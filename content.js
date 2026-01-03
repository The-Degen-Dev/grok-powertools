// Grok Power Tools - Content Script

// --- CONFIGURATION DEFAULTS ---
const SettingsDefaults = {
    maxRetries: 3,
    videoGoal: 10,
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
        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            this.el.style.left = `${initialLeft + (e.clientX - startX)}px`;
            this.el.style.top = `${initialTop + (e.clientY - startY)}px`;
            this.el.style.bottom = 'auto';
        });
        document.addEventListener('mouseup', () => isDragging = false);

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
    destroy() { if (this.el) { this.el.remove(); this.el = null; } }
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
        try { const parsed = JSON.parse(json); this.setAll(parsed); return true; }
        catch { return false; }
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
        const stored = await chrome.storage.local.get(['promptHistory']);
        if (stored.promptHistory) { this.history = stored.promptHistory; this.notify(); }
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
        const ta = document.querySelector('textarea');

        // 1. Try Main Textarea first
        if (ta && ta.value && ta.value.trim().length > 0) {
            text = ta.value.trim();
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
    save() { chrome.storage.local.set({ promptHistory: this.history }); this.notify(); }
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
        if (retryToggle) retryToggle.checked = settings.autoRetryEnabled;
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
                            <span>Videos Generated</span>
                            <span id="gptVideoCounter" class="gpt-badge gpt-badge-neutral" style="font-size:10px">0/0</span>
                        </div>
                        <div class="gpt-row" style="margin-top:8px">
                             <span># of Videos</span>
                             <input type="number" id="gptVideoGoal" class="gpt-input" value="1" min="1" max="50">
                        </div>
                         <div class="gpt-row" style="margin-top:12px">
                            <button id="gptStartGoalBtn" class="gpt-btn gpt-btn-primary">Start Video Goal</button>
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
        this.el.querySelector('#gptStartGoalBtn').addEventListener('click', () => {
            const count = parseInt(this.el.querySelector('#gptVideoGoal').value, 10);
            this.retryManager.startGoal(count);
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
        if (mainGoal && !this.retryManager.goalRunning) mainGoal.value = s.videoGoal;
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
        this.renderSavedList(stored.savedPrompts || []);
    }
    renderSavedList(prompts) {
        const list = this.el.querySelector('#gptPromptList');
        list.innerHTML = '';
        if (prompts.length === 0) {
            list.innerHTML = '<div style="font-size:11px; color:#71767b; width:100%; text-align:center; padding:8px;">No saved prompts</div>';
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
        const ta = document.querySelector('textarea');
        if (ta && ta.value && ta.value.trim().length > 0) {
            const name = prompt('Name for this prompt partial:');
            if (name) {
                const s = await chrome.storage.local.get(['savedPrompts']);
                const p = s.savedPrompts || [];
                p.push({ name, text: ta.value });
                await chrome.storage.local.set({ savedPrompts: p });
                this.renderSavedList(p);
                this.toast.show('Prompt Saved', 'success');
            }
        } else {
            this.toast.show('Input is empty!', 'error');
        }
    }
    injectPrompt(text) {
        const ta = document.querySelector('textarea');
        if (ta) {
            ta.focus();

            // React 16+ State Hack:
            // Simply setting .value = text doesn't trigger the internal React state update.
            // We must call the native setter on the prototype.
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                window.HTMLTextAreaElement.prototype,
                "value"
            ).set;
            nativeInputValueSetter.call(ta, text);

            const ev = new Event('input', { bubbles: true });
            ta.dispatchEvent(ev);
        }
    }
}

class VideoRetryManager {
    constructor(overlay, settingsManager, historyManager) {
        this.overlay = overlay;
        this.settingsManager = settingsManager;
        this.historyManager = historyManager; // New dependency
        this.MODERATION_TEXT = 'Content Moderated. Try a different idea.';
        this.BUTTON_SELECTOR = 'button[aria-label="Make video"]';
        this.currentRetry = 0;
        this.lastClickTime = 0;
        this.goalRunning = false;
        this.goalTotal = 0;
        this.goalCount = 0;
        this.settingsManager.subscribe(() => this.updateConfig());
        this.updateConfig();
        this.startObserver();
    }
    updateConfig() { }
    startGoal(count) {
        this.goalRunning = true;
        this.goalTotal = count;
        this.goalCount = 0;
        this.overlay.setStatus('Goal Started', 'info');
        this.updateCounters();
        this.clickMakeVideo();
    }
    startObserver() { setInterval(() => this.checkAndAct(), 1000); }
    updateCounters() {
        if (!this.overlay || !this.overlay.el) return;
        const retryB = this.overlay.el.querySelector('#gptRetryCounter');
        const vidB = this.overlay.el.querySelector('#gptVideoCounter');
        const s = this.settingsManager.settings;
        if (retryB) retryB.textContent = `${this.currentRetry}/${s.maxRetries}`;
        if (vidB) vidB.textContent = `${this.goalCount}/${this.goalTotal}`;
    }
    checkAndAct() {
        const s = this.settingsManager.settings;
        if (!s.autoRetryEnabled && !this.goalRunning) return;
        if (typeof document === 'undefined') return;
        // Check for moderation text anywhere in body
        // Note: Grok sometimes shows this in a toast or modal.
        if (s.autoRetryEnabled && document.body.textContent.includes(this.MODERATION_TEXT)) {
            this.attemptRetry();
        }
        if (this.goalRunning) {
            const btn = document.querySelector(this.BUTTON_SELECTOR);
            if (btn && !btn.disabled && (Date.now() - this.lastClickTime > s.retryCooldown)) {
                if (this.goalCount < this.goalTotal) {
                    this.goalCount++;
                    this.updateCounters();
                    this.clickMakeVideo();
                } else {
                    this.goalRunning = false;
                    this.overlay.setStatus('Goal Complete', 'success');
                }
            }
        }
    }
    attemptRetry() {
        const s = this.settingsManager.settings;
        if (Date.now() - this.lastClickTime < s.retryCooldown) return;
        if (this.currentRetry >= s.maxRetries) {
            this.overlay.setStatus('Max Retries Hit', 'error');
            return;
        }
        this.currentRetry++;
        this.updateCounters();
        this.overlay.setStatus(`Retrying...`, 'warning');
        this.clickMakeVideo();
    }
    clickMakeVideo() {
        const btn = document.querySelector(this.BUTTON_SELECTOR);
        if (btn) {
            // FIX: Ensure prompt is present
            const ta = document.querySelector('textarea');
            if (ta && (!ta.value || ta.value.trim() === '')) {
                // Try to get last used prompt
                if (this.historyManager && this.historyManager.history.length > 0) {
                    const lastPrompt = this.historyManager.history[0].text;
                    if (lastPrompt) {
                        // Inject it
                        ta.focus();
                        if (ta.setRangeText) {
                            ta.setRangeText(lastPrompt);
                        } else {
                            ta.value = lastPrompt;
                        }
                        ta.dispatchEvent(new Event('input', { bubbles: true }));
                        console.log('VideoRetryManager: Re-injected prompt:', lastPrompt.substring(0, 20) + '...');
                    }
                }
            }

            this.lastClickTime = Date.now();
            btn.click();
        }
    }
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
        targetItem.style.border = "4px solid blue";
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

        // Click Download
        let downloadBtn = null;
        const start = Date.now();
        while (!downloadBtn && Date.now() - start < 5000) {
            if (!this.state.isRunning) return;
            downloadBtn = document.querySelector('button[aria-label="Download"]')
                || document.querySelector('.lucide-download')
                || document.querySelector('[role="button"][aria-label="Download"]');
            if (!downloadBtn) await this.sleep(500);
            if (!this.state.isRunning) return;
        }

        if (downloadBtn) {
            this.log(`Downloading...`, 'success');
            let targetToClick = downloadBtn;
            if (['svg', 'path', 'line'].includes(downloadBtn.tagName.toLowerCase())) {
                const parentBtn = downloadBtn.closest('button');
                if (parentBtn) targetToClick = parentBtn;
            }
            // Robust Click
            ['mousedown', 'click', 'mouseup'].forEach(evt => {
                targetToClick.dispatchEvent(new MouseEvent(evt, { bubbles: true, cancelable: true, view: window }));
            });
            await this.sleep(this.Config.actionWait);
        } else {
            this.log('Download button missing.', 'error');
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
