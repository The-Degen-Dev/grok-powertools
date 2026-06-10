# Live Acceptance E2E Design

Status: design spec for user review.

Date: 2026-06-09

Repo: `/Users/philipbankier/Development/skunkworks/Grok-Tinker/chrome-extension-powertools`

Do not move to the implementation plan until this file is reviewed and approved.

## Goal

Create a safe, repeatable live acceptance process that proves Grok Power Tools works from a real user perspective across the extension, Grok saved gallery, cloud backend, local vault/download behavior, and web app.

Acceptance evidence must come from real systems:

- Real Grok pages and media.
- Real Chrome extension behavior.
- Real Cloudflare Worker, R2, and D1 resources.
- Real local web app behavior.
- Real browser or desktop automation where needed.

Unit tests, mocked Playwright tests, typechecks, and linting are preflight and regression evidence only. They are not enough for a final acceptance verdict.

## Non-Goals

- Do not run a full production backup as the first live test.
- Do not mutate production R2 or D1 from acceptance tests.
- Do not rely on Grok state changes outside audit-owned canary actions.
- Do not use copied secrets, cookies, signed URLs, or bearer tokens in committed files or evidence.
- Do not claim atomic rollback across Chrome storage, MV3 service workers, alarms, downloads, Grok remote state, R2, or D1.

## Safety Architecture

The acceptance setup needs isolation beyond a duplicate R2 bucket. The safe target is an acceptance-only cloud stack:

- Dedicated acceptance Worker.
- Dedicated acceptance R2 bucket.
- Dedicated acceptance D1 database.
- Dedicated acceptance API key or secret.
- Hard non-production key prefix.
- Per-run prefix under that hard acceptance prefix.
- Worker identity endpoint that proves which Worker, bucket, D1 binding, mode, version, key prefix, and run ID are active.

The existing logged-in Chrome profile is allowed only as the final user-perspective lane, after safer lanes pass. Earlier lanes must use an isolated browser profile or a controlled extension harness.

All write-capable live lanes must be explicitly armed. A lane is blocked before mutation if the harness cannot prove the target Worker, bucket, D1 database, extension ID/version/hash, prefix, and run ID.

## Cloud Isolation

Recommended resource shape:

- Worker: acceptance-only deployment, separate from production Worker.
- R2 bucket: acceptance-only bucket, never `grok-gallery-001`.
- D1 database: acceptance-only database, never `grok-powertools-db`.
- Prefix: `acceptance/$ACCEPTANCE_RUN_ID/...` or stricter, with the Worker refusing any write outside the configured acceptance prefix.
- API key: acceptance-only secret, separate from the current production-like key.

The Worker must reject:

- Missing `run_id`.
- Unknown or unarmed `run_id`.
- Missing correlation ID.
- Production prefixes.
- Default prefix fallback.
- Prefix normalization that escapes the acceptance prefix.
- Requests when the run is quarantined or killed.

The Worker identity endpoint must return only non-secret diagnostics. It must not expose API keys, signed URLs, cookies, bearer tokens, or raw prompts.

## Components

1. Strict acceptance manifest

The harness starts from a typed manifest, not an informal checklist. The manifest records:

- `run_id`
- `lane_id`
- `canary_id`
- expected Grok post or media IDs when known
- extension ID
- extension version
- extension source path
- extension source hash
- Worker identity URL
- Worker version
- R2 bucket name
- D1 database name and ID
- hard acceptance key prefix
- API key fingerprint only
- Chrome profile mode
- download root
- restore plan
- expected verdict states

2. Isolated acceptance cloud

The acceptance Worker writes only to the acceptance R2 bucket and D1 database. R2 object keys must match the product's current canonical `media/by-asset` and conflict-key model so the test proves the real storage contract.

3. Browser harness

The browser harness drives the extension in this order:

- MV3 isolated profile lane.
- Acceptance cloud lane.
- Existing logged-in Chrome lane only after earlier lanes pass.

The harness captures:

- extension storage
- queue state
- alarms
- active tab
- processed IDs
- cloud config
- service-worker logs
- download root
- local vault inventory
- loaded extension version and hash

Service-worker reload is treated as a mutation risk, not a harmless reset.

4. Correlation and evidence collector

Every live canary uses a correlation ID that should flow through:

- acceptance manifest
- extension logs
- background/service-worker queue item
- Worker request
- R2 object metadata
- D1 row
- local file name or adjacent metadata when practical
- evidence workbook

The evidence collector records:

- R2 object key
- object size
- content type
- SHA-256 hash
- ETag
- uploaded timestamp
- asset ID
- source URL hash
- D1 table and primary key
- D1 row delta
- metadata snapshot fields
- restore evidence
- no-production-touch evidence

Evidence must be redacted before it is written to disk.

5. Evidence workbook and ops review surface

The acceptance output is a single redacted JSON or HTML workbook. The web app ops page may import or display the workbook.

