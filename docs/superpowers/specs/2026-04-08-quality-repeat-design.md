# Quality Repeat — Auto-generate multiple batches of Quality images

## Context

Grok Imagine's Quality mode generates 4 images per submission. Speed mode has an endless gallery, but Quality is limited to 4 at a time. To get 20 Quality images, you must manually click "Generate More" 5 times. This feature automates that.

## Approach

Click the native "Generate More" button in a loop with smart wait-for-completion between clicks. No API reverse-engineering — just DOM automation like a human would do.

## UI: On-Page Quick Buttons

When the extension detects a "Generate More" button on the page (via MutationObserver on the scroll container), it injects quick-count buttons beside it:

```
[ Generate More ]  [ ×2 ] [ ×5 ] [ ×10 ]
```

- Buttons styled to match Grok's `bg-surface-l2 text-secondary rounded-full text-xs font-semibold` pattern
- Clicking a multiplier starts the repeat loop for that many clicks
- While running, replace the multiplier buttons with a progress indicator + stop button:
  ```
  [ Generate More ]  Generating 2/5...  [ ✕ ]
  ```
- The native "Generate More" button remains visible but is not hidden/disabled

### Detection

Use a `MutationObserver` on `document.body` (or the main scroll container `.overflow-scroll`) to detect when a button with text content "Generate More" appears. Inject the quick buttons as siblings. Re-inject if the button is re-rendered (React may replace DOM nodes).

## UI: Overlay Panel

Add a "Quality Repeat" section in the `GrokOverlay` panel, positioned after the Video batch section:

```
─── Quality Repeat ───
Repeats: [  5  ]     (×4 = 20 images)
[ Start Quality Repeat ]
```

While running:
```
─── Quality Repeat ───
Progress: 12/20 images (3/5 repeats)
[ Stop ]
```

### Overlay fields
- **Repeats input**: Number input, default 5, min 1, max 50
- **Calculated label**: Shows `(×4 = N images)` dynamically
- **Start button**: Green, triggers the repeat loop
- **Stop button**: Red, appears while running, sets `running = false`
- **Progress text**: Updates after each completed batch

## Core Logic

### Location

Add a `QualityRepeatManager` section within `VideoRetryManager` (reuse the existing class's infrastructure: `safeStatus`, `sleep`, overlay reference, `isConnected` checks). Alternatively, add as standalone methods if cleaner.

### Algorithm

```
qualityRepeat(targetRepeats):
  running = true
  completed = 0

  while completed < targetRepeats AND running:
    btn = findGenerateMoreButton()
    if not btn:
      wait up to 5s for btn to appear
      if still not found: stop with error

    countBefore = countGeneratedImages()
    btn.click()

    // Wait for new images to appear (or timeout)
    waitForNewImages(countBefore, timeout=30s)

    completed++
    updateProgress(completed, targetRepeats)

  running = false
  showComplete(completed, targetRepeats)
```

### Key functions

- **`findGenerateMoreButton()`**: `Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Generate More')`
- **`countGeneratedImages()`**: Count `<img>` elements with `src` containing `imagine-public` or `assets.grok.com` in the scroll container
- **`waitForNewImages(countBefore, timeout)`**: Poll every 500ms until image count > countBefore, or timeout. Also check for loading/skeleton indicators clearing.
- **`updateProgress(completed, total)`**: Update both on-page counter and overlay status text

### Stop mechanism

- `this.qualityRepeatRunning` flag, checked at the top of each loop iteration
- Stop button sets flag to `false`
- Any navigation away from `/imagine` also stops (check `location.href`)

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Generate More button disappears (navigation) | Stop, show "Generation stopped — page changed" |
| Single generation times out (30s) | Log warning, continue to next repeat |
| User manually clicks Generate More during run | Loop sees the new images and counts the repeat as done |
| Mode switches (Quality → Speed) mid-run | Don't detect/prevent — the loop still works with Generate More |
| Page loses focus / tab backgrounded | Continue — DOM clicks work in background tabs |
| Extension context invalidated (reload) | Loop breaks on next `chrome.runtime` call, stops naturally |

## Files to modify

| File | Change |
|------|--------|
| `content.js` — `GrokOverlay` | Add Quality Repeat section HTML + event listeners |
| `content.js` — `VideoRetryManager` (or new section) | Add `startQualityRepeat()`, `stopQualityRepeat()`, helper functions |
| `content.js` — MutationObserver setup | Detect "Generate More" button, inject quick-count buttons |

## Verification

1. Navigate to `grok.com/imagine`, select Quality mode, enter a prompt, generate initial 4 images
2. Verify quick buttons (`×2`, `×5`, `×10`) appear next to "Generate More"
3. Click `×2` — should auto-click Generate More twice, producing 8 more images (12 total)
4. Verify progress shows in both on-page counter and overlay
5. Click `×5` — should produce 20 more images. Click stop mid-way and verify it stops cleanly
6. Test from overlay: set repeats to 3, click Start, verify 12 images generated
7. Navigate away mid-generation — verify it stops with a notification
