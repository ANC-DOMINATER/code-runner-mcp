import { OpenAPIHono } from "@hono/zod-openapi";
import { createApp } from "./app.ts";
import process from "node:process";

const port = Number(process.env.PORT || 9000);
const hostname = "0.0.0.0";

const app = new OpenAPIHono();

// Mount routes at root path instead of /code-runner
app.route("/", createApp());

// Add a simple root endpoint for health check
app.get("/", (c) => {
  return c.json({ 
    message: "Code Runner MCP Server is running!", 
    version: "0.1.0",
    endpoints: {
      health: "/health",
      docs: "/docs"
    }
  });
});

Deno.serve(
  {
    port,
    hostname,
  },
  app.fetch
);
