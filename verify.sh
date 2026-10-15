#!/bin/bash

# Local verification gate. Mirrors CI (.github/workflows/ci.yml and e2e.yml).
#
#   ./verify.sh backend            lint, unit tests, nest build
#   ./verify.sh frontend           lint, unit tests, next build
#   ./verify.sh e2e [spec ...]     backend e2e, then Playwright for any specs given
#   ./verify.sh all [spec ...]     backend, frontend, then e2e
#
# Each step runs unpiped with its output in <git-dir>/verify-logs/<step>.log, so a
# failing step fails the script. Summary lines are printed after each step.
# Run the backend e2e only when no other gate or review agent is running. A
# lone "socket hang up" is CPU contention, so rerun that file alone.
#
# Only a passing `all` run writes `git write-tree` (the staged tree) to
# <git-dir>/verify-ok, so a pre-push hook can check that what was verified is
# what is being pushed. Partial modes never record the tree. Stage your changes
# before the final run. <git-dir> comes from `git rev-parse --git-dir`, which
# also works inside a worktree, where .git is a file.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
VERIFY_GIT_DIR="$(cd "$ROOT_DIR" && cd "$(git rev-parse --git-dir)" && pwd)"
LOG_DIR="$VERIFY_GIT_DIR/verify-logs"
mkdir -p "$LOG_DIR"

# run_step <name> <dir> <summary-regex> <command...>
run_step() {
  local name="$1" dir="$2" pattern="$3"
  shift 3
  local log="$LOG_DIR/$name.log"
  echo "==> $name"
  if (cd "$ROOT_DIR/$dir" && "$@") >"$log" 2>&1; then
    # Strip ANSI colors so the summary patterns match.
    local summary
    summary="$(sed 's/\x1b\[[0-9;]*m//g' "$log" | grep -E "$pattern" | tail -5 || true)"
    echo "${summary:-ok}"
  else
    local status=$?
    echo "FAILED: $name (exit $status). Last 40 lines of $log:"
    tail -40 "$log"
    exit "$status"
  fi
}

backend() {
  run_step backend-lint backend '[0-9]+ problems?|error' npm run lint:check
  run_step backend-unit backend '^(Tests|Test Suites):' npm test
  run_step backend-build backend 'Found [0-9]+ error|error TS' npm run build
}

frontend() {
  run_step frontend-lint frontend '[0-9]+ problems?|error' npm run lint
  run_step frontend-unit frontend 'Test Files|Tests ' npm test
  run_step frontend-build frontend 'Compiled|Route \(app\)|rror' npm run build
}

e2e() {
  run_step backend-e2e backend '^(Tests|Test Suites):' npm run test:e2e
  if [ "$#" -gt 0 ]; then
    run_step playwright frontend '[0-9]+ (passed|failed|flaky|skipped)' npm run test:e2e -- "$@"
  else
    echo "==> playwright skipped (no specs given)"
  fi
}

mode="${1:-}"
[ "$#" -gt 0 ] && shift
case "$mode" in
  backend) backend ;;
  frontend) frontend ;;
  e2e) e2e "$@" ;;
  all) backend; frontend; e2e "$@" ;;
  *) echo "usage: $0 backend|frontend|e2e|all [playwright-spec ...]" >&2; exit 2 ;;
esac

echo
if [ "$mode" = all ]; then
  git -C "$ROOT_DIR" write-tree > "$VERIFY_GIT_DIR/verify-ok"
  echo "verify.sh all passed. Staged tree $(cat "$VERIFY_GIT_DIR/verify-ok") recorded in $VERIFY_GIT_DIR/verify-ok."
else
  echo "verify.sh $mode passed. Partial run, so verify-ok was not written."
fi
