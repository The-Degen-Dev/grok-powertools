// Grok Power Tools - Content Script

// --- CONFIGURATION DEFAULTS ---
const SettingsDefaults = {
    maxRetries: 3,
    videoGoal: 10,
    galleryBatchLimit: 10,
    autoRetryEnabled: true,
    retryCooldown: 8000,
    generationDelay: 8000,
    historyLimit: 50,
    devMode: false
};

// --- UTILS ---
class ToastManager {
    constructor() {
        this.container = document.createElement('div');
        this.container.id = 'gpt-toaster';
        document.body.appendChild(this.container);
    }

    show(msg, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `gpt-toast ${type}`;
        toast.textContent = msg;
        this.container.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
}

class LogViewer {
    constructor() {
        this.el = null;
        this.isMinimized = false;
        this.render();
        this.setupListeners();
    }

    render() {
        if (this.el) return;
        const div = document.createElement('div');
        div.id = 'gpt-logs-panel';
        div.innerHTML = `
            <div class="gpt-logs-header" id="gptLogsHeader">
                <span>System Logs</span>
                <div style="display:flex; gap:8px">
                    <button class="gpt-btn-icon" id="gptLogsMinBtn" title="Minimize/Maximize">_</button>
                    <button class="gpt-btn-icon" id="gptLogsClearBtn" title="Clear">Ø</button>
                    <button class="gpt-btn-icon" id="gptLogsCloseBtn" title="Close Logs">x</button>
                </div>
            </div>
            <div class="gpt-logs-content" id="gptLogsContent"></div>
        `;
        document.body.appendChild(div);
        this.el = div;
    }

    setupListeners() {
        const header = this.el.querySelector('#gptLogsHeader');
        let isDragging = false, startX, startY, initialLeft, initialTop;

        header.addEventListener('mousedown', (e) => {
            if (e.target.closest('button')) return;
            isDragging = true;
            startX = e.clientX; startY = e.clientY;
            const rect = this.el.getBoundingClientRect();
            initialLeft = rect.left; initialTop = rect.top;
        });
        this._onMouseMove = (e) => {
            if (!isDragging) return;
            this.el.style.left = `${initialLeft + (e.clientX - startX)}px`;
            this.el.style.top = `${initialTop + (e.clientY - startY)}px`;
            this.el.style.bottom = 'auto';
        };
        this._onMouseUp = () => isDragging = false;
        document.addEventListener('mousemove', this._onMouseMove);
        document.addEventListener('mouseup', this._onMouseUp);

        this.el.querySelector('#gptLogsMinBtn').addEventListener('click', () => {
            this.isMinimized = !this.isMinimized;
            this.el.classList.toggle('minimized', this.isMinimized);
        });
        this.el.querySelector('#gptLogsClearBtn').addEventListener('click', () => {
            this.el.querySelector('#gptLogsContent').innerHTML = '';
        });
        this.el.querySelector('#gptLogsCloseBtn').addEventListener('click', () => this.destroy());
    }

    addLog(msg, type = 'neutral') {
        if (!this.el) return;
        const container = this.el.querySelector('#gptLogsContent');
        const row = document.createElement('div');
        row.className = `gpt-log-entry ${type}`;
        const time = new Date().toLocaleTimeString().split(' ')[0];
        row.innerHTML = `<span class="gpt-log-timestamp">[${time}]</span> ${msg}`;
        container.insertBefore(row, container.firstChild);
        if (container.children.length > 100) container.removeChild(container.lastChild);
    }
    destroy() {
        if (this._onMouseMove) document.removeEventListener('mousemove', this._onMouseMove);
        if (this._onMouseUp) document.removeEventListener('mouseup', this._onMouseUp);
        if (this.el) { this.el.remove(); this.el = null; }
    }
}

class SettingsManager {
    constructor() {
        this.settings = { ...SettingsDefaults };
        this.listeners = new Set();
        this.init();
    }
    async init() {
        const stored = await chrome.storage.sync.get(['gptGlobalSettings']);
        if (stored.gptGlobalSettings) {
            this.settings = { ...this.settings, ...stored.gptGlobalSettings };
        }
        this.notify();
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'sync' && changes.gptGlobalSettings) {
                this.settings = { ...this.settings, ...changes.gptGlobalSettings.newValue };
                this.notify();
            }
        });
    }
    get(key) { return this.settings[key]; }
    set(key, value) { this.settings[key] = value; this.save(); this.notify(); }
    setAll(updates) { this.settings = { ...this.settings, ...updates }; this.save(); this.notify(); }
    save() { chrome.storage.sync.set({ gptGlobalSettings: this.settings }); }
    subscribe(cb) { this.listeners.add(cb); return () => this.listeners.delete(cb); }
    notify() { this.listeners.forEach(cb => cb(this.settings)); }
    export() { return JSON.stringify(this.settings, null, 2); }
    import(json) {
        try {
            const parsed = JSON.parse(json);
            // 1. Settings
            if (parsed.gptGlobalSettings || parsed.maxRetries) {
                // Handle both wrapped and flat formats
                const settingsUpdates = parsed.gptGlobalSettings || parsed;
                // Filter out non-settings keys if flat
                const cleanSettings = {};
                Object.keys(SettingsDefaults).forEach(k => {
                    if (settingsUpdates[k] !== undefined) cleanSettings[k] = settingsUpdates[k];
                });
                this.setAll(cleanSettings);
            }

            // 2. Processed IDs (History)
            if (parsed.processedIds && Array.isArray(parsed.processedIds)) {
                chrome.storage.local.get(['processedIds'], (res) => {
                    const existing = new Set(res.processedIds || []);
                    parsed.processedIds.forEach(id => existing.add(id));
                    chrome.storage.local.set({ processedIds: Array.from(existing) });
                    console.log(`Imported ${parsed.processedIds.length} IDs. Total: ${existing.size}`);
                });
            }
            return true;
        }
        catch (e) { console.error(e); return false; }
    }
    reset() { this.settings = { ...SettingsDefaults }; this.save(); this.notify(); }
}

class PromptHistoryManager {
    constructor(settingsManager) {
        this.settingsManager = settingsManager;
        this.history = [];
        this.listeners = new Set();
        this.init();
        this.setupCapture();
    }
    async init() {
        try {
            const stored = await chrome.storage.local.get(['promptHistory']);
            if (stored.promptHistory) { this.history = stored.promptHistory; this.notify(); }
        } catch (e) {
            console.warn('GPT: Extension context invalidated, cannot load history.');
        }
    }
    setupCapture() {
        // Use Capture Phase ({capture: true}) to intercept events BEFORE the app handles/clears them.

        // Clicks (Video or Submit)
        window.addEventListener('click', (e) => {
            // Video Button
            const btn = e.target.closest('button[aria-label="Make video"]');
            if (btn) {
                console.log('GPT: Make Video clicked');
                this.captureCurrentPrompt('video', btn);
            }

            // Image Submit Button
            const submitBtn = e.target.closest('button[aria-label="Submit"]');
            if (submitBtn) {
                console.log('GPT: Submit clicked');
                this.captureCurrentPrompt('image', submitBtn);
            }
        }, true); // <--- Capture Phase

        // Enter Key in Textarea
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                const ta = e.target.closest('textarea');
                if (ta) {
                    console.log('GPT: Enter pressed with len', ta.value.length);
                    this.captureCurrentPrompt('image', ta);
                }
            }
        }, true); // <--- Capture Phase
    }

    captureCurrentPrompt(type = 'image', triggerEl = null) {
        let text = '';
        const ta = document.querySelector('textarea[aria-required="true"]');
        const ce = document.querySelector('[contenteditable="true"]');

        // 1. Try Main Textarea first, then contenteditable
        if (ta && ta.value && ta.value.trim().length > 0) {
            text = ta.value.trim();
        } else if (ce && ce.textContent && ce.textContent.trim().length > 0) {
            text = ce.textContent.trim();
        }

        // 2. If 'video' and text is empty, try to find context from trigger element (Card)
        if (!text && type === 'video' && triggerEl) {
            // Heuristic: The button is usually in a card. Find parent container.
            // Look for closest article or div.group or just parents.
            let container = triggerEl.closest('article');
            if (!container) container = triggerEl.closest('div.group');
            if (!container) container = triggerEl.parentElement?.parentElement;

            if (container) {
                // Try Image Alt
                const img = container.querySelector('img');
                if (img && img.alt) {
                    text = img.alt.trim();
                    console.log('GPT: Found prompt from Image Alt:', text.substring(0, 20));
                } else {
                    // Try Paragraph text (for text-only cards?)
                    const p = container.querySelector('p');
                    if (p) text = p.innerText.trim();
                }
            }
        }

        if (text && text.length > 0) {
            this.add(text, type);
        } else {
            console.log(`GPT: Failed to capture ${type} prompt. Text empty.`);
        }
    }

    add(text, type = 'image') {
        // De-duplicate if same text AND type
        if (this.history.length > 0 && this.history[0].text === text && this.history[0].type === type) {
            this.history[0].timestamp = Date.now();
        } else {
            this.history.unshift({
                id: Date.now().toString(),
                text: text,
                type: type,
                timestamp: Date.now()
            });
        }
        const limit = this.settingsManager.get('historyLimit') || 50;
        if (this.history.length > limit) this.history = this.history.slice(0, limit);
        this.save();
    }
    save() {
        try {
            chrome.storage.local.set({ promptHistory: this.history });
        } catch (e) {
            console.warn('GPT: Extension context invalidated, cannot save history.');
        }
        this.notify();
    }
    clear() { this.history = []; this.save(); }
    subscribe(cb) { this.listeners.add(cb); return () => this.listeners.delete(cb); }
    notify() { this.listeners.forEach(cb => cb(this.history)); }
}

