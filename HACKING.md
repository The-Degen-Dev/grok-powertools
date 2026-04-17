# HACKING.md — Contributor's guide to the Chrome extension

Welcome. This is the orientation doc for people who want to **change the code**. `README.md` tells users what the extension does; `CONTRIBUTING.md` explains the PR process; this file explains the weird parts of Chrome MV3 extensions and the Grok-specific gotchas that will trip you up on day one.

If you've never built a Chrome extension before, start here and read top to bottom. Then skim `CLAUDE.md` for the architecture overview and the canonical DOM selector reference.

---

## 1. Reload after every change

**There is no hot reload.** When you edit any file in the extension:

1. Open `chrome://extensions/`
2. Find "Grok Power Tools" and click the circular reload icon
3. Reload the Grok tab (the content script gets re-injected by Chrome on navigation, not on extension reload)

If the overlay doesn't appear after reload:

- Is your Grok tab already open? Refresh it. The old content script is dead but Chrome doesn't tell you.
- Did you get an "Extension context invalidated" error in the console? That's the old content script trying to talk to a now-reloaded service worker. Refresh the Grok tab to re-inject a fresh content script.

> **Why:** Chrome MV3 service workers can be killed at any time, and extension reloads spawn a brand new service worker. Anything the page was holding onto (message ports, content-script-scoped listeners) is orphaned. Refreshing the page is the mercy kill.

---

## 2. Three DevTools consoles, three sets of logs

This extension runs code in three separate JavaScript contexts. Each has its own DevTools console. If you're looking for a log and don't see it, you're probably looking at the wrong console.

| Console | What runs here | How to open |
|---|---|---|
| **Content script** | `content.js` — the overlay, the scraper, the DOM automation | Press **F12** on `grok.com/imagine`. Console tab. |
| **Service worker** | `background.js` — downloads, message routing, R2 uploads | `chrome://extensions/` → find Grok Power Tools → click the blue **"Service Worker"** link |
| **Popup** | `popup.js` — the settings panel that opens from the extension icon | Right-click the extension icon in the Chrome toolbar → **"Inspect popup"** |

There's also a **fourth** context: `bridge.js`, which runs in the **MAIN world** of the Grok page. Its `console.log` calls appear in the same console as the content script (F12 on Grok) but its state (variables, TipTap editor references) is not visible from content script code. See §4.

**Common mistake:** you add `console.log('hello')` to `background.js`, reload the extension, do the action, and see nothing in the Grok-page console. You were looking at the content script console. Open the Service Worker DevTools instead.

---

## 3. Why selectors break (and how to debug them)

Grok is a Next.js + React app with Radix UI components. The DOM is regenerated aggressively on navigation, and Grok ships UI tweaks often. **Most bugs you'll file in this repo are selectors that stopped matching.**

### Symptoms

- "Nothing happens when I click the overlay's batch button"
- In the content script console: `Prompted Batch [detail]: Submit button not found`
- In the Elements panel, the button you expect is there — but with a different `aria-label` than your code looks for

### Debug loop

1. Open `grok.com/imagine` → F12 → Elements panel
2. Copy the `aria-label` of the actual button you want
3. In the content script Console, run `document.querySelector('button[aria-label="whatever-you-copied"]')` to confirm it matches
4. Update the selector in `content.js` (the canonical list lives in `CLAUDE.md` under "DOM Selectors for Grok UI")
5. Test by reloading the extension + refreshing the Grok tab

### Rules of thumb

- **Prefer `aria-label` over classnames.** Tailwind classes change when Grok rebuilds; aria labels are stable for accessibility reasons.
- **Watch for duplicate aria-labels.** The page sometimes has two buttons with the same `aria-label` — one hidden (0×0 pixels, off-screen) and one visible. `document.querySelector()` returns the first one in DOM order, which is often the hidden one. See `clickSubmitButton()` in `content.js` for the visible-only-picker pattern.
- **Radix UI components need full pointer event sequences, not plain `.click()`.** If a dropdown won't open when your code clicks the trigger, use `simulateClick()` from `VideoRetryManager` — it dispatches `pointerdown/mousedown/pointerup/mouseup/click` in order. Plain `element.click()` dispatches only `click`, and Radix ignores it.
- **React controlled inputs ignore `.value = 'x'`.** See §4.

---

## 4. bridge.js: MAIN world vs. isolated world

This is the single most confusing thing about this codebase. Read this section carefully.

### The two worlds

Chrome runs content scripts in an **isolated world** — a separate JavaScript context that shares the page's DOM but not its JavaScript. From the content script:

- ✅ You can see `<div>` elements, `<button>` elements, text, attributes
- ❌ You **cannot** see `window.someAppState`, React fibers, or custom properties like `contenteditableElement.editor` that the page's own scripts set

That last one is the killer. When you `document.querySelector('[contenteditable="true"]')` and try to inject text, the element has a TipTap editor instance attached as `ce.editor` — but **from the content script, `ce.editor` is `undefined`**. Setting `.textContent` updates the DOM but not TipTap's internal state, and on the next React render your injection is wiped.

### How `bridge.js` solves it

