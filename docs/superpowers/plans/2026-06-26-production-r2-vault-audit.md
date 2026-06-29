# Production R2 Vault Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run a read-only production audit that proves, blocks, or disproves production R2 media and metadata correctness with durable evidence.

**Architecture:** Treat the audit as an evidence pipeline. Capture raw production R2, D1, metadata, local filesystem, Worker, web, and live Grok evidence in that order, then reconcile them into explicit deltas and split verdicts. Product code should remain unchanged unless a tiny audit-only fix is explicitly approved later.

**Tech Stack:** Node.js 24 through `mise`, npm, Wrangler 4, Cloudflare R2 S3-compatible API or Cloudflare R2 read API, D1 remote read queries, Next.js Vault routes, Chrome existing Grok session, JSONL/JSON/CSV/Markdown audit artifacts.

## Post-Audit Status

The read-only audit evidence baseline is complete at commit `edaaf8134bb545969d6e8036952695a3d8102ca7`. Current baseline artifacts are in `docs/audits/2026-06-26-production-r2-vault-system-audit/`, especially `report-canonical.md`, `reconciliations/local-canonical-index-summary.json`, `reconciliations/canonical-gap-report.json`, and `manifest.json`.

The local-only canonical snapshot dry run is now complete and validated. Current dry-run artifacts are `reconciliations/canonical-snapshot-schema.json`, `reconciliations/canonical-snapshot-dry-run-summary.json`, `logs/canonical-snapshot-dry-run-validation.json`, `report-canonical-snapshot-dry-run.md`, and the ignored private payload `private/canonical-snapshot-dry-run.json`.

The first append-only R2 JSON canonical snapshot write is now complete and readback verified. Current write artifacts are `logs/canonical-snapshot-r2-write-readback.json` and `report-canonical-snapshot-r2-write.md`. The approved R2 object is `grok-powertools/v1/users/_system/canonical-snapshots/r2-vault-canonical-snapshot-v1/2026-06-29T004723Z-4100f2c3c2d3837a212125c39b6d926cefa31c7453af4a5df9d1d49d6b4f2ef1.json` in bucket `grok-gallery-001`; readback SHA-256 and stable content hash match the approved values.

Do not re-run this historical checklist as the next phase by default. The next execution slice is D1 canonical index projection from the approved R2 JSON snapshot. D1 writes, Worker writes, product read changes, Grok actions, repair/sync routes, object moves, deletes, and physical duplicate cleanup remain forbidden until separately approved.

Forward staged plan:

1. D1 canonical index projection derived from the approved R2 JSON snapshot.
2. Product views read the D1 projection while diagnostics retain access to R2 snapshot and raw R2 evidence.
3. Recurring reconciliation compares D1, the approved R2 snapshot, raw R2 inventory, and Grok evidence.
4. Review queue burn-down resolves or explicitly defers response gaps, `needs_human_review`, `orphan_candidate`, and hash-only duplicate groups.
5. Physical duplicate cleanup dry run creates an exact manifest from the approved canonical index and validated D1 projection.
6. Physical duplicate cleanup executes only after separate approval of the exact dry-run manifest, then the audit reruns to verify storage, index, and product state.

---

## Scope Check

The spec spans R2, D1, metadata, local files, web routes, Worker routes, extension status, and live Grok. Keep this as one plan because the value is in cross-source reconciliation. Splitting into subsystem plans would make it easier to miss source conflicts.

This plan does not repair production data. It produces evidence, deltas, split verdicts, and a later repair backlog.

## File Structure

- Create: `docs/audits/2026-06-26-production-r2-vault-system-audit/`
  - Owns all evidence from this audit run.
- Create: `docs/audits/2026-06-26-production-r2-vault-system-audit/manifest.json`
  - Machine-readable run status, commands, sources, blockers, and artifact index.
- Create: `docs/audits/2026-06-26-production-r2-vault-system-audit/report.md`
  - Human report with split verdicts and prioritized next actions.
- Create: `docs/audits/2026-06-26-production-r2-vault-system-audit/implementation-notes.html`
  - Execution notes for decisions, deviations, tradeoffs, blockers, and exact user decisions during the audit run.
- Create directory: `docs/audits/2026-06-26-production-r2-vault-system-audit/inventory/`
  - Raw R2, R2 hashes, D1, metadata, Worker, and local inventories.
- Create directory: `docs/audits/2026-06-26-production-r2-vault-system-audit/reconciliations/`
  - R2/D1, R2/metadata, R2/local, Worker/raw, duplicate, malformed-key, unresolved, and sample-set outputs.
- Create directory: `docs/audits/2026-06-26-production-r2-vault-system-audit/logs/`
  - Terminal output, command stderr, route responses, service startup logs, and browser notes.
