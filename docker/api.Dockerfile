# Build context is the repository root (see docker-compose.yml) because
# this is a monorepo — the API depends on packages/shared, and Docker needs
# access to both to build either one.

FROM node:20-alpine AS base
WORKDIR /app

# Copy only the manifests first, so `npm install` is cached by Docker and
# only re-runs when a package.json actually changes — not on every source
# edit, which would otherwise reinstall the entire dependency tree on
# every rebuild during development.
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
COPY apps/api apps/api

RUN npm run generate --workspace=@taskflow/shared
RUN npm run build --workspace=@taskflow/api

# ── Runtime stage ────────────────────────────────────────────────────────
# A separate, smaller final image: no TypeScript source, no dev
# dependencies, no build tools — just compiled JS and the packages it
# needs to run.
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist

RUN mkdir -p /app/uploads/generated

EXPOSE 4000
CMD ["node", "apps/api/dist/index.js"]