`bridge.js` is a file in the extension that gets injected into the Grok page's **MAIN world** (same context as Grok's React code). It's loaded via `manifest.json` → `web_accessible_resources` and injected by `content.js` as a `<script>` tag at page load (see `injectPageWorldBridge()` at the top of `content.js`).

From `bridge.js`, `ce.editor` is a real TipTap instance and `ce.editor.commands.insertContent(text)` works correctly.

### Communication

The two worlds can't call each other's functions, but they share the DOM, so they communicate via **custom DOM events**:

```js
// Content script (isolated world) — asks bridge.js to set editor content
document.dispatchEvent(new CustomEvent('__gpt_set_editor_content', {
    detail: { text: 'my video prompt' }
}));

// bridge.js (MAIN world) — listens and does the work
document.addEventListener('__gpt_set_editor_content', (e) => {
    const ce = document.querySelector('[contenteditable="true"]');
    if (ce?.editor) {
        ce.editor.commands.clearContent();
        ce.editor.commands.insertContent(e.detail.text);
    }
});
```

### When you also need bridge.js: cookies

The service worker (`background.js`) can `fetch()` URLs, but its requests **do not** include the user's Grok session cookies. This breaks for `assets.grok.com` videos, which require auth. The MAIN-world `fetch()` in `bridge.js` does get the page's cookies, so the R2 backup pipeline for videos goes: content script → `document.dispatchEvent('__gpt_fetch_media')` → bridge.js fetches with cookies → returns a blob URL → content script reads the blob → sends base64 to background → background uploads to R2.

If a request works in Chrome but not from the extension, the answer is usually "route it through bridge.js."

---

## 5. Storage: two namespaces, easy to confuse

Settings live in `chrome.storage.sync` (syncs across the user's Chrome profile). Everything else lives in `chrome.storage.local`. They're completely separate key-value stores.

| Data | Namespace | Written by |
|---|---|---|
| `gptGlobalSettings` (autoRetryEnabled, videoGoal, etc.) | `sync` | `SettingsManager` in `content.js` |
| `promptHistory`, `savedPrompts`, `overlayState`, `scraperState`, `processedIds`, `downloadPath`, `activeGrokUserId`, `activityLogs` | `local` | various places |
| Popup UI settings (`downloadPath`, `autoRetryEnabled`, `retryMaxCount`) | `local` | `popup.js` |

**Note the duplication:** the overlay's `SettingsManager` keeps `autoRetryEnabled` in `sync`, but the popup keeps its own copy in `local`. This is on purpose (popup should work before the content script hydrates) but it's a footgun — if you change the schema in one place you probably need to change it in the other.

---

## 6. The one-file monolith

`content.js` is ~3,000 lines and holds 7 classes. That's more than I'd start a greenfield project with, but the tradeoff is: **no build step.** Every class is in one `<script>` tag injected by Chrome, so there are no imports, no bundler, no source maps to keep straight.

If you want to split it, go for it — but keep the "raw JS, no build" property, because the "fork the repo and load unpacked" flow is the whole point for non-devs who want to use this. If you add a build step, document the new flow in README.md at the same time.

Class boundaries (search for `class FooManager` in `content.js`):

1. `ToastManager` — temporary notification popups
2. `LogViewer` — draggable dev log panel (only visible in dev mode)
3. `SettingsManager` — `chrome.storage.sync` with pub/sub
4. `PromptHistoryManager` — captures prompts via capture-phase listeners
5. `GrokOverlay` — the main floating dashboard UI
6. `VideoRetryManager` — auto-retry logic, batch processing, quality repeat
7. `GrokScraper` — bulk download

---

## 7. Running the tests

```bash
npm install
npm run test:unit   # Jest + jsdom, ~0.6s, 112 tests
npm run test:e2e    # Playwright loads the unpacked extension in a real Chromium
npm run lint
```

If `npm run test:unit` fails at "Test suite failed to run — `chrome.runtime.getURL` is not a function", your `jest.setup.js` is missing a Chrome API shim. Check the top of that file.

If `npm run lint` screams about a thousand errors in `web/.next/`, your `eslint.config.js` is missing the `web/**` ignore. See the flat-config gotcha: `ignores` only applies globally when it's in its own config object, not when it's alongside `files`.

---

## 8. Getting help / filing issues

When something breaks, a useful bug report answers:

1. **Which console did you check?** (content script / service worker / popup)
2. **What was the exact console error?** (copy the full message, not "it failed")
3. **Did the Grok UI change?** (open Elements panel, paste the `aria-label` you expected vs the one you actually see)
4. **Does `npm run test:unit` pass on `main`?** (rule out "my branch broke it" vs "main is broken")

Grok updates their UI on an unpredictable cadence. When a batch stops working, the 95% answer is a changed selector, not a logic bug.

---

## 9. Further reading

- `CLAUDE.md` — detailed architecture, class responsibilities, Grok page structure (views, known-working selectors, observed quirks)
- `README.md` — user-facing feature list and install flow
- `CONTRIBUTING.md` — PR workflow, commit message style, LICENSE
- `manifest.json` — permissions and `web_accessible_resources` declarations (if you add a new MAIN-world script, it goes here)