// --- MAIN OVERLAY ---

class GrokOverlay {
    constructor(scraper, retryManager, settingsManager, historyManager) {
        this.scraper = scraper;
        this.retryManager = retryManager;
        this.settingsManager = settingsManager;
        this.historyManager = historyManager;

        this.logViewer = null;
        this.toast = new ToastManager();
        this.state = { minimized: false, width: 380, height: null };

        if (typeof document !== 'undefined') {
            this.render();
            this.setupListeners();
            this.restoreState();
            this.settingsManager.subscribe(s => this.onSettingsChange(s));
            this.historyManager.subscribe(h => this.renderHistoryList(h));
        }
    }

    async restoreState() {
        const stored = await chrome.storage.local.get(['overlayState']);
        if (stored.overlayState) {
            this.state = { ...this.state, ...stored.overlayState };
            if (this.state.minimized) this.minimize(true);
            if (this.state.width) this.el.style.width = `${this.state.width}px`;
            if (this.state.height) this.el.style.height = `${this.state.height}px`;
        }
        this.loadSavedPrompts();
        this.renderHistoryList(this.historyManager.history);
        if (this.settingsManager.get('devMode')) this.setDevMode(true);
    }

    onSettingsChange(settings) {
        const retryToggle = this.el.querySelector('#gptRetryToggle');
        const goalInput = this.el.querySelector('#gptVideoGoal');
        const galleryLimitInput = this.el.querySelector('#gptGalleryLimit');
        if (retryToggle) retryToggle.checked = settings.autoRetryEnabled;
        if (goalInput && !this.retryManager.goalRunning && !this.retryManager.batchRunning) {
            goalInput.value = settings.videoGoal || 1;
        }
        if (galleryLimitInput && !this.retryManager.batchRunning) {
            galleryLimitInput.value = settings.galleryBatchLimit || settings.videoGoal || 1;
        }
        if (settings.devMode && !this.logViewer) this.setDevMode(true);
        else if (!settings.devMode && this.logViewer) this.setDevMode(false);
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
                    <div class="gpt-controls" style="display:flex; align-items:center;">
                        <button class="gpt-btn-icon" id="gptSettingsBtn" title="Settings" style="margin-right:8px">
                           <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                        </button>
                        <button class="gpt-btn-icon" id="gptMinBtn" title="Minimize">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                        </button>
                    </div>
                </div>

                <!-- MAIN VIEW -->
                <div class="gpt-content" id="gptMainView">
                    <div class="gpt-section">
                        <div class="gpt-row">
                            <span style="font-size:12px; font-weight:600; color:#e7e9ea">STATUS</span>
                            <span id="gptStatusBadge" class="gpt-badge gpt-badge-success">Ready</span>
                        </div>
                    </div>

                    <div class="gpt-section">
                        <div class="gpt-row">
                             <span>Auto-Retry</span>
                             <label class="gpt-toggle-switch">
                                 <input type="checkbox" id="gptRetryToggle">
                                 <span class="gpt-slider"></span>
                             </label>
                        </div>
                        <div class="gpt-row" style="margin-top:8px; font-size:11px; color:#71767b">
                            <span>Retries Used</span>
                            <span id="gptRetryCounter" class="gpt-badge gpt-badge-neutral" style="font-size:10px">0/0</span>
                        </div>
                         <div class="gpt-row" style="margin-top:4px; font-size:11px; color:#71767b">
                            <span id="gptProgressLabel">Videos Generated</span>
                            <span id="gptVideoCounter" class="gpt-badge gpt-badge-neutral" style="font-size:10px">0/0</span>
                        </div>
                        <div class="gpt-row" style="margin-top:8px">
                             <span># of Videos</span>
                             <input type="number" id="gptVideoGoal" class="gpt-input" value="1" min="1" max="50">
                        </div>
                        <div class="gpt-row" style="margin-top:8px" id="gptGalleryLimitRow">
                             <span>Gallery Limit</span>
                             <input type="number" id="gptGalleryLimit" class="gpt-input" value="10" min="1" max="200">
                        </div>
                         <div class="gpt-row" style="margin-top:12px">
                            <button id="gptStartGoalBtn" class="gpt-btn gpt-btn-primary">Start Video Goal</button>
                        </div>
                        <div class="gpt-row" style="margin-top:8px">
                            <button id="gptQuickBatchBtn" class="gpt-btn gpt-btn-secondary" style="flex:1; background:#1d9bf0; font-size:11px;">Quick Batch</button>
                            <button id="gptPromptedBatchBtn" class="gpt-btn gpt-btn-secondary" style="flex:1; margin-left:4px; background:#7c3aed; font-size:11px;">Prompted Batch</button>
                            <button id="gptBatchStopBtn" class="gpt-btn" style="flex:1; background:#f4212e; display:none; font-size:11px;">Stop Batch</button>
                        </div>
                        <div id="gptBatchPromptRow" style="margin-top:6px; display:none;">
                            <select id="gptBatchPromptSelect" class="gpt-input" style="font-size:11px; padding:4px;">
                                <option value="">-- Select prompt for batch --</option>
                            </select>
                        </div>
                        <div class="gpt-row" style="margin-top:4px; font-size:10px; color:#71767b; display:none;" id="gptBatchStatus">
                            Batch Mode: Active
                        </div>
                    </div>

                    <div class="gpt-section">
                        <div style="display:flex; gap:8px; margin-bottom:8px; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:8px;">
                             <div class="gpt-tab active" id="tab-btn-history" style="flex:1; text-align:center;">History</div>
                             <div class="gpt-tab" id="tab-btn-saved" style="flex:1; text-align:center;">Saved</div>
                        </div>

                        <div id="view-history">
                            <input type="text" id="gptHistorySearch" class="gpt-history-search" placeholder="Search history...">
                            <div class="gpt-history-list" id="gptHistoryList"></div>
                            <button id="gptClearHistoryBtn" class="gpt-btn" style="margin-top:8px; width:100%; justify-content:center; background:rgba(244,33,46,0.2); color:#f4212e;">
                                Clear History
                            </button>
                        </div>

                        <div id="view-saved" style="display:none;">
                            <div class="gpt-prompt-list" id="gptPromptList">
                                 <div style="font-size:11px; color:#71767b; width:100%; text-align:center; padding:8px;">No saved prompts</div>
                            </div>
                            <button id="gptAddPromptBtn" class="gpt-btn" style="margin-top:8px; width:100%; justify-content:center;">
                                + Add Prompt Partial
                            </button>
                        </div>
                    </div>
                </div>

                <!-- SETTINGS VIEW -->
                <div class="gpt-content gpt-settings-view" id="gptSettingsView" style="display:none;">
                    <button class="gpt-btn" id="gptBackBtn" style="width: auto; padding: 4px 8px; margin-bottom:10px;">
                        ← Back
                    </button>

                    <div class="gpt-tabs">
                        <div class="gpt-tab active" data-tab="defaults">Defaults</div>
                        <div class="gpt-tab" data-tab="timing">Timing</div>
                        <div class="gpt-tab" data-tab="advanced">Advanced</div>
                    </div>

                    <!-- DEFAULTS TAB -->
                    <div class="gpt-settings-panel active" id="tab-defaults">
                        <div class="gpt-input-group">
                            <div class="gpt-input-label">Default Max Retries
                                <span class="gpt-badge-sm" id="lblMaxRetries"></span>
                            </div>
                            <input type="number" id="setMaxRetries" class="gpt-input" min="1" max="50">
                        </div>
                        <div class="gpt-input-group">
                            <div class="gpt-input-label">Default Video Goal
                                <span class="gpt-badge-sm" id="lblVideoGoal"></span>
                            </div>
                            <input type="number" id="setVideoGoal" class="gpt-input" min="1" max="50">
                        </div>
                    </div>

                    <!-- TIMING TAB -->
                    <div class="gpt-settings-panel" id="tab-timing">
                        <div class="gpt-input-group">
                            <div class="gpt-input-label">Retry Cooldown (ms)
                                <span class="gpt-badge-sm" id="lblCooldown"></span>
                            </div>
                            <input type="number" id="setCooldown" class="gpt-input" step="1000">
                        </div>
                         <div class="gpt-input-group">
                            <div class="gpt-input-label">Generation Delay (ms)
                                <span class="gpt-badge-sm" id="lblGenDelay"></span>
                            </div>
                            <input type="number" id="setGenDelay" class="gpt-input" step="1000">
                        </div>
                    </div>

                    <!-- ADVANCED TAB -->
                    <div class="gpt-settings-panel" id="tab-advanced">
                         <div class="gpt-row">
                            <span>Developer Mode</span>
                            <label class="gpt-toggle-switch">
                                <input type="checkbox" id="setDevMode">
                                <span class="gpt-slider"></span>
                            </label>
                        </div>
                         <div class="gpt-input-group" style="margin-top:8px;">
                            <div class="gpt-input-label">Prompt History Limit</div>
                            <input type="number" id="setHistoryLimit" class="gpt-input" min="1" max="200">
                        </div>
                         <div class="gpt-section" style="margin-top:12px; padding-top:12px; border-top:1px solid rgba(255,255,255,0.1);">
                            <div style="display:flex; gap:8px;">
                                <button id="btnExport" class="gpt-btn" style="flex:1">Export JSON</button>
                                <button id="btnImport" class="gpt-btn" style="flex:1">Import JSON</button>
                                <button id="btnReset" class="gpt-btn" style="background:#f4212e33; color:#f4212e; flex:1">Reset</button>
                            </div>
                             <input type="file" id="fileImport" accept=".json" style="display:none;" />
                        </div>
                    </div>
                </div>
                
                <div class="gpt-resize-handle"></div>
            `;
        document.body.appendChild(container);
        this.el = container;
    }

    setupListeners() {
        const header = this.el.querySelector('#gptHeader');
        let isDragging = false, startX, startY, initialLeft, initialTop;
        header.addEventListener('mousedown', (e) => {
            if (e.target.closest('button')) return;
            isDragging = true;
            const rect = this.el.getBoundingClientRect();
            startX = e.clientX; startY = e.clientY;
            initialLeft = rect.left; initialTop = rect.top;
        });
        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            this.el.style.left = (initialLeft + (e.clientX - startX)) + 'px';
            this.el.style.top = (initialTop + (e.clientY - startY)) + 'px';
            this.el.style.bottom = 'auto'; this.el.style.right = 'auto';
        });
        document.addEventListener('mouseup', () => isDragging = false);

        // --- RESIZE LOGIC ---
        const resizeHandle = this.el.querySelector('.gpt-resize-handle');
        let isResizing = false, resizeStartX, resizeStartY, startWidth, startHeight;
        resizeHandle.addEventListener('mousedown', (e) => {
            isResizing = true;
            resizeStartX = e.clientX;
            resizeStartY = e.clientY;
            startWidth = this.el.offsetWidth;
            startHeight = this.el.offsetHeight;
            e.stopPropagation();
            e.preventDefault();
        });
        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const newWidth = startWidth + (e.clientX - resizeStartX);
            const newHeight = startHeight + (e.clientY - resizeStartY);
            this.el.style.width = Math.max(300, newWidth) + 'px';
            // this.el.style.height = Math.max(200, newHeight) + 'px'; 
            this.state.width = Math.max(300, newWidth);
            // this.state.height = Math.max(200, newHeight);
        });
        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                this.saveState();
            }
        });

        // UI Nav
        this.el.querySelector('#gptSettingsBtn').addEventListener('click', () => {
            this.populateSettingsForm();
            this.el.querySelector('#gptMainView').style.display = 'none';
            this.el.querySelector('#gptSettingsView').style.display = 'block';
        });
        this.el.querySelector('#gptBackBtn').addEventListener('click', () => {
            this.el.querySelector('#gptSettingsView').style.display = 'none';
            this.el.querySelector('#gptMainView').style.display = 'block';
        });
        this.el.querySelector('#gptMinBtn').addEventListener('click', (e) => {
            e.stopPropagation();
            this.minimize(true);
        });
        this.el.addEventListener('click', (e) => {
            if (this.state.minimized && !isDragging) this.minimize(false);
        });

        const tabHistory = this.el.querySelector('#tab-btn-history');
        const tabSaved = this.el.querySelector('#tab-btn-saved');
        const viewHistory = this.el.querySelector('#view-history');
        const viewSaved = this.el.querySelector('#view-saved');

        tabHistory.addEventListener('click', () => {
            tabHistory.classList.add('active'); tabSaved.classList.remove('active');
            viewHistory.style.display = 'block'; viewSaved.style.display = 'none';
        });
        tabSaved.addEventListener('click', () => {
            tabSaved.classList.add('active'); tabHistory.classList.remove('active');
            viewSaved.style.display = 'block'; viewHistory.style.display = 'none';
        });

        const searchInput = this.el.querySelector('#gptHistorySearch');
        searchInput.addEventListener('input', (e) => {
            this.renderHistoryList(this.historyManager.history, e.target.value);
        });
        this.el.querySelector('#gptClearHistoryBtn').addEventListener('click', () => {
            if (confirm('Clear all prompt history?')) this.historyManager.clear();
        });

        this.el.querySelectorAll('.gpt-settings-view .gpt-tab').forEach(t => {
            t.addEventListener('click', () => {
                this.el.querySelectorAll('.gpt-settings-view .gpt-tab').forEach(x => x.classList.remove('active'));
                this.el.querySelectorAll('.gpt-settings-panel').forEach(x => x.classList.remove('active'));
                t.classList.add('active');
                this.el.querySelector(`#tab-${t.dataset.tab}`).classList.add('active');
            });
        });

        this.el.querySelector('#gptRetryToggle').addEventListener('change', (e) => this.settingsManager.set('autoRetryEnabled', e.target.checked));
        this.el.querySelector('#gptVideoGoal').addEventListener('change', (e) => this.settingsManager.set('videoGoal', parseInt(e.target.value)));
        this.el.querySelector('#gptGalleryLimit').addEventListener('change', (e) => {
            const limit = Math.max(1, parseInt(e.target.value, 10) || 1);
            e.target.value = limit;
            this.settingsManager.set('galleryBatchLimit', limit);
        });
        this.el.querySelector('#gptStartGoalBtn').addEventListener('click', () => {
            const count = parseInt(this.el.querySelector('#gptVideoGoal').value, 10);
            this.retryManager.startGoal(count);
        });
        this.el.querySelector('#gptQuickBatchBtn').addEventListener('click', async () => {
            await this.retryManager.startBatch('quick');
        });
        this.el.querySelector('#gptPromptedBatchBtn').addEventListener('click', async () => {
            const select = this.el.querySelector('#gptBatchPromptSelect');
            let prompt = select ? select.value : '';
            // Fallback: use Grok's visible prompt input (textarea on detail view, contenteditable on gallery)
            if (!prompt) {
                const ta = document.querySelector('textarea[aria-required="true"]');
                const ce = document.querySelector('[contenteditable="true"]');
                if (ta && ta.value && ta.value.trim().length > 0) {
                    prompt = ta.value.trim();
                } else if (ce && ce.textContent && ce.textContent.trim().length > 0) {
                    prompt = ce.textContent.trim();
                }
            }
            if (!prompt) {
                this.toast.show('Enter a prompt in the text box or select one from the dropdown', 'error');
                return;
            }
            const videoGoal = Math.max(1, parseInt(this.el.querySelector('#gptVideoGoal').value, 10) || 1);
            const galleryLimit = Math.max(1, parseInt(this.el.querySelector('#gptGalleryLimit').value, 10) || videoGoal);
            await this.retryManager.startBatch('prompted', prompt, { videoGoal, galleryLimit });
        });
        this.el.querySelector('#gptBatchStopBtn').addEventListener('click', () => {
            this.retryManager.stopBatch();
        });
        // Show/hide prompt selector when Prompted Batch is relevant
        this.el.querySelector('#gptPromptedBatchBtn').addEventListener('mouseenter', () => {
            this.populateBatchPromptSelect();
            this.el.querySelector('#gptBatchPromptRow').style.display = 'block';
        });
        this.el.querySelector('#gptAddPromptBtn').addEventListener('click', () => this.saveCurrentPrompt());

        const bindInput = (id, key, type = 'int') => {
            this.el.querySelector('#' + id).addEventListener('change', (e) => {
                let val = e.target.value;
                if (type === 'int') val = parseInt(val, 10);
                if (type === 'bool') val = e.target.checked;
                this.settingsManager.set(key, val);
                this.toast.show('Setting Saved', 'success');
                this.populateSettingsForm();
            });
        };
        bindInput('setMaxRetries', 'maxRetries');
        bindInput('setVideoGoal', 'videoGoal');
        bindInput('setCooldown', 'retryCooldown');
        bindInput('setGenDelay', 'generationDelay');
        bindInput('setHistoryLimit', 'historyLimit');
        bindInput('setDevMode', 'devMode', 'bool');

        this.el.querySelector('#btnExport').addEventListener('click', () => {
            const json = this.settingsManager.export();
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = 'grok_settings.json';
            a.click();
        });
        this.el.querySelector('#btnReset').addEventListener('click', () => {
            if (confirm('Reset all settings?')) {
                this.settingsManager.reset();
                this.populateSettingsForm();
                this.toast.show('Settings Reset', 'success');
            }
        });
        this.el.querySelector('#btnImport').addEventListener('click', () => this.el.querySelector('#fileImport').click());
        this.el.querySelector('#fileImport').addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                if (this.settingsManager.import(ev.target.result)) {
                    this.populateSettingsForm();
                    this.toast.show('Settings Imported', 'success');
                } else {
                    this.toast.show('Import Failed', 'error');
                }
            };
            reader.readAsText(file);
        });
    }

    populateSettingsForm() {
        const s = this.settingsManager.settings;
        const setVal = (id, val, textId) => {
            const el = this.el.querySelector('#' + id);
            if (el) el.value = val;
            const txt = this.el.querySelector('#' + textId);
            if (txt) txt.textContent = val;
        };
        setVal('setMaxRetries', s.maxRetries, 'lblMaxRetries');
        setVal('setVideoGoal', s.videoGoal, 'lblVideoGoal');
        setVal('setCooldown', s.retryCooldown, 'lblCooldown');
        setVal('setGenDelay', s.generationDelay, 'lblGenDelay');
        this.el.querySelector('#setHistoryLimit').value = s.historyLimit;
        this.el.querySelector('#setDevMode').checked = s.devMode;

        const mainGoal = this.el.querySelector('#gptVideoGoal');
        const galleryLimit = this.el.querySelector('#gptGalleryLimit');
        if (mainGoal && !this.retryManager.goalRunning) mainGoal.value = s.videoGoal;
        if (galleryLimit && !this.retryManager.batchRunning) galleryLimit.value = s.galleryBatchLimit || s.videoGoal || 1;
    }

    minimize(isMin) {
        this.state.minimized = isMin;
        this.el.classList.toggle('minimized', isMin);
        this.saveState();
    }
    setDevMode(enabled) {
        if (enabled && !this.logViewer) {
            this.logViewer = new LogViewer();
            this.logViewer.addLog('Dev Mode Active');
        } else if (!enabled && this.logViewer) {
            this.logViewer.destroy();
            this.logViewer = null;
        }
    }
    setStatus(msg, type) {
        const badge = this.el.querySelector('#gptStatusBadge');
        if (badge) { badge.textContent = msg; badge.className = `gpt-badge gpt-badge-${type}`; }
        if (this.logViewer) this.logViewer.addLog(msg, type);
    }

    async loadSavedPrompts() {
        const stored = await chrome.storage.local.get(['savedPrompts']);
        this.savedPrompts = stored.savedPrompts || [];
        this.renderSavedList(this.savedPrompts);
    }
    renderSavedList(prompts) {
        this.savedPrompts = prompts;
        const list = this.el.querySelector('#gptPromptList');
        list.innerHTML = '';
        if (prompts.length === 0) {
            const emptyState = document.createElement('div');
            emptyState.style.cssText = 'display:flex; flex-direction:column; align-items:center; gap:8px; padding:12px;';

            const msg = document.createElement('div');
            msg.textContent = 'No saved prompts';
            msg.style.cssText = 'font-size:11px; color:#71767b;';

            const loadBtn = document.createElement('button');
            loadBtn.className = 'gpt-btn';
            loadBtn.textContent = 'Load Examples';
            loadBtn.style.fontSize = '11px';
            loadBtn.style.padding = '4px 8px';
            loadBtn.onclick = () => this.loadExamplePrompts();

            emptyState.appendChild(msg);
            emptyState.appendChild(loadBtn);
            list.appendChild(emptyState);
            return;
        }
        prompts.forEach((p, idx) => {
            const tag = document.createElement('div');
            tag.className = 'gpt-prompt-tag';
            tag.textContent = p.name || p.text.substring(0, 15);
            tag.title = p.text;
            tag.onclick = (e) => {
                if (e.target.classList.contains('gpt-prompt-delete')) return;
                this.injectPrompt(p.text);
            };
            const del = document.createElement('div');
            del.className = 'gpt-prompt-delete';
            del.textContent = 'x';
            del.onclick = (e) => {
                e.stopPropagation();
                prompts.splice(idx, 1);
                chrome.storage.local.set({ savedPrompts: prompts });
                this.renderSavedList(prompts);
            };
            tag.appendChild(del);
            list.appendChild(tag);
        });
    }
    renderHistoryList(history, search = '') {
        const list = this.el.querySelector('#gptHistoryList');
        if (!list) return;
        list.innerHTML = '';
        let filtered = history;
        if (search) {
            const q = search.toLowerCase();
            filtered = history.filter(h => h.text.toLowerCase().includes(q));
        }
        if (filtered.length === 0) {
            list.innerHTML = '<div style="font-size:11px; color:#71767b; text-align:center; padding:12px;">No history found</div>';
            return;
        }
        filtered.forEach(h => {
            const item = document.createElement('div');
            item.className = 'gpt-history-item';
            item.onclick = () => this.injectPrompt(h.text);

            const timeStr = new Date(h.timestamp).toLocaleTimeString();
            const typeIcon = h.type === 'video' ? '🎥' : '🖼️';
            const typeClass = h.type === 'video' ? 'video' : 'image';

            item.innerHTML = `
                <div class="gpt-history-text">${h.text}</div>
                <div class="gpt-history-meta">
                    <span class="gpt-history-type ${typeClass}">${typeIcon}</span>
                    <span>${timeStr}</span>
                </div>
            `;
            list.appendChild(item);
        });
    }
    async saveCurrentPrompt() {
        const ta = document.querySelector('textarea[aria-required="true"]');
        const ce = document.querySelector('[contenteditable="true"]');
        const text = (ta && ta.value && ta.value.trim()) || (ce && ce.textContent && ce.textContent.trim()) || '';
        if (text.length > 0) {
            const name = prompt('Name for this prompt partial:');
            if (name) {
                const s = await chrome.storage.local.get(['savedPrompts']);
                const p = s.savedPrompts || [];
                p.push({ name, text });
                await chrome.storage.local.set({ savedPrompts: p });
                this.renderSavedList(p);
                this.toast.show('Prompt Saved', 'success');
            }
        } else {
            this.toast.show('Input is empty!', 'error');
        }
    }

    async loadExamplePrompts() {
        if (!confirm('Load example prompts?')) return;
        const examples = [
            {
                name: "World Cup Streaker (T2I)",
                text: "A photograph taken at a soccer World Cup final match, capturing a fully nude blonde petite teen woman with very large natural pendulous breasts, invading the soccer field during the match, security guards chasing her on the field. High detailed World Cup effects, photograph taken from a smartphone in the stands, deep realistic shadows, lens flare."
            },
            {
                name: "Field Chase (I2V)",
                text: "Playfully running around the filed, security guards chasing and trying to arrest her. Perfect bouncing physics"
            }
        ];

        const s = await chrome.storage.local.get(['savedPrompts']);
        const current = s.savedPrompts || [];
        const combined = [...current, ...examples];

        await chrome.storage.local.set({ savedPrompts: combined });
        this.renderSavedList(combined);
        this.toast.show('Examples Loaded', 'success');
    }
    populateBatchPromptSelect() {
        const select = this.el.querySelector('#gptBatchPromptSelect');
        if (!select) return;
        const current = select.value;
        // Clear existing options safely
        while (select.firstChild) select.removeChild(select.firstChild);
        const defaultOpt = document.createElement('option');
        defaultOpt.value = '';
        defaultOpt.textContent = '-- Select prompt for batch --';
        select.appendChild(defaultOpt);
        // Add saved prompts
        const saved = this.savedPrompts || [];
        saved.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.text;
            opt.textContent = p.name || p.text.substring(0, 40);
            select.appendChild(opt);
        });
        // Add recent history
        const history = this.historyManager ? this.historyManager.history.slice(0, 10) : [];
        if (history.length > 0 && saved.length > 0) {
            const divider = document.createElement('option');
            divider.disabled = true;
            divider.textContent = '\u2500\u2500 Recent History \u2500\u2500';
            select.appendChild(divider);
        }
        history.forEach(h => {
            const opt = document.createElement('option');
            opt.value = h.text;
            opt.textContent = h.text.substring(0, 40) + (h.text.length > 40 ? '...' : '');
            select.appendChild(opt);
        });
        if (current) select.value = current;
    }

    injectPrompt(text) {
        const ta = document.querySelector('textarea[aria-required="true"]');
        if (ta) {
            ta.focus();
            // React 16+ State Hack:
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                window.HTMLTextAreaElement.prototype,
                "value"
            ).set;
            nativeInputValueSetter.call(ta, text);
            ta.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
            // Fallback: contenteditable div (used on favorites gallery)
            const ce = document.querySelector('[contenteditable="true"]');
            if (ce) {
                ce.focus();
                ce.textContent = text;
                ce.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }
    }
}