The ops page is not core verification unless the implementation adds object and D1 verification APIs. The source of truth for acceptance is the harness plus direct Worker/R2/D1 verification.

6. Test lanes

The final design uses ordered lanes:

- Local gates.
- MV3 isolated browser lane.
- Acceptance cloud lane.
- Existing logged-in Chrome lane.
- Local web app lane against acceptance data.

## Data Flow

```text
manifest
  -> browser harness
  -> Grok canary action
  -> content script
  -> background service worker
  -> acceptance Worker
  -> R2 and D1
  -> direct object and D1 verification
  -> evidence workbook
  -> ops display
  -> restore and diff
  -> typed verdict
```

## Error Handling

The acceptance process is a transaction-like harness with honest limits. It does not promise true rollback.

Each write-capable lane creates:

- an arming record
- a write lease
- an append-only event ledger
- a preflight state fingerprint
- post-action evidence
- recovery steps
- a post-recovery state fingerprint
- a sentinel check

The Worker exposes a kill switch or quarantine mode for a run. Once a run is quarantined, further writes for that run are rejected.

## Fail-Fast Rules

The run must stop before mutation when:

- The loaded extension ID, version, source path, or hash does not match the manifest.
- The Worker identity endpoint does not echo the expected run ID, key prefix, Worker version, R2 bucket, D1 binding, and acceptance mode.
- The run prefix is not empty before start, unless the run is explicitly marked as a resume.
- Chrome DevTools connection is required but not connected to the existing Chrome session.
- Browser automation cannot prove which tab or profile it is controlling.
- Required cloud resources cannot be listed or verified.
- Any acceptance secret check would require printing raw secret values.

The run must stop after mutation and mark the verdict as contaminated when:

- A queue item lacks `runId`, `correlationId`, expected prefix, or media attempt ordinal.
- `cloudConfig.apiKey`, signed URLs, cookies, bearer tokens, or raw prompts appear in evidence.
- Prefix fallback normalization occurs.
- A production bucket, database, Worker, or prefix is touched.
- An offscreen document, pending download, pending upload, queue entry, or alarm survives lane end outside the allowlist.
- A Grok media download event lacks an active correlation ID.
- A canary produces zero attempts or more than one attempt when exactly one is expected.
- The live lane touches non-audit-owned Grok content.
- A safety check needs manual interpretation instead of a deterministic pass/fail assertion.

## Verdicts

`verified`: all assertions pass, safety checks are clean, artifacts are run-scoped, redacted evidence is complete, and the sentinel check is clean.

`failed`: the controlled acceptance environment worked, but a product assertion failed.

`blocked`: preflight failed before mutation.

`contaminated`: a safety violation happened during execution or recovery, an artifact escaped scope, a secret leaked, queue or alarm state remained, or the restore diff exceeded the allowlist.

`inconclusive`: evidence collection failed before mutation. After mutation, use `failed` or `contaminated`, not `inconclusive`.

## Coverage

The acceptance suite covers these user-facing surfaces:

- Chrome extension overlay on Grok.
- Extension popup.
- Grok saved-gallery backup flow.
- Cloud Worker, R2, and D1 sync path.
- Local Vault and download behavior.
- Web app collections, prompt library, clip editing, movie maker, sharing, auth, sync, and ops import/display views where available locally.

The final existing-Chrome lane must include:

- One public image canary.
- One authenticated video canary.

This is needed because public image media and authenticated video media use different retrieval paths.

## UX Criteria

The acceptance verdict must include user-perspective notes, not only machine assertions.

The UX passes only when:

- The user can tell within a few seconds whether the extension is idle, working, blocked, failed, or done.
- Safe canaries and dangerous full backup actions are visually and operationally distinct.
- Failures explain what happened and what safe next step is available.
- The test does not leave the extension busy, broken, armed, or pointed at the wrong cloud config.
- The run does not unexpectedly navigate away from unrelated tabs.
- The run does not create hidden uploads or unclear success messages.
- Popup and web app status agree with the underlying queue and cloud state.

## Tool And Path Readiness

Verified local repo state on 2026-06-09:

- Repo path exists: `/Users/philipbankier/Development/skunkworks/Grok-Tinker/chrome-extension-powertools`
- Branch before spec work: `main`
- `main` matched `origin/main` at the start of the spec work.
- Pre-existing untracked files were present under `docs/superpowers/plans/` and are unrelated to this spec.
- Root, `web`, and `cloud` package and lock files exist.

Root scripts:

- `npm run test:unit`
- `npm run test:e2e`
- `npm run lint`

Web scripts:

- `npm run build`
- `npm run lint`
- `npm run dev -- --port <free_port>` if needed

Cloud scripts:

- `npm run typecheck`
- `npx wrangler dev`
- `npx wrangler deploy`

Runtime findings:

