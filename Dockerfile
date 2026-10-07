FROM node:24-bookworm-slim AS base
WORKDIR /app
FROM base AS dependencies
COPY package*.json ./
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca npm ci --fetch-timeout=30000 --fetch-retries=1; else npm ci; fi
FROM dependencies AS build
COPY . .
RUN npm run db:generate && npm run build
FROM base AS runtime
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]
FROM dependencies AS tools
COPY prisma ./prisma
COPY prisma.config.ts tsconfig.json ./
COPY src/server/db.ts src/server/password.ts ./src/server/
COPY scripts ./scripts
RUN npm run db:generate
