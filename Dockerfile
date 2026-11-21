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
CMD ["npx", "tsx", "src/index.ts"]
