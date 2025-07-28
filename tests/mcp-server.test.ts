import { assertEquals, assertExists } from "./setup.ts";
import { withEnv } from "./setup.ts";
import { setUpMcpServer } from "../src/set-up-mcp.ts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

Deno.test("MCP Server Setup - Basic Initialization", () => {
  const server = setUpMcpServer(
    { name: "test-server", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );
  
  assertExists(server);
  assertEquals(server instanceof McpServer, true);
});

Deno.test("MCP Server Setup - Tools Registration", () => {
  const server = setUpMcpServer(
    { name: "test-server", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );
  
  // The server should have tools registered
  // We can't directly access the tools, but we can verify the server exists
  assertExists(server);
});

Deno.test("MCP Server Setup - With Environment Variables", () => {
  withEnv({
    "NODEFS_ROOT": "/tmp/test",
    "NODEFS_MOUNT_POINT": "/mnt/test", 
    "DENO_PERMISSION_ARGS": "--allow-net --allow-env"
  }, () => {
    const server = setUpMcpServer(
      { name: "test-server", version: "0.1.0" },
      { capabilities: { tools: {} } }
    );
    
    assertExists(server);
  });
});

Deno.test("MCP Server Setup - Default Environment", () => {
  // Test with minimal environment (should still work)
  withEnv({}, () => {
    const server = setUpMcpServer(
      { name: "test-server", version: "0.1.0" },
      { capabilities: { tools: {} } }
    );
    
    assertExists(server);
  });
});
