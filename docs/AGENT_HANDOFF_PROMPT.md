# Agent Handoff Prompt

Paste this into the next agent session to get it oriented quickly.

```text
You are taking over the Grok Power Tools repo.

Repo:
- /Users/philipbankier/Development/skunkworks/Grok-Tinker/chrome-extension-powertools
- Work from main unless explicitly told otherwise.
- origin: https://github.com/philipbankier/grok-powertools.git
- upstream: git@github.com:The-Degen-Dev/grok-powertools.git

First, orient before changing code:
1. Read AGENTS.md, README.md, HACKING.md, CONTRIBUTING.md, manifest.json, and package.json.
2. Read docs/CLOUD_R2_SETUP.md for the Cloudflare R2 backup architecture.
3. Read web/package.json, cloud/package.json, web/src/lib/local-storage.ts, web/src/lib/sync-engine.ts, and cloud/src/index.ts.
4. If local CLAUDE.md files exist, treat them as stale local notes only. The tracked source of truth is AGENTS.md plus current code.

Product shape:
- Root is a Chrome MV3 extension for Grok Imagine and provider-aware ChatGPT Images text-to-image tracking.
- content.js is the raw no-build extension monolith: overlay UI, prompt history, saved prompts, retry/goals, Quality Repeat, batch automation, and scraper.
- background.js is the MV3 service worker: downloads, cloud sync queue, R2 upload pipeline, popup message routing.
- bridge.js runs in Grok's MAIN world and communicates with content.js via DOM CustomEvents. Use it when React/TipTap state or page cookies are required.
- popup.js/popup.html/popup.css are the extension popup settings and cloud controls.
- cloud/ is a Cloudflare Worker with R2 presign, metadata snapshot, D1, and JWT sync endpoints.
- web/ is a Next.js 16 + React 19 web app for dashboards, collections, prompt library, clip editing, movie maker, sharing, auth, and sync.
- ChatGPT Images V1 is supported on chatgpt.com/images by observing the native prompt bar and native send button. Reference-image ChatGPT recreate/edit and video are separate follow-up work.

Important extension gotchas:
- There is no hot reload. After editing extension files, reload the extension in chrome://extensions and refresh the Grok tab.
- Logs live in separate consoles: Grok page content script, extension service worker, and popup inspect console.
- Grok UI changes often. Most automation failures are selectors. Prefer accessible labels, verify visible elements, and use full pointer-event sequences for Radix controls.
- React controlled inputs and TipTap content usually need bridge.js, not direct content-script DOM mutation.
- ChatGPT Images has a visible ProseMirror composer plus a hidden fallback textarea. Verify visible composer text before trusting selectors or status.
- Authenticated media from assets.grok.com often needs page cookies, so route fetches through bridge.js when service-worker fetch fails.
- Storage is split: chrome.storage.sync for overlay global settings; chrome.storage.local for prompts, history, processed IDs, activity logs, cloud config, and popup state.
- Keep the extension raw JS/no-build unless intentionally changing the install story, and update README/HACKING if that changes.

Validation commands:
- Root extension: npm install, then npm run test:unit, npm run test:e2e, npm run lint.
- Root E2E injects content.js into a mocked page; it is not enough for real Grok DOM/cookie behavior.
- Web app: cd web && npm install && npm run build && npm run lint. Dev server is npm run dev on port 3001.
- Worker: cd cloud && npm install && npm run typecheck. Deploy is npm run deploy after secrets/env are configured.
- For extension behavior, perform live Chrome validation on grok.com/imagine when possible.
- For provider-aware work, perform live Chrome validation on the relevant provider page: grok.com/imagine for Grok or chatgpt.com/images for ChatGPT Images. Use narrow inspection, verify visible composer state, and avoid scraping unrelated private gallery content.

Env/config hygiene:
- Do not ask for or commit local secret values.
- Keep examples generic, such as AUTH_SECRET: <set locally>, AUTH_GOOGLE_SECRET: <set locally>, WORKER_URL: https://<worker>.<account>.workers.dev.
- Never copy values from ignored local env files into tracked docs or code.
- Cloudflare account, bucket, database, and worker identifiers may appear in tracked config/tests; treat them as deployment identifiers, not credentials.

Automation/tool routing:
- Use Browser/browser-use first for websites, localhost apps, file URLs, and browser-contained UI.
- Use Peekaboo only for native macOS UI that Browser cannot reach, such as chrome://extensions reload flows, Chrome extension toolbar/popup, system dialogs, or desktop state.
- Before Peekaboo element interactions, capture fresh state with peekaboo see --json; if capture fails, check peekaboo permissions status --json.

Known cleanup candidates to verify before acting:
- README/LICENSE say MIT, but root package.json says ISC.
- web/README.md is still mostly default Next.js boilerplate.
- root and web do not appear to have lockfiles; cloud has package-lock.json.
- cloud/wrangler.toml contains deployment identifiers. Do not publish additional secrets.
- Planning docs under docs/superpowers and web/docs/plans are useful provenance, but current code may already implement parts of them. Verify current files before treating unchecked plan steps as todo.
- The local feat/web-redesign branch is older and divergent. Do not merge it into main without a separate archaeology pass; current main already has the web app plus newer extension/cloud/auth/sync work.

When building:
- Keep changes scoped.
- Preserve the extension's no-build load-unpacked workflow unless explicitly told otherwise.
- Add or update focused tests for helper logic, selectors, storage schema, sync/R2 queues, and web data model changes.
- Do not claim cloud backup, sync, or Grok automation works from unit tests alone; prove the actual path relevant to the change.
```
