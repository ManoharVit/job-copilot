#!/bin/bash
set -e
echo '🚀 Setting up Job Copilot...'
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt -q
mkdir -p data
echo '✅ Setup complete!'
echo 'Run: bash start.sh'