class VideoRetryManager {
    constructor(overlay, settingsManager, historyManager) {
        this.overlay = overlay;
        this.settingsManager = settingsManager;
        this.historyManager = historyManager;
        this.BUTTON_SELECTOR = 'button[aria-label="Make video"]';
        this.PROGRESS_SELECTOR = 'button[aria-label="Video Options"]';
        this.CARD_SELECTOR = '[class*="media-post-masonry-card"]';
        this.currentRetry = 0;
        this.lastClickTime = 0;
        this.goalRunning = false;
        this.batchRunning = false;
        this.goalTotal = 0;
        this.goalCount = 0;

        // Scoped targeting: the card container we're operating on
        this.targetContext = null;

        // State for managing async verify step
        this.isVerifying = false;
        this.verifyStartTime = 0;
        this.lastSuccessTime = 0;
        this.preClickButtonCount = 0;

        // Interval management
        this.intervalId = null;

        // Batch state
        this.batchQueue = [];
        this.batchIndex = 0;
        this.batchAborted = false;
        this.batchMode = null;       // 'quick' or 'prompted'
        this.batchPrompt = null;     // Prompt text for prompted mode
        this.scrollAttempts = 0;
        this.batchContext = null;    // 'gallery' or 'detail'

        this.settingsManager.subscribe(() => this.updateConfig());
        this.updateConfig();
        this.startObserver();
    }

