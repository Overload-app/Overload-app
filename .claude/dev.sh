#!/bin/bash
export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH"
cd "$(dirname "$0")/.."
# Respect an assigned PORT (from the preview tool's autoPort) if set,
# otherwise fall back to Vite's own default.
exec npm run dev -- ${PORT:+--port "$PORT"}
