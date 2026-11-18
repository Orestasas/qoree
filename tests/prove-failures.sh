#!/bin/zsh
# Proves the checks can fail. A clean ./test.sh must pass; then every deliberate fault below, each a wrong expected
# value or a code change a suite must catch, has to make ./test.sh fail. One fault also runs against the full suite
# list, and "summary-lie" makes a suite print a passing summary while failing, to prove ./test.sh trusts exit codes
# only. A fault that leaves the run passing is a check that can't fail: this script then exits 1. A fault has to fail
# the run for the right reason, a failed check (./test.sh exit 1): a broken harness or an unknown suite name (exit 2)
# proves nothing. Every fault the suites define (MUTATE and TEST_FAULT names) has to be listed here.
#   tests/prove-failures.sh
emulate -L zsh
ROOT="${0:A:h:h}"
cd "$ROOT"
bad=0
expect() {  # expect <pass|fail> <label> <env assignment or -> <suites, or none for every offline suite>
  local want=$1 label=$2 env=$3 only=$4 code
  if [[ $env == - ]]; then ./test.sh --only "$only" > /dev/null 2>&1; code=$?
  else env "$env" ./test.sh --only "$only" > /dev/null 2>&1; code=$?; fi
  local got=error; (( code == 0 )) && got=pass; (( code == 1 )) && got=fail
  if [[ $got == $want ]]; then printf 'ok    %-42s run %sed (exit %d)\n' "$label" "$got" $code
  else bad=$((bad + 1)); printf 'WRONG %-42s run %sed (exit %d), expected it to %s\n' "$label" "$got" $code "$want"; fi
}