    updateConfig() { }

    // --- Fix 1: Safe overlay access ---
    safeStatus(msg, type) {
        if (this.overlay && this.overlay.setStatus) this.overlay.setStatus(msg, type);
    }

    // --- Fix 2: Find the card container closest to viewport center ---
    findTargetContext() {
        const buttons = document.querySelectorAll(this.BUTTON_SELECTOR);
        if (buttons.length === 0) return null;
        if (buttons.length === 1) return buttons[0].closest(this.CARD_SELECTOR) || buttons[0].parentElement;

        const viewportCenterY = window.innerHeight / 2;
        let bestBtn = null;
        let bestDist = Infinity;
        for (const btn of buttons) {
            const rect = btn.getBoundingClientRect();
            const dist = Math.abs(rect.top + rect.height / 2 - viewportCenterY);
            if (dist < bestDist) {
                bestDist = dist;
                bestBtn = btn;
            }
        }
        return bestBtn.closest(this.CARD_SELECTOR) || bestBtn.parentElement;
    }

    // Scoped query helper: search within targetContext if available, else document
    _queryRoot() {
        return (this.targetContext && this.targetContext.isConnected) ? this.targetContext : document;
    }

    detectBatchContext() {
        if (/\/imagine\/post\//.test(window.location.pathname)) {
            return 'detail';
        }

        const galleryCard = document.querySelector(this.CARD_SELECTOR)
            || document.querySelector('[data-testid*="media-post"]');
        if (galleryCard) return 'gallery';

        const backControl = document.querySelector('[aria-label="Back"]') || document.querySelector('.lucide-arrow-left');
        if (backControl) return 'detail';

        const makeVideoButtons = document.querySelectorAll(this.BUTTON_SELECTOR);
        if (makeVideoButtons.length > 1) return 'gallery';
        if (makeVideoButtons.length === 1) return 'detail';

        return 'detail';
    }

