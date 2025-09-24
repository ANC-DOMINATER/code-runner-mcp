import type { OpenAPIHono } from "@hono/zod-openapi";
import { server } from "../app.ts";
import { runJS } from "../service/js-runner.ts";
import { runPy } from "../service/py-runner.ts";

/**
 * Alternative MCP handler that supports true HTTP streaming
 * for better compatibility with MCP clients that expect persistent connections
 */
export const mcpStreamHandler = (app: OpenAPIHono) => {
  // Handle MCP streaming protocol
  app.post("/mcp-stream", async (c) => {
    console.log("[MCP-Stream] Starting streaming connection...");
    
    // Set streaming headers
    c.header("Content-Type", "application/json");
    c.header("Cache-Control", "no-cache");
    c.header("Connection", "keep-alive");
    c.header("Access-Control-Allow-Origin", "*");
    c.header("Access-Control-Allow-Methods", "POST, OPTIONS");
    c.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    
    try {
      const body = await c.req.json();
      console.log("[MCP-Stream] Received:", JSON.stringify(body, null, 2));
      
      // Create a streaming response
      const stream = new ReadableStream({
        start(controller) {
          // Process the request and send response
          processStreamingRequest(body, controller);
        }
      });
      
      return new Response(stream, {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          "Access-Control-Allow-Origin": "*"
        }
      });
      
    } catch (error) {
      console.error("[MCP-Stream] Error:", error);
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
};

async function processStreamingRequest(body: any, controller: ReadableStreamDefaultController) {
  const encoder = new TextEncoder();
  
  try {
    let response: any;
    
    if (body.method === "initialize") {
      // Handle initialization
      const clientVersion = body.params?.protocolVersion;
      const supportedVersions = ["2024-11-05", "2025-03-26", "2025-06-18"];
      let protocolVersion = "2025-06-18";
      
      if (clientVersion && supportedVersions.includes(clientVersion)) {
        protocolVersion = clientVersion;
      }
      
      response = {
        jsonrpc: "2.0",
        id: body.id,
        result: {
          protocolVersion,
          capabilities: {
            tools: {},
            prompts: {},
            resources: {}
          },
          serverInfo: {
            name: "code-runner-mcp",
            version: "0.2.0"
          }
        }
      };
    }
    else if (body.method === "tools/list") {
      response = {
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
    }
    else {
      // Method not found
      response = {
        jsonrpc: "2.0",
        id: body.id,
        error: {
          code: -32601,
          message: `Method '${body.method}' not found`
        }
      };
    }
    
    // Send the response
    const responseText = JSON.stringify(response) + "\n";
    controller.enqueue(encoder.encode(responseText));
    controller.close();
    
    console.log("[MCP-Stream] Response sent:", response);
    
  } catch (error) {
    console.error("[MCP-Stream] Processing error:", error);
    const errorResponse = {
      jsonrpc: "2.0",
      id: body.id || null,
      error: {
        code: -32603,
        message: "Internal error",
        data: error instanceof Error ? error.message : "Unknown error"
      }
    };
    
    controller.enqueue(encoder.encode(JSON.stringify(errorResponse) + "\n"));
    controller.close();
  }
}