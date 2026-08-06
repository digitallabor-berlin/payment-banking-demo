# syntax=docker/dockerfile:1

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# ---- deps ----------------------------------------------------------------
FROM base AS deps
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/foundry-client/package.json packages/foundry-client/
COPY packages/ui/package.json packages/ui/
COPY apps/merchant/package.json apps/merchant/
# better-sqlite3 needs a toolchain to build its native addon.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
RUN pnpm install --frozen-lockfile

# ---- build ---------------------------------------------------------------
FROM base AS build
WORKDIR /repo
COPY --from=deps /repo/node_modules ./node_modules
COPY . .
# Placeholder secrets: next build must not require real ones, but env.ts
# validates at import time. These never reach the runtime image.
ENV FOUNDRY_ADMIN_KEY=build-only \
    BANK_API_KEY=build-only
RUN pnpm --filter @demo/merchant run build

# ---- runtime -------------------------------------------------------------
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_PATH=/data/merchant.db

# Next's standalone output already contains the traced workspace deps.
COPY --from=build /repo/apps/merchant/.next/standalone ./
COPY --from=build /repo/apps/merchant/.next/static ./apps/merchant/.next/static
COPY --from=build /repo/apps/merchant/drizzle ./apps/merchant/drizzle

RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000

# Migrations run on first DB access (src/db/index.ts), so no entrypoint script.
WORKDIR /app/apps/merchant
CMD ["node", "server.js"]