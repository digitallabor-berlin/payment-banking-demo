# syntax=docker/dockerfile:1

# One image, both apps. See
# docs/superpowers/specs/2026-08-06-kubernetes-deployment-design.md
#
# Build from the REPO ROOT as context: a pnpm workspace build needs the root
# manifests and the packages/ sources.
#   podman build -t payment-demo:dev .

# ---- build ---------------------------------------------------------------
FROM node:22-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /repo

# better-sqlite3 compiles a native addon.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# The install runs AFTER the sources are in place, deliberately -- there is no
# separate `deps` stage. `.npmrc` sets node-linker=hoisted, so third-party
# packages hoist to the root node_modules, but the @demo/* workspace links live
# ONLY in apps/<app>/node_modules (verified: node_modules/@demo does not exist;
# apps/bank/node_modules/@demo/{ui,foundry-client} are symlinks into packages/).
# A deps stage copying just /repo/node_modules drops those links and
# `next build` then cannot resolve @demo/ui. Letting pnpm run over the real
# tree creates every link itself. No cache is lost that matters: the in-cluster
# build Job clones fresh every time, so a deps layer would never hit.
COPY . .
RUN pnpm install --frozen-lockfile

# `next build` must not require real secrets, but env.ts validates at import
# time. These placeholders never reach the runtime stage.
ENV FOUNDRY_ADMIN_KEY=build-only \
    BANK_API_KEY=build-only \
    SESSION_SECRET=build-only-secret-0123456789012345678901234567890123
RUN pnpm --filter @demo/bank run build \
  && pnpm --filter @demo/merchant run build

# ---- runtime -------------------------------------------------------------
FROM node:22-slim AS runtime
ENV NODE_ENV=production
# Next's standalone server binds to $HOSTNAME when set. Container runtimes set
# HOSTNAME to the container/pod name, which is not a bindable interface -- pin
# it to 0.0.0.0 so the server is reachable from off-pod (kubelet probes).
ENV HOSTNAME=0.0.0.0
WORKDIR /app

# Both standalone trees, side by side, each copied verbatim into its own prefix.
# NOT merged into a shared /app: each carries its own root-level node_modules
# produced by Next's independent dependency trace, and COPY resolves an overlap
# last-writer-wins per file -- a subtly missing traced file would surface as a
# runtime MODULE_NOT_FOUND on a rarely-hit route, not as a build failure.
COPY --from=build /repo/apps/bank/.next/standalone      /app/bank/
COPY --from=build /repo/apps/bank/.next/static          /app/bank/apps/bank/.next/static
COPY --from=build /repo/apps/bank/drizzle               /app/bank/apps/bank/drizzle

COPY --from=build /repo/apps/merchant/.next/standalone   /app/merchant/
COPY --from=build /repo/apps/merchant/.next/static       /app/merchant/apps/merchant/.next/static
COPY --from=build /repo/apps/merchant/drizzle            /app/merchant/apps/merchant/drizzle
# The merchant serves product imagery from public/. The per-app Dockerfiles this
# replaces never copied it, so every product image 404'd in a container.
COPY --from=build /repo/apps/merchant/public             /app/merchant/apps/merchant/public

COPY docker-entrypoint.sh /app/docker-entrypoint.sh

# `USER 1000` numerically, not `USER node`: with a NAME the kubelet cannot prove
# the user is non-root and rejects `runAsNonRoot: true` with
# CreateContainerConfigError. 1000 is `node` in node:22-slim.
RUN chmod +x /app/docker-entrypoint.sh \
  && mkdir -p /data \
  && chown 1000:1000 /data
USER 1000

VOLUME ["/data"]
# bank 3001, merchant 3000. Documentation only; the manifest sets PORT.
EXPOSE 3000 3001

# Migrations AND seeding run at boot via src/instrumentation.ts, so there is no
# migrate/seed step here.
ENTRYPOINT ["/app/docker-entrypoint.sh"]