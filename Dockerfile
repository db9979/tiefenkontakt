# Tiefenkontakt: game server + built client on one port. Put your HTTPS reverse proxy in front.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json tsconfig.json vitest.config.ts ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production \
    PORT=8787 \
    TRUST_PROXY=1 \
    DB_PATH=/data/tiefenkontakt.db \
    MATCH_DIR=/data/matches \
    CLIENT_DIST=/app/apps/client/dist
VOLUME /data
EXPOSE 8787
WORKDIR /app/apps/server
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s \
  CMD node -e "fetch('http://localhost:8787/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Node itself is PID 1 so SIGTERM (docker stop) reaches the server, which saves running matches
CMD ["node", "--import", "tsx", "src/index.ts"]
