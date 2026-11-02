# Multi-stage production Dockerfile
FROM node:22-alpine AS runner

WORKDIR /app

# Set production environment
ENV NODE_ENV=production
ENV PORT=3000

# Copy package descriptors
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy application code and public assets
COPY src/ ./src/
COPY public/ ./public/

# Create data directory for SQLite persistence (if not using PostgreSQL)
RUN mkdir -p /app/data && chown -R node:node /app

USER node

EXPOSE 3000

CMD ["node", "src/server.js"]