- Create directory: `docs/audits/2026-06-26-production-r2-vault-system-audit/screenshots/`
  - Local app, Ops proof, Repair Workbench, and existing Grok tab screenshots.
- Create directory: `docs/audits/2026-06-26-production-r2-vault-system-audit/browser-samples/`
  - Redacted sample notes for live Grok and extension inspection.
- Create directory: `docs/audits/2026-06-26-production-r2-vault-system-audit/scripts/`
  - Audit-local helper scripts only. These are not product code.
- Create: `docs/audits/2026-06-26-production-r2-vault-system-audit/scripts/audit-production-r2-vault.mjs`
  - One audit runner with modes: `scaffold`, `preflight`, `r2`, `d1`, `metadata`, `local`, `worker`, `reconcile`, `report`, `validate-artifacts`.
- Modify only if absolutely needed: `docs/superpowers/specs/2026-06-26-production-r2-vault-audit-design.md`
  - Only for clarifying audit rules, not to relax safety gates.

## Environment Contract

Read-only production inventory must not start until these values are proven in logs with secrets redacted:

| Name | Required for | Expected value or handling |
| ---- | ------------ | -------------------------- |
| `CLOUDFLARE_ACCOUNT_ID` | Wrangler account and R2 endpoint proof | Must match `ba5339fd86e87c226bdc306347636042` from `cloud/wrangler.toml`, or stop and record blocker |
| `AUDIT_R2_BUCKET` | R2 object listing and hashing | Defaults to `grok-gallery-001` |
| `AUDIT_R2_PREFIX` | R2 object listing and classification | Defaults to `grok-powertools/v1` |
| `R2_ACCESS_KEY_ID` | S3-compatible R2 list/get/head | Required only if S3-compatible path is used, never written to artifacts |
| `R2_SECRET_ACCESS_KEY` | S3-compatible R2 list/get/head | Required only if S3-compatible path is used, never written to artifacts |
| `WORKER_URL` | Worker and Next route cross-check | Must point to deployed production Worker or an explicitly documented local Worker |
| `WORKER_API_KEY` or `CLIENT_API_KEY` | Worker and Next route cross-check | Required for Worker-authenticated GET and HEAD routes, never written to artifacts |

All Cloudflare and Wrangler commands should run through:

```bash
PATH="/opt/homebrew/bin:$PATH" npm_config_cache=/tmp/codex-wrangler-npx-cache mise exec node@24 -- npx --yes wrangler@latest ...
```

## Task 1: Scaffold The Audit Run

**Files:**
- Create: `docs/audits/2026-06-26-production-r2-vault-system-audit/manifest.json`
- Create: `docs/audits/2026-06-26-production-r2-vault-system-audit/report.md`
- Create: `docs/audits/2026-06-26-production-r2-vault-system-audit/implementation-notes.html`
- Create directories under `docs/audits/2026-06-26-production-r2-vault-system-audit/`
- Commit: audit scaffold only

- [ ] **Step 1: Check working tree before creating artifacts**

Run:

```bash
git status --short
git branch --show-current
git rev-parse HEAD
git diff --check
```

Expected: `git diff --check` exits 0. If unrelated dirty files exist, record them in `logs/preflight-git.txt` and do not revert them.

- [ ] **Step 2: Create audit directories**

Run:

```bash
mkdir -p docs/audits/2026-06-26-production-r2-vault-system-audit/{inventory,reconciliations,logs,screenshots,browser-samples,scripts}
touch docs/audits/2026-06-26-production-r2-vault-system-audit/{inventory,reconciliations,logs,screenshots,browser-samples,scripts}/.gitkeep
```

Expected: all directories exist.

- [ ] **Step 3: Create the initial manifest**

Use `apply_patch` to create `docs/audits/2026-06-26-production-r2-vault-system-audit/manifest.json`:

```json
{
  "auditName": "Production R2 Vault system audit",
  "auditDate": "2026-06-26",
  "status": "in_progress",
  "repo": {
    "path": "/Users/philipbankier/Development/skunkworks/Grok-Tinker/chrome-extension-powertools",
    "branch": "",
    "commit": "",
    "gitStatusShort": ""
  },
  "productionTarget": {
    "r2Bucket": "grok-gallery-001",
    "d1Database": "grok-powertools-db",
    "d1DatabaseId": "ad89e4bb-0b68-4c72-93d9-b90e6eb45aa6",
    "keyPrefix": "grok-powertools/v1",
    "workerName": "grok-r2-backup-worker"
  },
  "localRoots": {
    "vault": "/Users/philipbankier/Content/Grok IMagine/greymaker/GrokVault",
    "parent": "/Users/philipbankier/Content/Grok IMagine/greymaker"
  },
  "subsystems": {
    "preflight": "not_run",
    "rawR2": "not_run",
    "r2ByteHashes": "not_run",
    "d1": "not_run",
    "metadata": "not_run",
    "localFiles": "not_run",
    "workerRoutes": "not_run",
    "webRoutes": "not_run",
    "localSystem": "not_run",
    "liveGrok": "not_run",
    "reconciliation": "not_run"
  },
  "blockers": [],
  "evidenceIndex": [],
  "finalVerdicts": {
    "productionR2InternalCorrectness": "not_run",
    "currentGrokSavedCompleteness": "not_run",
    "localSystemHealth": "not_run"
  }
}
```

