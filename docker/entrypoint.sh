#!/usr/bin/env bash
set -euo pipefail

# Docker is a reproducible development runtime, not a second OSA
# implementation. All audit state, isolation and report validation live in the
# TypeScript CLI; this wrapper only supplies container defaults.
usage() {
  cat <<'USAGE'
用法:
  osa-entrypoint audit <task-dir> [OSA audit options]
  osa-entrypoint <task-dir> [OSA audit options]
  osa-entrypoint batch <tasks-dir> [OSA batch options]
  osa-entrypoint doctor
  osa-entrypoint shell

被审对象通常挂载于 /data/tasks，产出挂载于 /runs。
开发时可以把工作树挂载到 /src/osa；入口会优先执行当前工作树构建的 CLI。
USAGE
}

osa_cli() {
  if [[ -f /src/osa/package.json ]]; then
    npm --prefix /src/osa run build >/dev/null
    node /src/osa/dist/cli.js "$@"
  else
    command osa "$@"
  fi
}

cmd_doctor() {
  osa_cli doctor
  echo "--- sandbox Python packages ---"
  python3 -c 'import numpy,scipy,networkx,sympy;print("numpy",numpy.__version__,"scipy",scipy.__version__,"networkx",networkx.__version__,"sympy",sympy.__version__)'
}

cmd_audit() {
  local task="${1:?需要 task 目录}"
  shift
  osa_cli audit "$task" --output /runs --model "${OSA_MODEL:-openai/gpt-5.6-sol}" --headless "$@"
}

cmd_batch() {
  local dir="${1:?需要 tasks 目录}"
  shift
  osa_cli batch "$dir" --output /runs --model "${OSA_MODEL:-openai/gpt-5.6-sol}" "$@"
}

sub="${1:-}"
shift || true
case "$sub" in
  audit) cmd_audit "$@" ;;
  batch) cmd_batch "$@" ;;
  doctor) cmd_doctor ;;
  shell) exec bash ;;
  --help|-h|"") usage ;;
  -*) echo "未知选项: $sub" >&2; usage; exit 2 ;;
  *) cmd_audit "$sub" "$@" ;;
esac
