# ---------------------------------------------------------------------------
# Build stage
# ---------------------------------------------------------------------------
FROM node:22-alpine AS builder

WORKDIR /app

# better-sqlite3 is a native addon and needs a toolchain to compile.
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Reinstall without dev dependencies so only runtime packages are copied
# forward, keeping the final image small.
RUN npm ci --omit=dev

# ---------------------------------------------------------------------------
# Runtime stage
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runtime

ENV NODE_ENV=production

WORKDIR /app

# The stock `node` user (uid 1000) avoids running as root.
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./

# Uploaded datasets live here; mounted as a volume in compose so they survive a
# container restart.
RUN mkdir -p /app/uploads && chown node:node /app/uploads

USER node
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3001/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "dist/index.js"]
