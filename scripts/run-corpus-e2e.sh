#!/usr/bin/env bash
set -u

# Run the real solution corpus in isolated containers. This is intentionally
# a background-friendly supervisor: one failed sample must not stop the rest.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNS_DIR="$ROOT_DIR/runs"
DATASET_CACHE="${OSA_DATASET_CACHE:-$HOME/.cache/huggingface/hub/datasets--Jack-Jieke-Wu--Gewu-Solutions}"
REVISION="${OSA_DATASET_REVISION:-$(cat "$DATASET_CACHE/refs/main")}" 
SNAPSHOT_DIR="$DATASET_CACHE/snapshots/$REVISION"
RESULTS="${OSA_E2E_RESULTS:-/tmp/opencode/osa-e2e-results.tsv}"
LOG_DIR="${OSA_E2E_LOG_DIR:-/tmp/opencode}"
STATUS_DIR="${OSA_E2E_STATUS_DIR:-$LOG_DIR/osa-e2e-status}"
PARALLEL="${OSA_E2E_PARALLEL:-4}"

mkdir -p "$LOG_DIR" "$STATUS_DIR"
: > "$RESULTS"

run_one() {
  local task="$1" name log report run status_file
  name="$(basename "$task")"
  log="$LOG_DIR/osa-e2e-${name}.log"
  status_file="$STATUS_DIR/$name.tsv"
  docker compose --project-directory "$ROOT_DIR" run --rm -T \
    -v "$DATASET_CACHE:/data/tasks:ro" \
    osa-dev "/data/tasks/snapshots/$REVISION/$name" \
    --exec-timeout 45000 --max-commands 20 --timeout 900000 >"$log" 2>&1
  local code=$?
  for path in "$RUNS_DIR"/"${name}"*/.assay/report/assay.md; do
    [ -f "$path" ] && report="$path"
  done
  run="${report%/.assay/report/assay.md}"
  printf '%s\t%s\t%s\t%s\n' "$name" "$code" "${report:-missing}" "${run:-missing}" > "$status_file"
}

export ROOT_DIR RUNS_DIR DATASET_CACHE REVISION SNAPSHOT_DIR RESULTS LOG_DIR STATUS_DIR
export -f run_one

tasks=()
for task in "$SNAPSHOT_DIR"/*; do
  [ -d "$task" ] || continue
  name="$(basename "$task")"
  existing=0
  for report in "$RUNS_DIR"/"${name}"*/.assay/report/assay.md; do
    if [ -f "$report" ]; then existing=1; break; fi
  done
  [ "$existing" -eq 0 ] && tasks+=("$task")
done

printf 'revision=%s\nsamples_to_run=%s\nparallel=%s\n' "$REVISION" "${#tasks[@]}" "$PARALLEL" > "$LOG_DIR/osa-e2e-manifest.txt"
printf '%s\0' "${tasks[@]}" | xargs -0 -n1 -P"$PARALLEL" bash -c 'run_one "$1"' _

printf 'sample\tstatus\treport\trun\n' > "$RESULTS"
for status_file in "$STATUS_DIR"/*.tsv; do
  [ -f "$status_file" ] && cat "$status_file" >> "$RESULTS"
done