Run:

```bash
node -e "JSON.parse(require('fs').readFileSync('docs/audits/2026-06-26-production-r2-vault-system-audit/manifest.json','utf8')); console.log('manifest ok')"
```

Expected: `manifest ok`.

- [ ] **Step 4: Create report and execution notes skeletons**

Create `report.md` with sections for split verdicts, identity proof, counts, duplicate findings, missing media, missing metadata, malformed keys, local-only and R2-only findings, Worker/product route mismatches, live Grok samples, extension status, blockers, and prioritized next actions.

Create `implementation-notes.html` with sections:

```html
<h2>Design Decisions</h2>
<ul></ul>
<h2>Deviations</h2>
<ul></ul>
<h2>Tradeoffs</h2>
<ul></ul>
<h2>Open Questions</h2>
<ul></ul>
```

Expected: both files exist and contain the four notes sections.

- [ ] **Step 5: Commit scaffold**

Run:

```bash
git add docs/audits/2026-06-26-production-r2-vault-system-audit
git commit -m "docs: scaffold production r2 vault audit"
```

Expected: commit succeeds. If the user wants to keep planning and execution commits together, skip this commit and record that decision in `implementation-notes.html`.

## Task 2: Create The Audit Runner Contract

**Files:**
- Create: `docs/audits/2026-06-26-production-r2-vault-system-audit/scripts/audit-production-r2-vault.mjs`
- Modify: `docs/audits/2026-06-26-production-r2-vault-system-audit/implementation-notes.html`
- Commit: audit runner

- [ ] **Step 1: Create the runner with explicit modes**

Use `apply_patch` to create `scripts/audit-production-r2-vault.mjs`. The runner must:

- use Node built-ins for filesystem, crypto, streams, and child processes
- write only inside `docs/audits/2026-06-26-production-r2-vault-system-audit/`
- support modes `scaffold`, `preflight`, `r2`, `d1`, `metadata`, `local`, `worker`, `reconcile`, `report`, `validate-artifacts`
- refuse unsupported modes with exit code 2
- redact any value from keys containing `key`, `token`, `secret`, `cookie`, `authorization`, `signature`, `credential`, `password`, `uploadUrl`, `signedUrl`, or `promptText`
- never call `POST /v1/objects/verify`, `POST /v1/metadata/snapshot`, `POST /v1/presign`, `/api/vault/repair/approve`, `/api/vault/repair/run`, `/api/vault/gap-fill/run`, or `/api/vault/reconcile/index`
- write command logs to `logs/`
- write parseable artifacts to `inventory/` and `reconciliations/`

The mode contract is part of the implementation. If a mode cannot run because credentials or routes are missing, it must write a blocker artifact and exit non-zero.

- [ ] **Step 2: Add runner self-test**

Run:

```bash
mise exec node@24 -- node docs/audits/2026-06-26-production-r2-vault-system-audit/scripts/audit-production-r2-vault.mjs
echo $?
mise exec node@24 -- node docs/audits/2026-06-26-production-r2-vault-system-audit/scripts/audit-production-r2-vault.mjs unknown-mode
echo $?
```

Expected: first command prints available modes and exits 0. Second command exits 2 and writes no production evidence.

- [ ] **Step 3: Commit runner**

Run:

```bash
git add docs/audits/2026-06-26-production-r2-vault-system-audit/scripts/audit-production-r2-vault.mjs docs/audits/2026-06-26-production-r2-vault-system-audit/implementation-notes.html
git commit -m "chore: add production r2 audit runner"
```

Expected: commit succeeds, or skipped with a notes entry if the user wants one combined audit commit.

## Task 3: Preflight Authority And Safety Proof

**Files:**
- Modify: `docs/audits/2026-06-26-production-r2-vault-system-audit/logs/preflight-*.txt`
- Modify: `docs/audits/2026-06-26-production-r2-vault-system-audit/manifest.json`
- Modify: `docs/audits/2026-06-26-production-r2-vault-system-audit/implementation-notes.html`

- [ ] **Step 1: Capture repo and runtime evidence**

