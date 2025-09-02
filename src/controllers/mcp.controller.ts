import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import type { ErrorSchema as _ErrorSchema } from "@mcpc/core";
import { handleConnecting } from "@mcpc/core";
import { server } from "../app.ts";
import { INCOMING_MSG_ROUTE_PATH } from "../set-up-mcp.ts";

export const mcpHandler = (app: OpenAPIHono) => {
  // Handle MCP protocol requests (POST for JSON-RPC)
  app.post("/mcp", async (c) => {
    try {
      const body = await c.req.json();
      
      // Handle MCP JSON-RPC requests
      if (body.method === "initialize") {
        return c.json({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            protocolVersion: "2024-11-05",
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
      }
      
      if (body.method === "tools/list") {
        return c.json({
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
        });
      }
      
      if (body.method === "tools/call") {
        // Handle tool execution via the actual MCP server
        const response = await handleConnecting(c.req.raw, server, INCOMING_MSG_ROUTE_PATH);
        return response;
      }
      
      // Handle other MCP methods
      const response = await handleConnecting(c.req.raw, server, INCOMING_MSG_ROUTE_PATH);
      return response;
      
    } catch (error) {
      console.error("MCP protocol error:", error);
      return c.json({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32603,
          message: "Internal error",
          data: error instanceof Error ? error.message : "Unknown error"
        }
      }, 500);
    }
  });

  // Handle connection via GET (for basic info)
  app.get("/mcp", async (c) => {
    return c.json({
      jsonrpc: "2.0",
      result: {
        protocolVersion: "2024-11-05",
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
