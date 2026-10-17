# Awake server with the web UI (PWA). The agents are built separately (see agents/).

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --workspaces --include-workspace-root
COPY shared shared
COPY backend backend
COPY frontend frontend
RUN npm run build -w frontend && npm run build -w backend

FROM node:24-alpine
ENV NODE_ENV=production DATA_DIR=/data PORT=8080 WEB_DIR=/app/web
WORKDIR /app
# su-exec: the entrypoint starts as root only to fix the ownership of /data, then runs the server as `node`.
RUN apk add --no-cache su-exec && mkdir -p /data && chown node:node /data
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
COPY --from=build /app/backend/dist/index.js ./index.js
COPY --from=build /app/frontend/dist ./web
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "--disable-warning=ExperimentalWarning", "index.js"]