Run:

```bash
{
  git status --short
  git branch --show-current
  git rev-parse HEAD
  node --version
  npm --version
  PATH="/opt/homebrew/bin:$PATH" mise exec node@24 -- node --version
} > docs/audits/2026-06-26-production-r2-vault-system-audit/logs/preflight-runtime.txt 2>&1
```

Expected: log contains current branch, commit, ambient Node, npm, and Node 24.

- [ ] **Step 2: Capture Wrangler command surface**

Run:

```bash
PATH="/opt/homebrew/bin:$PATH" npm_config_cache=/tmp/codex-wrangler-npx-cache \
  mise exec node@24 -- npx --yes wrangler@latest --version \
  > docs/audits/2026-06-26-production-r2-vault-system-audit/logs/wrangler-version.txt 2>&1
PATH="/opt/homebrew/bin:$PATH" npm_config_cache=/tmp/codex-wrangler-npx-cache \
  mise exec node@24 -- npx --yes wrangler@latest r2 object --help \
  > docs/audits/2026-06-26-production-r2-vault-system-audit/logs/wrangler-r2-object-help.txt 2>&1
PATH="/opt/homebrew/bin:$PATH" npm_config_cache=/tmp/codex-wrangler-npx-cache \
  mise exec node@24 -- npx --yes wrangler@latest d1 execute --help \
  > docs/audits/2026-06-26-production-r2-vault-system-audit/logs/wrangler-d1-execute-help.txt 2>&1
```

Expected: R2 object help shows get, put, delete, and no object-list command. D1 execute help shows `--remote`, `--json`, and `--command`.

- [ ] **Step 3: Prove production config identity from files**

Run:

```bash
sed -n '1,120p' cloud/wrangler.toml > docs/audits/2026-06-26-production-r2-vault-system-audit/logs/production-wrangler-config.txt
```

Expected: log shows Worker `grok-r2-backup-worker`, bucket `grok-gallery-001`, D1 `grok-powertools-db`, D1 ID `ad89e4bb-0b68-4c72-93d9-b90e6eb45aa6`, and key prefix `grok-powertools/v1`.

- [ ] **Step 4: Verify route safety against source code**

Run:

```bash
rg -n "POST /v1/objects/verify|/v1/metadata/snapshot|/v1/presign|/v1/sync/push|repair/approve|repair/run|gap-fill/run|reconcile/index|HEAD /v1/objects/verify|/api/vault/repair/proof" \
  cloud/src web/src/app/api/vault \
  > docs/audits/2026-06-26-production-r2-vault-system-audit/logs/route-safety-source.txt
```

Expected: log proves the write route denylist and the allowed read-only proof route.

- [ ] **Step 5: Run audit preflight mode**

Run:

```bash
mise exec node@24 -- node docs/audits/2026-06-26-production-r2-vault-system-audit/scripts/audit-production-r2-vault.mjs preflight
```

Expected: `manifest.json` moves `preflight` to `verified` or `blocked`. If blocked, do not run raw R2, local app, or live Grok phases.

## Task 4: Raw R2 Inventory And Byte Hashing

**Files:**
- Create: `inventory/r2-objects.jsonl`
- Create: `inventory/r2-pages.json`
- Create: `inventory/r2-objects-summary.json`
- Create: `inventory/r2-media-hashes.jsonl`
- Modify: `manifest.json`
- Modify: `implementation-notes.html`

- [ ] **Step 1: Install cloud dependencies if missing**

Run:

```bash
test -d cloud/node_modules || mise exec node@24 -- npm install --prefix cloud
```

Expected: `cloud/node_modules` exists. Do not change package versions during the audit.

- [ ] **Step 2: Verify read-only R2 credentials are present without printing them**

Run:

```bash
node -e "for (const k of ['CLOUDFLARE_ACCOUNT_ID','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY']) { if (!process.env[k]) { console.error(k + ' missing'); process.exitCode = 1; } }"
```

Expected: exit 0. If not, record missing names in `manifest.json` blockers and stop before live Grok.

- [ ] **Step 3: Run raw R2 inventory and hash pass**

Run:

```bash
AUDIT_R2_BUCKET="${AUDIT_R2_BUCKET:-grok-gallery-001}" \
AUDIT_R2_PREFIX="${AUDIT_R2_PREFIX:-grok-powertools/v1}" \
mise exec node@24 -- node docs/audits/2026-06-26-production-r2-vault-system-audit/scripts/audit-production-r2-vault.mjs r2
```

Expected:

- `inventory/r2-objects.jsonl` has one JSON object per raw R2 object
- `inventory/r2-pages.json` contains page size, page count, continuation token chain, final truncation state, timestamp, and method
- `inventory/r2-media-hashes.jsonl` has one row per media object hash attempt
- `inventory/r2-objects-summary.json` has raw object count, media count, metadata count, total bytes, and unhashable count

