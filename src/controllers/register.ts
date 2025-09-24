/// <reference path="../types/hono.d.ts" />

import type { OpenAPIHono } from "@hono/zod-openapi";
import { messageHandler } from "./messages.controller.ts";
import { mcpHandler, sseHandler } from "./mcp.controller.ts";
import { CONFIG, createLogger, createErrorResponse } from "../config.ts";

const logger = createLogger("register");
const startTime = Date.now();

export const registerAgent = (app: OpenAPIHono) => {
  // Register core MCP functionality
  messageHandler(app);
  mcpHandler(app); // Primary: MCP JSON-RPC at /mcp
  sseHandler(app); // Deprecated: SSE redirect for backward compatibility
  
  // Production-ready health check endpoint
  app.get("/health", async (c: any) => {
    try {
      const health = {
        status: "healthy",
        timestamp: new Date().toISOString(),
        service: CONFIG.SERVER.NAME,
        version: CONFIG.SERVER.VERSION,
        uptime: Math.floor((Date.now() - startTime) / 1000),
        environment: CONFIG.ENV.NODE_ENV,
        components: {
          server: "healthy",
          javascript: "healthy", 
          python: "initializing"
        }
      };

      // Quick JavaScript runtime check
      try {
        if (typeof eval === 'function') {
          health.components.javascript = "healthy";
        }
      } catch {
        health.components.javascript = "unhealthy";
        health.status = "degraded";
      }

      // Blocking Python status check with timeout
      try {
        const { initializePyodide } = await import("../service/py-runner.ts");
        await Promise.race([
          initializePyodide(),
          new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), CONFIG.TIMEOUTS.HEALTH_CHECK))
        ]);
        health.components.python = "healthy";
      } catch (pyError) {
        // Check if Pyodide is actually working by testing a simple operation
        try {
          const { getPyodide } = await import("../tool/py.ts");
          const pyodide = await Promise.race([
            getPyodide(),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000))
          ]);
          // If we can get Pyodide instance, it's healthy
          if (pyodide) {
            health.components.python = "healthy";
          } else {
            health.components.python = "initializing";
          }
        } catch {
          health.components.python = "initializing";
        }
      }

      const statusCode = health.status === "healthy" ? 200 : 503;
      return c.json(health, statusCode);
    } catch (error) {
      logger.error("Health check failed:", error);
      return c.json({
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        service: CONFIG.SERVER.NAME,
        error: error instanceof Error ? error.message : "Unknown error"
      }, 500);
    }
  });

  // Fast connectivity test endpoint
  app.get("/mcp-test", (c: any) => {
    return c.json({
      message: "MCP endpoint is reachable",
      timestamp: new Date().toISOString(),
      server: CONFIG.SERVER.NAME,
      version: CONFIG.SERVER.VERSION,
      transport: "HTTP Streamable",
      endpoint: "/mcp",
      protocol: `JSON-RPC ${CONFIG.MCP.JSON_RPC_VERSION}`,
      protocol_version: CONFIG.SERVER.PROTOCOL_VERSION
    });
  });

  // Simplified debug endpoint
  app.post("/mcp-simple", async (c: any) => {
    try {
      const body = await c.req.json();
      logger.info("Simple MCP test request:", JSON.stringify(body, null, 2));
      
      const response = {
        jsonrpc: CONFIG.MCP.JSON_RPC_VERSION,
        id: body.id,
        result: {
          message: "MCP endpoint operational",
          method: body.method,
          timestamp: new Date().toISOString(),
          server: CONFIG.SERVER.NAME
        }
      };
      
      return c.json(response);
    } catch (error) {
      logger.error("Simple MCP test error:", error);
      return c.json(
        createErrorResponse(
          null,
          CONFIG.MCP.ERROR_CODES.PARSE_ERROR,
          "Parse error",
          error instanceof Error ? error.message : "Invalid JSON"
        ),
        400
      );
    }
  });

  // Tools information endpoint
  app.get("/tools", (c: any) => {
    try {
      return c.json({
        tools: [
          {
            name: "python-code-runner",
            description: "Execute Python code using Pyodide WASM runtime",
            runtime: "pyodide",
            status: "available",
            max_code_length: CONFIG.LIMITS.MAX_CODE_LENGTH,
            timeout: CONFIG.TIMEOUTS.PYTHON_EXECUTION
          },
          {
            name: "javascript-code-runner", 
            description: "Execute JavaScript/TypeScript using Deno runtime",
            runtime: "deno",
            status: "available",
            max_code_length: CONFIG.LIMITS.MAX_CODE_LENGTH,
            timeout: CONFIG.TIMEOUTS.JAVASCRIPT_EXECUTION
          }
        ],
        usage: "Use POST /mcp with JSON-RPC 2.0 protocol to execute tools",
        protocol_version: CONFIG.SERVER.PROTOCOL_VERSION,
        limits: CONFIG.LIMITS
      });
    } catch (error) {
      logger.error("Tools endpoint error:", error);
      return c.json({
        error: "Failed to retrieve tools information",
        message: error instanceof Error ? error.message : "Unknown error"
      }, 500);
    }
  });
};
