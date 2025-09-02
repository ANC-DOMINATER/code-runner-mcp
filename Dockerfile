FROM denoland/deno:latest

# Create working directory
WORKDIR /app

# Copy your local source code
COPY . .

# Cache dependencies
RUN deno cache src/server.ts

# Expose port
EXPOSE 9000

# Run the local server file directly
ENTRYPOINT ["deno", "run", "--allow-all", "src/server.ts"]