#!/bin/sh
# Resolves through the skill symlink to the repository, then runs the CLI.
set -e
here=$(dirname "$(realpath "$0")")
exec bun "$here/../../src/cli.ts" "$@"