    injectPromptText(text) {
        if (!text) return false;

        const ta = document.querySelector('textarea[aria-required="true"]');
        if (ta) {
            ta.focus();
            const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
            setter.call(ta, text);
            ta.dispatchEvent(new Event('input', { bubbles: true }));
            return true;
        }

        const ce = document.querySelector('[contenteditable="true"]');
        if (ce) {
            ce.focus();
            ce.textContent = text;
            ce.dispatchEvent(new Event('input', { bubbles: true }));
            return true;
        }

        return false;
    }

    // --- Goal Mode ---
    startGoal(count) {
        this.goalRunning = true;
        this.batchRunning = false;
        this.batchContext = 'detail';
        this.goalTotal = count;
        this.goalCount = 0;
        this.currentRetry = 0;

        // Scope to the card the user is looking at
        this.targetContext = this.findTargetContext();

        const root = this._queryRoot();
        this.baseCompletedCount = root.querySelectorAll(this.PROGRESS_SELECTOR).length;
        console.log(`VideoRetryManager: Goal Started. Target: ${count}. Scoped: ${!!this.targetContext}`);

        this.safeStatus('Goal Started', 'info');
        this.updateCounters();
        this.clickMakeVideo();
    }

    // --- Batch Mode (Quick + Prompted) ---
    async startBatch(mode = 'quick', prompt = null, options = {}) {
        const normalizedMode = mode === 'prompted' ? 'prompted' : 'quick';

        if (normalizedMode === 'prompted') {
            const detectedContext = this.detectBatchContext();
            if (detectedContext === 'detail') {
                const videoGoal = Math.max(1, parseInt(options.videoGoal, 10) || this.settingsManager.get('videoGoal') || 1);
                await this.startPromptedBatchFromDetail(prompt, videoGoal);
            } else {
                const galleryLimit = Math.max(1, parseInt(options.galleryLimit, 10) || this.settingsManager.get('galleryBatchLimit') || 1);
                await this.startPromptedBatchFromGallery(prompt, galleryLimit);
            }
            return;
        }

        this.batchRunning = true;
        this.goalRunning = false;
        this.batchAborted = false;
        this.batchIndex = 0;
        this.batchMode = 'quick';
        this.batchContext = 'gallery';
        this.batchPrompt = null;
        this.scrollAttempts = 0;
        this.goalCount = 0;
        this.currentRetry = 0;

        this.safeStatus('Batch (quick): Scanning gallery...', 'info');

        this.batchQueue = this.buildBatchQueue();
        this.goalTotal = this.batchQueue.length;

        if (this.batchQueue.length === 0) {
            this.safeStatus('No items to process', 'warning');
            this.batchRunning = false;
            this.updateCounters();
            this.updateBatchButtons(false);
            return;
        }

        console.log(`Batch (quick): Found ${this.batchQueue.length} items to process.`);
        this.updateCounters();
        this.updateBatchButtons(true);
        await this.processBatchNext();
    }

    async startPromptedBatchFromGallery(prompt, galleryLimit) {
        this.batchRunning = true;
        this.goalRunning = false;
        this.batchAborted = false;
        this.batchIndex = 0;
        this.batchMode = 'prompted';
        this.batchContext = 'gallery';
        this.batchPrompt = prompt;
        this.scrollAttempts = 0;
        this.goalCount = 0;
        this.goalTotal = Math.max(1, galleryLimit);
        this.currentRetry = 0;

        this.batchQueue = this.buildBatchQueue();
        if (this.batchQueue.length === 0) {
            this.safeStatus('Prompted Batch [gallery]: No images found', 'warning');
            this.batchRunning = false;
            this.updateCounters();
            return;
        }

        console.log(`Prompted Batch [gallery]: Starting with ${this.batchQueue.length} images (limit ${this.goalTotal}).`);
        this.safeStatus(`Prompted Batch [gallery]: Starting 0/${this.goalTotal}`, 'info');
        this.updateCounters();
        this.updateBatchButtons(true);

        while (this.batchRunning && !this.batchAborted && this.goalCount < this.goalTotal) {
            if (this.batchIndex >= this.batchQueue.length) {
                const foundMore = await this.scrollForMore();
                if (!foundMore) break;
            }

            const item = this.batchQueue[this.batchIndex];
            if (!item || !item.button || !item.button.isConnected) {
                this.batchIndex++;
                continue;
            }

            if (item.container.querySelector(this.PROGRESS_SELECTOR)) {
                this.batchIndex++;
                continue;
            }

            this.safeStatus(`Prompted Batch [gallery]: ${this.goalCount + 1}/${this.goalTotal}`, 'info');
            await this.processBatchItemPrompted(item);
        }

        const hitLimit = this.goalCount >= this.goalTotal;
        const wasAborted = this.batchAborted;
        this.batchRunning = false;
        this.batchAborted = false;
        this.updateBatchButtons(false);
        this.updateCounters();
        if (hitLimit) {
            this.safeStatus(`Prompted Batch [gallery]: Complete (${this.goalCount}/${this.goalTotal})`, 'success');
        } else if (wasAborted) {
            this.safeStatus(`Prompted Batch [gallery]: Stopped (${this.goalCount}/${this.goalTotal})`, 'neutral');
        } else {
            this.safeStatus(`Prompted Batch [gallery]: Queue exhausted (${this.goalCount}/${this.goalTotal})`, 'neutral');
        }
    }