Stop if the runner reports unexpected object count, unexpected byte count, rate limit, unsafe local disk behavior, or credentials broader than read-only.

- [ ] **Step 4: Validate raw R2 artifacts**

Run:

```bash
node -e "const fs=require('fs'); for (const f of ['r2-objects.jsonl','r2-media-hashes.jsonl']) { const p='docs/audits/2026-06-26-production-r2-vault-system-audit/inventory/'+f; const rows=fs.readFileSync(p,'utf8').trim().split('\\n').filter(Boolean); rows.forEach((line,i)=>{ try { JSON.parse(line); } catch(e) { throw new Error(f+':'+(i+1)+' '+e.message); } }); console.log(f, rows.length); }"
node -e "JSON.parse(require('fs').readFileSync('docs/audits/2026-06-26-production-r2-vault-system-audit/inventory/r2-pages.json','utf8')); JSON.parse(require('fs').readFileSync('docs/audits/2026-06-26-production-r2-vault-system-audit/inventory/r2-objects-summary.json','utf8')); console.log('r2 json ok')"
```

Expected: line counts print and `r2 json ok` prints.

- [ ] **Step 5: Commit R2 evidence if secret scan is clean**

Run:

```bash
rg -n "AKIA|ASIA|secret|token|authorization|cookie|X-Amz-Signature|X-Amz-Credential|uploadUrl|signedUrl|promptText" docs/audits/2026-06-26-production-r2-vault-system-audit || true
git add docs/audits/2026-06-26-production-r2-vault-system-audit
git commit -m "docs: capture production r2 audit inventory"
```

Expected: secret scan finds no real secrets. If it finds a real secret, stop and remove the artifact before committing.

## Task 5: Raw D1 And Metadata Inventory

**Files:**
- Create: `inventory/d1-schema.json`
- Create: `inventory/d1-r2-dedupe-index.jsonl`
- Create: `inventory/d1-metadata-snapshot-index.jsonl`
- Create: `inventory/d1-vault-overlays.jsonl`
- Create: `inventory/metadata-objects.json`
- Create: `inventory/metadata-references.json`
- Modify: `manifest.json`

- [ ] **Step 1: Verify remote D1 read command works**

Run:

```bash
PATH="/opt/homebrew/bin:$PATH" npm_config_cache=/tmp/codex-wrangler-npx-cache \
  mise exec node@24 -- npx --yes wrangler@latest d1 execute grok-powertools-db --remote --json \
  --command "SELECT name, type FROM sqlite_master WHERE type IN ('table','index') ORDER BY type, name" \
  > docs/audits/2026-06-26-production-r2-vault-system-audit/logs/d1-schema-smoke.json 2> docs/audits/2026-06-26-production-r2-vault-system-audit/logs/d1-schema-smoke.err
```

Expected: exit 0 and JSON output. If blocked, record command, exit code, database name, account ID, and stderr in `manifest.json`, then continue only with D1 marked blocked.

- [ ] **Step 2: Run D1 inventory mode**

Run:

```bash
mise exec node@24 -- node docs/audits/2026-06-26-production-r2-vault-system-audit/scripts/audit-production-r2-vault.mjs d1
```

Expected: D1 schema, `r2_dedupe_index`, `metadata_snapshot_index`, and `vault_overlays` are exported as parseable files. The runner also records any sync/source tables that reference Vault media or metadata by schema inspection.

- [ ] **Step 3: Run metadata inventory mode**

Run:

```bash
mise exec node@24 -- node docs/audits/2026-06-26-production-r2-vault-system-audit/scripts/audit-production-r2-vault.mjs metadata
```

Expected:

- `metadata-objects.json` lists all raw R2 keys under `grok-powertools/v1/users/*/metadata/*`, versioned backfill manifests, upload-test/system metadata, and prompt sidecars discovered under media paths
- `metadata-references.json` lists referenced asset IDs, object keys, prompt IDs, schema versions, record counts, parse status, hash status, and redaction status
- raw prompt text is absent from durable files

- [ ] **Step 4: Validate D1 and metadata artifacts**

Run:

```bash
node -e "const fs=require('fs'); for (const f of ['d1-schema.json','metadata-objects.json','metadata-references.json']) { JSON.parse(fs.readFileSync('docs/audits/2026-06-26-production-r2-vault-system-audit/inventory/'+f,'utf8')); console.log(f, 'ok'); }"
node -e "const fs=require('fs'); for (const f of ['d1-r2-dedupe-index.jsonl','d1-metadata-snapshot-index.jsonl','d1-vault-overlays.jsonl']) { const p='docs/audits/2026-06-26-production-r2-vault-system-audit/inventory/'+f; if (!fs.existsSync(p)) continue; const lines=fs.readFileSync(p,'utf8').trim().split('\\n').filter(Boolean); lines.forEach(JSON.parse); console.log(f, lines.length); }"
```

