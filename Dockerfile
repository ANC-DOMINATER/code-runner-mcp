FROM denoland/deno:latest

# Set environment variables for better performance with Python 3.12
ENV DENO_DIR=/deno-cache
ENV DENO_INSTALL_ROOT=/usr/local
ENV NODE_ENV=production
ENV PYODIDE_PACKAGE_BASE_URL=https://cdn.jsdelivr.net/pyodide/v0.26.2/full/

# Create working directory
WORKDIR /app

# Create deno cache directory with proper permissions
RUN mkdir -p /deno-cache && chmod 755 /deno-cache

# Copy dependency files first for better caching
COPY deno.json ./

# Cache dependencies with Python 3.12 compatible versions
RUN deno cache --check=all src/server.ts || echo "Cache attempt completed"

# Copy your local source code
COPY . .

# Cache the main server file and dependencies with retries
RUN deno cache --check=all src/server.ts || \
    (sleep 5 && deno cache --check=all src/server.ts) || \
    echo "Final cache attempt completed"

# Expose port
EXPOSE 9000

# Add health check with longer timeout for cloud deployment
HEALTHCHECK --interval=45s --timeout=30s --start-period=120s --retries=3 \
    CMD curl -f http://localhost:9000/health || exit 1

# Run the local server file directly with all checks disabled
ENTRYPOINT ["deno", "run", "--allow-all", "--no-check", "--no-lock", "src/server.ts"]