# Full System Reliability and Functionality Audit Design

## Context

This project is a Grok Imagine power-tooling system with three active surfaces:

- A Chrome MV3 extension that overlays Grok Imagine, automates generation/download workflows, captures prompts, and can sync media/metadata through a BYO Cloudflare Worker/R2 path.
- A Cloudflare Worker in `cloud/` that provides health, presign, metadata snapshot, and sync endpoints.
- A Next.js web app in `web/` for collections, editing, movie/storyboard workflows, sharing, and sync.

The audit target is not only pass/fail QA. Grok Imagine is changing quickly, so the audit must also capture where the current extension and web product are falling behind the live Grok UI/UX, what new features may be necessary, and whether any existing assumptions need rethinking.

Initial local context already found:

- Root extension unit tests pass: `112` Jest tests.
- Root lint passes with warnings.
- Cloud Worker typecheck passes.
- Web build passes.
- Web lint currently fails on existing React/Next lint errors.
- Playwright E2E currently fails because the test Chrome API shim lacks `chrome.runtime.getURL`.
- Local web app runs at `http://localhost:3001`.
- Local Worker runs at `http://localhost:8787`.
- Local Vault path is `/Users/philipbankier/Content/Grok IMagine/greymaker/GrokVault`, about `1.6G`, with `1,853` files: `1,077` PNG, `774` MP4, `1` JPEG, and one `.DS_Store`.
- Direct Wrangler R2 listing is blocked by the current Cloudflare account/auth state, so R2 audit must use either the configured Worker/API-key path, corrected Cloudflare R2 access, or extension-stored configuration if available.

## Goals

1. Prove the real local system state end to end: extension, Chrome/Grok integration, local Vault, Worker/R2 path, and web app.
2. Exercise full functionality, including Grok Imagine creation flows, not only existing Saved/Vault content.
3. Reconcile data across Grok Saved, extension state, local Vault, prompt JSON exports, and R2 where access allows.
4. Capture reliability defects and unverified paths with exact evidence.
5. Capture product and UI/UX drift from the current Grok Imagine experience while using the system.
6. Produce a prioritized follow-up roadmap for fixes, features, and possible architecture rethink items.

## Non-Goals

- Do not delete local Vault files, R2 objects, Grok content, Chrome data, or prompt exports during the audit.
- Do not perform broad product/code fixes during the audit. Implementation fixes become follow-up work unless a small local setup fix is required to unblock the audit itself.
- Do not treat a single success message as proof of system health. Every critical workflow needs before/during/after evidence.

## Audit Surfaces

### Local Project Health

Audit the repository and local runtime:

- Git state and current commit.
- Dependency install state.
- Root extension scripts: unit tests, E2E, lint.
- Worker scripts: typecheck, local dev health, endpoint behavior.
- Web scripts: lint, build, dev server, route smoke checks.
- Local warnings that affect reliability, such as Next workspace-root detection, Wrangler compatibility-date fallback, Cloudflare auth/account ambiguity, and package audit findings.

### Browser and Grok Integration

Use the user's live Chrome tab at `grok.com/imagine/saved` and the Grok Vault UI for the real audit. Browser/browser-use is reserved for localhost and visual companion surfaces; Chrome or Computer Use is used for the existing user-profile Chrome session and extension UI.

Audit:

- Extension overlay injection and visual placement.
- Extension popup configuration and cloud settings.
- Current Grok Saved DOM shape and selector confidence.
- Creation flows for image and video.
- Saved/Vault navigation and bulk workflow affordances.
- Stop, retry, abort, and recovery states.
- Current Grok UI/UX drift from extension assumptions.

### Storage and Backup Integrity

Audit:

- Local Vault media inventory and date-folder distribution.
- Duplicate filenames and likely duplicate files.
- Zero-byte/corrupt-looking files.
- Prompt JSON exports under `/Users/philipbankier/Content/Grok IMagine/greymaker`.
- Extension storage snapshots where accessible.
- R2 object/key evidence through the Worker/API-key path or corrected Cloudflare access.
- New canary media generated during the live run and whether it lands in every expected place.

### Web App Functionality

Audit the web app as a product surface, not just a build artifact:

- Dashboard and navigation.
- Collections import/link parsing.
- Video metadata/proxy routes.
- Editor and movie/storyboard surfaces.
- Share flow.
- Sync route behavior where credentials/configuration allow.
- Current lint/build/runtime gaps.

## Live Test Flow

The audit runs in layers so evidence is collected before higher-risk live actions.

### 1. Baseline

Capture repo state, local dependency state, script results, running server URLs, extension loadability, and known warnings.

### 2. Inventory

