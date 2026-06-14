# Live Browser UI QA Design

Date: 2026-06-14

Repo: `/Users/philipbankier/Development/skunkworks/Grok-Tinker/chrome-extension-powertools`

Status: approved design for written spec review.

## Goal

Run a full browser and UI QA pass that proves Grok Power Tools still works from a real user perspective after local and Chrome state may have been changed manually.

The run must use the user's existing logged-in Chrome session and real Grok Imagine generation. It must generate at least one new image and one new video. The run must not perform backup, sync, backfill, R2 canary, upload pipeline, or full media backup actions.

## Current Context

The repo is clean on `main` and matches `origin/main` at `7a803dc`.

Recent work added live acceptance safety, bounded R2 canaries, fail-closed page-origin backup commands, and local gate evidence. The existing acceptance design still applies for backup and R2 work, but this QA pass is not a backup validation run.

Read-only preflight on 2026-06-13 found:

- `agent-browser` and `plwr` are not installed.
- `mise`, `npm`, and Peekaboo are available.
- Peekaboo has Screen Recording and Accessibility permissions.
- Port `3011` is free for local web QA.
- `CLOUDFLARE_ACCOUNT_ID` is not present in this shell, so R2 acceptance preflight is blocked.
- Existing Chrome has Grok Imagine tabs and the extension popup tab open.
- The extension popup is in a mixed state: production Worker URL, `cloud_only`, and acceptance download/key prefix.

The mixed popup state is a finding. This pass records it and avoids backup controls instead of changing backup state before testing.

## Scope

Covered:

- Local web app desktop and mobile UI.
- Extension popup read-only state.
- Extension overlay on live `grok.com/imagine`.
- Real Grok image generation.
- Real Grok video generation.
- Prompt entry, generation controls, overlay visibility, status behavior, settings, and minimize/restore.
- Generated result viewing where available through the current Grok UI.
- Evidence capture for pass/fail states.

Not covered by design:

- Full Media Backup.
- One Media R2 Canary.
- Test Upload Pipeline.
- Run Backfill.
- Retry Unsynced.
- Start Sync.
- Production or acceptance R2 writes.
- Destructive reset of processed IDs, saved prompts, prompt history, or Chrome storage.

## Tooling

Use project routing rules:

- Prefer browser-contained automation for websites and localhost when available.
- Use the existing Chrome session for authenticated Grok state.
- Use Peekaboo for native Chrome or desktop state when browser tooling cannot reach it.
- Before Peekaboo element interactions, capture fresh state with `peekaboo see --json`.
- Do not use Chrome DevTools MCP unless needed for the existing session, and only connect to the existing Chrome window/session.

Because `agent-browser` and `plwr` are not installed, the practical test stack is:

- Playwright or browser automation for local web app checks.
- AppleScript, existing Chrome automation, and Peekaboo for the logged-in Grok session.
- Shell and repo scripts for local gates and evidence parsing.

## Test Flow

### 1. Preflight

Verify and record:

- Git status and current commit.
- Node/npm/mise path.
- Browser automation tool availability.
- Peekaboo permissions.
- Existing Chrome Grok tabs.
- Extension popup state.
- Local web port availability.
- Whether local web server starts from this repo.

Do not run cloud/R2 preflight as a blocker for this pass, because backup is out of scope.

### 2. Local Web App

Start the Next app on a free port, prefer `3011` if `3001` is occupied or ambiguous.

Desktop and mobile routes:

- `/`
- `/movie`
- `/edit`
- `/ops`
- `/share`
- A collection/detail flow using examples or seeded local data.

UI checks:

- No horizontal overflow on mobile.
- Header navigation remains usable.
- Prompt Library opens in viewport.
- Settings opens in viewport and controls are clickable.
- Sign In opens in viewport.
- Clip editor loads a known-good video URL through the proxy.
- Invalid video URL shows a useful failure state.
- Share view renders valid and invalid share data.
- Ops view displays local gate evidence when imported or available.

### 3. Existing Chrome Grok Session

Use only the existing logged-in Chrome profile.

Before interacting:

