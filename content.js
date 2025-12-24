// Grok Power Tools - Content Script

// 1. RAW IMAGE MODE (New Tab)
if (window.location.hostname === 'imagine-public.x.ai') {
    (async () => {
        console.log('Raw Image Mode Detected');
        await new Promise(r => setTimeout(r, 500));
        const img = document.querySelector('img');
        if (img && img.src) {
            chrome.runtime.sendMessage({
                action: 'DOWNLOAD_MEDIA',
                url: img.src,
                date: new Date().toISOString().split('T')[0],
                postId: 'raw_image_' + Date.now(),
                ext: 'png'
            });
            setTimeout(() => { chrome.runtime.sendMessage({ action: 'CLOSE_TAB' }); }, 1000);
        }
    })();
} else {

    // --- CONFIGURATION ---
    const Config = {
        actionWait: 2000,
        navWait: 2000,
        colors: {
            success: '#00ba7c',
            warning: '#ffd400',
            error: '#f4212e',
            neutral: '#71767b'
        }
    };

    // --- UI OVERLAY CLASS ---
    class GrokOverlay {
        constructor(scraper, retryManager) {
            this.scraper = scraper;
            this.retryManager = retryManager;
            this.state = {
                minimized: false,
                position: { bottom: '20px', right: '20px', top: 'auto', left: 'auto' }
            };
            this.render();
            this.setupListeners();
            this.restoreState();
        }

        async restoreState() {
            const stored = await chrome.storage.local.get(['overlayState']);
            if (stored.overlayState) {
                this.state = { ...this.state, ...stored.overlayState };
                this.updatePosition();
                if (this.state.minimized) this.minimize(true);
            }
            this.loadPrompts();
        }

        saveState() {
            chrome.storage.local.set({ overlayState: this.state });
        }

        render() {
            const container = document.createElement('div');
            container.id = 'grok-powertools-overlay';
            container.innerHTML = `
                <div class="gpt-minimized-icon">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 3L11 3V11L3 11V13L11 13V21L13 21V13H21V11H13V3Z" /></svg>
                </div>
                
                <div class="gpt-header" id="gptHeader">
                    <div class="gpt-title">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14z"/></svg>
                        Grok Power Tools
                    </div>
                    <div class="gpt-controls">
                        <button class="gpt-btn-icon" id="gptMinBtn" title="Minimize">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                        </button>
                    </div>
                </div>

                <div class="gpt-content">
                    <!-- Status Section -->
                    <div class="gpt-section">
                        <div class="gpt-row">
                            <span style="font-size:12px; font-weight:600; color:#e7e9ea">STATUS</span>
                            <span id="gptStatusBadge" class="gpt-badge gpt-badge-success">Ready</span>
                        </div>
                    </div>

                    <!-- Auto Retry Section -->
                    <div class="gpt-section">
                         <div class="gpt-row">
                            <div class="gpt-label-help">
                                <h3>Auto-Retry & Goals</h3>
                                <div class="gpt-help-icon">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                                    <div class="gpt-tooltip">Manage automated video generation and retries.</div>
                                </div>
                            </div>
                         </div>
                        <div class="gpt-row">
                            <span>Auto-Retry Moderated</span>
                            <label class="gpt-toggle-switch">
                                <input type="checkbox" id="gptRetryToggle">
                                <span class="gpt-slider"></span>
                            </label>
                        </div>
                        <div class="gpt-row" style="margin-top:8px">
                            <span>Max Retries</span>
                            <input type="number" id="gptMaxRetries" class="gpt-input" value="3" min="1" max="50">
                        </div>
                         <div class="gpt-row" style="margin-top:8px">
                            <div class="gpt-label-help">
                                <span>Cooldown (sec)</span>
                                <div class="gpt-help-icon">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                                    <div class="gpt-tooltip">Seconds to wait between retries or sequential generations.</div>
                                </div>
                            </div>
                            <input type="number" id="gptCooldown" class="gpt-input" value="8" min="2" max="60">
                        </div>
                        <div class="gpt-row" style="margin-top:8px">
                            <div class="gpt-label-help">
                                <span>Goal (Videos)</span>
                                <div class="gpt-help-icon">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                                    <div class="gpt-tooltip">Target number of videos to generate automatically.</div>
                                </div>
                            </div>
                            <input type="number" id="gptVideoGoal" class="gpt-input" value="1" min="1" max="100">
                        </div>
                        <div class="gpt-row" style="margin-top:12px">
                            <button id="gptStartGoalBtn" class="gpt-btn gpt-btn-primary">Start Video Goal</button>
                        </div>
                    </div>

                    <!-- Prompt Manager -->
                    <div class="gpt-section">
                        <div class="gpt-row">
                            <div class="gpt-label-help">
                                <h3>Saved Prompts</h3>
                                <div class="gpt-help-icon">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                                    <div class="gpt-tooltip">Save, Import (JSON), or Export your prompts. Right-click a tag to delete.</div>
                                </div>
                            </div>
                            <div style="display:flex; gap:4px">
                                <button class="gpt-btn-icon" id="gptImportBtn" title="Import JSON">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                                </button>
                                <button class="gpt-btn-icon" id="gptExportBtn" title="Export JSON">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                                </button>
                                <button class="gpt-btn-icon" id="gptAddPromptBtn" title="Save Current Prompt">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                                </button>
                            </div>
                        </div>
                        <div class="gpt-prompt-list" id="gptPromptList">
                            <!-- Prompts injected here -->
                            <div style="font-size:11px; color:#71767b; width:100%; text-align:center; padding:8px;">No saved prompts</div>
                        </div>
                         <!-- Hidden input for file upload -->
                        <input type="file" id="gptImportFile" accept=".json" style="display:none;" />
                    </div>
                    
                    <div class="gpt-section">
                         <h3>Scraper Control</h3>
                          <div class="gpt-row">
                            <button id="gptStartScrapeBtn" class="gpt-btn gpt-btn-primary" style="margin-right:5px">Start Scraper</button>
                            <button id="gptStopScrapeBtn" class="gpt-btn" style="background:#f4212e33; color:#f4212e;">Stop</button>
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(container);
            this.el = container;
        }

        setupListeners() {
            // Drag Logic
            const header = this.el.querySelector('#gptHeader');
            let isDragging = false;
            let currentX;
            let currentY;
            let initialX;
            let initialY;
            let xOffset = 0;
            let yOffset = 0;

            const dragStart = (e) => {
                if (e.target.closest('.gpt-controls')) return;
                initialX = e.clientX - xOffset;
                initialY = e.clientY - yOffset;
                if (e.target === header || header.contains(e.target)) {
                    isDragging = true;
                }
            };

            const dragEnd = () => {
                initialX = currentX;
                initialY = currentY;
                isDragging = false;
            };

            const drag = (e) => {
                if (isDragging) {
                    e.preventDefault();
                    currentX = e.clientX - initialX;
                    currentY = e.clientY - initialY;
                    xOffset = currentX;
                    yOffset = currentY;
                    this.el.style.transform = `translate3d(${currentX}px, ${currentY}px, 0)`;
                }
            };

            header.addEventListener('mousedown', dragStart);
            document.addEventListener('mouseup', dragEnd);
            document.addEventListener('mousemove', drag);

            // Min/Max Logic - FIXED propagation
            this.el.querySelector('#gptMinBtn').addEventListener('click', (e) => {
                e.stopPropagation();
                this.minimize(true);
            });

            this.el.addEventListener('click', (e) => {
                if (this.state.minimized && !isDragging) {
                    e.stopPropagation();
                    this.minimize(false);
                }
            });

            // Settings Logic
            const retryToggle = this.el.querySelector('#gptRetryToggle');
            const maxRetries = this.el.querySelector('#gptMaxRetries');
            const cooldown = this.el.querySelector('#gptCooldown');

            retryToggle.addEventListener('change', (e) => {
                this.retryManager.setEnabled(e.target.checked);
            });

            maxRetries.addEventListener('change', (e) => {
                this.retryManager.setMaxRetries(parseInt(e.target.value, 10));
            });

            cooldown.addEventListener('change', (e) => {
                const val = parseInt(e.target.value, 10);
                this.retryManager.setCooldown(val * 1000);
            });

            // Prompt Logic
            this.el.querySelector('#gptAddPromptBtn').addEventListener('click', () => this.saveCurrentPrompt());

            // Export
            this.el.querySelector('#gptExportBtn').addEventListener('click', async () => {
                const stored = await chrome.storage.local.get(['savedPrompts']);
                const data = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(stored.savedPrompts || []));
                const dlNode = document.createElement('a');
                dlNode.setAttribute("href", data);
                dlNode.setAttribute("download", "grok_prompts.json");
                document.body.appendChild(dlNode); // required for firefox
                dlNode.click();
                dlNode.remove();
            });

            // Import
            const fileInput = this.el.querySelector('#gptImportFile');
            this.el.querySelector('#gptImportBtn').addEventListener('click', () => fileInput.click());
            fileInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = async (e) => {
                    try {
                        const newPrompts = JSON.parse(e.target.result);
                        if (Array.isArray(newPrompts)) {
                            const stored = await chrome.storage.local.get(['savedPrompts']);
                            const existing = stored.savedPrompts || [];
                            const merged = [...existing, ...newPrompts];
                            await chrome.storage.local.set({ savedPrompts: merged });
                            this.renderPromptList(merged);
                            this.setStatus('Prompts Imported', 'success');
                        }
                    } catch (err) {
                        this.setStatus('Import Failed', 'error');
                        console.error(err);
                    }
                };
                reader.readAsText(file);
            });

            // Goal Logic
            this.el.querySelector('#gptStartGoalBtn').addEventListener('click', () => {
                const count = parseInt(this.el.querySelector('#gptVideoGoal').value, 10);
                this.retryManager.startGoal(count);
            });

            // Scraper Logic
            this.el.querySelector('#gptStartScrapeBtn').addEventListener('click', () => this.scraper.start());
            this.el.querySelector('#gptStopScrapeBtn').addEventListener('click', () => this.scraper.stop());
        }

        minimize(isMin) {
            this.state.minimized = isMin;
            if (isMin) {
                this.el.classList.add('minimized');
                this.el.style.transform = 'none'; // Reset transform when minimized to dock
            } else {
                this.el.classList.remove('minimized');
            }
            this.saveState();
        }

        updatePosition() {
            // Basic position restore logic could go here
        }

        setStatus(text, type = 'neutral') {
            const badge = this.el.querySelector('#gptStatusBadge');
            badge.textContent = text;
            badge.className = `gpt-badge gpt-badge-${type}`;
        }

        async loadPrompts() {
            const stored = await chrome.storage.local.get(['savedPrompts']);
            const prompts = stored.savedPrompts || [];
            this.renderPromptList(prompts);
        }

        renderPromptList(prompts) {
            const list = this.el.querySelector('#gptPromptList');
            list.innerHTML = '';
            if (prompts.length === 0) {
                list.innerHTML = '<div style="font-size:11px; color:#71767b; width:100%; text-align:center; padding:8px;">No saved prompts</div>';
                return;
            }

            prompts.forEach((p, idx) => {
                const tag = document.createElement('div');
                tag.className = 'gpt-prompt-tag';
                tag.textContent = p.name || p.text.substring(0, 15) + '...';
                tag.title = p.text;
                tag.onclick = () => {
                    this.injectPrompt(p.text);
                };
                // Right click to delete
                tag.oncontextmenu = (e) => {
                    e.preventDefault();
                    if (confirm('Delete prompt?')) {
                        prompts.splice(idx, 1);
                        chrome.storage.local.set({ savedPrompts: prompts });
                        this.renderPromptList(prompts);
                    }
                };
                list.appendChild(tag);
            });
        }

        async saveCurrentPrompt() {
            const textarea = document.querySelector('textarea');
            if (!textarea || !textarea.value.trim()) {
                alert('No text in prompt box!');
                return;
            }
            const text = textarea.value.trim();
            const name = prompt('Name this prompt:', text.substring(0, 10));
            if (name) {
                const stored = await chrome.storage.local.get(['savedPrompts']);
                const prompts = stored.savedPrompts || [];
                prompts.push({ name, text });
                await chrome.storage.local.set({ savedPrompts: prompts });
                this.renderPromptList(prompts);
            }
        }

        injectPrompt(text) {
            const textarea = document.querySelector('textarea');
            if (textarea) {
                const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
                nativeInputValueSetter.call(textarea, text);
                textarea.dispatchEvent(new Event('input', { bubbles: true }));
                textarea.focus();
            }
        }
    }


    // --- ENHANCED VIDEO RETRY MANAGER ---
    class VideoRetryManager {
        constructor(overlay) {
            this.overlay = overlay; // Circular dependency handled by init assignment elsewhere if needed, or pass null first
            this.MODERATION_TEXT = 'Content Moderated. Try a different idea.';
            this.BUTTON_SELECTOR = 'button[aria-label="Make video"]';
            this.CLICK_COOLDOWN = 8000;

            this.enabled = false;
            this.maxRetries = 3;
            this.currentRetry = 0;
            this.lastClickTime = 0;

            this.goalRunning = false;
            this.goalTotal = 0;
            this.goalCount = 0;

            this.init();
        }

        setOverlay(overlay) {
            this.overlay = overlay;
        }

        async init() {
            const stored = await chrome.storage.local.get(['autoRetryEnabled', 'retryMaxCount', 'retryCooldown']);
            this.enabled = stored.autoRetryEnabled || false;
            this.maxRetries = stored.retryMaxCount || 3;
            if (stored.retryCooldown) this.CLICK_COOLDOWN = stored.retryCooldown;

            if (this.overlay) {
                // Sync UI
                document.getElementById('gptRetryToggle').checked = this.enabled;
                document.getElementById('gptMaxRetries').value = this.maxRetries;
                document.getElementById('gptCooldown').value = this.CLICK_COOLDOWN / 1000;
            }

            this.startObserver();
            setInterval(() => this.checkAndAct(), 1000);
        }

        setEnabled(val) {
            this.enabled = val;
            chrome.storage.local.set({ autoRetryEnabled: val });
        }

        setMaxRetries(val) {
            this.maxRetries = val;
            chrome.storage.local.set({ retryMaxCount: val });
        }

        setCooldown(ms) {
            this.CLICK_COOLDOWN = ms;
            chrome.storage.local.set({ retryCooldown: ms });
        }

        startGoal(count) {
            this.goalRunning = true;
            this.goalTotal = count;
            this.goalCount = 0;
            this.overlay.setStatus(`Goal: 0/${count}`, 'warning');
            this.clickMakeVideo();
        }

        startObserver() {
            const observer = new MutationObserver(() => {
                this.checkAndAct();
            });
            observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        }

        checkAndAct() {
            // 1. Check Moderation & Auto Retry
            if (this.enabled && document.body.textContent.includes(this.MODERATION_TEXT)) {
                this.attemptRetry();
            }

            // 2. Check Goal Progress
            // If we see "Make video" button appear again, it implies previous one finished or failed differently
            if (this.goalRunning) {
                const btn = document.querySelector(this.BUTTON_SELECTOR);
                if (btn && !btn.disabled && (Date.now() - this.lastClickTime > this.CLICK_COOLDOWN)) {
                    // Ready for next video
                    if (this.goalCount < this.goalTotal) {
                        this.goalCount++;
                        this.overlay.setStatus(`Goal: ${this.goalCount}/${this.goalTotal}`, 'warning');
                        this.clickMakeVideo();
                    } else {
                        this.goalRunning = false;
                        this.overlay.setStatus('Goal Complete!', 'success');
                    }
                }
            }
        }

        attemptRetry() {
            if (Date.now() - this.lastClickTime < this.CLICK_COOLDOWN) return;
            if (this.currentRetry >= this.maxRetries) {
                this.overlay.setStatus('Max Retries Hit', 'error');
                return;
            }

            this.currentRetry++;
            this.overlay.setStatus(`Retrying (${this.currentRetry}/${this.maxRetries})`, 'warning');
            this.clickMakeVideo();
        }

        clickMakeVideo() {
            const btn = document.querySelector(this.BUTTON_SELECTOR);
            if (btn) {
                this.lastClickTime = Date.now();
                btn.click();
            }
        }
    }


    // --- SCRAPER (Refactored to integrate) ---
    class GrokScraper {
        constructor() {
            this.overlay = null;
            this.processedIds = new Set();
            this.state = {
                isRunning: false,
                currentIndex: 0,
                mode: 'IDLE'
            };
            this.init();
        }

        setOverlay(overlay) { this.overlay = overlay; }

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
                if (request.action === 'INIT_SCRAPE') { // From popup
                    this.start();
                    sendResponse({ status: 'started' });
                } else if (request.action === 'ABORT_SCRAPE') { // From popup
                    this.stop();
                    sendResponse({ status: 'stopped' });
                }
            });
        }

        getCleanId(url) {
            if (!url) return null;
            try {
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
            this.log('Scraping stopped.', 'neutral');
            this.state.isRunning = false;
        }

        async determineModeAndExecute() {
            if (!this.state.isRunning) return;

            // --- USER IDENTIFICATION LOGIC ---
            try {
                const pfpImg = document.querySelector('img[alt="pfp"]');
                if (pfpImg && pfpImg.src) {
                    const parts = pfpImg.src.split('users/');
                    if (parts.length > 1) {
                        const subParts = parts[1].split('/');
                        const userId = subParts[0];
                        if (userId && userId.length > 5) {
                            chrome.storage.local.get(['activeGrokUserId'], (res) => {
                                if (res.activeGrokUserId !== userId) {
                                    chrome.storage.local.set({ activeGrokUserId: userId });
                                }
                            });
                        }
                    }
                }
            } catch (e) { }
            // ---------------------------------

            await this.sleep(1000);
            window.scrollBy(0, 10);
            await this.sleep(500);
            window.scrollBy(0, -10);
            await this.sleep(Config.navWait);

            const isMainFeed = window.location.href.match(/\/imagine\/?$/);
            const shouldBeInFavorites = this.state.isRunning && isMainFeed;

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
                        this.log('Navigating to Favorites...');
                        favButton.click();
                        await this.sleep(3000);
                        return;
                    }
                }
            }

            const downloadBtn = document.querySelector('[aria-label="Download"], .lucide-download');

            if (downloadBtn) {
                this.state.mode = 'DETAIL';
                this.executeDetailView();
            } else {
                this.state.mode = 'LIST';
                this.executeListView();
            }
        }

        async executeListView() {
            if (!this.state.isRunning) return;

            if (window.location.href.match(/\/imagine\/?$/)) {
                return;
            }

            const cardSelector = 'img[alt="Generated image"], [role="listitem"] img';
            let retries = 0;
            const MAX_RETRIES = 50;

            await this.sleep(1000);

            while (this.state.isRunning && retries < MAX_RETRIES) {
                const items = Array.from(document.querySelectorAll(cardSelector));
                const uniqueItems = items.filter((img, index, self) =>
                    index === self.findIndex((t) => t === img) && img.naturalWidth > 50
                );

                if (retries % 5 === 0) {
                    this.log(`Scanning... (${uniqueItems.length} items)`);
                }

                // Visual Sort
                let visualItems = uniqueItems.map(img => {
                    const container = img.closest('[role="listitem"]');
                    let top = 999999, left = 999999;
                    if (container) {
                        const rect = container.getBoundingClientRect();
                        top = rect.top + window.scrollY;
                        left = rect.left + window.scrollX;
                    } else {
                        const rect = img.getBoundingClientRect();
                        top = rect.top + window.scrollY;
                        left = rect.left + window.scrollX;
                    }
                    return { element: img, top: top, left: left, src: img.src };
                });

                visualItems.sort((a, b) => {
                    if (Math.abs(a.top - b.top) > 20) return a.top - b.top;
                    return a.left - b.left;
                });

                // Find Target
                for (let i = 0; i < visualItems.length; i++) {
                    const itemObj = visualItems[i];
                    const cleanId = this.getCleanId(itemObj.src);

                    if (cleanId && !this.processedIds.has(cleanId)) {
                        this.log(`Processing: ...${cleanId.slice(-6)}`, 'success');
                        await this.processItem(itemObj.element, cleanId);
                        return;
                    }
                }

                console.log('No new items visible. Scrolling...');
                const scroller = document.querySelector('.overflow-scroll') || document.querySelector('[role="list"]')?.parentElement || window;
                scroller.scrollBy(0, window.innerHeight);
                await this.sleep(1000);
                if (!this.state.isRunning) return;
                retries++;
            }

            if (retries >= MAX_RETRIES) {
                if (!this.state.isRunning) return;
                this.log('Stopped: End of feed.', 'warning');
                this.stop();
            }
        }

        async processItem(targetItem, cleanId) {
            targetItem.style.border = "4px solid blue";
            if (cleanId) {
                await chrome.storage.local.set({ currentItemId: cleanId });
            }
            targetItem.click();
            await this.sleep(Config.navWait);
            this.determineModeAndExecute();
        }

        async executeDetailView() {
            if (!this.state.isRunning) return;

            const storedState = await chrome.storage.local.get(['currentItemId']);
            let currentId = storedState.currentItemId;

            if (!currentId) {
                const mediaEl = document.querySelector('img[alt="Generated image"]') || document.querySelector('video') || document.querySelector('img.shrinkToFit');
                if (mediaEl) {
                    const src = mediaEl.src || (mediaEl.querySelector('source') ? mediaEl.querySelector('source').src : null);
                    currentId = this.getCleanId(src);
                }
            }

            if (currentId) {
                this.processedIds.add(currentId);
                await chrome.storage.local.set({ processedIds: Array.from(this.processedIds) });
            }

            // Click Download
            let downloadBtn = null;
            const start = Date.now();
            while (!downloadBtn && Date.now() - start < 5000) {
                if (!this.state.isRunning) return;
                downloadBtn = document.querySelector('button[aria-label="Download"]') || document.querySelector('.lucide-download');
                if (!downloadBtn) await this.sleep(500);
            }

            if (downloadBtn) {
                this.log(`Downloading...`, 'success');
                let targetToClick = downloadBtn;
                if (['svg', 'path', 'line'].includes(downloadBtn.tagName.toLowerCase())) {
                    const parentBtn = downloadBtn.closest('button');
                    if (parentBtn) targetToClick = parentBtn;
                }
                this.robustClick(targetToClick);
                await this.sleep(Config.actionWait);
            } else {
                this.log('Download missing. Skipping...', 'error');
            }

            if (!this.state.isRunning) return;

            // Back
            const backBtn = await this.waitForSelector('[aria-label="Back"], .lucide-arrow-left', 5000);
            if (backBtn) {
                backBtn.click();
                await this.sleep(Config.navWait);
                this.determineModeAndExecute();
            } else {
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

        sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

        log(msg, type = 'neutral') {
            chrome.runtime.sendMessage({ action: 'ADD_LOG', text: msg, type: type });
            if (this.overlay) {
                this.overlay.setStatus(msg, type);
            }
        }
    }

    // --- INITIALIZATION ---
    const scraper = new GrokScraper();
    const retryManager = new VideoRetryManager(null);
    const overlay = new GrokOverlay(scraper, retryManager);

    // Wire dependencies
    retryManager.setOverlay(overlay);
    scraper.setOverlay(overlay);
}
