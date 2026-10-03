#!/bin/bash
source .venv/bin/activate
cd backend
uvicorn server:app --host 127.0.0.1 --port 8000 --reload
