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
  app.get("/health", async (c) => {
    try {
      // Basic health check
      const health = {
        status: "healthy",
        timestamp: new Date().toISOString(),
        service: "code-runner-mcp",
        version: "0.2.0",
        components: {
          server: "healthy",
          javascript: "healthy",
          python: "checking..."
        }
      };

      // Quick check for JavaScript runtime (should always work)
      try {
        const testJs = "console.log('JS runtime test')";
        // Don't actually run it, just verify the function exists
        if (typeof eval === 'function') {
          health.components.javascript = "healthy";
        }
      } catch {
        health.components.javascript = "unhealthy";
      }

      // Check Python runtime status without blocking
      Promise.resolve().then(async () => {
        try {
          // Import and check if initialization promise exists
          const { initializePyodide } = await import("../service/py-runner.ts");
          await Promise.race([
            initializePyodide,
            new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000))
          ]);
          health.components.python = "healthy";
        } catch {
          health.components.python = "initializing";
        }
      });

      return c.json(health);
    } catch (error) {
      return c.json({
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        service: "code-runner-mcp",
        error: error instanceof Error ? error.message : "Unknown error"
      }, 500);
    }
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
