/// <reference path="./types/dom.d.ts" />

// Production configuration constants
export const CONFIG = {
  // Server configuration
  SERVER: {
    NAME: "code-runner-mcp",
    VERSION: "0.2.0",
    PROTOCOL_VERSION: "2025-06-18",
    DEFAULT_PORT: 9000,
    DEFAULT_HOSTNAME: "0.0.0.0"
  },

  // Execution timeouts (in milliseconds)
  TIMEOUTS: {
    PYTHON_INIT: 60000,       // 1 minute
    PYTHON_EXECUTION: 240000, // 4 minutes
    JAVASCRIPT_EXECUTION: 60000, // 1 minute
    HEALTH_CHECK: 3000        // 3 seconds
  },

  // Output limits
  LIMITS: {
    MAX_CODE_LENGTH: 50000,   // 50KB
    MAX_OUTPUT_LENGTH: 100000, // 100KB
    MAX_CHUNK_SIZE: 8192      // 8KB
  },

  // MCP Protocol constants
  MCP: {
    SUPPORTED_VERSIONS: ["2024-11-05", "2025-03-26", "2025-06-18"],
    JSON_RPC_VERSION: "2.0",
    ERROR_CODES: {
      PARSE_ERROR: -32700,
      INVALID_REQUEST: -32600,
      METHOD_NOT_FOUND: -32601,
      INVALID_PARAMS: -32602,
      INTERNAL_ERROR: -32603,
      TIMEOUT: -32001
    },
    // Hybrid compatibility settings
    COMPATIBILITY: {
      ACCEPT_LEGACY_PARAMS: true,    // Accept both 'arguments' and 'params' fields
      FLEXIBLE_ERROR_FORMAT: true,   // Support different error response formats
      LEGACY_CONTENT_FORMAT: true    // Support older content response formats
    }
  },

  // Environment variables
  ENV: {
    NODE_ENV: (globalThis as any).Deno?.env?.get("NODE_ENV") || "development",
    PORT: Number((globalThis as any).Deno?.env?.get("PORT") || "9000"),
    DENO_PERMISSION_ARGS: (globalThis as any).Deno?.env?.get("DENO_PERMISSION_ARGS") || "--allow-net",
    PYODIDE_PACKAGE_BASE_URL: (globalThis as any).Deno?.env?.get("PYODIDE_PACKAGE_BASE_URL")
  }
} as const;

// Utility functions
export const createErrorResponse = (id: any, code: number, message: string, data?: any) => ({
  jsonrpc: CONFIG.MCP.JSON_RPC_VERSION,
  id,
  error: { code, message, ...(data && { data }) }
});

export const createSuccessResponse = (id: any, result: any) => ({
  jsonrpc: CONFIG.MCP.JSON_RPC_VERSION,
  id,
  result
});

export const createServerInfo = () => ({
  name: CONFIG.SERVER.NAME,
  version: CONFIG.SERVER.VERSION
});

export const createCapabilities = () => ({
  tools: {},
  prompts: {},
  resources: {}
});

// Logging utility
export const createLogger = (component: string) => ({
  info: (message: string, ...args: any[]) => 
    console.log(`[${new Date().toISOString()}][${component}] ${message}`, ...args),
  warn: (message: string, ...args: any[]) => 
    console.warn(`[${new Date().toISOString()}][${component}] WARN: ${message}`, ...args),
  error: (message: string, ...args: any[]) => 
    console.error(`[${new Date().toISOString()}][${component}] ERROR: ${message}`, ...args)
});