- Identify the exact `https://grok.com/imagine` tab.
- Avoid navigating unrelated tabs.
- Capture current page and overlay state.
- Record whether the extension is injected and whether the overlay is minimized or open.

### 4. Live Image Generation

Generate one image using a QA-marked prompt. The prompt should be harmless, non-private, and easy to identify later, for example:

`Grok Power Tools QA 2026-06-14 image canary, a small orange toolbox on a clean desk, simple studio lighting`

Verify:

- Prompt can be entered through the current Grok UI.
- The chosen generation mode is visible.
- Submission works.
- Progress or loading state is visible.
- A generated image appears.
- The result can be opened or inspected through the current UI.
- No selector or overlay errors block the flow.

### 5. Live Video Generation

Generate one video using a QA-marked prompt. The prompt should be harmless, non-private, and easy to identify later, for example:

`Grok Power Tools QA 2026-06-14 video canary, a tiny orange toolbox gently spinning on a clean desk, 5 seconds, smooth camera`

Verify:

- Video mode can be selected.
- Prompt can be entered.
- Submission works.
- Progress or loading state is visible.
- A generated video appears or the UI reaches a clear queued/processing state.
- Playback opens or is visible if Grok makes the result available within the run window.
- No selector or overlay errors block the flow.

If Grok queues the video longer than the run window, record the queued state and continue with other non-destructive UI checks.

### 6. Extension Overlay

On the live Grok page, verify:

- Overlay injection.
- Open, minimize, and restore.
- Settings panel opens and returns.
- Status is readable.
- Generation-related controls are visible and aligned with the current Grok UI.
- Prompt/history/saved-prompt behavior that can be tested without deleting or overwriting existing user data.
- The overlay does not block critical Grok controls.

Do not start batch, Quality Repeat, gallery download, or backup flows unless a later approved plan explicitly adds them.

### 7. Extension Popup

Open or focus the extension popup tab and inspect:

- Status.
- Download folder.
- Backup mode.
- Worker URL.
- Key prefix.
- API key presence only, never raw value.
- Unsynced count.
- Last test and last error.
- Dangerous buttons are present but not clicked.

Record the mixed production/acceptance state as a finding if still present.

### 8. Evidence

Write evidence under `/private/tmp/grok-powertools-qa/<run-id>/` unless a later plan chooses a tracked artifact path.

Capture:

- Screenshots for every route and live Grok milestone.
- JSON metrics for viewport size, scroll width, visible modal rectangles, video element state, and key popup fields.
- Console/page errors where available.
- A final concise report with pass/fail per surface.

Do not write secrets, cookies, signed URLs, bearer tokens, raw API keys, or private prompt content into evidence.

## Safety Gates

Stop before action if:

- The automation cannot prove which Chrome tab it controls.
- A click target is ambiguous and could hit backup, sync, reset, or delete.
- A modal asks for payment, account switch, permission escalation, or anything outside normal generation.
- The browser state suggests the run would navigate or mutate unrelated tabs.
- A control would trigger R2, D1, sync, backfill, upload pipeline, or full media backup.

Stop after action and mark blocked or failed if:

- Image generation cannot be submitted.
- Video generation cannot be submitted.
- The extension overlay disappears or blocks normal Grok controls.
- A web app modal is clipped or outside the viewport.
- Mobile layout has horizontal overflow.
- Any evidence contains sensitive values.

## Verdicts

- `verified`: all scoped local web, extension popup, extension overlay, image generation, and video generation checks pass with evidence.
- `failed`: a scoped product behavior fails after interaction.
- `blocked`: preflight or safe interaction cannot proceed.
- `contaminated`: backup, sync, R2 upload, destructive reset, or unrelated Chrome tab mutation happens.
- `partial`: image or video generation enters a legitimate long-running Grok queue while other scoped checks pass.

## Output

The final QA report must state:

- What was tested.
- What passed.
- What failed.
- What was intentionally not tested.
- What was changed in the user's Grok account.
- What was changed in Chrome extension storage, if anything.
- What was changed in the local repo, if anything.
- Exact evidence paths.

The report must not say the project is ready if any scoped blocker remains.
