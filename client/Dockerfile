# ---------------------------------------------------------------------------
# Build stage
# ---------------------------------------------------------------------------
FROM node:22-alpine AS builder

WORKDIR /app

# Copy manifests first so the dependency layer is cached independently of source
# changes; editing a component should not trigger a reinstall.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Vite inlines VITE_* variables at build time, so the API URL must be supplied
# here rather than at runtime.
ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

RUN npm run build

# ---------------------------------------------------------------------------
# Runtime stage
# ---------------------------------------------------------------------------
FROM nginx:1.27-alpine AS runtime

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY security-headers.conf /etc/nginx/snippets/security-headers.conf

# The stock image runs as root. Dropping to the bundled `nginx` user requires
# every path nginx writes to be writable by it:
#   - the pid file defaults to /run/nginx.pid, which only root may create, so it
#     is relocated to /tmp
#   - the proxy and body temp directories live under /var/cache/nginx
#   - the entrypoint scripts rewrite files in /etc/nginx at container start
RUN sed -i 's,^pid .*;,pid /tmp/nginx.pid;,' /etc/nginx/nginx.conf \
    && mkdir -p /var/cache/nginx/client_temp /var/cache/nginx/proxy_temp \
    && chown -R nginx:nginx /var/cache/nginx /etc/nginx /usr/share/nginx/html

EXPOSE 8080
USER nginx

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://localhost:8080/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
