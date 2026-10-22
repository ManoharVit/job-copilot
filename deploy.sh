#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# Compatibility entrypoint: Vite now builds the actual FastAPI static directory.
# Never move/delete backend/static: it also contains the legacy dashboard.
case "${1:-}" in
    --dry-run) exec .venv/bin/python scripts/check_dashboard.py backend/static ;;
    "") ;;
    *) echo "Usage: ./deploy.sh [--dry-run]" >&2; exit 2 ;;
esac
(cd frontend && npm run build)
.venv/bin/python scripts/check_dashboard.py backend/static
echo "Dashboard built and verified. Open http://127.0.0.1:8765/ after starting ./start.sh."