- Ambient Node is `v20.18.1`.
- `mise exec node@24 -- node --version` returns `v24.16.0`.
- Acceptance scripts should pin Node 24 through `mise exec node@24 -- ...` unless the repo standard changes.
- Root Playwright is `1.57.0`.
- Root Jest is `30.1.3`.
- Root ESLint is `9.39.2`.
- `web` uses Next.js `16.1.6` and ESLint `9.39.3`.
- `cloud` uses Wrangler `4.67.0` locally and TypeScript `5.9.3`.
- Wrangler reported a newer version is available, so Cloudflare package currency must be decided before acceptance cloud setup.

Browser and desktop tools:

- `agent-browser` is not installed.
- `plwr` is not installed.
- Peekaboo is installed at `/opt/homebrew/bin/peekaboo`.
- Peekaboo permissions are granted for Screen Recording, Accessibility, and Event Synthesizing.
- `osascript` and `open` are available.
- Chrome is running.
- One existing Chrome tab was found on `https://grok.com/imagine/saved`.
- Three existing Chrome tabs were found on Grok imagine-related pages.
- Chrome DevTools MCP can see Chrome but is not connected. Any CDP lane must first connect to the existing Chrome window/session and must not start a detached debugging browser.

Grok and model tools:

- Native `grok` CLI is installed.
- Native catalog includes `grok-build`.
- Running `CLIProxyAPI` catalog includes `grok-build`, `grok-4.3`, and `gpt-5.5`.

GitHub:

- `gh` is authenticated as `The-Degen-Dev`.
- The inactive `philipbankier` account is also present.

Cloudflare:

- `wrangler whoami` works but cannot retrieve the account email because the token lacks User Details read permission.
- With `CLOUDFLARE_ACCOUNT_ID=ba5339fd86e87c226bdc306347636042`, `wrangler d1 list --json` works.
- The current checked-in D1 database is `grok-powertools-db` with ID `ad89e4bb-0b68-4c72-93d9-b90e6eb45aa6`.
- `wrangler r2 bucket list` currently fails with Cloudflare authentication error code `10000`, even when the account ID is provided.
- Acceptance R2 setup is blocked until R2 list/create/verify works through CLI or a documented API path.

Current production-shaped config:

- `cloud/wrangler.toml` uses `KEY_PREFIX = "grok-powertools/v1"`.
- `cloud/wrangler.toml` references R2 bucket `grok-gallery-001`.
- `cloud/wrangler.toml` references D1 database `grok-powertools-db`.

The acceptance implementation must not use those production-shaped resources for live tests.

Local web app:

- Port `3001` was already occupied by a Next server from another workspace.
- `http://127.0.0.1:3001/` returned `200`, but it was not this repo's app.
- `/ops` and `/api/ops/health` returned `404` on that server.
- Acceptance must prove the web server is launched from this repo, or use a different free port.

Secrets:

- `web/.env.local` exists and is ignored.
- `cloud/.dev.vars` exists and is ignored.
- Env checks must be filename-only or redacted. Raw env values must not be printed into logs, evidence, commits, or chat.

Extension identity:

- `manifest.json` declares MV3 extension name `Grok Media Downloader` and version `0.2.0`.
- The installed Chrome extension ID and loaded source hash were not fully verified in the latest read-only pass.
- Existing-Chrome acceptance is blocked until the installed extension ID, version, and source hash match the manifest.

## Required Preflight Gates

Before any write-capable acceptance test runs:

- Confirm the working tree state and branch.
- Confirm local commands run under the selected Node version.
- Confirm no unrelated web server is being tested by mistake.
- Confirm the extension ID, version, source path, and hash.
- Confirm Worker identity and acceptance resource bindings.
- Confirm R2 list/create/verify works for the acceptance bucket.
- Confirm D1 list/query/verify works for the acceptance database.
- Confirm Chrome automation is using the intended profile and tab.
- Confirm the run prefix is empty.
- Confirm evidence redaction is active.
- Confirm the restore plan and sentinel checks are configured.

## Open Questions

1. Should the acceptance Worker be deployed as a separate Cloudflare Worker name, or as an environment under the current Worker with hard guardrails?
2. Should acceptance use a new dedicated API key in `cloud/.env` or reuse the existing local secret format with a distinct value?
3. Should the web app acceptance lane use a fixed alternate port, or dynamically choose a free port and record it in the manifest?
4. Do we want acceptance artifacts retained for audit history, or deleted after the evidence workbook is written?
5. Should the final existing-Chrome lane be manual-arm only every time, or can it be scheduled after the isolated lanes pass?

## Approval Gate

If this design is approved, the next step is a TDD-driven implementation plan. That plan should start with failing tests and verification harness checks for:

- strict manifest validation
- Worker identity refusal rules
- acceptance prefix enforcement
- redaction
- verdict state machine
- state fingerprint diffing
- local web server identity checks
- cloud resource verification
- one-image and one-video canary acceptance paths
