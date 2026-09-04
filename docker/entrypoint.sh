#!/usr/bin/env bash
# OSA 运行入口。见 issue #3。
set -euo pipefail

usage() {
  cat <<'USAGE'
用法:
  osa-entrypoint audit <task-dir> [--model <provider/model>] [--paper-review auto|off]
  osa-entrypoint batch <tasks-dir> [--model ...]
  osa-entrypoint doctor
  osa-entrypoint shell

被审对象只读挂载于 /data/tasks，产出落 /runs。
dev loop: bind-mount 工作树到 /src/osa，提示词就地生效，无需重建镜像。
USAGE
}

# 提示词来源：bind-mount 的工作树优先（dev loop），否则用镜像内烘好的
PROMPT_DIR=/opt/osa/prompts
[[ -f /src/osa/prompts/osa-audit.md ]] && PROMPT_DIR=/src/osa/prompts

MODEL="${OSA_MODEL:-openai/gpt-5.6-sol}"
PAPER_REVIEW=auto

cmd_doctor() {
  echo "=== OSA 运行时自检 ==="
  printf '%-14s %s\n' node "$(node -v)"
  printf '%-14s %s\n' opencode "$(opencode --version 2>/dev/null || echo MISSING)"
  printf '%-14s %s\n' osp "$(osp --version 2>/dev/null || echo MISSING)"
  printf '%-14s %s\n' git "$(git --version | awk '{print $3}')"
  printf '%-14s %s\n' pdftotext "$(pdftotext -v 2>&1 | head -1 | awk '{print $NF}')"
  printf '%-14s %s\n' python3 "$(python3 -V | awk '{print $2}')"
  printf '%-14s %s\n' 提示词 "$PROMPT_DIR"
  echo "--- 沙箱 Python 包 ---"
  python3 -c 'import numpy,scipy,networkx,sympy;print("numpy",numpy.__version__,"scipy",scipy.__version__,"networkx",networkx.__version__,"sympy",sympy.__version__)'
  echo "--- OSP 自检 ---"
  osp doctor || true
  echo
  echo "凭据检查（镜像内不应有任何 key）:"
  env | grep -iE 'API_KEY|TOKEN|SECRET' | sed 's/=.*/=<set at runtime>/' || echo "  (无)"
}

# 搭一个 run 工作区：只读源 + opencode 配置 + agent 提示词
prepare_ws() {
  local task="$1" ws="$2"
  mkdir -p "$ws/.opencode/agent" "$ws/report"

  # 被审对象复制进 source/ 并冻结为只读——OSA 永不修改交付物
  cp -R "$task" "$ws/source"
  # hf download --local-dir 会带一份 .cache 镜像目录，会让文件计数翻倍（issue #3 验收项）
  rm -rf "$ws/source/.cache"
  chmod -R a-w "$ws/source"

  cp "$PROMPT_DIR/osa-audit.md" "$ws/.opencode/agent/osa.md"

  # 与 OSP 的关键差异：OSA 必须 bash: allow，因为它要执行被审对象的验证代码。
  # OSP 的同名配置是 bash: deny —— 它不执行任何东西。
  cat > "$ws/opencode.json" <<JSON
{
  "\$schema": "https://opencode.ai/config.json",
  "share": "disabled",
  "permission": {
    "*": "deny",
    "read": "allow",
    "glob": "allow",
    "grep": "allow",
    "write": "allow",
    "edit": "allow",
    "bash": "allow",
    "external_directory": "deny",
    "question": "deny",
    "webfetch": "deny",
    "websearch": "deny"
  },
  "agent": {
    "osa": { "mode": "primary", "description": "Open SolutionAssay auditor" }
  }
}
JSON
}

cmd_audit() {
  local task="${1:?需要 task 目录}"; shift || true
  [[ -d "$task" ]] || { echo "task 目录不存在: $task" >&2; exit 2; }

  local name ts ws
  name="$(basename "$task")"
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  ws="/runs/${name}__${ts}"

  echo "== OSA audit =="
  echo "task   : $task"
  echo "run    : $ws"
  echo "model  : $MODEL"
  echo "prompts: $PROMPT_DIR"
  prepare_ws "$task" "$ws"

  # paper 定位与消歧（issue #2 §5）。找到即在后台 fork OSP，与主干并行。
  local osp_pid=""
  if [[ "$PAPER_REVIEW" == auto ]]; then
    local paper
    paper="$(find "$ws/source" \( -path '*/paper/arxiv-submission/main.tex' -o -name 'main.tex' -o -name '*.pdf' \) \
             -not -path '*/references/*' -not -path '*/reviewed-package/*' 2>/dev/null | head -1 || true)"
    if [[ -n "$paper" ]]; then
      echo "paper  : $paper  → fork OSP（并行，失败不阻断）"
      ( osp review "$paper" --headless --mode autonomous \
          --output "$ws/paper-review" --network-policy offline --model "$MODEL" \
          > "$ws/osp.log" 2>&1 || echo "OSP 失败，见 osp.log" >> "$ws/osp.log" ) &
      osp_pid=$!
    else
      echo "paper  : 未检出，跳过 OSP"
    fi
  fi

  # OSA 主干
  opencode run --agent osa --dir "$ws" --model "$MODEL" \
    "审核 ./source 这个 solution repo。按你的 agent 指令走完全部 phase，把最终报告写到 ./report/assay.md。"

  if [[ -n "$osp_pid" ]]; then
    echo "等待 OSP 分支收尾…"
    wait "$osp_pid" || true
  fi

  echo
  echo "== 完成 =="
  ls -la "$ws/report/" 2>/dev/null
  [[ -f "$ws/report/assay.md" ]] && { echo "--- Resolution ---"; sed -n '/^## Resolution/,/^## /p' "$ws/report/assay.md" | head -12; }
}

cmd_batch() {
  local dir="${1:?需要 tasks 目录}"; shift || true
  local d
  for d in "$dir"/*/; do
    [[ -d "$d" ]] || continue
    echo "################ $(basename "$d") ################"
    cmd_audit "${d%/}" || echo "!! $(basename "$d") 失败，继续"
  done
}

SUB="${1:-}"; shift || true
ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --model) MODEL="$2"; shift 2 ;;
    --paper-review) PAPER_REVIEW="$2"; shift 2 ;;
    *) ARGS+=("$1"); shift ;;
  esac
done

case "$SUB" in
  audit)  cmd_audit "${ARGS[@]}" ;;
  batch)  cmd_batch "${ARGS[@]}" ;;
  doctor) cmd_doctor ;;
  shell)  exec bash ;;
  ""|--help|-h) usage ;;
  *) echo "未知子命令: $SUB" >&2; usage; exit 2 ;;
esac
