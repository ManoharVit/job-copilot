#!/bin/bash
set -e
# Resolve relative paths against this launcher, even when invoked elsewhere.
cd "$(dirname "$0")"
source .venv/bin/activate

# A surviving assets directory does not prove its index or referenced bundles exist.
if ! python scripts/check_dashboard.py backend/static; then
    echo "Building production React dashboard..."
    (cd frontend && npm run build)
    python scripts/check_dashboard.py backend/static
fi

# Reuse a healthy instance; never terminate another app occupying our port.
if python - <<'PYTHON'
import json
import socket
import sys
import urllib.request

address = "http://127.0.0.1:8765"
try:
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(address + "/api/health", timeout=2) as response:
        healthy = response.status == 200 and json.loads(response.read(1024)) == {
            "service": "job-copilot", "status": "ok"
        }
    if healthy:
        print(f"Job Copilot is already running: {address}")
        sys.exit(0)
except (OSError, ValueError):
    pass

try:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 8765))
except OSError:
    print(f"Cannot start Job Copilot: {address} is occupied or unavailable. "
          "No existing process was stopped.", file=sys.stderr)
    sys.exit(2)
sys.exit(1)
PYTHON
then
    exit 0
else
    result=$?
    if [ "$result" -ne 1 ]; then
        exit "$result"
    fi
fi

cd backend
# Creates a fresh schema; refuses to auto-migrate an existing outdated database.
python schema_guard.py
echo "Starting Job Copilot: http://127.0.0.1:8765"
exec uvicorn server:app --host 127.0.0.1 --port 8765 --reload
