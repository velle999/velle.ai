FROM node:20-slim

WORKDIR /app

# Install build tools for better-sqlite3
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Copy package files and install deps
COPY package.json ./
RUN npm install --production

# Copy app
COPY server/ ./server/
COPY public/ ./public/
COPY assets/ ./assets/
COPY personalities/ ./personalities/

# Create memory directory
RUN mkdir -p /app/memory

# Expose port
EXPOSE 3000

# Environment
ENV PORT=3000
ENV MODEL=auto
ENV OLLAMA_URL=http://host.docker.internal:11434

# Health check
HEALTHCHECK --interval=30s --timeout=5s \
  CMD curl -f http://localhost:3000/ || exit 1

CMD ["node", "server/index.js"]
