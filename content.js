// Grok Media Downloader Content Script - Navigation & Raw Image Handling

// 1. RAW IMAGE MODE (New Tab)
if (window.location.hostname === 'imagine-public.x.ai') {
    (async () => {
        console.log('Raw Image Mode Detected');
        // Wait a moment for load
        await new Promise(r => setTimeout(r, 500));

        const img = document.querySelector('img');
        if (img && img.src) {
            console.log('Downloading Raw Image:', img.src);

            chrome.runtime.sendMessage({
                action: 'DOWNLOAD_MEDIA',
                url: img.src,
                date: new Date().toISOString().split('T')[0],
                postId: 'raw_image_' + Date.now(),
                ext: 'png'
            });

            // Close tab after short delay
            setTimeout(() => {
                chrome.runtime.sendMessage({ action: 'CLOSE_TAB' });
            }, 1000);
        }
    })();
} else {
    // 2. MAIN SCRAPER MODE (Grok App)
    class GrokScraper {
        constructor() {
            console.log('GrokScraper Constructor Called');
            this.processedIds = new Set();
            this.state = {
                isRunning: false,
                currentIndex: 0,
                mode: 'IDLE'
            };

            this.init();
        }

        async init() {
            const stored = await chrome.storage.local.get(['scraperState', 'currentIndex', 'processedIds']);

            if (stored.processedIds) {
                this.processedIds = new Set(stored.processedIds);
                console.log(`Loaded ${this.processedIds.size} processed items.`);
            }

            this.state.isRunning = stored.scraperState === 'running';
            this.state.currentIndex = stored.currentIndex || 0;

            if (this.state.isRunning) {
                console.log(`Resuming Scraper. Index: ${this.state.currentIndex}`);
                this.determineModeAndExecute();
            }

            this.setupListeners();
        }

        setupListeners() {
            chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
                if (request.action === 'INIT_SCRAPE') {
                    this.start();
                    sendResponse({ status: 'started' });
                } else if (request.action === 'ABORT_SCRAPE') {
                    this.stop();
                    sendResponse({ status: 'stopped' });
                }
            });
        }

        getCleanId(url) {
            if (!url) return null;
            try {
                // Strip query parameters to match IDs cleanly
                return url.split('?')[0];
            } catch (e) {
                return url;
            }
        }

        async start() {
            console.log('Starting scrape run...');
            this.log('Scraping initialized.', 'success');

            await chrome.storage.local.set({
                scraperState: 'running',
                currentIndex: 0
            });

            this.state.isRunning = true;
            this.state.currentIndex = 0;
            this.determineModeAndExecute();
        }

        async stop() {
            console.log('Stopping scrape run.');
            await chrome.storage.local.set({ scraperState: 'idle' });
            this.log('Scraping stopped.');
            this.state.isRunning = false;
        }

        async determineModeAndExecute() {
            if (!this.state.isRunning) return;

            await this.sleep(1000);
            window.scrollBy(0, 10);
            await this.sleep(500);
            window.scrollBy(0, -10);
            await this.sleep(Config.navWait);

            // 0. Auto-Navigate to Favorites Logic
            // Guard: If we drifted to main feed (/imagine without /favorites) while running, force back.
            const isMainFeed = window.location.href.match(/\/imagine\/?$/);
            const shouldBeInFavorites = this.state.isRunning && isMainFeed && this.processedIds.size > 0;

            if ((this.state.mode === 'IDLE' && this.processedIds.size === 0) || shouldBeInFavorites) {
                const favButton = document.querySelector('img[alt="219e8040-acaa-435e-ba7f-14702e307a32"]')
                    || document.querySelector('img.border-white.rounded-xl')
                    || Array.from(document.querySelectorAll('a, button, [role="button"]')).find(el => {
                        const label = (el.ariaLabel || el.textContent || "").toLowerCase();
                        return (label.includes('favorite') || label.includes('gallery') || label.includes('saved')) && !label.includes('tweet');
                    });

                if (favButton) {
                    if (favButton.classList.contains('border-white') && favButton.classList.contains('border-2') && !shouldBeInFavorites) {
                        console.log('Favorites seems selected already.');
                    } else {
                        console.log('Navigating to Favorites (Auto or Drift Correction)...');
                        this.log('Navigating to Favorites...');
                        favButton.click();
                        await this.sleep(3000);
                    }
                }
            }

            const downloadBtn = document.querySelector('[aria-label="Download"], .lucide-download');

            if (downloadBtn) {
                console.log('Detected Mode: DETAIL_VIEW');
                this.state.mode = 'DETAIL';
                this.executeDetailView();
            } else {
                console.log('Detected Mode: LIST_VIEW');
                this.state.mode = 'LIST';
                this.executeListView();
            }
        }

        async executeListView() {
            if (!this.state.isRunning) return;
            const cardSelector = 'img[alt="Generated image"]';
            let retries = 0;

            await this.sleep(1000);

            while (this.state.isRunning && retries < 20) {
                const items = Array.from(document.querySelectorAll(cardSelector));
                console.log(`Scanning ${items.length} items for new content...`);

                // 1. Map to objects with visual coordinates (Fix for Masonry Layout)
                let visualItems = items.map(img => {
                    const container = img.closest('[role="listitem"]');
                    let top = 999999;
                    let left = 999999;

                    if (container) {
                        const styleTop = container.style.top ? parseInt(container.style.top, 10) : null;
                        const styleLeft = container.style.left ? parseInt(container.style.left, 10) : null;

                        if (styleTop !== null && !isNaN(styleTop)) top = styleTop;
                        else top = container.getBoundingClientRect().top + window.scrollY;

                        if (styleLeft !== null && !isNaN(styleLeft)) left = styleLeft;
                        else left = container.getBoundingClientRect().left + window.scrollX;
                    } else {
                        const rect = img.getBoundingClientRect();
                        top = rect.top + window.scrollY;
                        left = rect.left + window.scrollX;
                    }
                    return { element: img, top: top, left: left, src: img.src };
                });

                // 2. Sort by Visual Position: Top-Down, then Left-Right
                visualItems.sort((a, b) => {
                    if (Math.abs(a.top - b.top) > 20) {
                        return a.top - b.top;
                    }
                    return a.left - b.left;
                });

                // 3. Find First Unprocessed Sorted Item
                let targetItem = null;

                for (let i = 0; i < visualItems.length; i++) {
                    const itemObj = visualItems[i];
                    const cleanId = this.getCleanId(itemObj.src);

                    if (cleanId && !this.processedIds.has(cleanId)) {
                        targetItem = itemObj.element;
                        console.log(`Found unprocessed item at visual index ${i} (Top: ${itemObj.top}, Left: ${itemObj.left})`);

                        // Pass this ID to the processItem function
                        await this.processItem(targetItem, cleanId);
                        return; // ACTION TAKEN -> Break loop
                    }
                }

                console.log('No new items visible. Scrolling...');

                // TARGETED SCROLL for Favorites Container
                const scroller = document.querySelector('.overflow-scroll')
                    || document.querySelector('[role="list"]')?.parentElement
                    || window;

                scroller.scrollBy(0, window.innerHeight);
                await this.sleep(1000); // Reduced from 2000
                retries++;
            }

            if (retries >= 50) {
                this.log('End of list reached or stuck (Max Retries).', 'warning');
                this.stop();
            }
        }

        async processItem(targetItem, cleanId) {
            targetItem.style.border = "4px solid blue";
            this.log(`Opening item...`);

            // CRITICAL: SAVE ID SO DETAIL VIEW KNOWS WHAT IT IS
            if (cleanId) {
                await chrome.storage.local.set({ currentItemId: cleanId });
            }

            targetItem.click();
            await this.sleep(Config.navWait);
            this.determineModeAndExecute();
        }

        async executeDetailView() {
            if (!this.state.isRunning) return;

            // 1. DEDUPLICATION TRACKING (Robust)
            // Retrieve ID passed from List View
            const storedState = await chrome.storage.local.get(['currentItemId']);
            let currentId = storedState.currentItemId;

            // Fallback: Try DOM scraping if logic failed
            if (!currentId) {
                const mediaEl = document.querySelector('img[alt="Generated image"]') || document.querySelector('video') || document.querySelector('img.shrinkToFit');
                if (mediaEl) {
                    const src = mediaEl.src || (mediaEl.querySelector('source') ? mediaEl.querySelector('source').src : null);
                    currentId = this.getCleanId(src);
                }
            }

            if (currentId) {
                console.log('Marking as processed:', currentId);
                this.processedIds.add(currentId);
                await chrome.storage.local.set({ processedIds: Array.from(this.processedIds) });
            } else {
                this.log('Warning: Could not identify item ID. Loop risk.', 'warning');
            }

            // 2. CLICK DOWNLOAD BUTTON
            let downloadBtn = null;
            const start = Date.now();

            while (!downloadBtn && Date.now() - start < 5000) {
                if (!this.state.isRunning) return;
                downloadBtn = document.querySelector('button[aria-label="Download"]')
                    || document.querySelector('.lucide-download')
                    || document.querySelector('[role="button"][aria-label="Download"]');
                if (!downloadBtn) await this.sleep(500);
            }

            if (downloadBtn) {
                this.log(`Clicking Download...`, 'success');

                let targetToClick = downloadBtn;
                if (['svg', 'path', 'line'].includes(downloadBtn.tagName.toLowerCase())) {
                    const parentBtn = downloadBtn.closest('button');
                    if (parentBtn) targetToClick = parentBtn;
                }

                this.robustClick(targetToClick);

                await this.sleep(Config.actionWait);
            } else {
                this.log('Download button missing. Skipping...', 'error');
            }

            if (!this.state.isRunning) return;

            // 3. BACK BUTTON
            const backBtn = await this.waitForSelector('[aria-label="Back"], .lucide-arrow-left', 5000);

            if (backBtn) {
                backBtn.click();
                await this.sleep(Config.navWait);
                this.determineModeAndExecute();
            } else {
                console.error('Back button not found!');
                this.stop();
            }
        }

        async waitForSelector(selector, timeout = 5000) {
            const start = Date.now();
            while (Date.now() - start < timeout) {
                const el = document.querySelector(selector);
                if (el) return el;
                await this.sleep(500);
            }
            return null;
        }

        robustClick(element) {
            ['mousedown', 'click', 'mouseup'].forEach(eventType => {
                const event = new MouseEvent(eventType, {
                    bubbles: true,
                    cancelable: true,
                    view: window
                });
                element.dispatchEvent(event);
            });
        }

        sleep(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }

        log(msg, type = 'info') {
            chrome.runtime.sendMessage({ action: 'ADD_LOG', text: msg, type: type });
        }
    }

    const Config = {
        actionWait: 2000,
        navWait: 2000     // Increased to 2000 (1s was too fast causing drift)
    };

    // ----------------------------------------------------
    // Video Retry Manager (Auto-Retry for Moderation)
    // ----------------------------------------------------
    class VideoRetryManager {
        constructor() {
            this.MODERATION_TEXT = 'Content Moderated. Try a different idea.';
            this.BUTTON_SELECTOR = 'button[aria-label="Make video"]';
            this.CLICK_COOLDOWN = 8000;

            this.enabled = false;
            this.maxRetries = 3;
            this.retryCount = 0;
            this.lastClickTime = 0;
            this.currentUrl = window.location.href;

            this.init();
        }

        async init() {
            // Load settings
            const stored = await chrome.storage.local.get(['autoRetryEnabled', 'retryMaxCount']);
            this.enabled = stored.autoRetryEnabled || false;
            this.maxRetries = stored.retryMaxCount || 3;

            console.log(`VideoRetryManager: ${this.enabled ? 'Enabled' : 'Disabled'}, Max Retries: ${this.maxRetries}`);

            // Listen for settings changes
            chrome.storage.onChanged.addListener((changes, area) => {
                if (area === 'local') {
                    if (changes.autoRetryEnabled) {
                        this.enabled = changes.autoRetryEnabled.newValue;
                        console.log('VideoRetryManager: Enabled changed to', this.enabled);
                    }
                    if (changes.retryMaxCount) {
                        this.maxRetries = changes.retryMaxCount.newValue;
                        console.log('VideoRetryManager: Max Retries changed to', this.maxRetries);
                    }
                }
            });

            // Start Observing
            this.startObserver();

            // Watch for URL changes to reset counter
            setInterval(() => this.checkUrlChange(), 1000);

            // Backup Polling (Crucial if observer misses it)
            setInterval(() => this.checkAndAct(), 2000);
        }

        startObserver() {
            const observer = new MutationObserver(() => {
                this.checkAndAct();
            });
            observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        }

        checkUrlChange() {
            if (window.location.href !== this.currentUrl) {
                this.currentUrl = window.location.href;
                this.retryCount = 0; // Reset on new post
                // console.log('VideoRetryManager: URL changed, retry count reset.');
            }
        }

        checkAndAct() {
            if (!this.enabled) return;

            // Check for moderation text
            if (document.body.textContent.includes(this.MODERATION_TEXT)) {
                this.attemptRetry();
            }
        }

        attemptRetry() {
            const now = Date.now();
            if (now - this.lastClickTime < this.CLICK_COOLDOWN) return;

            if (this.retryCount >= this.maxRetries) {
                // console.log('VideoRetryManager: Max retries exhausted.');
                return;
            }

            const btn = document.querySelector(this.BUTTON_SELECTOR);
            if (btn) {
                this.retryCount++;
                this.lastClickTime = now;

                // Log to extension log
                chrome.runtime.sendMessage({
                    action: 'ADD_LOG',
                    text: `Auto-Retry Video (${this.retryCount}/${this.maxRetries})`,
                    type: 'warning'
                });

                console.log(`VideoRetryManager: Clicking 'Make video' (${this.retryCount}/${this.maxRetries})`);
                btn.click();
            } else {
                console.warn('VideoRetryManager: Moderation text found, but "Make video" button missing!');
                chrome.runtime.sendMessage({
                    action: 'ADD_LOG',
                    text: `Debug: Found error text, but missed Button!`,
                    type: 'error'
                });
            }
        }
    }


    new VideoRetryManager();
    new GrokScraper();
}
