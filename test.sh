#!/bin/zsh
# Runs the test suites and reports each as PASSED, FAILED or SKIPPED from its exit code alone: 0 passed, anything else
# failed (the live suite may also answer 3, skipped, when the network can't be reached). Nothing a suite prints is
# read to decide. Each suite's full output is kept in tests/logs/<suite>.log, and a failed suite's failing lines are
# shown here. The deterministic offline suites always run; the live-network suite only with --live, and is listed as
# skipped otherwise. Exits 1 if a suite failed its checks (exit 1), and 2 if the run itself went wrong: a suite's
# harness broke (any other exit code), an --only name is unknown, or no suite ran; 64 for an unknown option. A misspelt
# suite name never passes.
#   ./test.sh                  the offline suites
#   ./test.sh --live           the offline suites, then the live-network checks
#   ./test.sh --only kat,qr    just those suites (names as listed in the report)
# tests/prove-failures.sh shows every check can fail: deliberate wrong expectations must each fail the run.
# For checks in a browser, qa/make.py writes a copy of index.html with mocked network data:
#   python3 qa/make.py index.html qa/mock.js <somewhere outside this folder>/index.html
emulate -L zsh
ROOT="${0:A:h}"
B="$ROOT/build"; S="$ROOT/src"; LOGS="$ROOT/tests/logs"
live=0; only=()
while (( $# )); do
  case "$1" in
    --live) live=1 ;;
    --only) shift; only=(${(s:,:)1}) ;;
    *) print -u2 "usage: ./test.sh [--live] [--only suite,suite]"; exit 64 ;;
  esac
  shift
done
# Every suite below: an --only name not among them stops the run before anything runs.
known=(page storage-lifecycle backup adopt activity-view ui-state seed-privacy outcomes input-rules i18n types kat app-sign msg-sign crosscheck qr live-api deployed)
for n in $only; do
  (( ${known[(Ie)$n]} )) || { print -u2 "unknown suite: $n (the suites: ${(j:, :)known})"; exit 2; }
done
mkdir -p "$LOGS"
failed=0; broken=0; ran=0

wanted() { (( ${#only} == 0 )) || (( ${only[(Ie)$1]} )); }
# report <name> <exit code> <may skip: 0|1>
report() {
  local name=$1 code=$2 mayskip=$3 log="$LOGS/$1.log"
  if (( code == 0 )); then printf '%-18s PASSED\n' "$name"
  elif (( mayskip && code == 3 )); then printf '%-18s SKIPPED (%s)\n' "$name" "$(grep -m1 '^SKIPPED' "$log" | cut -c10-)"
  else
    failed=$((failed + 1))
    (( code == 1 )) || broken=$((broken + 1))
    printf '%-18s FAILED (exit %d%s)\n' "$name" "$code" "$( (( code == 1 )) || print ', the harness broke')"
    local lines; lines=$(grep -E '^(FAIL|HARNESS ERROR)' "$log" | head -n 20)
    [[ -z $lines ]] && lines=$(tail -n 15 "$log")
    print -r -- "$lines" | sed 's/^/    /'
    print "    full output: $log"
  fi
}
# suite <name> <may skip> <command…>
suite() {
  local name=$1 mayskip=$2; shift 2
  wanted "$name" || return 0
  ran=$((ran + 1))
  "$@" > "$LOGS/$name.log" 2>&1
  report "$name" $? "$mayskip"
}

suite page              0 node "$ROOT/tests/page.cjs" "$B" "$S"
suite storage-lifecycle 0 node "$ROOT/tests/storage-lifecycle.cjs" "$B" "$S"
suite backup            0 node "$ROOT/tests/backup.cjs" "$B" "$S"
suite adopt             0 node "$ROOT/tests/adopt.cjs" "$B" "$S"
suite activity-view     0 node "$ROOT/tests/activity-view.cjs" "$B" "$S"
suite ui-state          0 node "$ROOT/tests/ui-state.cjs" "$B" "$S"
suite seed-privacy      0 node "$ROOT/tests/seed-privacy.cjs" "$S"
suite outcomes          0 node "$ROOT/tests/outcomes.cjs" "$B" "$S"
suite input-rules       0 node "$ROOT/tests/input-rules.cjs" "$S"
suite i18n              0 node "$ROOT/tests/i18n.cjs" "$S"
suite types             0 node "$ROOT/tests/types.cjs" "$S"
suite kat               0 node "$ROOT/tests/kat.cjs" "$B" "$S"
suite app-sign          0 node "$ROOT/tests/app-sign.cjs" "$B" "$S"
suite msg-sign          0 node "$ROOT/tests/msg-sign.cjs" "$B" "$S" "$ROOT/research/wallet-src/repo"
suite crosscheck        0 node "$ROOT/tests/crosscheck.cjs" "$B" "$S"
suite qr                0 node "$ROOT/tests/qrcheck.cjs" "$B" "$ROOT/qrtest"
if (( live )); then
  suite live-api 1 node "$ROOT/tests/live-api.cjs" "$B" "$S"
  suite deployed 1 node "$ROOT/tests/deployed.cjs" "$ROOT"
else
  for n in live-api deployed; do wanted $n && printf '%-18s SKIPPED (live network: run ./test.sh --live)\n' $n; done
fi

print
if (( ran == 0 )); then print "No suite ran: check the --only names"; exit 2; fi
if (( broken )); then print "$failed of $ran suites FAILED, $broken of them because the harness broke"; exit 2; fi
if (( failed )); then print "$failed of $ran suites FAILED"; exit 1; fi
print "All $ran suites that ran PASSED"
exit 0