Capture local Vault inventory, prompt JSON summaries, extension storage/configuration, and R2 access state. Record counts before any live creation or backup action.

### 3. Browser State

Inspect the existing Chrome tab at `grok.com/imagine/saved`. Confirm Grok auth/session state, extension overlay presence, extension popup state, current Grok UI structure, and selectors relevant to creation, download, Saved/Vault, and batch actions.

### 4. Controlled Canaries

Run small live Grok Imagine canaries:

- Create at least one image canary.
- Create at least one video canary if account state and Grok limits allow.
- Download or scrape canary media through the extension.
- Verify local Vault deltas.
- Verify R2 upload/sync or record the exact blocker.
- Capture screenshots/logs/object identifiers for every canary.

### 5. Stress and Failure Paths

After canaries prove basic safety, exercise broader workflows:

- Saved/Vault scraping against existing items.
- Batch generation paths where selector confidence is adequate.
- Quality repeat if the current Grok UI presents the expected Generate More flow.
- Stop, abort, retry, and partial-failure recovery.
- Backfill and queue retry behavior.
- Cloud test pipeline behavior.

Pause and record before proceeding if Grok auth, rate limits, moderation, selector breakage, or R2 auth ambiguity makes the next action unsafe or misleading.

## Evidence Model

Create a timestamped audit folder under `docs/audits/`.

Expected structure:

```text
docs/audits/YYYY-MM-DD-grok-powertools-full-system-audit/
  manifest.json
  report.md
  inventory/
  logs/
  screenshots/
  reconciliations/
```

### `manifest.json`

Record:

- Audit start/end times.
- Repo commit and git status summary.
- Local server URLs and process notes.
- Chrome/Grok target URL.
- Local Vault path.
- R2/Worker target and access method.
- Canary IDs, filenames, object keys, or source URLs.

### `inventory/`

Record:

- Vault counts by extension/date folder.
- File-size summaries.
- Duplicate filename and checksum findings.
- Prompt JSON file summaries.
- Extension storage/config snapshots where accessible.
- R2 listing or Worker-derived object evidence where available.

### `logs/`

Record:

- Key terminal command outputs or summaries.
- Browser console and service-worker logs where accessible.
- Worker responses.
- Exact error strings.

### `screenshots/`

Record:

- Grok Saved starting state.
- Extension overlay/popup states.
- Creation-flow states.
- Scraper/download/R2 sync states.
- Web app smoke states.
- Any failure or confusing UI state.

### `report.md`

The final report must include:

- Executive status by subsystem.
- Confirmed working flows.
- Broken flows.
- Unverified flows and why they remain unverified.
- Backup completeness findings across local Vault, Grok Saved, extension state, and R2.
- UI/UX drift from current Grok Imagine.
- Feature opportunities.
- Architecture rethink triggers.
- Prioritized next actions: P0 reliability, P1 functionality, P2 product/UX.
- Operator runbook for rerunning the audit.

## Risk Controls

- No destructive data operations.
- Start with small canaries before larger loops.
- Capture evidence before fixes.
- Stop or pause on auth/rate-limit/moderation blocks, selector confidence collapse, unexpected bulk action risk, or ambiguous R2 credentials.
- Treat R2 access failure as an audit finding, not a reason to infer backup state.
- Do not conflate "local Worker health" with "production R2 backup works"; they are separate evidence items.

## Tool Routing

- Use Terminal for repo tests, local servers, Vault inventory, Wrangler/Worker probes, and durable artifacts.
- Use Chrome or Computer Use for the user's live Chrome session, Grok Saved tab, extension overlay, extension popup, and desktop-visible state.
- Use Browser/browser-use for localhost app checks and visual companion screens when useful.
- Use Peekaboo only if Chrome/Computer Use cannot capture native macOS or desktop state needed for the audit, and then capture fresh state first.

## Success Criteria

The audit is complete when:

1. Every major subsystem has a current status: working, broken, blocked, or unverified.
2. Every status is backed by evidence in the audit folder.
3. At least one live creation/download/local backup path is exercised, unless Grok account state blocks creation and the exact blocker is captured.
4. R2 is either verified with object-level evidence or the access/configuration blocker is captured precisely.
5. The report includes actionable next work with priorities and enough reproduction context for implementation.
6. The operator runbook explains how to rerun the audit and interpret failures.

## Approved Direction

The approved approach is a hybrid operational audit plus product-discovery capture:

- Run the real system end to end.
- Include creation flows.
- Audit reliability and full functionality.
- Use the live Grok session and current Grok UI as the truth.
- Capture UI/UX gaps and feature opportunities while exercising the system.
- Produce durable artifacts rather than relying on chat-only notes.
