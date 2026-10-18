FROM node:24-slim

WORKDIR /app

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
ENV LUMIERE_DATA_DIR=/data

EXPOSE 8080

# /data is provided at runtime by a mounted platform volume (Railway: mount a
# volume at /data). Deliberately no VOLUME directive here — it is unnecessary
# with an explicit mount and is mishandled by some hosted builders.
# Run Node directly (via tsx's ESM loader) instead of `npm start`:
# npm -> sh -> cross-env adds processes that swallow SIGTERM, which Railway
# sends on every redeploy. With node as PID 1 the server's graceful-shutdown
# handler runs and the SQLite database is closed cleanly before exit.
CMD ["node", "--import", "tsx", "server.ts"]

