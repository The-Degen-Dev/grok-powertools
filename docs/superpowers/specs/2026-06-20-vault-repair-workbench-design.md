# Vault Repair Workbench Design

Date: 2026-06-20

## Summary

Build a Vault Repair Workbench for the Grok Power Tools web app. The workbench is a controlled repair console for finding, planning, approving, running, verifying, and recording repairs across the R2-backed Vault system.

The workbench must make R2, D1, metadata snapshots, local proof, and live Grok evidence understandable without turning repair into a broad "fix everything" button. It starts read-only, fails closed by default, and only runs approved repair actions with exact target counts, source proof, write classes, and a stable plan hash.

This spec covers the approved product and safety design. It does not claim repair routes are already built. Current gap-fill and reconcile routes intentionally fail closed.

## Approved Constraints

- R2 remains the primary source for the loaded Vault library.
- Live Grok Saved is a gated repair lane only, used after stored proof shows a gap.
- All scan and plan flows are read-only.
- Production R2 writes, D1 writes, metadata repair, live Grok repair, backfill, retry, and processed-ID changes require explicit operator approval.
- No deletes are allowed in the repair workbench.
- No processed-ID reset is allowed.
- No silent overwrite is allowed.
- No detached Chrome profile is allowed.
- No generated replacement media is allowed.
- Public cached media URLs are not proof. Verification must use direct Worker, S3, D1, or local hash proof.

## Product Model

The workbench has five repair tiers.

| Tier | Name | Allowed action | Approval |
| --- | --- | --- | --- |
| T0 | Read-only detection | Scan, classify, preview, plan | Not required |
| T1 | D1 index repair | Update proof/index rows from existing evidence | Required |
| T2 | Metadata repair | Write or refresh metadata snapshots and sidecars | Required |
| T3 | Object canonicalization | Link duplicates, choose canonical records, record alternates or conflicts | Required |
| T4 | Media restore | Restore a missing or corrupt media object from verified source proof only | Required |

The repair surface has these units:

- Scanner: reads R2 inventory, D1 index rows, metadata snapshots, IndexedDB Vault records, and known canonical key rules.
- Classifier: converts observed drift into `RepairIssue` records.
- Planner: converts selected issues into a `RepairPlan`.
- Approval gate: binds approval to an exact plan hash.
- Runner: runs approved non-Grok repairs through narrow server and Worker routes.
- Live Grok runbook: describes operator steps for existing Chrome-session repair.
- Verifier: checks direct proof after a run.
- Ledger: records append-only evidence for scans, plans, approvals, runs, and verification.

## Repair Data Model

The workbench adds first-class repair records instead of overloading Vault assets.

```ts
type RepairIssue = {
  issueId: string;
  assetId?: string;
  issueType:
    | "index_drift"
    | "metadata_drift"
    | "duplicate_canonical_mismatch"
    | "missing_media_object"
    | "corrupt_media_object"
    | "live_grok_required";
  riskTier: "T0" | "T1" | "T2" | "T3" | "T4";
  sourceProof: SourceProof[];
  writeClass: "none" | "d1_index" | "r2_metadata" | "r2_media" | "live_grok_runbook";
  blockedReason?: string;
};

type SourceProof = {
  kind: "r2_object" | "d1_index" | "metadata_snapshot" | "local_verified_object" | "live_grok_existing_chrome";
  label: string;
  objectKey?: string;
  contentSha256?: string;
  sizeBytes?: number;
  observedAt: string;
};

type RepairPlan = {
  planId: string;
  issueIds: string[];
  targetCount: number;
  objectKeys: string[];
  writeClasses: RepairIssue["writeClass"][];
  riskTierMax: RepairIssue["riskTier"];
  actions: RepairAction[];
  planHash: string;
  createdAt: string;
};

type RepairAction = {
  actionId: string;
  idempotencyKey: string;
  writeClass: RepairIssue["writeClass"];
  target: string;
  expectedProof: SourceProof[];
};

type RepairRun = {
  runId: string;
  planId: string;
  planHash: string;
  status: "draft" | "dry_run_ready" | "blocked" | "needs_approval" | "approved" | "running" | "succeeded" | "partial" | "failed" | "cancelled";
  resultCounts: {
    succeeded: number;
    skipped: number;
    conflicted: number;
    failed: number;
  };
};
```

Live Grok runbooks use a separate state lane:

```ts
type LiveGrokRunbookState =
  | "approved"
  | "waiting_for_operator"
  | "running_external"
  | "needs_user_action"
  | "succeeded"
  | "partial"
  | "failed";
```

Approval is invalidated if any selected target, object key, issue list, write class, target count, or action changes after approval.

## Architecture And Data Flow

