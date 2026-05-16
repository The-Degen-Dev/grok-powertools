# Quality Repeat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-click Grok's "Generate More" button N times so Quality mode can produce 8, 20, or 40+ images from one prompt without manual clicking.

**Architecture:** A `qualityRepeat` method on `VideoRetryManager` runs an async loop: click "Generate More" -> wait for new images to appear -> repeat. On-page quick buttons (x2/x5/x10) are injected next to the native button via MutationObserver. Overlay panel gets a matching section with count input + start/stop.

**Tech Stack:** Vanilla JS (no build), Chrome Extension MV3, DOM MutationObserver

---

### Task 1: Add Quality Repeat section to overlay HTML

**Files:**
- Modify: `content.js:571` -- insert new HTML section between Template Batch and Gallery Download

- [ ] **Step 1: Add the overlay HTML**

In `content.js`, find the closing `</div>` of the Template Batch section (line 571) and insert the Quality Repeat section after it, before the Gallery Download section (line 573).

Insert after `</div>` on line 571 (the end of Template Batch section):

```html
                    <div class="gpt-section">
                        <label class="gpt-row" style="font-weight:600; margin-bottom:4px;">Quality Repeat</label>
                        <div class="gpt-row" style="gap:6px; align-items:center;">
                            <span style="font-size:11px;">Repeats:</span>
                            <input type="number" id="gptQualityRepeatCount" class="gpt-input" value="5" min="1" max="50" style="width:48px;">
                            <span id="gptQualityRepeatCalc" style="font-size:10px; color:#71767b;">(x4 = 20 images)</span>
                        </div>
                        <div class="gpt-row" style="margin-top:6px; gap:4px;">
                            <button id="gptQualityRepeatBtn" class="gpt-btn gpt-btn-primary" style="flex:1; background:#8b5cf6; font-size:11px;">Start Quality Repeat</button>
                            <button id="gptQualityRepeatStopBtn" class="gpt-btn" style="flex:1; background:#f4212e; display:none; font-size:11px;">Stop</button>
                        </div>
                        <div id="gptQualityRepeatStatus" style="font-size:10px; color:#71767b; margin-top:4px;"></div>
                    </div>
```

- [ ] **Step 2: Syntax check**

Run: `node -c content.js`
Expected: No output (clean parse)

- [ ] **Step 3: Commit**

```bash
git add content.js
git commit -m "feat(ext): add Quality Repeat section to overlay HTML"
```

---

### Task 2: Wire up overlay event listeners

**Files:**
- Modify: `content.js` -- `GrokOverlay` constructor event listener block (~line 805-830)

- [ ] **Step 1: Add event listeners for Quality Repeat controls**

Find the block where other overlay event listeners are wired up (after `gptBatchStopBtn` listener, around line 829-835). Add after the existing batch stop listener:

```js
        // Quality Repeat controls
        this.el.querySelector('#gptQualityRepeatCount').addEventListener('input', (e) => {
            const count = Math.max(1, parseInt(e.target.value, 10) || 1);
            const calcEl = this.el.querySelector('#gptQualityRepeatCalc');
            if (calcEl) calcEl.textContent = '(x4 = ' + (count * 4) + ' images)';
        });
        this.el.querySelector('#gptQualityRepeatBtn').addEventListener('click', () => {
            const count = Math.max(1, parseInt(this.el.querySelector('#gptQualityRepeatCount').value, 10) || 5);
            this.retryManager.startQualityRepeat(count);
        });
        this.el.querySelector('#gptQualityRepeatStopBtn').addEventListener('click', () => {
            this.retryManager.stopQualityRepeat();
        });
```

- [ ] **Step 2: Syntax check**

Run: `node -c content.js`
Expected: No output (clean parse)

- [ ] **Step 3: Commit**

```bash
git add content.js
git commit -m "feat(ext): wire up Quality Repeat overlay event listeners"
```

---

### Task 3: Implement core Quality Repeat logic on VideoRetryManager

**Files:**
- Modify: `content.js` -- `VideoRetryManager` class (add methods before the closing `}` of the class, around line 2100)

- [ ] **Step 1: Add Quality Repeat state properties to constructor**

In the `VideoRetryManager` constructor (line 1347-1386), add after the `this.batchContext = null;` line (line 1381):

```js
        // Quality Repeat state
        this.qualityRepeatRunning = false;
        this.qualityRepeatTotal = 0;
        this.qualityRepeatCompleted = 0;
```

- [ ] **Step 2: Add helper methods**

Add these methods to `VideoRetryManager`, after `updateCounters()` (around line 2100, before the class closing brace):

