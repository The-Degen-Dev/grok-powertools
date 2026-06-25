# Grok Power Tools Agent Guide

Use this file to get oriented before changing the repo. For a paste-ready onboarding prompt, see `docs/AGENT_HANDOFF_PROMPT.md`.

## Tool Routing

- Use Browser/browser-use first for websites, localhost apps, file URLs, and UI that is fully inside the browser.
- For live Grok validation in the user's loaded Chrome profile, do not run whole-profile tab discovery or full-window accessibility snapshots. Avoid DevTools `list_pages`, full Chrome snapshots, and AppleScript loops over every tab; operate only on the visible Grok tab/window with narrow probes.
- Use Peekaboo only when the task needs native macOS UI state or control that Browser/browser-use cannot reach: desktop apps, system dialogs, app windows, menu bar, Dock, Spaces, clipboard, screenshots, or direct Accessibility actions.
- Before using Peekaboo for element interactions, capture fresh state with `peekaboo see --json` and use snapshot or element IDs when practical.
- If Peekaboo capture or automation fails, confirm `peekaboo permissions status --json` before treating it as an application bug.

## Repo Shape

This repo has three product surfaces:

- Chrome extension: raw MV3 JavaScript/CSS/HTML at the repo root. There is intentionally no extension build step.
- Web app: Next.js app under `web/` for collections, prompt library, clip editing, movie maker, sharing, auth, and sync.
- Cloud backend: Cloudflare Worker under `cloud/` for R2 presigned uploads, metadata snapshots, and D1/JWT sync.

Provider work:

- The extension is currently Grok-first. Planned ChatGPT Images support is scoped in `docs/superpowers/specs/2026-06-25-chatgpt-images-provider-design.md`; do not claim ChatGPT support is shipped until the implementation and live validation are complete.
- Provider-aware changes should keep Grok-only controls off ChatGPT pages instead of reusing Grok labels or workflows by default.

Key extension files:

- `content.js`: main in-page overlay, prompt history, saved prompts, auto-retry/goals, Quality Repeat, batch automation, scraper.
- `background.js`: MV3 service worker for downloads, cloud sync queue, R2 uploads, popup message routing.
- `bridge.js`: MAIN-world Grok page bridge for TipTap/editor state and cookie-bearing media fetches.
- `popup.js`, `popup.html`, `popup.css`: extension popup settings and cloud controls.
- `cloudSyncUtils.js`: shared cloud config, key-building, retry, and validation helpers.

## Chrome Extension Gotchas

- There is no hot reload. After editing extension files, reload the extension in `chrome://extensions` and refresh the Grok tab.
- Logs live in separate consoles: Grok page content script, extension service worker, and popup inspect console.
- Grok UI changes often. Most automation failures are selectors. Prefer accessible labels, verify visible elements, and use full pointer-event sequences for Radix controls.
- React controlled inputs and TipTap content usually need `bridge.js`, not direct content-script DOM mutation.
- Authenticated media from `assets.grok.com` often needs page cookies, so route fetches through `bridge.js` when service-worker fetch fails.
- Storage is split: `chrome.storage.sync` for overlay global settings, `chrome.storage.local` for prompts, history, processed IDs, activity logs, cloud config, and popup state.
- Keep the raw load-unpacked extension workflow unless explicitly asked to change it.

## Validation

Root extension:

```bash
npm install
npm run test:unit
npm run test:e2e
npm run lint
```

Web app:

```bash
cd web
npm install
npm run build
npm run lint
```

Cloud Worker:

```bash
cd cloud
npm install
npm run typecheck
```

For extension behavior, unit and mocked Playwright tests are not enough. Validate the relevant path in Chrome on `grok.com/imagine` or `chatgpt.com/images` when the change touches selectors, cookies, downloads, or live provider DOM behavior.
- For Vault/R2 work, do not treat a single preview page or default limit as the full dataset. Verify pagination, final unique asset count, and media access for an item beyond the first page before calling the Vault loaded.

## Branch And Safety Notes

- Current `origin/main` already contains the extension, web app, and cloud surfaces.
- The local `feat/web-redesign` branch is older and divergent. Do not merge it into `main` without a separate archaeology pass; it would remove current extension/cloud/auth/sync work.
- Local `CLAUDE.md` files may exist but are ignored locally and are not the tracked source of truth.
- Do not commit local env files, OAuth credentials, API keys, bearer tokens, cookies, personal access tokens, or copied values from ignored files such as `web/.env.local`.
