#!/usr/bin/env bash
set -euo pipefail

# Install the packaged CLI without requiring users to understand the
# repository's TypeScript or Docker development workflow.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'OSA requires Node.js >= 20.' >&2
  exit 1
fi

node -e 'const major = Number(process.versions.node.split(".")[0]); if (major < 20) process.exit(1)' || {
  printf 'OSA requires Node.js >= 20 (found %s).\n' "$(node --version)" >&2
  exit 1
}

if [[ ! -d "$ROOT_DIR/node_modules" ]]; then
  npm --prefix "$ROOT_DIR" ci --ignore-scripts
fi
npm --prefix "$ROOT_DIR" run build
npm --prefix "$ROOT_DIR" link
