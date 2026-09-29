# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS client
WORKDIR /app
COPY shared ./shared
COPY client ./client
WORKDIR /app/client
RUN npm ci && npm run build

FROM node:24-bookworm-slim AS server-build
WORKDIR /app
COPY shared ./shared
COPY server ./server
WORKDIR /app/server
RUN npm ci && npm run build

FROM node:24-bookworm-slim
ENV NODE_ENV=production \
    PORT=3001 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    STATIC_DIR=/app/public
WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=server-build /app/server/dist ./dist
COPY --from=client /app/client/build ./public
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
