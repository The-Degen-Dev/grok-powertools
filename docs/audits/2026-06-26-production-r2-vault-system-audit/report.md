# Production R2 Vault System Audit

Plan date: 2026-06-26
Execution started: 2026-06-27T16:28:22-04:00
Report generated: 2026-06-27T20:56:03.500Z

## Split Verdicts

| Verdict | Status | Evidence |
| ------- | ------ | -------- |
| Production R2 internal correctness | blocked | Raw R2: not_run; hashes: not_run; D1: not_run; metadata: not_run; local: verified; Worker: not_run; reconciliation: not_run. |
| Current Grok Saved completeness | inconclusive | Full Saved completeness requires an authoritative current Saved enumeration; visual samples alone do not prove it. |
| Local system health | clean | Local checks: verified; local files: verified. |

## Identity Proof

- R2 bucket: grok-gallery-001
- D1 database: grok-powertools-db
- D1 database ID: ad89e4bb-0b68-4c72-93d9-b90e6eb45aa6
- Key prefix: grok-powertools/v1
- Worker name: grok-r2-backup-worker
- Account ID from config: ba5339fd86e87c226bdc306347636042

## Counts

- Raw R2 objects: not_run
- Raw R2 media objects: not_run
- Raw R2 metadata objects: not_run
- R2 hash attempts: not_run
- R2 hash failures: not_run
- Local media/files inventoried: 8532

## Duplicate Findings

See `reconciliations/duplicate-groups.json`. Same-hash groups: not_run.

## Missing Media

See `reconciliations/r2-local-delta.json`, `reconciliations/r2-d1-delta.json`, and `reconciliations/worker-raw-delta.json`.

## Missing Metadata

See `reconciliations/r2-metadata-delta.json`.

## Malformed Keys

See `reconciliations/malformed-keys.json`.

## Local-Only And R2-Only Findings

See `reconciliations/r2-local-delta.json`.

## Worker And Product Route Mismatches

See `reconciliations/worker-raw-delta.json`.

## Live Grok Samples

Status: not_run. Evidence goes in `browser-samples/live-grok-samples.md`.

## Extension Status

Status: not_run. Evidence goes in `browser-samples/live-grok-samples.md`.

## Local System Checks

- rootUnit: passed (logs/root-test-unit.txt)
- rootE2E: passed (logs/root-test-e2e.txt)
- rootLint: passed (logs/root-lint.txt)
- webBuild: passed (logs/web-build.txt)
- webLint: passed (logs/web-lint.txt)
- cloudTypecheck: passed (logs/cloud-typecheck.txt)
- cloudAcceptance: passed (logs/cloud-test-acceptance.txt)

## Blockers

1. preflight: CLOUDFLARE_ACCOUNT_ID missing or does not match production account from cloud/wrangler.toml
2. preflight: Authenticated R2 bucket/prefix proof failed
3. preflight: Cloudflare Wrangler auth token appears broader than read-only

## Unresolved Items

None recorded.

## Prioritized Next Actions

- P0 data correctness: Resolve blockers and review unresolved reconciliation groups before any repair plan.
- P1 backup pipeline reliability: Only after this read-only audit, design a separate repair/backfill plan for confirmed gaps.
- P2 product visibility and operator UX: Improve preview/reporting only after raw R2 and D1 truth are reconciled.
