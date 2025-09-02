import type { OpenAPIHono } from "@hono/zod-openapi";
import { messageHandler } from "./messages.controller.ts";
import { mcpHandler, sseHandler } from "./mcp.controller.ts";
import { server } from "../app.ts";

import { openApiDocsHandler } from "@mcpc/core";

export const registerAgent = (app: OpenAPIHono) => {
  messageHandler(app);
  mcpHandler(app); // Primary: MCP JSON-RPC at /mcp
  sseHandler(app); // Deprecated: SSE redirect for backward compatibility
  openApiDocsHandler(app);
  
  // Health check endpoint for DigitalOcean App Platform
  app.get("/health", (c) => {
    return c.json({ 
      status: "healthy", 
      timestamp: new Date().toISOString(),
      service: "code-runner-mcp"
    });
  });

  // Tools list endpoint for debugging - only show actual tools
  app.get("/tools", (c) => {
    try {
      const capabilities = server.getCapabilities?.();
      return c.json({
        capabilities: capabilities || {},
        available_tools: [
          "python-code-runner",
          "javascript-code-runner"
        ],
        usage: "Use POST /mcp with JSON-RPC to execute tools"
      });
    } catch (error) {
      return c.json({
        error: "Failed to get server capabilities",
        message: error instanceof Error ? error.message : "Unknown error"
      }, 500);
    }
  });
};
