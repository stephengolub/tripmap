#!/usr/bin/env bash
# Run the tripmap web app for local use: the API on 127.0.0.1:8000 and the
# Vite dev server on http://localhost:5173 (which proxies /api to the API).
# Both run in the foreground; Ctrl-C stops both.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_BIN="/Users/sgolub/.asdf/installs/nodejs/22.14.0/bin"

if ! command -v npm >/dev/null 2>&1 && [ -x "$NODE_BIN/npm" ]; then
  PATH="$NODE_BIN:$PATH"
fi

# Job control puts each child in its own process group, so cleanup can stop
# the whole tree (uv -> python, npm -> node) and not just the direct child.
set -m
pids=()
cleanup() {
  trap - INT TERM EXIT
  for pid in ${pids[@]+"${pids[@]}"}; do
    kill -TERM -- "-$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

# tripmap-api always binds to 127.0.0.1 (loopback only).
(cd "$ROOT" && exec uv run tripmap-api --port 8000) &
pids+=($!)

if [ ! -d "$ROOT/web/node_modules" ]; then
  (cd "$ROOT/web" && npm install)
fi
(cd "$ROOT/web" && exec npm run dev -- --host localhost --port 5173 --strictPort) &
pids+=($!)

echo "tripmap: API on http://127.0.0.1:8000, app on http://localhost:5173 (Ctrl-C to stop)"

# Exit as soon as either process dies; the trap stops the other. Polling
# rather than `wait -n` keeps this working on macOS's stock bash 3.2.
while kill -0 "${pids[0]}" 2>/dev/null && kill -0 "${pids[1]}" 2>/dev/null; do
  sleep 1
done