```js
    // --- Quality Repeat: auto-click "Generate More" N times ---

    findGenerateMoreButton() {
        return Array.from(document.querySelectorAll('button')).find(
            b => b.textContent.trim() === 'Generate More'
        );
    }

    countGeneratedImages() {
        return document.querySelectorAll(
            'img[src*="imagine-public"], img[src*="assets.grok.com"]'
        ).length;
    }

    async waitForNewImages(countBefore, timeout = 30000) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            if (!this.qualityRepeatRunning) return false;
            if (this.countGeneratedImages() > countBefore) return true;
            await this.sleep(500);
        }
        return false; // timed out
    }

    updateQualityRepeatUI(running) {
        if (!this.overlay || !this.overlay.el) return;
        const startBtn = this.overlay.el.querySelector('#gptQualityRepeatBtn');
        const stopBtn = this.overlay.el.querySelector('#gptQualityRepeatStopBtn');
        const statusEl = this.overlay.el.querySelector('#gptQualityRepeatStatus');
        if (startBtn) startBtn.style.display = running ? 'none' : '';
        if (stopBtn) stopBtn.style.display = running ? '' : 'none';
        if (statusEl) {
            if (running) {
                const images = this.qualityRepeatCompleted * 4;
                const totalImages = this.qualityRepeatTotal * 4;
                statusEl.textContent = 'Generating: ' + images + '/' + totalImages + ' images (' + this.qualityRepeatCompleted + '/' + this.qualityRepeatTotal + ' repeats)';
            } else if (this.qualityRepeatCompleted > 0) {
                statusEl.textContent = 'Done: ' + (this.qualityRepeatCompleted * 4) + ' images (' + this.qualityRepeatCompleted + '/' + this.qualityRepeatTotal + ' repeats)';
            } else {
                statusEl.textContent = '';
            }
        }
    }
```

- [ ] **Step 3: Add the main startQualityRepeat and stopQualityRepeat methods**

```js
    async startQualityRepeat(targetRepeats) {
        if (this.qualityRepeatRunning) return;
        this.qualityRepeatRunning = true;
        this.qualityRepeatTotal = targetRepeats;
        this.qualityRepeatCompleted = 0;
        this.updateQualityRepeatUI(true);
        this.safeStatus('Quality Repeat: Starting 0/' + targetRepeats, 'info');

        while (this.qualityRepeatCompleted < this.qualityRepeatTotal && this.qualityRepeatRunning) {
            // Find the Generate More button (wait up to 5s for it to appear)
            let btn = this.findGenerateMoreButton();
            if (!btn) {
                const waitStart = Date.now();
                while (!btn && Date.now() - waitStart < 5000) {
                    await this.sleep(500);
                    btn = this.findGenerateMoreButton();
                }
            }
            if (!btn) {
                this.safeStatus('Quality Repeat: Generate More button not found', 'warning');
                break;
            }

            if (!location.href.includes('/imagine')) {
                this.safeStatus('Quality Repeat: Navigated away from Imagine', 'warning');
                break;
            }

            const countBefore = this.countGeneratedImages();
            btn.click();

            const appeared = await this.waitForNewImages(countBefore);
            if (!this.qualityRepeatRunning) break;

            this.qualityRepeatCompleted++;
            this.updateQualityRepeatUI(true);
            this.safeStatus('Quality Repeat: ' + this.qualityRepeatCompleted + '/' + this.qualityRepeatTotal, 'info');

            if (!appeared) {
                console.warn('Quality Repeat: Timeout waiting for images on repeat ' + this.qualityRepeatCompleted);
            }

            // Brief pause before next click
            await this.sleep(1000);
        }

        this.qualityRepeatRunning = false;
        this.updateQualityRepeatUI(false);
        const done = this.qualityRepeatCompleted >= this.qualityRepeatTotal;
        const msg = done
            ? 'Quality Repeat: Complete (' + (this.qualityRepeatCompleted * 4) + ' images)'
            : 'Quality Repeat: Stopped (' + (this.qualityRepeatCompleted * 4) + ' images)';
        this.safeStatus(msg, done ? 'success' : 'neutral');
        this.updateOnPageButtons(false);
    }

    stopQualityRepeat() {
        this.qualityRepeatRunning = false;
    }
```

- [ ] **Step 4: Add the `sleep` helper to VideoRetryManager**

`VideoRetryManager` does NOT have its own `sleep` (only `GrokScraper` at line 2803 does). Add it to the class:

```js
    sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
```

- [ ] **Step 5: Syntax check**

Run: `node -c content.js`
Expected: No output (clean parse)

- [ ] **Step 6: Commit**

```bash
git add content.js
git commit -m "feat(ext): implement Quality Repeat core logic on VideoRetryManager"
```

---

### Task 4: Inject on-page quick buttons next to "Generate More"

**Files:**
- Modify: `content.js` -- `VideoRetryManager` class (add MutationObserver logic)

- [ ] **Step 1: Add the on-page button injection and management methods**

Add these methods to `VideoRetryManager`, after `stopQualityRepeat()`:

