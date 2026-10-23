#!/bin/sh
# Runs the installed agent-replay binary (`bun run install:bin` in the repo).
bin="$HOME/.local/bin/agent-replay"
if [ ! -x "$bin" ]; then
  echo "agent-replay is not installed. Run \`bun install && bun run install:bin\` in the agent-replay repository." >&2
  exit 127
fi
exec "$bin" "$@"
