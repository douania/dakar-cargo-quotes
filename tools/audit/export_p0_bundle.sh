#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

FILES=(
  "AUDIT_METIER_P0_PROTOCOL.md"
  "audit/p0/README.md"
  "audit/p0/input/cases.csv"
  "audit/p0/input/incoterm_rules.csv"
  "audit/p0/input/quote_lines.csv"
  "audit/p0/reports/bootstrap_summary.json"
  "tools/audit/run_p0_audit.mjs"
)

OUT_FILE="${1:-audit/p0/reports/audit_p0_bundle_for_share.txt}"
mkdir -p "$(dirname "$OUT_FILE")"

{
  printf '# Bundle audit P0 export\n\n'
  printf 'Generated at: %s\n\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')"

  for f in "${FILES[@]}"; do
    if [[ ! -f "$f" ]]; then
      printf '===== MISSING: %s =====\n\n' "$f"
      continue
    fi

    printf '===== BEGIN: %s =====\n' "$f"
    printf '```%s\n' "$(case "$f" in
      *.md) echo markdown ;;
      *.csv) echo csv ;;
      *.json) echo json ;;
      *.mjs) echo javascript ;;
      *) echo text ;;
    esac)"
    cat "$f"
    printf '\n```\n'
    printf '===== END: %s =====\n\n' "$f"
  done
} > "$OUT_FILE"

echo "Export complete: $OUT_FILE"
