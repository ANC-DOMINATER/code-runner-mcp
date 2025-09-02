import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { server } from "../app.ts";
import { runJS } from "../service/js-runner.ts";
import { runPy } from "../service/py-runner.ts";

export const mcpHandler = (app: OpenAPIHono) => {
  // Add CORS headers middleware for MCP endpoint
  app.use("/mcp", async (c, next) => {
    // Set CORS headers
    c.header("Access-Control-Allow-Origin", "*");
    c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    c.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    c.header("Access-Control-Max-Age", "86400");
    
    await next();
  });

  // Handle CORS preflight requests
  app.options("/mcp", (c) => {
    return c.text("", 200);
  });

  // Handle MCP protocol requests (POST for JSON-RPC)
  app.post("/mcp", async (c) => {
    try {
      const body = await c.req.json();
      
      // Log incoming requests for debugging
      console.log("[MCP] Incoming request:", JSON.stringify(body, null, 2));
      console.log("[MCP] Headers:", Object.fromEntries(c.req.raw.headers.entries()));
      
      // Handle MCP JSON-RPC requests
      if (body.method === "initialize") {
        // Use the client's protocol version if provided, otherwise use our latest
        const clientProtocolVersion = body.params?.protocolVersion;
        const supportedVersions = ["2024-11-05", "2025-06-18"];
        const protocolVersion = supportedVersions.includes(clientProtocolVersion) 
          ? clientProtocolVersion 
          : "2025-06-18";
          
        const response = {
          jsonrpc: "2.0",
          id: body.id,
          result: {
            protocolVersion,
            capabilities: {
              tools: {
                listChanged: true
              },
              prompts: {},
              resources: {}
            },
            serverInfo: {
              name: "code-runner-mcp",
              version: "0.1.0"
            }
          }
        };
        
        // Ensure proper JSON response with CORS headers
        c.header("Content-Type", "application/json");
        return c.json(response);
      }
      
      if (body.method === "tools/list") {
        const response = {
          jsonrpc: "2.0",
          id: body.id,
          result: {
            tools: [
              {
                name: "python-code-runner",
                description: "Execute Python code with package imports using Pyodide WASM",
                inputSchema: {
                  type: "object",
                  properties: {
                    code: {
                      type: "string",
                      description: "Python source code to execute"
                    },
                    importToPackageMap: {
                      type: "object",
                      description: "Optional mapping from import names to package names for micropip installation"
                    }
                  },
                  required: ["code"]
                }
              },
              {
                name: "javascript-code-runner",
                description: "Execute JavaScript/TypeScript code using Deno runtime",
                inputSchema: {
                  type: "object",
                  properties: {
                    code: {
                      type: "string",
                      description: "JavaScript/TypeScript source code to execute"
                    }
                  },
                  required: ["code"]
                }
              }
            ]
          }
        };
        
        c.header("Content-Type", "application/json");
        return c.json(response);
      }
      
      if (body.method === "tools/call") {
        const { name, arguments: args } = body.params;
        
        try {
          if (name === "python-code-runner") {
            const options = args.importToPackageMap ? { importToPackageMap: args.importToPackageMap } : undefined;
            const stream = await runPy(args.code, options);
            const decoder = new TextDecoder();
            let output = "";
            for await (const chunk of stream) {
              output += decoder.decode(chunk);
            }
            
            return c.json({
              jsonrpc: "2.0",
              id: body.id,
              result: {
                content: [
                  {
                    type: "text",
                    text: output || "(no output)"
                  }
                ]
              }
            });
          }
          
          if (name === "javascript-code-runner") {
            const stream = await runJS(args.code);
            const decoder = new TextDecoder();
            let output = "";
            for await (const chunk of stream) {
              output += decoder.decode(chunk);
            }
            
            return c.json({
              jsonrpc: "2.0",
              id: body.id,
              result: {
                content: [
                  {
                    type: "text",
                    text: output || "(no output)"
                  }
                ]
              }
            });
          }
          
          // Tool not found
          return c.json({
            jsonrpc: "2.0",
            id: body.id,
            error: {
              code: -32601,
              message: `Tool '${name}' not found`
            }
          });
          
        } catch (error) {
          return c.json({
            jsonrpc: "2.0",
            id: body.id,
            error: {
              code: -32603,
              message: "Tool execution failed",
              data: error instanceof Error ? error.message : "Unknown error"
            }
          });
        }
      }
      
      // Method not found
      return c.json({
        jsonrpc: "2.0",
        id: body.id,
        error: {
          code: -32601,
          message: `Method '${body.method}' not found`
        }
      });
      
    } catch (error) {
      console.error("MCP protocol error:", error);
      return c.json({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32700,
          message: "Parse error",
          data: error instanceof Error ? error.message : "Unknown error"
        }
      }, 400);
    }
  });

  // Handle connection via GET (for basic info)
  app.get("/mcp", async (c) => {
    return c.json({
      jsonrpc: "2.0",
      result: {
        protocolVersion: "2025-06-18",
        capabilities: {
          tools: {
            listChanged: true
          },
          prompts: {},
          resources: {}
        },
        serverInfo: {
          name: "code-runner-mcp",
          version: "0.1.0"
        }
      }
    });
  });

  // Add endpoint for WebSocket upgrade (in case n8n needs WebSocket)
  app.get("/mcp/ws", async (c) => {
    return c.text("WebSocket endpoint - use appropriate WebSocket client", 426, {
      "Upgrade": "websocket",
      "Connection": "Upgrade"
    });
  });

  // Add alternative endpoint paths that n8n might expect
  app.post("/", async (c) => {
    // Redirect root POST requests to /mcp
    return app.fetch(new Request(c.req.url.replace(/\/$/, "/mcp"), c.req.raw));
  });
};

// Keep SSE for backward compatibility
export const sseHandler = (app: OpenAPIHono) =>
  app.openapi(
    createRoute({
      method: "get",
      path: "/sse",
      responses: {
        200: {
          content: {
            "text/event-stream": {
              schema: z.any(),
            },
          },
          description: "DEPRECATED: Use /mcp endpoint with Streamable HTTP instead",
        },
      },
    }),
    async (c) => {
      return c.redirect("/mcp", 301);
    }
  );
