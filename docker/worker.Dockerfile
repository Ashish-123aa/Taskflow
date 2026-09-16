# Build context is the repository root — same reasoning as docker/api.Dockerfile.

FROM node:20-alpine AS base
WORKDIR /app

COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm install

# ── Build stage ─────────────────────────────────────────────────────────
FROM base AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/worker apps/worker

RUN npm run generate --workspace=@taskflow/shared
RUN npm run build --workspace=@taskflow/worker

# ── Runtime stage ────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/apps/worker/package.json ./apps/worker/package.json
COPY --from=build /app/apps/worker/dist ./apps/worker/dist

RUN mkdir -p /app/uploads/generated

# No EXPOSE — the worker never listens for HTTP; it only connects out to
# Redis and Postgres.
CMD ["node", "apps/worker/dist/index.js"]
