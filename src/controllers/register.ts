import type { OpenAPIHono } from "@hono/zod-openapi";
import { messageHandler } from "./messages.controller.ts";
import { streamableHttpHandler, sseHandler } from "./sse.controller.ts";

import { openApiDocsHandler } from "@mcpc/core";

export const registerAgent = (app: OpenAPIHono) => {
  messageHandler(app);
  streamableHttpHandler(app); // Primary: Streamable HTTP at /mcp
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
};