Expected: all JSON parses.

## Task 6: Local Filesystem Inventory

**Files:**
- Create: `inventory/local-vault-files.csv`
- Create: `inventory/local-parent-media-files.csv`
- Create: `inventory/local-media-summary.json`
- Modify: `manifest.json`

- [ ] **Step 1: Verify local roots exist**

Run:

```bash
test -d "/Users/philipbankier/Content/Grok IMagine/greymaker/GrokVault"
test -d "/Users/philipbankier/Content/Grok IMagine/greymaker"
```

Expected: both commands exit 0. If either path is missing, record blocker and do not infer local completeness.

- [ ] **Step 2: Run local inventory mode**

Run:

```bash
mise exec node@24 -- node docs/audits/2026-06-26-production-r2-vault-system-audit/scripts/audit-production-r2-vault.mjs local
```

Expected:

- `local-vault-files.csv` contains every file under `GrokVault` with size, extension, media type, SHA-256, ctime, mtime, filename UUIDs, and likely Grok IDs
- `local-parent-media-files.csv` contains parent media candidates outside `GrokVault`
- parent scan excludes `.git`, `node_modules`, `.next`, `dist`, `build`, `.wrangler`, cache folders, package-manager stores, and unrelated source trees unless pulled back by an R2 object key, UUID, sidecar, or metadata reference
- `local-media-summary.json` includes counts, bytes, zero-byte list, duplicate filename groups, duplicate hash groups, and suspicious media signatures

- [ ] **Step 3: Validate local inventory artifacts**

Run:

```bash
node -e "const fs=require('fs'); JSON.parse(fs.readFileSync('docs/audits/2026-06-26-production-r2-vault-system-audit/inventory/local-media-summary.json','utf8')); for (const f of ['local-vault-files.csv','local-parent-media-files.csv']) { const p='docs/audits/2026-06-26-production-r2-vault-system-audit/inventory/'+f; console.log(f, fs.readFileSync(p,'utf8').split('\\n').filter(Boolean).length); }"
```

Expected: summary parses and both CSV line counts print.

## Task 7: Worker And Web Route Cross-Check

**Files:**
- Create: `inventory/worker-vault-assets.jsonl`
- Create: `inventory/worker-vault-pages.json`
- Create: `reconciliations/worker-raw-delta.json`
- Create logs under `logs/worker-*` and `logs/web-*`
- Modify: `manifest.json`

- [ ] **Step 1: Verify Worker env without printing secrets**

Run:

```bash
node -e "for (const k of ['WORKER_URL']) { if (!process.env[k]) { console.error(k + ' missing'); process.exitCode = 1; } } if (!process.env.WORKER_API_KEY && !process.env.CLIENT_API_KEY) { console.error('WORKER_API_KEY or CLIENT_API_KEY missing'); process.exitCode = 1; }"
```

Expected: exit 0. If missing, record exact missing names and skip Worker/web route cross-check.

- [ ] **Step 2: Run Worker cross-check mode**

Run:

```bash
mise exec node@24 -- node docs/audits/2026-06-26-production-r2-vault-system-audit/scripts/audit-production-r2-vault.mjs worker
```

Expected:

- Worker identity matches bucket, prefix, binding state, and redacted API-key fingerprint
- Worker inventory pages to exhaustion and records page count
- Worker route source is classified as D1 rows or R2 fallback
- Worker media proof uses `HEAD /v1/objects/verify` and `GET /v1/vault/media` only
- at least one media object beyond the first page is proven accessible if raw inventory has more than one page

- [ ] **Step 3: Start web app only after raw inventories are captured**

Run:

```bash
WORKER_URL="$WORKER_URL" WORKER_API_KEY="${WORKER_API_KEY:-$CLIENT_API_KEY}" npm --prefix web run dev
```

Expected: Next dev server starts on port `3001`. If port `3001` is owned by another workspace, use a free alternate port and record the port in `logs/web-server.txt`.

- [ ] **Step 4: Probe allowed Next routes**

Run from another shell:

