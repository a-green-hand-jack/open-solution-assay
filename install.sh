#!/usr/bin/env bash
set -euo pipefail

# Install the packaged CLI without requiring users to understand the
# repository's TypeScript or Docker development workflow.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$SCRIPT_DIR"

# When invoked through curl, install from a GitHub source archive instead of
# requiring the user to clone the repository. A checked-out tree still works
# for local development installs.
if [[ ! -f "$ROOT_DIR/package.json" ]]; then
  command -v curl >/dev/null 2>&1 || { printf '%s\n' 'OSA installation requires curl.' >&2; exit 1; }
  command -v tar >/dev/null 2>&1 || { printf '%s\n' 'OSA installation requires tar.' >&2; exit 1; }
  TEMP_DIR="$(mktemp -d)"
  trap 'rm -rf "$TEMP_DIR"' EXIT
  curl -fsSL https://github.com/a-green-hand-jack/open-solution-assay/archive/refs/heads/main.tar.gz | tar -xz -C "$TEMP_DIR"
  ROOT_DIR="$TEMP_DIR/open-solution-assay-main"
fi

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