```js
    // --- On-page quick buttons next to "Generate More" ---

    injectQuickRepeatButtons(generateMoreBtn) {
        // Don't inject twice
        if (generateMoreBtn.parentElement.querySelector('.gpt-quality-repeat-inline')) return;

        const container = document.createElement('span');
        container.className = 'gpt-quality-repeat-inline';
        container.style.cssText = 'display:inline-flex; gap:4px; margin-left:8px; align-items:center;';
        this._buildQuickButtons(container);
        generateMoreBtn.parentElement.appendChild(container);
    }

    _buildQuickButtons(container) {
        while (container.firstChild) container.removeChild(container.firstChild);
        [2, 5, 10].forEach(count => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = 'x' + count;
            btn.style.cssText = 'padding:4px 10px; font-size:11px; font-weight:600; border-radius:9999px; border:none; cursor:pointer; background:rgba(139,92,246,0.15); color:#a78bfa; transition:background 0.2s;';
            btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(139,92,246,0.3)'; });
            btn.addEventListener('mouseleave', () => { btn.style.background = 'rgba(139,92,246,0.15)'; });
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.startQualityRepeat(count);
                this._showOnPageProgress(container);
            });
            container.appendChild(btn);
        });
    }

    _showOnPageProgress(container) {
        while (container.firstChild) container.removeChild(container.firstChild);

        const status = document.createElement('span');
        status.className = 'gpt-qr-inline-status';
        status.style.cssText = 'font-size:11px; color:#a78bfa; font-weight:600;';
        status.textContent = 'Starting...';
        container.appendChild(status);

        const stopBtn = document.createElement('button');
        stopBtn.type = 'button';
        stopBtn.textContent = 'Stop';
        stopBtn.style.cssText = 'padding:2px 8px; font-size:11px; font-weight:600; border-radius:9999px; border:none; cursor:pointer; background:rgba(244,33,46,0.2); color:#f4212e; margin-left:6px;';
        stopBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.stopQualityRepeat();
        });
        container.appendChild(stopBtn);

        // Update the inline status on an interval
        const interval = setInterval(() => {
            if (!this.qualityRepeatRunning) {
                clearInterval(interval);
                this._buildQuickButtons(container);
                return;
            }
            status.textContent = this.qualityRepeatCompleted + '/' + this.qualityRepeatTotal + '...';
        }, 500);
    }

    updateOnPageButtons(running) {
        const container = document.querySelector('.gpt-quality-repeat-inline');
        if (!container) return;
        if (!running) this._buildQuickButtons(container);
    }
```

- [ ] **Step 2: Add MutationObserver to detect "Generate More" button**

In the `VideoRetryManager` constructor, after the `this.startObserver();` call (line 1385), add:

```js
        // Watch for "Generate More" button appearing on the page
        this.generateMoreObserver = new MutationObserver(() => {
            const btn = this.findGenerateMoreButton();
            if (btn && !btn.parentElement.querySelector('.gpt-quality-repeat-inline')) {
                this.injectQuickRepeatButtons(btn);
            }
        });
        this.generateMoreObserver.observe(document.body, { childList: true, subtree: true });
```

- [ ] **Step 3: Syntax check**

Run: `node -c content.js`
Expected: No output (clean parse)

- [ ] **Step 4: Commit**

```bash
git add content.js
git commit -m "feat(ext): inject on-page quick repeat buttons next to Generate More"
```

---

### Task 5: Manual end-to-end test

**Files:** None (testing only)

- [ ] **Step 1: Reload extension and refresh Grok page**

1. Go to `chrome://extensions`, click reload on Grok Power Tools
2. Navigate to `grok.com/imagine`
3. Select Quality mode, enter a prompt, submit to generate initial 4 images

- [ ] **Step 2: Verify on-page buttons appear**

After the initial 4 images generate, the "Generate More" button should appear with `x2`, `x5`, `x10` buttons next to it.

- [ ] **Step 3: Test x2 from on-page**

Click `x2`. Verify:
- Progress text appears: `0/2...`, `1/2...`
- Stop button is visible
- After completion, `x2`/`x5`/`x10` buttons reappear
- 8 new images generated (12 total on page)

- [ ] **Step 4: Test from overlay**

Open Grok Power Tools overlay. In the Quality Repeat section:
- Set repeats to 3
- Click "Start Quality Repeat"
- Verify progress in overlay: `Generating: 4/12 images (1/3 repeats)`
- Click Stop mid-way and verify it stops cleanly

- [ ] **Step 5: Test edge case -- navigate away**

Start a x5 repeat, then navigate away from `/imagine`. Verify it stops with notification.

- [ ] **Step 6: Commit final working state**

```bash
git add content.js
git commit -m "feat(ext): Quality Repeat -- auto-generate batches of Quality images"
```
