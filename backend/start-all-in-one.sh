#!/bin/sh
# Single-container startup: the API and the Worker run in the same container.
#
# Free PaaS tiers basically do not offer a long-running background worker, yet parse jobs must always have someone claiming them;
# so one image starts both entry points here, exposing only the API port to the outside.
# When they need to run separately (docker compose / Northflank) each still starts on its own, unaffected.
set -eu

: "${PORT:=8000}"
export PORT

# Start the worker first: it runs migrations on startup, and an advisory lock ensures a concurrent API start does not collide with it.
python -m app.workers.runner &
worker_pid=$!

uvicorn app.main:app --host 0.0.0.0 --port "$PORT" --proxy-headers &
api_pid=$!

# When the platform sends SIGTERM, take down both child processes, so the worker does not become an orphan still holding database connections.
trap 'kill -TERM "$api_pid" "$worker_pid" 2>/dev/null || true' TERM INT

# The API is the foreground process: if it dies (or exits on a signal), take down the worker and exit too,
# so the platform restarts the whole container instead of leaving an unmanaged worker running.
# The exit code must be passed through: when the API crashes (e.g. the database is unreachable) exit non-zero so the platform restarts it;
# if this always returned 0, the platform would treat it as a clean finish and might not bring it back up.
api_status=0
wait "$api_pid" || api_status=$?
kill -TERM "$worker_pid" 2>/dev/null || true
wait "$worker_pid" || true
exit "$api_status"
