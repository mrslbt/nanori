#!/usr/bin/env bash
# Claude Code PostToolUse hook: when a file under local/ is edited, rerun the last public run against the local reproduction.
# Guards: only fires for local/ paths, ignores generated reports, debounces to one run per edit batch, never triggers itself.
set -u
cd "$(dirname "$0")/.." || exit 0
input="$(cat)"
file="$(printf '%s' "$input" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log(j.tool_input?.file_path||j.tool_input?.path||"")}catch{console.log("")}})')"
case "$file" in
  */local/*) ;;
  *) exit 0 ;;
esac
case "$file" in
  *report.html|*report.json|*/runs/*) exit 0 ;;
esac
[ -n "${NANORI_HOOK_RUNNING:-}" ] && exit 0
lock=".nanori-rerun.lock"
if [ -f "$lock" ] && [ $(( $(date +%s) - $(stat -f %m "$lock") )) -lt 20 ]; then exit 0; fi
touch "$lock"
run_id="$(cat .nanori-last-run 2>/dev/null || true)"
target="$(cat .nanori-local-target 2>/dev/null || true)"
[ -z "$run_id" ] || [ -z "$target" ] && { echo "nanori hook: set .nanori-last-run and .nanori-local-target first"; exit 0; }
echo "nanori hook: $file changed under local/, rerunning $run_id against $target"
NANORI_HOOK_RUNNING=1 node dist/cli.js rerun "$run_id" --target "$target" --headless 2>&1 | tail -12
