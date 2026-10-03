#!/bin/bash
set -e
source .venv/bin/activate
cd backend
# Creates the schema on a brand-new empty database; verifies an existing one is
# current; REFUSES (exit 3, nothing modified) if an existing DB is outdated.
python schema_guard.py
uvicorn server:app --host 127.0.0.1 --port 8000 --reload
