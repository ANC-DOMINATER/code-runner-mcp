import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import type { ErrorSchema as _ErrorSchema } from "@mcpc/core";
import { handleConnecting } from "@mcpc/core";
import { server } from "../app.ts";
import { INCOMING_MSG_ROUTE_PATH } from "../set-up-mcp.ts";

export const streamableHttpHandler = (app: OpenAPIHono) => {
  // Simple test endpoint to check if MCP server info is accessible
  app.get("/mcp", async (c) => {
    try {
      // Return basic MCP server information for testing
      return c.json({
        jsonrpc: "2.0",
        result: {
          protocolVersion: "2024-11-05",
          capabilities: {
            tools: {},
            prompts: {},
            resources: {}
          },
          serverInfo: {
            name: "code-runner-mcp",
            version: "0.1.0"
          }
        }
      });
    } catch (error) {
      console.error("MCP endpoint error:", error);
      return c.json({
        error: "Failed to handle MCP request",
        message: error instanceof Error ? error.message : "Unknown error"
      }, 500);
    }
  });

  // Handle actual MCP communication via POST
  app.post("/mcp", async (c) => {
    try {
      // This should handle the actual MCP protocol messages
      const response = await handleConnecting(
        c.req.raw,
        server,
        INCOMING_MSG_ROUTE_PATH
      );
      return response;
    } catch (error) {
      console.error("MCP POST error:", error);
      return c.json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal error",
          data: error instanceof Error ? error.message : "Unknown error"
        }
      }, 500);
    }
  });
};

// Keep SSE for backward compatibility but mark as deprecated
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
        400: {
          content: {
            "application/json": {
              schema: z.any(),
            },
          },
          description: "Returns an error",
        },
      },
    }),
    async (c) => {
      // Redirect to the new streamable HTTP endpoint
      return c.redirect("/mcp", 301);
    }
  );
