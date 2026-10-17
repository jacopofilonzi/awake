#!/bin/sh
# Container entrypoint. The server runs as the unprivileged `node` user (uid 1000), but a bind mount such
# as ./data:/data is created by Docker as root on the host, and the server could not write its database.
# Started as root (the default), this makes DATA_DIR owned by `node` (only what isn't yet: fast on every
# start) and then runs the command as `node`. Started as another user (`user:` in compose), it just runs it.
set -e

dir="${DATA_DIR:-/data}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$dir"
  find "$dir" ! -user node -exec chown node:node {} +
  exec su-exec node "$@"
fi

exec "$@"
