FROM denoland/deno:latest

# Create working directory
WORKDIR /app

# Cache dependencies for faster builds
RUN deno cache jsr:@mcpc/code-runner-mcp

# Expose port
EXPOSE 9000

# Run the HTTP server instead of STDIO server for DigitalOcean
ENTRYPOINT ["deno", "run", "--allow-all", "jsr:@mcpc/code-runner-mcp/server"]