    async startPromptedBatchFromDetail(prompt, videoGoal) {
        this.batchRunning = true;
        this.goalRunning = false;
        this.batchAborted = false;
        this.batchIndex = 0;
        this.batchMode = 'prompted';
        this.batchContext = 'detail';
        this.batchPrompt = prompt;
        this.scrollAttempts = 0;
        this.goalCount = 0;
        this.goalTotal = Math.max(1, videoGoal);
        this.currentRetry = 0;
        this.targetContext = this.findTargetContext();

        if (prompt && this.historyManager && typeof this.historyManager.add === 'function') {
            this.historyManager.add(prompt, 'video');
        }

        this.safeStatus(`Prompted Batch [detail]: Starting 0/${this.goalTotal}`, 'info');
        this.updateCounters();
        this.updateBatchButtons(true);

        while (this.batchRunning && !this.batchAborted && this.goalCount < this.goalTotal) {
            if (this.batchPrompt) {
                this.injectPromptText(this.batchPrompt);
                await this.sleep(300);
            }

            const makeBtn = document.querySelector(this.BUTTON_SELECTOR);
            if (!makeBtn) {
                this.safeStatus('Prompted Batch [detail]: Make video button not found', 'warning');
                break;
            }

            this.preClickButtonCount = document.querySelectorAll(this.PROGRESS_SELECTOR).length;
            this.lastClickTime = Date.now();
            makeBtn.click();
            console.log(`Prompted Batch [detail]: Clicked Make Video (${this.goalCount + 1}/${this.goalTotal}).`);

            const result = await this.awaitBatchItemCompletion(document, {
                allowRetry: true,
                labelPrefix: 'Prompted Batch [detail]'
            });

            if (result === 'success') {
                this.goalCount++;
                this.currentRetry = 0;
                this.updateCounters();
                this.safeStatus(`Prompted Batch [detail]: Progress ${this.goalCount}/${this.goalTotal}`, 'success');
                continue;
            }

            if (result === 'aborted') break;

            this.safeStatus('Prompted Batch [detail]: Stopped after failed attempt', 'warning');
            break;
        }

        const hitGoal = this.goalCount >= this.goalTotal;
        const wasAborted = this.batchAborted;
        this.batchRunning = false;
        this.batchAborted = false;
        this.updateBatchButtons(false);
        this.updateCounters();
        if (hitGoal) {
            this.safeStatus(`Prompted Batch [detail]: Complete (${this.goalCount}/${this.goalTotal})`, 'success');
        } else if (wasAborted) {
            this.safeStatus(`Prompted Batch [detail]: Stopped (${this.goalCount}/${this.goalTotal})`, 'neutral');
        } else {
            this.safeStatus(`Prompted Batch [detail]: Stopped (${this.goalCount}/${this.goalTotal})`, 'neutral');
        }
    }

    stopBatch() {
        this.batchRunning = false;
        this.batchAborted = true;
        this.goalRunning = false;
        this.isVerifying = false;
        this.targetContext = null;
        this.batchContext = null;
        this.safeStatus('Batch Stopped', 'neutral');
        this.updateCounters();
        this.updateBatchButtons(false);
    }

    buildBatchQueue() {
        const buttons = Array.from(document.querySelectorAll(this.BUTTON_SELECTOR));
        const items = buttons.map(btn => {
            const container = btn.closest(this.CARD_SELECTOR) || btn.parentElement;
            const rect = container.getBoundingClientRect();
            return { button: btn, container, top: rect.top + window.scrollY, left: rect.left + window.scrollX };
        });
        // Sort visually: top-to-bottom, left-to-right (20px row tolerance)
        items.sort((a, b) => {
            if (Math.abs(a.top - b.top) > 20) return a.top - b.top;
            return a.left - b.left;
        });
        // Filter out items that already have a completed video
        return items.filter(item => !item.container.querySelector(this.PROGRESS_SELECTOR));
    }

    async processBatchNext() {
        if (!this.batchRunning || this.batchAborted) return;

        // If queue exhausted, try auto-scrolling for more
        if (this.batchIndex >= this.batchQueue.length) {
            const foundMore = await this.scrollForMore();
            if (!foundMore) {
                this.safeStatus(`Batch Complete! ${this.goalCount} videos`, 'success');
                this.batchRunning = false;
                this.updateBatchButtons(false);
                return;
            }
            // Continue with the newly found items
        }

        const item = this.batchQueue[this.batchIndex];

        // Skip if button detached from DOM
        if (!item.button.isConnected) {
            console.log(`Batch: Item ${this.batchIndex} detached, skipping.`);
            this.batchIndex++;
            return this.processBatchNext();
        }

        // Skip if already has video
        if (item.container.querySelector(this.PROGRESS_SELECTOR)) {
            console.log(`Batch: Item ${this.batchIndex} already has video, skipping.`);
            this.batchIndex++;
            this.goalCount++;
            this.updateCounters();
            return this.processBatchNext();
        }

        this.safeStatus(`Batch: ${this.batchIndex + 1}/${this.batchQueue.length} (${this.batchMode})`, 'info');

        if (this.batchMode === 'quick') {
            await this.processBatchItemQuick(item);
        } else {
            await this.processBatchItemPrompted(item);
        }
    }

    // Mode A: Quick batch — fire-and-forget, click all "Make video" buttons rapidly
    async processBatchItemQuick(item) {
        item.button.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await this.sleep(500);

        item.button.click();
        this.goalCount++;
        this.updateCounters();
        console.log(`Batch Quick: Fired item ${this.batchIndex + 1}.`);
        this.safeStatus(`Batch: Fired ${this.batchIndex + 1}/${this.batchQueue.length}`, 'info');

        this.batchIndex++;
        await this.sleep(1500); // Brief pause between clicks
        if (this.batchRunning && !this.batchAborted) await this.processBatchNext();
    }

    // Mode B: Prompted batch — click into image, inject prompt, make video, go back
    async processBatchItemPrompted(item) {
        // Click the image (not the button) to enter detail view
        const img = item.container.querySelector('img');
        if (!img) {
            console.log(`Prompted Batch [gallery]: No image found for item ${this.batchIndex + 1}, skipping.`);
            this.batchIndex++;
            return;
        }

        img.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await this.sleep(500);
        img.click();
        await this.sleep(2000); // Wait for detail view to load

        // Inject the prompt
        if (this.batchPrompt) {
            const injected = this.injectPromptText(this.batchPrompt);
            if (injected) {
                console.log('Prompted Batch [gallery]: Injected prompt.');
                await this.sleep(500);
            }
        }

        // Find and click "Make video" in the detail view
        const makeBtn = document.querySelector(this.BUTTON_SELECTOR);
        if (!makeBtn) {
            console.log('Prompted Batch [gallery]: No Make video button in detail view.');
        } else {
            this.lastClickTime = Date.now();
            makeBtn.click();
            console.log(`Prompted Batch [gallery]: Clicked Make Video for item ${this.batchIndex + 1}.`);
            await this.sleep(1200); // safety wait before navigating back
        }

        const didGoBack = await this.batchGoBack();
        if (!didGoBack) {
            console.log(`Prompted Batch [gallery]: Back navigation failed for item ${this.batchIndex + 1}, skipping.`);
        }

        this.goalCount++;
        this.batchIndex++;
        this.targetContext = null;
        this.currentRetry = 0;
        this.updateCounters();
        await this.sleep(1500);
    }

    async batchGoBack() {
        const previousUrl = window.location.href;
        const backBtn = document.querySelector('[aria-label="Back"]') || document.querySelector('.lucide-arrow-left');
        if (backBtn) {
            const clickTarget = backBtn.closest('button') || backBtn.closest('a') || backBtn;
            clickTarget.click();
            await this.sleep(2000);
            if (this.detectBatchContext() === 'gallery' || window.location.href !== previousUrl) {
                return true;
            }
        }

        if (window.history.length > 1) {
            window.history.back();
            await this.sleep(2200);
            if (this.detectBatchContext() === 'gallery' || window.location.href !== previousUrl) {
                return true;
            }
        }

        return false;
    }