The web app owns the workbench UI, local repair history, plan review, approval review, and run history. It must not mutate R2 or D1 as a side effect of ordinary page load or preview.

Worker routes own direct R2 and D1 proof. They are the only server-side path for approved non-Grok repairs.

The repair ledger has three layers:

- R2 append-only run evidence under a repair-run prefix such as `repair-runs/{runId}/`.
- D1 summary rows for fast UI history and source-fact updates.
- IndexedDB mirror for local owner-mode history.

The main flow is:

1. Scan: read-only inventory and proof collection.
2. Classify: create `RepairIssue` rows.
3. Plan: create a stable `RepairPlan` with exact targets and write impact.
4. Approve: bind operator approval to the plan hash.
5. Run: execute only approved idempotent actions.
6. Verify: read direct Worker, S3, D1, or local proof.
7. Record: append action results to the ledger.

R2 media restore must use conditional writes. If the canonical key already exists and proof differs, the result is a conflict or quarantine record, not an overwrite retry.

Cloudflare Workflows, Queues, Durable Objects, R2 event notifications, Data Catalog, bucket locks, and lifecycle rules are not first-pass requirements. The runner boundary should leave room for them later if cloud-only long-running repairs need stronger orchestration.

## Operator Workflow

The workbench should behave like a controlled repair console.

Top-level UI:

- Summary band: issue count, writable count, blocked count, last scan time, active backup status.
- Issue inventory: filters for risk tier, issue type, source proof, blocked state, and write class.
- Evidence drawer: direct proof for each issue.
- Plan builder: selected issues become a plan with exact target count and write impact.
- Approval panel: exact writes, target keys, safety gates, and plan hash.
- Run history: append-only scan, plan, approval, run, verify, and result timeline.

Action rules:

- `Scan` is always read-only.
- `Plan` is read-only and safely repeatable.
- `Approve` locks a specific plan hash.
- `Run` is disabled unless plan hash, target count, write classes, and safety checks still match.
- `Verify` uses direct proof, not cached public URLs.
- `Live Grok` repair emits a runbook for the existing logged-in Chrome session. It does not start a detached browser or run inside the web app.

There is no broad "repair everything" action. The nearest safe shortcut is "select eligible low-risk issues", and it still requires exact counts, write classes, and approval.

## Failure Behavior

The workbench fails closed for:

- Missing Worker auth.
- Missing or rejected R2 config.
- Missing D1 access.
- Active backup or conflicting long-running operation.
- Stale plan hash.
- Changed target count, object keys, write classes, or issue set.
- Failed source proof.
- Live Grok session not available or not logged in.

Conditional R2 write failure becomes a conflict result. It does not retry as an overwrite.

Partial runs keep completed action ledger entries. Failed or skipped actions remain visible and can be used to build a new plan.

## Testing And Acceptance

Automated tests should cover:

- Scanner classification from R2, D1, metadata, local, and live-Grok-required fixtures without writes.
- Planner stable hashes, exact target counts, risk tiers, write classes, and source proof summaries.
- Approval invalidation after target, object key, count, write class, or issue-list changes.
- Runner fail-closed behavior for unapproved plans, stale hashes, and live-Grok-only actions.
- R2 conditional restore behavior that never overwrites an existing canonical object.
- Conflict and quarantine result handling.
- Append-only ledger writes for scan, plan, approval, run, verify, skipped, conflicted, and failed events.
- UI coverage for issue filtering, evidence drawer, plan builder, approval gate, and run history.

Manual acceptance should prove:

- Read-only scan can run against the current Vault without changing R2, D1, processed IDs, or extension state.
- Dry-run plans show exact counts and target keys.
- Low-risk D1-only repair is proven first in a test fixture or duplicate bucket/index before production.
- T2 metadata repair and T4 media restore require explicit approval for exact targets.
- Live Grok repair remains runbook-only until the user approves use of the existing logged-in Chrome session.
- Final verification uses direct Worker, S3, D1, or hash proof.

Done means:

- Repair discovery and planning are usable without enabling unsafe writes.
- Fail-closed behavior is tested.
- At least one safe approved non-Grok repair path is exercised end to end in test mode.
- Production-impacting paths remain approval-gated with exact write impact.
- Documentation clearly separates built behavior, runbook-only behavior, and intentionally blocked behavior.

## Out Of Scope

- Resetting processed IDs.
- Running full backup, retry unsynced, backfill, or live Grok actions as part of ordinary scan.
- Deleting or manually editing production R2 objects.
- Generated replacement media.
- Detached Chrome profiles.
- Cloudflare bucket lifecycle rules that delete media.

## Open Questions

None block build planning. The first build plan should still choose the smallest safe vertical slice, likely T0 scan and T1 D1-only repair planning before any T2+ write path.
