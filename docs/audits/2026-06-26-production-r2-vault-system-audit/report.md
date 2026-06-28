# Production R2 Vault System Audit

Plan date: 2026-06-26
Execution started: 2026-06-27T16:28:22-04:00
Report generated: 2026-06-28T04:18:39.262Z

## Split Verdicts

| Verdict | Status | Evidence |
| ------- | ------ | -------- |
| Production R2 internal correctness | dirty | Raw R2: verified; hashes: verified; D1: verified; metadata: verified; local: verified; Worker: verified; web: verified; reconciliation: dirty. |
| Current Grok Saved completeness | blocked | Full Saved completeness requires an authoritative current Saved enumeration; visual samples alone do not prove it. |
| Local system health | clean | Local checks: verified; local files: verified. |

## Identity Proof

- R2 bucket: grok-gallery-001
- D1 database: grok-powertools-db
- D1 database ID: ad89e4bb-0b68-4c72-93d9-b90e6eb45aa6
- Key prefix: grok-powertools/v1
- Worker name: grok-r2-backup-worker
- Account ID from config: ba5339fd86e87c226bdc306347636042

## Counts

- Raw R2 objects: 18083
- Raw R2 media objects: 15981
- Raw R2 metadata objects: 10
- R2 hash attempts: 15981
- R2 hash failures: 0
- Local media/files inventoried: 8532
- D1/Worker indexed assets: 4647
- Web route assets: 4647

## Duplicate Findings

See `reconciliations/duplicate-groups.json`. Same-hash groups: 5116.
See `reconciliations/unresolved-summary.json` for duplicate and legacy/canonical classification. Duplicate hash object groups: 5116.
Duplicate byte hashes are real byte-identical groups, not automatic corruption or deletion candidates. They require classification because many involve legacy date-folder repeats, and some canonical-only groups remain unresolved.

## Missing Media

See `reconciliations/r2-local-delta.json`, `reconciliations/r2-d1-delta.json`, and `reconciliations/worker-raw-delta.json`.
R2 media missing from D1 by class: {"legacy-date-media":9893,"canonical-media":1441}.
R2 media missing from Worker by class: {"legacy-date-media":9893,"canonical-media":1441}.
Interpretation: exact-key D1/Worker gaps include legacy date-folder media that the current D1/Worker inventory does not index by design, plus canonical `media/by-asset` objects that remain unresolved raw-R2-only evidence until another artifact proves they are intentionally out of scope.

## Metadata Reference Coverage

See `reconciliations/r2-metadata-delta.json`.
`metadataReferencesMissingMedia` means metadata references pointing at missing media. `r2MediaWithoutMetadataReference` is not proof that required metadata is missing; the metadata reference artifact is mostly prompt sidecar references and is not an authoritative coverage map for every R2 object.

## Malformed Keys

See `reconciliations/malformed-keys.json`.

## Local-Only And R2-Only Findings

See `reconciliations/r2-local-delta.json`.
Interpretation: local/R2 deltas are SHA-256 overlap findings between production R2 and the scanned local macOS corpus only. They do not prove that R2 lost local files or that the local machine is expected to contain every R2 asset.

## Worker And Product Route Mismatches

See `reconciliations/worker-raw-delta.json`.
See `reconciliations/web-worker-delta.json`. Web/Worker asset ID mismatches: 0 worker-only and 0 web-only.
Interpretation: web route parity proves the product route matches Worker/D1 inventory. It does not prove the web Vault covers every raw R2 object because the Worker inventory prefers D1-indexed rows.

## Route Safety Evidence

- Worker route source proof: `logs/route-safety-source.txt`
- Next route source proof: `logs/next-route-safety-source.txt`
- Production write routes remain denied until a separate approved repair plan.

## Live Grok Samples

Status: blocked. Evidence goes in `browser-samples/live-grok-samples.md`.

## Extension Status

Status: blocked. Evidence goes in `browser-samples/live-grok-samples.md`.

## Local System Checks

- rootUnit: passed (logs/root-test-unit.txt)
- rootE2E: passed (logs/root-test-e2e.txt)
- rootLint: passed (logs/root-lint.txt)
- webBuild: passed (logs/web-build.txt)
- webLint: passed (logs/web-lint.txt)
- cloudTypecheck: passed (logs/cloud-typecheck.txt)
- cloudAcceptance: passed (logs/cloud-test-acceptance.txt)
- webUiSmoke: passed (logs/web-ui-smoke.json)

## Blockers

1. liveGrok: Visible Chrome window is not the Grok Saved tab, and project instructions forbid broad Chrome tab discovery or taking over unrelated tabs for live Grok validation.

## Unresolved Items

See `reconciliations/unresolved-items.json` for 5 unresolved groups.

## Prioritized Next Actions

- P0 live validation: Bring the existing Grok Saved tab/window to the foreground for read-only live Grok and extension inspection.
- P1 data correctness: Review unresolved canonical raw-R2-only objects, duplicate hash groups, and local/R2 overlap findings before any repair plan.
- P2 backup pipeline reliability: Only after this read-only audit, design a separate repair/backfill plan for confirmed gaps.
- P2 product visibility and operator UX: Improve preview/reporting only after raw R2 and D1 truth are reconciled.