```bash
WEB_URL="${WEB_URL:-http://127.0.0.1:3001}"
curl -sS "$WEB_URL/api/vault/identity" > docs/audits/2026-06-26-production-r2-vault-system-audit/logs/web-vault-identity.json
curl -sS "$WEB_URL/api/vault/inventory" > docs/audits/2026-06-26-production-r2-vault-system-audit/logs/web-vault-inventory.json
curl -sS "$WEB_URL/api/vault/preview" > docs/audits/2026-06-26-production-r2-vault-system-audit/logs/web-vault-preview.json
curl -sS -X POST "$WEB_URL/api/vault/repair/scan" > docs/audits/2026-06-26-production-r2-vault-system-audit/logs/web-repair-scan.json
```

Expected: all responses are JSON. Do not call approve, run, gap-fill run, or reconcile index routes.

## Task 8: Reconciliation And Sample Set

**Files:**
- Create: `reconciliations/r2-d1-delta.json`
- Create: `reconciliations/r2-metadata-delta.json`
- Create: `reconciliations/r2-local-delta.json`
- Create: `reconciliations/worker-raw-delta.json`
- Create: `reconciliations/duplicate-groups.json`
- Create: `reconciliations/malformed-keys.json`
- Create: `reconciliations/unresolved-items.json`
- Create: `reconciliations/sample-set.json`
- Modify: `manifest.json`

- [ ] **Step 1: Run reconciliation mode**

Run:

```bash
mise exec node@24 -- node docs/audits/2026-06-26-production-r2-vault-system-audit/scripts/audit-production-r2-vault.mjs reconcile
```

Expected:

- every unmatched R2, D1, metadata, local, or Worker record appears in a delta or unresolved file
- duplicate groups classify canonical plus legacy pointer, conflict object, accidental duplicate blob, same hash, same asset ID with different hashes, same source URL hash, and metadata snapshot churn
- malformed keys and out-of-prefix objects are listed separately
- sample set includes newest R2 media, oldest R2 media, first-page media, beyond-first-page media, image sample, video sample, duplicate candidate, missing metadata candidate, local-only candidate, and R2-only candidate when those classes exist

- [ ] **Step 2: Validate reconciliation artifacts**

Run:

```bash
node -e "const fs=require('fs'); for (const f of ['r2-d1-delta.json','r2-metadata-delta.json','r2-local-delta.json','worker-raw-delta.json','duplicate-groups.json','malformed-keys.json','unresolved-items.json','sample-set.json']) { JSON.parse(fs.readFileSync('docs/audits/2026-06-26-production-r2-vault-system-audit/reconciliations/'+f,'utf8')); console.log(f, 'ok'); }"
```

Expected: every reconciliation file parses.

## Task 9: Local System Checks

**Files:**
- Create logs under `logs/`
- Create screenshots under `screenshots/`
- Modify: `manifest.json`

- [ ] **Step 1: Run root checks**

Run:

```bash
mise exec node@24 -- npm run test:unit > docs/audits/2026-06-26-production-r2-vault-system-audit/logs/root-test-unit.txt 2>&1
mise exec node@24 -- npm run test:e2e > docs/audits/2026-06-26-production-r2-vault-system-audit/logs/root-test-e2e.txt 2>&1
mise exec node@24 -- npm run lint > docs/audits/2026-06-26-production-r2-vault-system-audit/logs/root-lint.txt 2>&1
```

Expected: each command either passes or writes exact failures. Do not claim local system health is clean unless all required checks pass.

- [ ] **Step 2: Run web checks**

Run:

```bash
mise exec node@24 -- npm --prefix web run build > docs/audits/2026-06-26-production-r2-vault-system-audit/logs/web-build.txt 2>&1
mise exec node@24 -- npm --prefix web run lint > docs/audits/2026-06-26-production-r2-vault-system-audit/logs/web-lint.txt 2>&1
```

Expected: each command either passes or writes exact failures.

- [ ] **Step 3: Run cloud checks**

Run:

```bash
mise exec node@24 -- npm --prefix cloud run typecheck > docs/audits/2026-06-26-production-r2-vault-system-audit/logs/cloud-typecheck.txt 2>&1
mise exec node@24 -- npm --prefix cloud run test:acceptance > docs/audits/2026-06-26-production-r2-vault-system-audit/logs/cloud-test-acceptance.txt 2>&1
```

Expected: each command either passes or writes exact failures. Cloud acceptance tests are local or fail-closed only, not production write tests.

- [ ] **Step 4: Browser-test local web Vault surfaces**

Use Playwright or the available browser automation tool to capture:

- Vault page loaded with committed local IndexedDB state if Worker env is available
- Ops proof screen
- media image display through proxy
- media video playback through proxy
- Repair Workbench scan and plan creation, no approve or run

Expected: screenshots are saved under `screenshots/` and route logs under `logs/`.

## Task 10: Existing Chrome Grok And Extension Inspection

**Files:**
- Create: `browser-samples/live-grok-samples.md`
- Create screenshots under `screenshots/`
- Modify: `manifest.json`

