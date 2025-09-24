/// <reference path="../types/hono.d.ts" />
/// <reference path="../types/deno.d.ts" />

import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { runJS } from "../service/js-runner.ts";
import { runPy } from "../service/py-runner.ts";
import { CONFIG, createLogger, createErrorResponse, createSuccessResponse, createServerInfo, createCapabilities } from "../config.ts";

const logger = createLogger("mcp");

export const mcpHandler = (app: OpenAPIHono) => {
  // Add CORS headers middleware for MCP endpoint
  app.use("/mcp", async (c: any, next: any) => {
    // Set CORS headers
    c.header("Access-Control-Allow-Origin", "*");
    c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    c.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-ID");
    c.header("Access-Control-Max-Age", "86400");
    
    // Add connection and caching headers for better client compatibility
    c.header("Connection", "keep-alive");
    c.header("Keep-Alive", "timeout=120, max=100");
    c.header("Cache-Control", "no-cache, no-store, must-revalidate");
    c.header("X-Content-Type-Options", "nosniff");
    
    await next();
  });

  // Handle CORS preflight requests
  app.options("/mcp", (c: any) => {
    return c.text("", 200);
  });

  // Handle MCP protocol requests (POST for JSON-RPC)
  app.post("/mcp", async (c: any) => {
    const startTime = Date.now();
    const requestId = Math.random().toString(36).substring(7);
    
    logger.info(`Request started [${requestId}]`);
    
    // Immediately set response headers for streaming compatibility
    c.header("Content-Type", "application/json");
    c.header("Transfer-Encoding", "chunked");
    
    try {
      let body;
      try {
        body = await c.req.json();
        logger.info(`Request body [${requestId}]:`, JSON.stringify(body, null, 2));
      } catch (parseError) {
        logger.error(`JSON parse error [${requestId}]:`, parseError);
        return c.json(
          createErrorResponse(null, CONFIG.MCP.ERROR_CODES.PARSE_ERROR, "Parse error", 
            parseError instanceof Error ? parseError.message : "Invalid JSON"),
          400
        );
      }
      
      // Handle MCP JSON-RPC requests
      if (body.method === "initialize") {
        // MCP Protocol Version Negotiation
        const clientVersion = body.params?.protocolVersion;
        let protocolVersion = CONFIG.SERVER.PROTOCOL_VERSION; // Default to latest
        
        if (clientVersion && CONFIG.MCP.SUPPORTED_VERSIONS.includes(clientVersion)) {
          protocolVersion = clientVersion;
        }
        
        const response = createSuccessResponse(body.id, {
          protocolVersion,
          capabilities: createCapabilities(),
          serverInfo: createServerInfo()
        });
        
        logger.info(`Initialize response [${requestId}]:`, JSON.stringify(response, null, 2));
        const elapsed = Date.now() - startTime;
        logger.info(`Initialize completed in ${elapsed}ms [${requestId}]`);
        
        return c.json(response);
      }
      
      if (body.method === "tools/list") {
        const response = createSuccessResponse(body.id, {
          tools: [
            {
              name: "python-code-runner",
              description: "Execute Python code with package imports using Pyodide WASM. Supports scientific computing libraries like pandas, numpy, matplotlib, etc.",
              inputSchema: {
                type: "object",
                properties: {
                  code: {
                    type: "string",
                    description: "Python source code to execute",
                    maxLength: CONFIG.LIMITS.MAX_CODE_LENGTH
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
                    description: "JavaScript/TypeScript source code to execute",
                    maxLength: CONFIG.LIMITS.MAX_CODE_LENGTH
                  }
                },
                required: ["code"],
                additionalProperties: false
              }
            }
          ]
        });
        
        logger.info("Tools list response:", JSON.stringify(response, null, 2));
        return c.json(response);
      }
      
      if (body.method === "tools/call") {
        logger.info("Tools call request:", JSON.stringify(body.params, null, 2));
        
        if (!body.params || !body.params.name) {
          return c.json(
            createErrorResponse(body.id, CONFIG.MCP.ERROR_CODES.INVALID_PARAMS, "Invalid params - missing tool name")
          );
        }
        
        const { name, arguments: args } = body.params;
        
        try {
          if (name === "python-code-runner") {
            if (!args || typeof args.code !== "string") {
              return c.json(
                createErrorResponse(body.id, CONFIG.MCP.ERROR_CODES.INVALID_PARAMS, 
                  "Invalid params - code parameter is required and must be a string")
              );
            }
            
            // Validate code length to prevent excessive execution
            if (args.code.length > CONFIG.LIMITS.MAX_CODE_LENGTH) {
              return c.json(
                createErrorResponse(body.id, CONFIG.MCP.ERROR_CODES.INVALID_PARAMS,
                  `Code too long - maximum ${CONFIG.LIMITS.MAX_CODE_LENGTH} characters allowed`)
              );
            }
            
            logger.info("Executing Python code:", args.code.substring(0, 200) + (args.code.length > 200 ? "..." : ""));
            
            const options = args.importToPackageMap ? { importToPackageMap: args.importToPackageMap } : undefined;
            
            let stream;
            try {
              // Add timeout protection for the entire Python execution
              const executionPromise = runPy(args.code, options);
              const timeoutPromise = new Promise<never>((_, reject) => {
                setTimeout(() => {
                  reject(new Error("Python execution timeout"));
                }, CONFIG.TIMEOUTS.PYTHON_EXECUTION);
              });
              
              stream = await Promise.race([executionPromise, timeoutPromise]);
            } catch (initError) {
              logger.error("Python initialization/execution error:", initError);
              return c.json(
                createErrorResponse(body.id, CONFIG.MCP.ERROR_CODES.INTERNAL_ERROR, 
                  "Python execution failed", initError instanceof Error ? initError.message : "Unknown execution error")
              );
            }
            
            const decoder = new TextDecoder();
            let output = "";
            
            try {
              for await (const chunk of stream) {
                output += decoder.decode(chunk);
                // Prevent excessive output
                if (output.length > CONFIG.LIMITS.MAX_OUTPUT_LENGTH) {
                  output += `\n[OUTPUT TRUNCATED - Maximum ${CONFIG.LIMITS.MAX_OUTPUT_LENGTH / 1000}KB limit reached]`;
                  break;
                }
              }
            } catch (streamError) {
              logger.error("Python stream error:", streamError);
              return c.json(
                createErrorResponse(body.id, CONFIG.MCP.ERROR_CODES.INTERNAL_ERROR,
                  "Python execution failed", streamError instanceof Error ? streamError.message : "Stream processing error")
              );
            }
            
            const response = createSuccessResponse(body.id, {
              content: [
                {
                  type: "text",
                  text: output || "(no output)"
                }
              ]
            });
            
            logger.info("Python execution completed, output length:", output.length);
            return c.json(response);
          }
          
          if (name === "javascript-code-runner") {
            if (!args || typeof args.code !== "string") {
              return c.json(
                createErrorResponse(body.id, CONFIG.MCP.ERROR_CODES.INVALID_PARAMS,
                  "Invalid params - code parameter is required and must be a string")
              );
            }
            
            // Validate code length
            if (args.code.length > CONFIG.LIMITS.MAX_CODE_LENGTH) {
              return c.json(
                createErrorResponse(body.id, CONFIG.MCP.ERROR_CODES.INVALID_PARAMS,
                  `Code too long - maximum ${CONFIG.LIMITS.MAX_CODE_LENGTH} characters allowed`)
              );
            }
            
            const stream = await runJS(args.code);
            const decoder = new TextDecoder();
            let output = "";
            
            try {
              for await (const chunk of stream) {
                output += decoder.decode(chunk);
                if (output.length > CONFIG.LIMITS.MAX_OUTPUT_LENGTH) {
                  output += `\n[OUTPUT TRUNCATED - Maximum ${CONFIG.LIMITS.MAX_OUTPUT_LENGTH / 1000}KB limit reached]`;
                  break;
                }
              }
            } catch (streamError) {
              logger.error("JavaScript stream error:", streamError);
              return c.json(
                createErrorResponse(body.id, CONFIG.MCP.ERROR_CODES.INTERNAL_ERROR,
                  "JavaScript execution failed", streamError instanceof Error ? streamError.message : "Stream processing error")
              );
            }
            
            const response = createSuccessResponse(body.id, {
              content: [
                {
                  type: "text",
                  text: output || "(no output)"
                }
              ]
            });
            
            logger.info("JavaScript execution completed, output length:", output.length);
            return c.json(response);
          }
          
          // Tool not found
          return c.json(
            createErrorResponse(body.id, CONFIG.MCP.ERROR_CODES.METHOD_NOT_FOUND, `Tool '${name}' not found`)
          );
          
        } catch (error) {
          return c.json(
            createErrorResponse(body.id, CONFIG.MCP.ERROR_CODES.INTERNAL_ERROR,
              "Tool execution failed", error instanceof Error ? error.message : "Unknown error")
          );
        }
      }
      
      // Method not found
      return c.json(
        createErrorResponse(body.id, CONFIG.MCP.ERROR_CODES.METHOD_NOT_FOUND, `Method '${body.method}' not found`)
      );
      
    } catch (error) {
      const elapsed = Date.now() - startTime;
      logger.error(`Unhandled protocol error after ${elapsed}ms [${requestId}]:`, error);
      
      // Try to return a proper JSON-RPC error response
      try {
        const errorResponse = createErrorResponse(null, CONFIG.MCP.ERROR_CODES.INTERNAL_ERROR, 
          "Internal error", error instanceof Error ? error.message : "Unknown error");
        return c.json(errorResponse, 500);
      } catch (responseError) {
        logger.error(`Failed to send error response [${requestId}]:`, responseError);
        return c.text("Internal Server Error", 500);
      }
    }
  });

  // Handle connection via GET (for basic info)
  app.get("/mcp", async (c: any) => {
    return c.json({
      jsonrpc: CONFIG.MCP.JSON_RPC_VERSION,
      result: {
        protocolVersion: CONFIG.SERVER.PROTOCOL_VERSION,
        capabilities: createCapabilities(),
        serverInfo: createServerInfo()
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
    async (c: any) => {
      return c.redirect("/mcp", 301);
    }
  );