# A fault a suite defines but this script never runs is a fault proof that proves nothing: stop before running any.
unlisted=()
for f in ${(f)"$(grep -ho "mutation('[a-z0-9-]*'" tests/*.cjs | cut -d"'" -f2 | sort -u)"}; do
  grep -Eq "^expect fail .*MUTATE=$f( |\$)" "${0:A}" || unlisted+=("MUTATE=$f")
done
for f in ${(f)"$(grep -ho "fault('[a-z0-9-]*')" tests/*.cjs tests/lib/*.cjs | cut -d"'" -f2 | sort -u)"}; do
  grep -Eq "^expect fail .*TEST_FAULT=$f( |\$)" "${0:A}" || unlisted+=("TEST_FAULT=$f")
done
if (( ${#unlisted} )); then print "Faults the suites define that this script never runs: ${unlisted[*]}"; exit 1; fi

expect pass 'clean run, every suite'        -
expect fail 'UI: encryption outlives its pane' MUTATE=encryption-outlives-pane ui-state
expect fail 'UI: only writes are serialized'  MUTATE=edit-writes-only         ui-state
expect fail 'UI: Activity list blind to reads' MUTATE=activity-list-unread ui-state
expect fail 'UI: activity kept across languages' MUTATE=activity-source-language ui-state
expect fail 'UI: hold release click asks'    MUTATE=hold-release-click       ui-state
expect fail 'UI: dialog confirms unchecked'  MUTATE=dialog-unchecked         ui-state
expect fail 'UI: Hold to send skips confirmSend' MUTATE=hold-bypasses-confirm ui-state
expect fail 'UI: dialog check not passed on'  MUTATE=confirm-asked-dropped    ui-state
expect fail 'UI: confirmSend skips the guard' MUTATE=confirm-unguarded        ui-state
expect fail 'UI/adopt: guard ignores the dialog check' MUTATE=guard-asked-ignored adopt,ui-state
expect fail 'outcomes: a server’s words on screen' MUTATE=server-words-shown outcomes
expect fail 'outcomes: reordering marks kept'  MUTATE=bidi-kept outcomes
expect fail 'outcomes: a retry after a lock'   MUTATE=retry-after-lock outcomes
expect fail 'outcomes: a lock misses the request out' MUTATE=abort-unwired outcomes
expect fail 'outcomes: a lock read as a network error' MUTATE=abort-as-network-error outcomes
expect fail 'app-sign: decoded transfer unchecked' MUTATE=decode-unchecked app-sign
expect fail 'page: CSP other than reviewed'    TEST_FAULT=csp-shape page
expect fail 'app-sign: self-test ignores signatures' MUTATE=selftest-sign-unchecked app-sign
expect fail 'UI: a save after a lock as saved' MUTATE=save-after-lock-ok ui-state
expect fail 'UI: a setting redraws nothing'           MUTATE=prefs-unbumped ui-state
expect fail 'UI: an account edit redraws nothing'     MUTATE=wallet-edit-unbumped ui-state
expect fail 'UI: another account redraws nothing'     MUTATE=scope-unbumped ui-state
expect fail 'UI: a lock keeps the activity source'    MUTATE=lock-unbumped ui-state
expect fail 'UI: a balance redraws nothing'           MUTATE=balance-unbumped ui-state
expect fail 'UI: an unchanged balance redraws'        MUTATE=balance-bumped-always ui-state
expect fail 'UI: prices redraw nothing'               MUTATE=market-unbumped ui-state
expect fail 'UI: the chart redraws nothing'           MUTATE=chart-unbumped ui-state
expect fail 'UI: transactions redraw nothing'         MUTATE=history-unbumped ui-state
expect fail 'UI: unchanged transactions redraw'       MUTATE=history-bumped-always ui-state
expect fail 'UI: the whole history redraws nothing'   MUTATE=full-unbumped ui-state
expect fail 'UI: an unchanged whole history redraws'  MUTATE=full-bumped-always ui-state
expect fail 'UI: focus lost when its opener is redrawn' MUTATE=opener-not-found ui-state
expect fail 'UI: focus by position only'              MUTATE=opener-place-only ui-state
expect fail 'UI: a restored transfer redraws nothing' MUTATE=restore-unbumped ui-state
expect fail 'UI: a settled transfer redraws nothing'  MUTATE=settle-unbumped ui-state
expect fail 'UI: a checked transfer redraws nothing'  MUTATE=dismiss-unbumped ui-state
expect fail 'UI: a transfer signed redraws nothing'   MUTATE=send-unbumped ui-state
expect fail 'UI: an unsaved transfer redraws nothing' MUTATE=send-undo-unbumped ui-state
expect fail 'UI: a broadcast answered redraws nothing' MUTATE=broadcast-unbumped ui-state
expect fail 'UI: a retried broadcast redraws nothing' MUTATE=retry-unbumped ui-state
expect fail 'UI: labels redraw nothing'               MUTATE=labels-unbumped ui-state
expect fail 'UI: the tick redraws nothing'            MUTATE=tick-unbumped ui-state
expect fail 'UI: assets redraw nothing'                MUTATE=assets-unbumped ui-state
expect fail 'UI: unchanged assets redraw'             MUTATE=assets-bumped-always ui-state
expect fail 'UI: Load more starting redraws nothing'  MUTATE=more-unbumped ui-state
expect fail 'UI: Load more ending redraws nothing'    MUTATE=more-done-unbumped ui-state
expect fail 'UI: a failed read redraws nothing'       MUTATE=history-error-unbumped ui-state
expect fail 'UI: the same failure redraws'            MUTATE=history-error-bumped-always ui-state
expect fail 'UI: an address sent to redraws nothing'  MUTATE=sent-unbumped ui-state
expect fail 'UI: a filter redraws nothing'            MUTATE=filters-set-unbumped ui-state
expect fail 'UI: Show more redraws nothing'           MUTATE=filters-more-unbumped ui-state
expect fail 'UI: Show all redraws nothing'            MUTATE=filters-reset-unbumped ui-state
expect fail 'UI: the self-test redraws nothing'       MUTATE=selftest-unbumped ui-state
expect fail 'UI: a read redraws after a lock'         MUTATE=redraw-after-lock ui-state
expect fail 'UI: a balance kept after a lock'         MUTATE=balance-kept-after-lock ui-state
expect fail 'UI: a balance error after a lock'        MUTATE=balance-error-after-lock ui-state
expect fail 'UI: assets kept after a lock'            MUTATE=assets-kept-after-lock ui-state
expect fail 'UI: an assets error after a lock'        MUTATE=assets-error-after-lock ui-state
expect fail 'UI: a whole history kept after a lock'   MUTATE=full-kept-after-lock ui-state
expect fail 'UI: a history error after a lock'        MUTATE=full-error-after-lock ui-state
expect fail 'UI: a tick kept after a lock'            MUTATE=tick-kept-after-lock ui-state
expect fail 'UI: a tick error after a lock'           MUTATE=tick-error-after-lock ui-state
expect fail 'UI: prices kept after a lock'            MUTATE=market-kept-after-lock ui-state
expect fail 'UI: a price error after a lock'          MUTATE=market-error-after-lock ui-state
expect fail 'UI: prices redrawn after a lock'         MUTATE=market-redrawn-after-lock ui-state
expect fail 'UI: exchange status after a lock'        MUTATE=exchanges-after-lock ui-state
expect fail 'UI: a chart kept after a lock'           MUTATE=chart-after-lock ui-state
expect fail 'UI: price history kept after a lock'     MUTATE=prices-after-lock ui-state
expect fail 'UI: labels kept after a lock'            MUTATE=labels-after-lock ui-state
expect fail 'UI: labels redrawn after a lock'         MUTATE=labels-redrawn-after-lock ui-state
expect fail 'UI: an archive tick kept after a lock'   MUTATE=archive-after-lock ui-state
# Wrong expected bytes, hashes, signatures and QR results.
expect fail 'i18n: English formatting'     TEST_FAULT=english-format          i18n
expect fail 'kat: identity'                 TEST_FAULT=kat-identity            kat
expect fail 'kat: K12 digest'               TEST_FAULT=kat-digest              kat
expect fail 'kat: signature'                TEST_FAULT=kat-signature           kat
expect fail 'kat: transaction hash'         TEST_FAULT=kat-txhash              kat
expect fail 'kat: Argon2id'                 TEST_FAULT=kat-argon2              kat
expect fail 'app-sign: transaction bytes'   TEST_FAULT=tx-bytes                app-sign
expect fail 'app-sign: transaction id'      TEST_FAULT=tx-hash                 app-sign
expect fail 'app-sign: signature'           TEST_FAULT=tx-signature            app-sign
expect fail 'app-sign: missing refusal'     TEST_FAULT=refusal                 app-sign
expect fail 'crosscheck: K12'               TEST_FAULT=xc-k12                  crosscheck
expect fail 'crosscheck: identity'          TEST_FAULT=xc-identity             crosscheck
expect fail 'crosscheck: signature'         TEST_FAULT=xc-signature            crosscheck
expect fail 'msg-sign: output'              TEST_FAULT=msg-output              msg-sign
expect fail 'msg-sign: wrong identity'      TEST_FAULT=msg-identity            msg-sign
expect fail 'msg-sign: malformed input'     TEST_FAULT=msg-malformed           msg-sign
expect fail 'msg-sign: guard'               TEST_FAULT=msg-guard               msg-sign
expect fail 'qr: decoded result'            TEST_FAULT=qr-result               qr
# The runner itself.
expect fail 'runner: passing summary, exit 1' TEST_FAULT=summary-lie           kat
expect fail 'runner: one fault, every suite' TEST_FAULT=tx-signature
# Code changes the page, lifecycle, outcome and message-signing suites must catch.
# The page's one script: the library handed over through a global, by the build or read by the app first, or
# taken from one when the page's own libraries fail to start; and the wallet starting without its library.
expect fail 'page: library handed over by a global'  MUTATE=page-global      page
expect fail 'page: app reads the global first'       MUTATE=app-global       page
expect fail 'page: global taken when the start fails' MUTATE=catch-fallback  page
expect fail 'page: runs without its library'         MUTATE=no-library-runs  page
expect fail 'adopt: cleanup by accounts only' MUTATE=discard-accounts          adopt
expect fail 'adopt: unguarded journal sync'  MUTATE=sync-unguarded             adopt
expect fail 'storage: no re-check after save' MUTATE=no-final-check            storage-lifecycle
expect fail 'storage: page served by a service worker' MUTATE=worker-controller storage-lifecycle
expect fail 'storage: worker registered on the address' MUTATE=worker-listed   storage-lifecycle
expect fail 'storage: worker list holds up startup' MUTATE=worker-wait         storage-lifecycle
expect fail 'storage: worker removal spins forever' MUTATE=remove-wait         storage-lifecycle
expect fail 'storage: confirmed removal distrusted' MUTATE=remove-listed       storage-lifecycle
expect fail 'storage: worker check after the self-test' MUTATE=worker-late     storage-lifecycle
expect fail 'storage: worker check not awaited' MUTATE=worker-unawaited        storage-lifecycle
expect fail 'storage: refusal keeps the reload key' MUTATE=worker-keeps-reload-key storage-lifecycle
expect fail 'storage: worker check skipped without libraries' MUTATE=worker-skipped-without-library storage-lifecycle
expect fail 'outcomes: odd exchange flags read' MUTATE=status-loose-flags    outcomes
expect fail 'outcomes: unknown status called paused' MUTATE=status-unknown-paused outcomes
expect fail 'outcomes: donation address typo' MUTATE=donation-address-typo   outcomes
expect fail 'outcomes: tip dollars turned the wrong way' MUTATE=tip-usd-inverted outcomes
expect fail 'outcomes: accent ink by the old 4.5:1 rule' MUTATE=ink-wcag        outcomes
expect fail 'adopt: failure from a restarted record' MUTATE=fail-on-account   adopt
expect fail 'adopt: failure from the archive’s false' MUTATE=fail-on-flag      adopt
expect fail 'adopt: failure from a record Core dropped' MUTATE=fail-when-gone  adopt
expect fail 'adopt: deposit in the transfer’s own tick' MUTATE=same-tick-deposit adopt
expect fail 'adopt: success from account record' MUTATE=send-on-account       adopt
expect fail 'adopt: archive flag over the settlement' MUTATE=flag-row          adopt
expect fail 'adopt: archive false shown as failed' MUTATE=flag-failed          adopt
expect fail 'adopt: sent on a record unlike the signed one' MUTATE=sent-unchecked adopt
expect fail 'adopt: the record’s signature not compared' MUTATE=same-loose-signature adopt
expect fail 'adopt: not executed before the tick is processed' MUTATE=absent-unprocessed adopt
expect fail 'adopt: a tick list with bad entries used' MUTATE=absent-loose-list adopt
expect fail 'adopt: another tick’s list used' MUTATE=absent-other-tick adopt
expect fail 'adopt: a tick list that lists it ignored' MUTATE=present-ignored adopt
expect fail 'adopt: broadcast before the journal is written' MUTATE=broadcast-unjournalled adopt
expect fail 'adopt: broadcast after a lock' MUTATE=broadcast-after-lock adopt
expect fail 'adopt: incoming read by input type' MUTATE=flag-by-type           adopt
expect fail 'adopt: contract call counted without flag' MUTATE=contract-call-unflagged adopt
expect fail 'adopt: unconfirmed money gone through' MUTATE=credit-unconfirmed  adopt
expect fail 'adopt: received by direction alone' MUTATE=received-by-dir       adopt
expect fail 'adopt: unconfirmed money given a value' MUTATE=valued-unconfirmed adopt
expect fail 'adopt: zero amount restored'     MUTATE=zero-restored             adopt
expect fail 'adopt: random generator not checked' MUTATE=rng-unchecked    adopt
expect fail 'adopt: generator of rejected bytes kept' MUTATE=rng-rejected-bytes adopt
expect fail 'adopt: made seed not checked'    MUTATE=seed-unchecked     adopt
expect fail 'adopt: gave up before the tick passed' MUTATE=give-up-early       adopt
expect fail 'adopt: checked before the tick'   MUTATE=dismiss-early            adopt
expect fail 'adopt: checked before the archive' MUTATE=dismiss-unarchived      adopt
expect fail 'adopt: checked on the archive alone' MUTATE=dismiss-tickless      adopt
expect fail 'adopt: checked at the tick itself' MUTATE=dismiss-at-tick         adopt
expect fail 'adopt: send lock dropped mid-transfer' MUTATE=claim-backstop      adopt
expect fail 'adopt: send lock kept past the tick' MUTATE=claim-past-tick    adopt
expect fail 'adopt: stalled tick shown as moving' MUTATE=stall-unseen          adopt
expect fail 'adopt: any repeated tick a stall' MUTATE=stall-instant            adopt
expect fail 'storage: write without its auth re-check' MUTATE=write-auth      storage-lifecycle
expect fail 'storage: erase outside the lock'  MUTATE=erase-unlocked           storage-lifecycle
expect fail 'storage: writes without Web Locks' MUTATE=lock-fallback           storage-lifecycle
expect fail 'storage: erased new wallet not refused' MUTATE=no-gone            storage-lifecycle
expect fail 'adopt: cancelled resume keeps secrets' MUTATE=no-drop             adopt
expect fail 'adopt: cleanup ignores the owner' MUTATE=no-owner                 adopt
expect fail 'adopt: cancelled unlock adopted'  MUTATE=no-cancel                adopt
expect fail 'adopt: erase clears memory late'  MUTATE=erase-late               adopt
expect fail 'adopt: erase success unverified'  MUTATE=erase-unchecked          adopt
expect fail 'adopt: failed discard left unsaid' MUTATE=discard-silent          adopt
expect fail 'adopt: limit stops a seed upgrade' MUTATE=limit-first             adopt
expect fail 'adopt: failed removal not redrawn' MUTATE=remove-silent           adopt
expect fail 'adopt: price history with market data off' MUTATE=price-unguarded adopt
expect fail 'adopt: removal with a transfer open' MUTATE=remove-open          adopt
expect fail 'adopt: removed sender not restored' MUTATE=restore-gone-sender   adopt
expect fail 'adopt: outgoing read without its filter' MUTATE=sent-unfiltered   adopt
expect fail 'adopt: only the accounts on screen read' MUTATE=lookalike-scope-only adopt
expect fail 'adopt: look-alike reads not shared' MUTATE=known-run-unshared  adopt
expect fail 'adopt: transfers signed here left out' MUTATE=sent-no-pending     adopt
expect fail 'adopt: a known look-alike not flagged' MUTATE=lookalike-known-silent adopt
expect fail 'adopt: loading passed in silence'  MUTATE=lookalike-loading-silent adopt
expect fail 'adopt: hold kept when the check changes' MUTATE=hold-not-cancelled adopt
expect fail 'adopt: hold sends on a stale check' MUTATE=hold-stale-ignored adopt
expect fail 'adopt: look-alike run joined across a lock' MUTATE=known-run-across-sessions adopt
expect fail 'adopt: look-alike run skips a late account' MUTATE=known-run-snapshot adopt
expect fail 'adopt: look-alike run retries in an outage' MUTATE=known-run-retries adopt
expect fail 'adopt: look-alike runs overlap after a lock' MUTATE=known-run-overlap adopt
expect fail 'adopt: old read goes on past a lock' MUTATE=sent-read-past-lock adopt
expect fail 'adopt: old read kept past a lock' MUTATE=sent-kept-past-lock adopt
expect fail 'adopt: old failure kept past a lock' MUTATE=sent-failed-past-lock adopt
expect fail 'adopt: message check misses watch-only seeds' MUTATE=scope-no-watch adopt
expect fail 'adopt: Review hold skips the stale guard' MUTATE=guard-sends-anyway adopt
expect fail 'adopt: chart history read in full each time' MUTATE=full-no-topup adopt
expect fail 'adopt: “haven’t sent” said before the read' MUTATE=sent-here-early adopt
expect fail 'adopt: arrivals said for the first read' MUTATE=arrivals-from-start adopt
expect fail 'adopt: arrivals said before they moved' MUTATE=arrivals-unmoved adopt
expect fail 'adopt: an arrival said twice' MUTATE=arrivals-twice adopt
expect fail 'adopt: arrivals said for watched addresses' MUTATE=arrivals-watched adopt
expect fail 'adopt: an arrival said after a lock' MUTATE=arrivals-after-lock adopt
expect fail 'adopt: a history without its total read as whole' MUTATE=history-total-lenient adopt
expect fail 'adopt: Send dialog not re-checked' MUTATE=check-not-offered adopt
expect fail 'adopt: an account switch reseals the wallet' MUTATE=switch-reseals adopt
expect fail 'adopt: “sent here” said of your own account' MUTATE=sent-here-own adopt
expect fail 'adopt: chart history read at once past a gap' MUTATE=full-unthrottled adopt
expect fail 'activity: a kind lets everything through' MUTATE=activity-kind-ignored activity-view
expect fail 'activity: only Activity’s pages searched' MUTATE=activity-history-only activity-view
expect fail 'activity: a transfer’s own row repeated' MUTATE=activity-no-skip activity-view
expect fail 'activity: a capped history called whole' MUTATE=activity-capped-whole activity-view
expect fail 'activity: unconfirmed money totalled' MUTATE=activity-totals-unconfirmed activity-view
expect fail 'activity: a move between accounts as sent' MUTATE=activity-totals-self activity-view
expect fail 'activity: amounts searched while hidden' MUTATE=activity-amount-when-hidden activity-view
expect fail 'activity: ordered by amount while hidden' MUTATE=activity-order-when-hidden activity-view
expect fail 'activity: “2 500” read as two words' MUTATE=activity-grouped-digits activity-view
expect fail 'activity: short addresses not understood' MUTATE=activity-short-id activity-view
expect fail 'activity: accents not ignored' MUTATE=activity-accents activity-view
expect fail 'activity: a transfer signed here under any kind' MUTATE=activity-pending-kind activity-view
expect fail 'msg-sign: seed in a message signed' MUTATE=msg-seed               msg-sign
expect fail 'msg-sign: only the signer’s seed'  MUTATE=msg-seed-signer-only   msg-sign
expect fail 'msg-sign: seed matched exactly'    MUTATE=msg-seed-exact         msg-sign
expect fail 'msg-sign: fragment warning missing' MUTATE=msg-fragment-warning msg-sign
expect fail 'msg-sign: partial-seed guessing oracle' MUTATE=msg-fragment-oracle msg-sign
expect fail 'seed privacy: reveal after returning' MUTATE=privacy-late-reveal seed-privacy
expect fail 'seed privacy: blur ignored' MUTATE=privacy-blur seed-privacy
expect fail 'seed privacy: copy outlives focus' MUTATE=privacy-copy seed-privacy
expect fail 'seed privacy: lock screen keeps draft' MUTATE=unlock-keeps-draft seed-privacy
expect fail 'password: typing leaves the error' MUTATE=password-error-kept seed-privacy
expect fail 'password: leaving keeps the fields' MUTATE=password-kept-on-leave seed-privacy
expect fail 'password: kept while checked' MUTATE=password-kept-while-checked seed-privacy
expect fail 'password: backup file autofilled' MUTATE=backup-file-autocomplete seed-privacy
expect fail 'password: Change password clears the pair' MUTATE=change-clears-pair seed-privacy
expect fail 'msg-sign: watch-only seed not looked for' MUTATE=msg-seed-watch  msg-sign
expect fail 'msg-sign: seed shape unconfirmed'  MUTATE=msg-seedlike           msg-sign
expect fail 'msg-sign: seed shape passed as an id' MUTATE=msg-seed-shape-exempt msg-sign
expect fail 'types: a field the state lacks'   MUTATE=types-field            types
expect fail 'types: an unknown error code'    MUTATE=types-code             types
expect fail 'types: parseTx drifts from its type' MUTATE=types-record       types
expect fail 'types: a gone account read (strict)' MUTATE=types-null         types

print
if (( bad )); then print "$bad deliberate fault(s) did NOT fail the run"; exit 1; fi
print 'Every deliberate fault failed the run, and the clean run passed'
exit 0
