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
      let body;
      try {
        body = await c.req.json();
      } catch (parseError) {
        console.error("[MCP] JSON parse error:", parseError);
        return c.json({
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32700,
            message: "Parse error",
            data: parseError instanceof Error ? parseError.message : "Invalid JSON"
          }
        }, 400);
      }
      
      // Log for debugging
      console.log("[MCP] Request:", JSON.stringify(body, null, 2));
      
      // Handle MCP JSON-RPC requests
      if (body.method === "initialize") {
        // MCP Protocol Version Negotiation
        // According to spec: servers MAY support multiple protocol versions
        // but MUST agree on a single version for the session
        const clientVersion = body.params?.protocolVersion;
        const supportedVersions = [
          "2024-11-05",  // Legacy support
          "2025-03-26",  // n8n version support
          "2025-06-18"   // Current specification
        ];
        
        // Use the client's version if supported, otherwise use the latest we support
        let protocolVersion = "2025-06-18"; // Default to latest
        if (clientVersion && supportedVersions.includes(clientVersion)) {
          protocolVersion = clientVersion;
        }
        
        const response = {
          jsonrpc: "2.0",
          id: body.id,
          result: {
            protocolVersion,
            capabilities: {
              tools: {},  // Tools capability - empty object means we support tools
              prompts: {},
              resources: {}
            },
            serverInfo: {
              name: "code-runner-mcp",
              version: "0.2.0"
            }
          }
        };
        
        console.log("[MCP] Initialize response:", JSON.stringify(response, null, 2));
        
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
                description: "Execute Python code with package imports using Pyodide WASM. Supports scientific computing libraries like pandas, numpy, matplotlib, etc.",
                inputSchema: {
                  type: "object",
                  properties: {
                    code: {
                      type: "string",
                      description: "Python source code to execute"
                    },
                    importToPackageMap: {
                      type: "object",
                      additionalProperties: {
                        type: "string"
                      },
                      description: "Optional mapping from import names to package names for micropip installation (e.g., {'sklearn': 'scikit-learn', 'PIL': 'Pillow'})"
                    }
                  },
                  required: ["code"],
                  additionalProperties: false
                }
              },
              {
                name: "javascript-code-runner",
                description: "Execute JavaScript/TypeScript code using Deno runtime. Supports npm packages, JSR packages, and Node.js built-ins.",
                inputSchema: {
                  type: "object",
                  properties: {
                    code: {
                      type: "string",
                      description: "JavaScript/TypeScript source code to execute"
                    }
                  },
                  required: ["code"],
                  additionalProperties: false
                }
              }
            ]
          }
        };
        
        console.log("[MCP] Tools list response:", JSON.stringify(response, null, 2));
        
        c.header("Content-Type", "application/json");
        return c.json(response);
      }
      
      if (body.method === "tools/call") {
        console.log("[MCP] Tools call request:", JSON.stringify(body.params, null, 2));
        
        if (!body.params || !body.params.name) {
          return c.json({
            jsonrpc: "2.0",
            id: body.id,
            error: {
              code: -32602,
              message: "Invalid params - missing tool name"
            }
          });
        }
        
        const { name, arguments: args } = body.params;
        
        try {
          if (name === "python-code-runner") {
            if (!args || typeof args.code !== "string") {
              return c.json({
                jsonrpc: "2.0",
                id: body.id,
                error: {
                  code: -32602,
                  message: "Invalid params - code parameter is required and must be a string"
                }
              });
            }
            
            // Validate code length to prevent excessive execution
            if (args.code.length > 50000) {
              return c.json({
                jsonrpc: "2.0",
                id: body.id,
                error: {
                  code: -32602,
                  message: "Code too long - maximum 50,000 characters allowed"
                }
              });
            }
            
            console.log("[MCP] Executing Python code:", args.code.substring(0, 200) + (args.code.length > 200 ? "..." : ""));
            
            const options = args.importToPackageMap ? { importToPackageMap: args.importToPackageMap } : undefined;
            
            let stream;
            try {
              // Add timeout protection for the entire Python execution
              const executionPromise = runPy(args.code, options);
              const timeoutPromise = new Promise<never>((_, reject) => {
                setTimeout(() => {
                  reject(new Error("Python execution timeout (4 minutes)"));
                }, 240000); // 4 minutes total timeout
              });
              
              stream = await Promise.race([executionPromise, timeoutPromise]);
            } catch (initError) {
              console.error("[MCP] Python initialization/execution error:", initError);
              return c.json({
                jsonrpc: "2.0",
                id: body.id,
                error: {
                  code: -32603,
                  message: "Python execution failed",
                  data: initError instanceof Error ? initError.message : "Unknown execution error"
                }
              });
            }
            
            const decoder = new TextDecoder();
            let output = "";
            
            try {
              for await (const chunk of stream) {
                output += decoder.decode(chunk);
                // Prevent excessive output
                if (output.length > 100000) {
                  output += "\n[OUTPUT TRUNCATED - Maximum 100KB limit reached]";
                  break;
                }
              }
            } catch (streamError) {
              console.error("[MCP] Python stream error:", streamError);
              return c.json({
                jsonrpc: "2.0",
                id: body.id,
                error: {
                  code: -32603,
                  message: "Python execution failed",
                  data: streamError instanceof Error ? streamError.message : "Stream processing error"
                }
              });
            }
            
            const response = {
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
            };
            
            console.log("[MCP] Python execution completed, output length:", output.length);
            return c.json(response);
          }
          
          if (name === "javascript-code-runner") {
            if (!args || typeof args.code !== "string") {
              return c.json({
                jsonrpc: "2.0",
                id: body.id,
                error: {
                  code: -32602,
                  message: "Invalid params - code parameter is required and must be a string"
                }
              });
            }
            
            const stream = await runJS(args.code);
            const decoder = new TextDecoder();
            let output = "";
            
            try {
              for await (const chunk of stream) {
                output += decoder.decode(chunk);
              }
            } catch (streamError) {
              console.error("[MCP] JavaScript stream error:", streamError);
              return c.json({
                jsonrpc: "2.0",
                id: body.id,
                error: {
                  code: -32603,
                  message: "JavaScript execution failed",
                  data: streamError instanceof Error ? streamError.message : "Stream processing error"
                }
              });
            }
            
            const response = {
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
            };
            
            console.log("[MCP] JavaScript execution result:", JSON.stringify(response, null, 2));
            return c.json(response);
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
      console.error("[MCP] Unhandled protocol error:", error);
      console.error("[MCP] Stack trace:", error instanceof Error ? error.stack : "No stack trace");
      
      // Try to return a proper JSON-RPC error response
      try {
        return c.json({
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32603,
            message: "Internal error",
            data: error instanceof Error ? error.message : "Unknown error"
          }
        }, 500);
      } catch (responseError) {
        console.error("[MCP] Failed to send error response:", responseError);
        return c.text("Internal Server Error", 500);
      }
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
