FROM node:24-slim

WORKDIR /app

# pg_dump is used by the on-demand database backup script.
RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client \
  && rm -rf /var/lib/apt/lists/*

# Install dependencies first so Docker can cache that layer
COPY package.json package-lock.json ./
RUN npm ci

# Copy application source and build the frontend
COPY . .
RUN npm run build

# Production environment (single-line ENVs: no backslash continuations that
# CRLF line endings could break on hosted Linux builders)
ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

# Run Node directly (via tsx's ESM loader) instead of `npm start`:
# npm -> sh -> cross-env adds processes that swallow SIGTERM, which Railway
# sends on every redeploy. With node as PID 1 the server can shut down cleanly.
CMD ["node", "--import", "tsx", "server.ts"]