    async awaitBatchItemCompletion(searchRoot, options = {}) {
        const TIMEOUT = 120000;
        const POLL_INTERVAL = 1500;
        const startTime = Date.now();
        const s = this.settingsManager.settings;
        const allowRetry = options.allowRetry !== false;
        const labelPrefix = options.labelPrefix || 'Batch';

        while (this.batchRunning && !this.batchAborted) {
            await this.sleep(POLL_INTERVAL);
            if (!this.batchRunning) return 'aborted';

            const elapsed = Date.now() - startTime;

            // Check if "Make video" button reappeared (generation done)
            const btnBack = searchRoot.querySelector(this.BUTTON_SELECTOR);
            if (!btnBack) {
                this.safeStatus(`${labelPrefix}: Generating...`, 'info');
                if (elapsed > TIMEOUT) {
                    console.log(`${labelPrefix}: Timed out on item.`);
                    this.safeStatus(`${labelPrefix}: Timed out`, 'warning');
                    return 'failed';
                }
                continue;
            }

            // Button is back — did it succeed?
            const currentCompleted = searchRoot.querySelectorAll(this.PROGRESS_SELECTOR).length;
            if (currentCompleted > this.preClickButtonCount) {
                return 'success';
            } else {
                if (!allowRetry) {
                    return 'failed';
                }

                // Failure — retry
                if (this.currentRetry >= s.maxRetries) {
                    console.log(`${labelPrefix}: Max retries on item.`);
                    this.safeStatus(`${labelPrefix}: Max retries hit`, 'warning');
                    return 'failed';
                }

                this.currentRetry++;
                this.safeStatus(`${labelPrefix}: Retry ${this.currentRetry}/${s.maxRetries}`, 'warning');
                this.preClickButtonCount = currentCompleted;
                this.updateCounters();

                await this.sleep(s.retryCooldown);
                if (!this.batchRunning) return 'aborted';

                const retryBtn = searchRoot.querySelector(this.BUTTON_SELECTOR);
                if (retryBtn) {
                    this.lastClickTime = Date.now();
                    retryBtn.click();
                }
            }
        }

        return this.batchAborted ? 'aborted' : 'failed';
    }

    async scrollForMore() {
        if (this.scrollAttempts >= 3) return false;
        this.scrollAttempts++;

        // Scroll to bottom of last queued item (absolute position, never backward)
        const lastItem = this.batchQueue[this.batchQueue.length - 1];
        if (lastItem && lastItem.container.isConnected) {
            const rect = lastItem.container.getBoundingClientRect();
            window.scrollTo(0, rect.bottom + window.scrollY);
        } else {
            window.scrollTo(0, document.body.scrollHeight);
        }
        await this.sleep(2500); // Wait for lazy load

        const newQueue = this.buildBatchQueue();
        // Only add genuinely new items (not already in queue)
        const existingContainers = new Set(this.batchQueue.map(i => i.container));
        const newItems = newQueue.filter(i => !existingContainers.has(i.container));

        if (newItems.length > 0) {
            this.batchQueue.push(...newItems);
            if (!(this.batchMode === 'prompted' && this.batchContext === 'gallery')) {
                this.goalTotal = this.batchQueue.length;
            }
            this.scrollAttempts = 0; // Reset on success
            this.updateCounters();
            console.log(`Batch: Scrolled and found ${newItems.length} new items.`);
            return true;
        }

        console.log(`Batch: Scroll attempt ${this.scrollAttempts}/3 found no new items.`);
        return false;
    }

    updateBatchButtons(running) {
        if (!this.overlay || !this.overlay.el) return;
        const quickBtn = this.overlay.el.querySelector('#gptQuickBatchBtn');
        const promptedBtn = this.overlay.el.querySelector('#gptPromptedBatchBtn');
        const stopBtn = this.overlay.el.querySelector('#gptBatchStopBtn');
        const batchStatus = this.overlay.el.querySelector('#gptBatchStatus');
        const promptRow = this.overlay.el.querySelector('#gptBatchPromptRow');
        const galleryLimitRow = this.overlay.el.querySelector('#gptGalleryLimitRow');

        if (quickBtn) quickBtn.style.display = running ? 'none' : '';
        if (promptedBtn) promptedBtn.style.display = running ? 'none' : '';
        if (stopBtn) stopBtn.style.display = running ? '' : 'none';
        if (batchStatus) batchStatus.style.display = running ? 'block' : 'none';
        if (promptRow) promptRow.style.display = running ? 'none' : '';
        if (galleryLimitRow) galleryLimitRow.style.display = running ? 'none' : '';
        if (batchStatus) {
            const ctx = this.batchContext ? ` [${this.batchContext}]` : '';
            batchStatus.textContent = running ? `Batch Mode${ctx}: Active` : 'Batch Mode: Active';
        }
    }

    // --- Observer (1s polling for Goal mode only) ---
    startObserver() {
        if (this.intervalId) clearInterval(this.intervalId);
        this.intervalId = setInterval(() => this.checkAndAct(), 1000);
    }

    stopObserver() {
        if (this.intervalId) { clearInterval(this.intervalId); this.intervalId = null; }
    }

    updateCounters() {
        if (!this.overlay || !this.overlay.el) return;
        const retryB = this.overlay.el.querySelector('#gptRetryCounter');
        const vidB = this.overlay.el.querySelector('#gptVideoCounter');
        const progressLabel = this.overlay.el.querySelector('#gptProgressLabel');
        const s = this.settingsManager.settings;
        const isGalleryPrompted = this.batchRunning && this.batchMode === 'prompted' && this.batchContext === 'gallery';
        if (progressLabel) {
            progressLabel.textContent = isGalleryPrompted ? 'Images Processed' : 'Videos Generated';
        }
        if (retryB) retryB.textContent = `${this.currentRetry}/${s.maxRetries}`;
        if (vidB) vidB.textContent = `${this.goalCount}/${this.goalTotal}`;
    }

    checkAndAct() {
        // Batch mode uses its own async loop
        if (this.batchRunning) return;
        // Only act during active goals
        if (!this.goalRunning) return;
        if (typeof document === 'undefined') return;

        // Context-loss detection: if target was detached, stop
        if (this.targetContext && !this.targetContext.isConnected) {
            console.log('VideoRetryManager: Target context detached. Stopping.');
            this.goalRunning = false;
            this.isVerifying = false;
            this.targetContext = null;
            this.safeStatus('Stopped (context lost)', 'warning');
            return;
        }

        const root = this._queryRoot();
        const makeVideoBtn = root.querySelector(this.BUTTON_SELECTOR);
        const isGenerating = !makeVideoBtn;

        if (isGenerating) {
            this.safeStatus('Generating...', 'info');
            // Verify timeout: 2 minutes
            if (this.isVerifying && (Date.now() - this.verifyStartTime > 120000)) {
                console.log('VideoRetryManager: Verification timed out.');
                this.isVerifying = false;
                this.safeStatus('Generation timed out', 'error');
            }
            return;
        }

        if (this.isVerifying) {
            const currentCompleted = root.querySelectorAll(this.PROGRESS_SELECTOR).length;

            if (currentCompleted > this.preClickButtonCount) {
                console.log('VideoRetryManager: SUCCESS detected.');
                this.goalCount++;
                this.currentRetry = 0;
                this.updateCounters();
                this.safeStatus('Success! Next...', 'success');

                if (this.goalCount >= this.goalTotal) {
                    console.log('VideoRetryManager: Goal Reached.');
                    this.goalRunning = false;
                    this.safeStatus('Goal Complete', 'success');
                    this.isVerifying = false;
                    this.targetContext = null;
                    return;
                }

                this.isVerifying = false;
                // Fall through to click logic
            } else {
                console.log('VideoRetryManager: FAILURE detected.');
                this.isVerifying = false;
                this.attemptRetry();
                return;
            }
        }

        // Click logic: ready to click next?
        const s = this.settingsManager.settings;
        if (makeVideoBtn && !makeVideoBtn.disabled && (Date.now() - this.lastClickTime > s.retryCooldown)) {
            this.clickMakeVideo();
        }
    }

    attemptRetry() {
        const s = this.settingsManager.settings;
        if (Date.now() - this.lastClickTime < s.retryCooldown) return;

        // Check if auto-retry is enabled
        if (!s.autoRetryEnabled) {
            this.safeStatus('Failed (auto-retry off)', 'error');
            this.goalRunning = false;
            this.targetContext = null;
            return;
        }

        if (this.currentRetry >= s.maxRetries) {
            this.safeStatus('Max Retries Hit', 'error');
            this.goalRunning = false;
            this.targetContext = null;
            return;
        }

        this.currentRetry++;
        console.log(`VideoRetryManager: Retrying... Attempt ${this.currentRetry}`);
        this.updateCounters();
        this.safeStatus(`Retrying... (${this.currentRetry})`, 'warning');
        this.clickMakeVideo();
    }

    clickMakeVideo() {
        const root = this._queryRoot();
        const btn = root.querySelector(this.BUTTON_SELECTOR);
        if (btn) {
            // Ensure prompt is present
            const ta = document.querySelector('textarea[aria-required="true"]');
            if (ta && (!ta.value || ta.value.trim() === '')) {
                if (this.historyManager && this.historyManager.history.length > 0) {
                    const lastPrompt = this.historyManager.history[0].text;
                    if (lastPrompt) {
                        ta.focus();
                        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
                        nativeInputValueSetter.call(ta, lastPrompt);
                        ta.dispatchEvent(new Event('input', { bubbles: true }));
                        console.log('VideoRetryManager: Re-injected prompt');
                    }
                }
            }

            this.lastClickTime = Date.now();
            this.isVerifying = true;
            this.verifyStartTime = Date.now();

            // Record state BEFORE click (scoped)
            this.preClickButtonCount = root.querySelectorAll(this.PROGRESS_SELECTOR).length;

            btn.click();
            console.log('VideoRetryManager: Clicked Make Video.');
        }
    }

    sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
}


class GrokScraper {
    constructor() {
        this.overlay = null;
        this.processedIds = new Set();
        this.state = { isRunning: false, currentIndex: 0, mode: 'IDLE' };
        this.Config = { actionWait: 2000, navWait: 2000 };
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

        // --- USER IDENTIFICATION LOGIC (Restored) ---
        try {
            const pfpImg = document.querySelector('img[alt="pfp"]');
            if (pfpImg && pfpImg.src) {
                const parts = pfpImg.src.split('users/');
                if (parts.length > 1) {
                    const userId = parts[1].split('/')[0];
                    if (userId && userId.length > 5) {
                        chrome.storage.local.get(['activeGrokUserId'], (res) => {
                            if (res.activeGrokUserId !== userId) {
                                console.log('Switching Account Context to:', userId);
                                chrome.storage.local.set({ activeGrokUserId: userId });
                            }
                        });
                    }
                }
            }
        } catch (e) { }

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

    getCleanId(url) { if (!url) return null; try { return url.split('?')[0]; } catch (e) { return url; } }

    async start() {
        this.log('Scraping initialized.', 'success');
        await chrome.storage.local.set({ scraperState: 'running', currentIndex: 0 });
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

        // --- DRIFT GUARD (Restored) ---
        // Guard: If we drifted to main feed (/imagine without /favorites) while running, force back.
        const isMainFeed = window.location.href.match(/\/imagine\/?$/);
        const shouldBeInFavorites = this.state.isRunning && isMainFeed;

        if (shouldBeInFavorites) {
            const favButton = document.querySelector('img[alt="219e8040-acaa-435e-ba7f-14702e307a32"]')
                || document.querySelector('img.border-white.rounded-xl')
                || Array.from(document.querySelectorAll('a, button, [role="button"]')).find(el => {
                    const label = (el.ariaLabel || el.textContent || "").toLowerCase();
                    return (label.includes('favorite') || label.includes('gallery') || label.includes('saved')) && !label.includes('tweet');
                });

            if (favButton) {
                if (favButton.classList.contains('border-white') && favButton.classList.contains('border-2')) {
                    // Already selected
                } else {
                    this.log('Restoring Favorites context...', 'warning');
                    favButton.click();
                    await this.sleep(3000);
                    if (!this.state.isRunning) return;
                    return; // Return to refresh context
                }
            } else {
                this.log('Drifted to Main Feed but cannot find Favorites button!', 'error');
            }
        }
        // ------------------------------

        await this.sleep(1000);
        window.scrollBy(0, 10);
        await this.sleep(500);
        window.scrollBy(0, -10);
        await this.sleep(this.Config.navWait);
        if (!this.state.isRunning) return;

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

        // Safety Check
        if (window.location.href.match(/\/imagine\/?$/)) {
            console.log('On Main Feed. Deferring to Drift Guard.');
            this.determineModeAndExecute();
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

            console.log(`Scanning ${uniqueItems.length} items...`);
            if (retries % 5 === 0) this.log(`Scanning... (${uniqueItems.length} items visible)`);

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
                return { element: img, top, left, src: img.src };
            });

            visualItems.sort((a, b) => {
                if (Math.abs(a.top - b.top) > 20) return a.top - b.top;
                return a.left - b.left;
            });

            // Find Unprocessed
            let targetItem = null;
            for (let i = 0; i < visualItems.length; i++) {
                const itemObj = visualItems[i];
                const cleanId = this.getCleanId(itemObj.src);
                if (cleanId && !this.processedIds.has(cleanId)) {
                    targetItem = itemObj.element;
                    this.log(`new item: ...${cleanId.slice(-6)}`, 'success');
                    await this.processItem(targetItem, cleanId);
                    return; // Action Taken
                }
            }

            // Scroll if no action
            console.log('No new items visible. Scrolling...');
            const scroller = document.querySelector('.overflow-scroll') || document.querySelector('[role="list"]')?.parentElement || window;
            scroller.scrollBy(0, window.innerHeight);
            await this.sleep(1000);
            if (!this.state.isRunning) return;
            retries++;
        }

        if (retries >= MAX_RETRIES) {
            if (!this.state.isRunning) return;
            this.log('Stopped: No new items found.', 'warning');
            this.stop();
        }
    }

    async processItem(targetItem, cleanId) {
        targetItem.style.outline = "2px solid rgba(29,155,240,0.5)";
        this.log(`Opening item...`);
        if (cleanId) await chrome.storage.local.set({ currentItemId: cleanId });
        targetItem.click();
        await this.sleep(this.Config.navWait);
        this.determineModeAndExecute();
    }

    async executeDetailView() {
        if (!this.state.isRunning) return;

        // Deduplication
        const storedState = await chrome.storage.local.get(['currentItemId']);
        let currentId = storedState.currentItemId;
        if (!currentId) {
            const mediaEl = document.querySelector('img[alt="Generated image"]') || document.querySelector('video');
            if (mediaEl) {
                const src = mediaEl.src || (mediaEl.querySelector('source') ? mediaEl.querySelector('source').src : null);
                currentId = this.getCleanId(src);
            }
        }

        if (currentId) {
            this.processedIds.add(currentId);
            await chrome.storage.local.set({ processedIds: Array.from(this.processedIds) });
        }

        // MULTI-VIDEO SUPPORT
        // Strategies:
        // 1. Find container with thumbnails.
        // 2. Iterate each button inside.
        // 3. Click, Wait, Download.

        // Container seems to be the one with 'overflow-y-auto' inside the article relative area
        // Or we can just find all buttons with img alt="Thumbnail X"

        const thumbnailButtons = Array.from(document.querySelectorAll('button img[alt^="Thumbnail"]'))
            .map(img => img.closest('button'))
            .filter(btn => btn);

        if (thumbnailButtons.length > 0) {
            console.log(`Multi-Video Detected: ${thumbnailButtons.length} versions.`);

            // Try to find the scrollable container to ensure all match?
            // User provided: class="... overflow-y-auto ..."
            // Let's try to find it from the first button
            const scrollContainer = thumbnailButtons[0].closest('.overflow-y-auto');

            for (let i = 0; i < thumbnailButtons.length; i++) {
                const btn = thumbnailButtons[i];

                // Scroll into view if needed
                if (scrollContainer) {
                    btn.scrollIntoView({ behavior: 'instant', block: 'center' });
                    await this.sleep(200);
                }

                this.log(`Processing Version ${i + 1}/${thumbnailButtons.length}...`);
                btn.click();

                // Active state check: The active button usually has a ring or opacity change
                // We just wait a bit to be safe.
                await this.sleep(1500);

                await this.performDownload();
            }
        } else {
            // Fallback: No thumbnails found? Maybe it's a single video without thumbnails?
            // Or maybe our selector missed. Check if there's just a generated video/image.
            console.log('No thumbnails found. Assuming single item.');
            await this.performDownload();
        }

        if (!this.state.isRunning) return;

        // Back Button
        const backBtn = await this.waitForSelector('[aria-label="Back"], .lucide-arrow-left', 5000);
        if (backBtn) {
            backBtn.click();
            await this.sleep(this.Config.navWait);
            this.determineModeAndExecute();
        } else {
            console.error('Back button not found!');
            this.stop();
        }
    }

    async performDownload() {
        if (!this.state.isRunning) return;

        // Click Download
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
            this.log(`Downloading...`, 'success');
            let targetToClick = downloadBtn;
            if (['svg', 'path', 'line'].includes(downloadBtn.tagName.toLowerCase())) {
                const parentBtn = downloadBtn.closest('button');
                if (parentBtn) targetToClick = parentBtn;
            }
            ['mousedown', 'click', 'mouseup'].forEach(evt => {
                targetToClick.dispatchEvent(new MouseEvent(evt, { bubbles: true, cancelable: true, view: window }));
            });
            await this.sleep(this.Config.actionWait);
        } else {
            this.log('Download button missing.', 'error');
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

    sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

    log(msg, type = 'neutral') {
        if (this.overlay) this.overlay.setStatus(msg, type);
        // Also log to background for legacy compatibility/debugging
        chrome.runtime.sendMessage({ action: 'ADD_LOG', text: msg, type: type }).catch(() => { });
    }
}

if (typeof module === 'undefined') {
    // Always initialize the Overlay and Managers on supported sites (defined in manifest)
    const settings = new SettingsManager();
    const history = new PromptHistoryManager(settings);
    const scraper = new GrokScraper();
    const retry = new VideoRetryManager(null, settings, history);
    const overlay = new GrokOverlay(scraper, retry, settings, history);
    retry.overlay = overlay;
    scraper.setOverlay(overlay);
} else {
    module.exports = { SettingsManager, GrokOverlay, VideoRetryManager, GrokScraper, PromptHistoryManager };
}