- [ ] **Step 1: Verify raw inventories are complete before browser work**

Run:

```bash
mise exec node@24 -- node docs/audits/2026-06-26-production-r2-vault-system-audit/scripts/audit-production-r2-vault.mjs validate-artifacts
```

Expected: raw R2, R2 hashes, D1 or D1 blocker, metadata, local, Worker, and reconciliation artifacts are present. If not, stop and ask whether to continue with blockers.

- [ ] **Step 2: Target only the visible existing Grok tab**

Use the repo tool-routing rules:

- prefer `agent-browser` or `plwr` only if installed and attached to the intended browser context
- otherwise use the existing Chrome session with the narrowest available control method
- use Peekaboo only for native macOS state, and capture fresh state before interactions
- do not run whole-profile tab discovery, full Chrome snapshots, or AppleScript loops over every tab

Expected: `browser-samples/live-grok-samples.md` records the exact automation method and why it is known to target the visible Grok tab.

- [ ] **Step 3: Inspect without clicking write controls**

Inspect:

- current Grok route and visible Saved/Vault state
- extension overlay injection
- extension popup/cloud status if reachable
- backup mode
- worker host
- key prefix
- unsynced count
- last test status
- last error
- sample set items from `reconciliations/sample-set.json`

Expected: evidence is recorded with API keys redacted. No backup, sync, repair, generation, or full scrape action is clicked.

## Task 11: Final Report, Secret Scan, And Handoff

**Files:**
- Modify: `report.md`
- Modify: `manifest.json`
- Modify: `implementation-notes.html`
- Modify: `docs/superpowers/plans/2026-06-26-production-r2-vault-audit-implementation-planning-notes.html` only if planning assumptions changed during execution planning

- [ ] **Step 1: Generate final report from artifacts**

Run:

```bash
mise exec node@24 -- node docs/audits/2026-06-26-production-r2-vault-system-audit/scripts/audit-production-r2-vault.mjs report
```

Expected: `report.md` includes split verdicts for production R2 internal correctness, current Grok Saved completeness, and local system health.

- [ ] **Step 2: Enforce final verdict gates**

Run:

```bash
mise exec node@24 -- node docs/audits/2026-06-26-production-r2-vault-system-audit/scripts/audit-production-r2-vault.mjs validate-artifacts
```

Expected: validation passes, or the report verdict is `blocked` or `inconclusive` with exact blocker text. Do not call R2 internally clean unless raw R2 listing, byte hashes, D1 or proven-irrelevant D1 state, metadata, local inventory, duplicate classification, beyond-first-page media access, and conflict explanation are all complete.

- [ ] **Step 3: Run secret scan before staging**

Run:

```bash
rg -n "AKIA|ASIA|BEGIN PRIVATE KEY|authorization|cookie|token|secret|password|X-Amz-Signature|X-Amz-Credential|uploadUrl|signedUrl|promptText" docs/audits/2026-06-26-production-r2-vault-system-audit docs/superpowers/plans/2026-06-26-production-r2-vault-audit.md docs/superpowers/plans/2026-06-26-production-r2-vault-audit-implementation-planning-notes.html || true
```

Expected: no real secrets. If any secret is found, remove it from artifacts and recommend credential rotation when appropriate.

- [ ] **Step 4: Commit final audit artifacts**

Run:

```bash
git add docs/audits/2026-06-26-production-r2-vault-system-audit docs/superpowers/plans/2026-06-26-production-r2-vault-audit.md docs/superpowers/plans/2026-06-26-production-r2-vault-audit-implementation-planning-notes.html docs/superpowers/specs/2026-06-26-production-r2-vault-audit-design.md
git commit -m "docs: complete production r2 vault audit"
```

Expected: commit succeeds. If the user asked not to commit, leave files unstaged and report exact paths.

## Self-Review Result

Spec coverage:

- Preflight and authority proof: Tasks 1, 2, and 3.
- Raw R2 inventory and byte hashing: Task 4.
- Raw D1/index inventory: Task 5.
- Metadata and sidecar inventory: Task 5.
- Worker and product route cross-check: Task 7.
- Local filesystem inventory: Task 6.
- Reconciliation: Task 8.
- Local system run: Task 9.
- Live Grok and extension inspection: Task 10.
- Evidence folder and report requirements: Tasks 1 and 11.
- Validation gates and stop criteria: Tasks 3, 4, 10, and 11.

Placeholder scan:

- The plan uses concrete file paths, commands, expected outputs, and stop conditions.
- No task requires production writes.
- No task relies on old audit counts as current proof.

Type and name consistency:

- Artifact names match the hardened spec.
- Route allowlist and denylist match the current Worker and Next route code.
- Verdict names match the split verdict requirement.
