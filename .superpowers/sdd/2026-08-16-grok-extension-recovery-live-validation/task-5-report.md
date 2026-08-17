# Task 5 Report: Conservative Saved Scan Ledger And Exhaustion Proof

Date: 2026-08-17
Branch: `codex/grok-extension-recovery`
Exact base: `faace04ae55fb4b25b94378c0988a52ba33463d3`
Status: complete

## Commits

- Carry gate: `75a589c` (`fix(extension): reject ambiguous scrape writers`)
- Saved traversal: `fix(extension): prove Saved gallery exhaustion` (this report's commit)

No push was performed.

## Carry Gate

- Added immutable `claimId` values to writer markers and version 4 run-state records.
- Same `(writerEpoch, writerId)` records from distinct claim IDs now conflict before revision ordering.
- Sequential revisions from one claim ID still select the latest accepted record.
- A current-run record with matching token, epoch, owner tab, and kind but a mismatched lease writer now conflicts instead of falling through as missing.
- Conflicts tombstone the active lease and clear stale unversioned `scraperState`, `currentIndex`, navigation, and backup progress.
- Legacy records remain readable. Multiple legacy records asserting one full authority are conservatively distinct claims and therefore conflict.

Carry red:

```text
npm run test:unit -- --runInBand tests/unit/grokScraperNavigation.test.js -t "writer claimant|lease writer|same full authority"
FAIL: 2 failed, 1 passed, 258 skipped
```

Carry green:

```text
npm run test:unit -- --runInBand tests/unit/grokScraperNavigation.test.js -t "writer claimant|lease writer|same full authority"
PASS: 3 passed, 258 skipped
```

## Saved Traversal

- Added a per-run in-memory identity and durability ledger.
- Persisted backup scan state contains only numeric counts and timestamps, never identity sets.
- Added visible semantic loading detection scoped to the Saved surface.
- Applied the exact eligibility split: normal Sync skips historical processed IDs and same-run visits; backup ignores historical processed IDs and skips only same-run backup visits.
- Added a bounded durability query before every Saved bottom probe.
- Bottom proof requires 8 unchanged rounds, at least 6000 ms since the last new identity, no semantic loader, no pending transfer, no gallery change, and a bottom position.
- Probe waits are 750 ms. Limits are 1000 backup attempts and 200 normal Sync attempts.
- Natural exhaustion passes through the bounded durability barrier before Complete. Safety limits stop as `scan_limit` for both modes.
- Added a virtualized five-window fixture with 30 identities, mixed image/video Agent media, exact-once transfer, valid Saved receipts on every return, no Agent gallery scroll, and durable completion only after all identities.
- Added a visible-loader fixture that reaches all 1000 backup attempts and reports `scan_limit`, never Complete.

Scan-ledger red:

```text
npm run test:unit -- --runInBand tests/unit/grokScraperNavigation.test.js -t "scan ledger|bottom|exhaust"
FAIL: 6 failed, 261 skipped
```

Scan-ledger green:

```text
npm run test:unit -- --runInBand tests/unit/grokScraperNavigation.test.js -t "scan ledger|bottom|exhaust"
PASS: 6 passed, 261 skipped
```

The first focused virtualized E2E run found a fixture-only processed-key mismatch: the backup dedupe set uses the canonical source URL, not the ledger UUID. After correcting the fixture, the focused set passed.

## Validation

```text
npm run test:unit -- --runInBand tests/unit/grokScraperNavigation.test.js --silent --verbose=false
PASS: 269 tests

npm run test:unit -- --runInBand tests/unit/grokScraperNavigation.test.js tests/unit/grokScraperBackup.test.js --silent --verbose=false
PASS: 361 tests

npm run test:unit -- --runInBand --silent --verbose=false
PASS: 28 suites, 767 tests

npm run test:e2e -- --grep "virtualized|Saved"
PASS: 10 tests

npm run test:e2e
PASS: 37 tests

npm run lint
PASS

node --check background.js
node --check content.js
node --check tests/unit/grokScraperNavigation.test.js
node --check tests/e2e/extension.spec.js
PASS

git diff --check
PASS
```

```text
gitleaks git --staged --redact --no-banner
PASS: no leaks found, approximately 36.15 KB scanned

git diff --cached --check
PASS
```

## Self-review

- Fixed a rejected one-shot durability query so it remains fail-closed as pending instead of escaping the scan loop.
- Fixed failed backup scan-summary persistence so it terminates with `scan_progress_persist_failed` instead of silently leaving a run active.
- Preserved the Task 4 legacy resolver contract for its existing exhaustion fixtures while using the conservative contract in runtime traversal.
- Confirmed only authorized runtime, test, and report files changed. Protected untracked files remain untouched.
- No live Chrome, cloud, R2, D1, credential, deployment, or network validation was performed.
