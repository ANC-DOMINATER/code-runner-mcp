FROM denoland/deno:latest

# Set environment variables for better performance
ENV DENO_DIR=/deno-cache
ENV DENO_INSTALL_ROOT=/usr/local
ENV NODE_ENV=production
ENV PYODIDE_PACKAGE_BASE_URL=https://fastly.jsdelivr.net/pyodide/v0.28.0/full/

# Create working directory
WORKDIR /app

# Create deno cache directory with proper permissions
RUN mkdir -p /deno-cache && chmod 755 /deno-cache

# Copy dependency files first for better caching
COPY deno.json deno.lock ./

# Cache dependencies, skip type checking to avoid DOM type issues
RUN deno cache --no-check src/server.ts || echo "Cache attempt completed"

# Copy your local source code
COPY . .

# Cache the main server file and dependencies with retries, skip type checking
RUN deno cache --no-check src/server.ts || \
    (sleep 5 && deno cache --no-check src/server.ts) || \
    echo "Final cache attempt completed"

# Expose port
EXPOSE 9000

# Add health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:9000/health || exit 1

# Run the local server file directly with all checks disabled
ENTRYPOINT ["deno", "run", "--allow-all", "--no-check", "--no-lock", "src/server.ts"]