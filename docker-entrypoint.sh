#!/bin/sh
# One image, two apps. The argument selects which one this container runs.
#
# Owning the `cd` here rather than via the manifest's workingDir keeps a single
# source of truth: `podman run <image> bank` behaves identically to the pod.
set -eu

APP="${1:-}"
case "$APP" in
  bank | merchant) ;;
  *)
    echo "docker-entrypoint.sh: expected 'bank' or 'merchant', got '${APP}'" >&2
    echo "usage: docker-entrypoint.sh <bank|merchant>" >&2
    exit 64
    ;;
esac

# env.ts defaults DATABASE_PATH to a RELATIVE "./data/<app>.db", which resolves
# under the app directory -- owned by root and unwritable by USER 1000, so the
# app would exit 1 at boot with EACCES. /data is this image's declared VOLUME
# and is chowned to 1000, so default there instead. An explicit DATABASE_PATH
# (as the Kubernetes manifest sets) still wins.
export DATABASE_PATH="${DATABASE_PATH:-/data/${APP}.db}"

# Next defaults to 3000 for both apps. This demo assigns bank 3001 / merchant
# 3000 (see EXPOSE and the Kubernetes manifest), so default to the app's own
# port -- otherwise `podman run -p 3001:3001 <image> bank` silently listens on
# the wrong port. An explicit PORT still wins.
if [ "$APP" = "bank" ]; then
  export PORT="${PORT:-3001}"
else
  export PORT="${PORT:-3000}"
fi

# Both apps resolve drizzle migrations as path.join(process.cwd(), "drizzle")
# (apps/*/src/db/index.ts), so the CWD must be the app's own root.
cd "/app/${APP}/apps/${APP}"
exec node server.js