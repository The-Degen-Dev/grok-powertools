document.addEventListener('DOMContentLoaded', () => {
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    const statusText = document.getElementById('statusText');
    const progressFill = document.getElementById('progressFill');
    const logList = document.getElementById('logList');

    // Video Control Elements
    const autoRetryCheckbox = document.getElementById('autoRetryCheckbox');
    const maxRetriesInput = document.getElementById('maxRetriesInput');
    const downloadPathInput = document.getElementById('downloadPathInput');

    // Cloud Control Elements
    const cloudModeSelect = document.getElementById('cloudModeSelect');
    const cloudWorkerUrlInput = document.getElementById('cloudWorkerUrlInput');
    const cloudApiKeyInput = document.getElementById('cloudApiKeyInput');
    const cloudKeyPrefixInput = document.getElementById('cloudKeyPrefixInput');
    const cloudModeBadge = document.getElementById('cloudModeBadge');
    const cloudUnsyncedCount = document.getElementById('cloudUnsyncedCount');
    const cloudLastError = document.getElementById('cloudLastError');
    const cloudTestBtn = document.getElementById('cloudTestBtn');
    const cloudRetryBtn = document.getElementById('cloudRetryBtn');
    const cloudBackfillBtn = document.getElementById('cloudBackfillBtn');

    const DEFAULT_CLOUD_CONFIG = {
        enabled: false,
        mode: 'local_only',
        workerUrl: '',
        apiKey: '',
        keyPrefix: 'grok-powertools/v1'
    };

    let cloudConfig = { ...DEFAULT_CLOUD_CONFIG };

    // Load saved state
    chrome.storage.local.get([
        'isScraping',
        'activityLogs',
        'autoRetryEnabled',
        'retryMaxCount',
        'downloadPath',
        'cloudConfig',
        'cloudSyncState'
    ], (result) => {
        if (result.isScraping) {
            setRunningState(true);
        }
        if (result.activityLogs) {
            renderLogs(result.activityLogs);
        }

        // Load settings
        autoRetryCheckbox.checked = result.autoRetryEnabled || false;
        maxRetriesInput.value = result.retryMaxCount || 3;
        downloadPathInput.value = result.downloadPath || 'GrokVault';

        cloudConfig = normalizeCloudConfig(result.cloudConfig);
        renderCloudConfig(cloudConfig);
        if (result.cloudSyncState) renderCloudState(result.cloudSyncState);

        chrome.runtime.sendMessage({ action: 'CLOUD_GET_STATUS' }, (response) => {
            if (response && response.ok && response.state) {
                renderCloudState(response.state);
            }
        });
    });

    startBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'START_SCRAPE' }, (response) => {
            if (response && response.status === 'started') {
                setRunningState(true);
            } else {
                addLog('Failed to start. Refresh page?', 'error');
            }
        });
    });

    stopBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'STOP_SCRAPE' }, () => {
            setRunningState(false);
        });
    });

    // Save Video Settings on Change
    autoRetryCheckbox.addEventListener('change', () => {
        const enabled = autoRetryCheckbox.checked;
        chrome.storage.local.set({ autoRetryEnabled: enabled });
        addLog(`Auto-Retry ${enabled ? 'Enabled' : 'Disabled'}`);
    });

    maxRetriesInput.addEventListener('change', () => {
        const count = parseInt(maxRetriesInput.value, 10) || 3;
        chrome.storage.local.set({ retryMaxCount: count });
        addLog(`Max Retries set to ${count}`);
    });

    downloadPathInput.addEventListener('change', () => {
        const path = downloadPathInput.value.trim() || 'GrokVault';
        chrome.storage.local.set({ downloadPath: path });
        addLog(`Download Path set to: ${path}`);
    });

    cloudModeSelect.addEventListener('change', async () => {
        cloudConfig.mode = cloudModeSelect.value === 'dual_write' ? 'dual_write' : 'local_only';
        cloudConfig.enabled = cloudConfig.mode === 'dual_write';
        await saveCloudConfig();
        addLog(
            cloudConfig.mode === 'dual_write'
                ? 'Cloud backup mode: Dual-write (Local + R2)'
                : 'Cloud backup mode: Local only',
            'info'
        );
    });

    cloudWorkerUrlInput.addEventListener('change', async () => {
        cloudConfig.workerUrl = normalizeWorkerUrl(cloudWorkerUrlInput.value);
        if (cloudConfig.workerUrl && !isValidWorkersDevUrl(cloudConfig.workerUrl)) {
            addLog('Worker URL must match https://<name>.workers.dev', 'error');
            renderCloudConfig(cloudConfig);
            return;
        }
        await saveCloudConfig();
        addLog('Cloud worker URL saved', 'info');
    });

    cloudApiKeyInput.addEventListener('change', async () => {
        cloudConfig.apiKey = cloudApiKeyInput.value.trim();
        await saveCloudConfig();
        addLog('Cloud API key saved', 'info');
    });

    cloudKeyPrefixInput.addEventListener('change', async () => {
        cloudConfig.keyPrefix = sanitizeKeyPrefix(cloudKeyPrefixInput.value);
        await saveCloudConfig();
        addLog(`Cloud key prefix set to: ${cloudConfig.keyPrefix}`, 'info');
    });

    cloudTestBtn.addEventListener('click', async () => {
        const validationError = validateCloudConfig(cloudConfig);
        if (validationError) {
            addLog(validationError, 'error');
            return;
        }

        cloudTestBtn.disabled = true;
        addLog('Testing cloud connection...', 'info');

        chrome.runtime.sendMessage({ action: 'CLOUD_TEST_CONNECTION', config: cloudConfig }, (response) => {
            cloudTestBtn.disabled = false;
            if (response && response.ok && response.result && response.result.ok) {
                addLog('Cloud connection OK', 'success');
            } else {
                addLog(response?.error || 'Cloud connection failed', 'error');
            }
        });
    });

    cloudRetryBtn.addEventListener('click', () => {
        cloudRetryBtn.disabled = true;
        addLog('Retrying unsynced cloud items...', 'info');

        chrome.runtime.sendMessage({ action: 'CLOUD_RETRY_UNSYNCED' }, (response) => {
            cloudRetryBtn.disabled = false;
            if (response && response.ok) {
                addLog('Manual retry finished', 'success');
                if (response.state) renderCloudState(response.state);
            } else {
                addLog(response?.error || 'Manual retry failed', 'error');
            }
        });
    });

    cloudBackfillBtn.addEventListener('click', () => {
        cloudBackfillBtn.disabled = true;
        addLog('Running cloud backfill...', 'info');

        chrome.runtime.sendMessage({ action: 'CLOUD_RUN_BACKFILL' }, (response) => {
            cloudBackfillBtn.disabled = false;
            if (response && response.ok) {
                addLog('Backfill queued/completed', 'success');
                if (response.state) renderCloudState(response.state);
            } else {
                addLog(response?.error || 'Backfill failed', 'error');
            }
        });
    });

    // Listen for updates from background/content
    chrome.runtime.onMessage.addListener((message) => {
        if (message.action === 'UPDATE_LOGS') {
            renderLogs(message.logs);
        } else if (message.action === 'UPDATE_STATUS') {
            statusText.textContent = message.text;
        } else if (message.action === 'UPDATE_PROGRESS') {
            progressFill.style.width = `${message.progress}%`;
        } else if (message.action === 'SCRAPE_COMPLETE') {
            setRunningState(false);
        } else if (message.action === 'UPDATE_CLOUD_STATUS') {
            renderCloudState(message.state || {});
        }
    });

    function setRunningState(isRunning) {
        startBtn.disabled = isRunning;
        stopBtn.disabled = !isRunning;
        statusText.textContent = isRunning ? 'Scanning timeline...' : 'Idle';
    }

    function renderLogs(logs) {
        logList.innerHTML = '';
        logs.forEach((log) => {
            const li = document.createElement('li');
            li.textContent = log.text;
            if (log.type) li.classList.add(log.type);
            logList.appendChild(li);
        });
    }

    function addLog(text, type = 'normal') {
        chrome.runtime.sendMessage({ action: 'ADD_LOG', text: text, type: type });
    }

    function normalizeWorkerUrl(url) {
        return String(url || '').trim().replace(/\/+$/, '');
    }

    function isValidWorkersDevUrl(url) {
        try {
            const parsed = new URL(normalizeWorkerUrl(url));
            return parsed.protocol === 'https:' && /^[a-z0-9-]+\.workers\.dev$/i.test(parsed.hostname);
        } catch (e) {
            return false;
        }
    }

    function sanitizeKeyPrefix(prefix) {
        const clean = String(prefix || '').trim().replace(/^\/+/, '').replace(/\/+$/, '');
        return clean || DEFAULT_CLOUD_CONFIG.keyPrefix;
    }

    function normalizeCloudConfig(config) {
        const merged = { ...DEFAULT_CLOUD_CONFIG, ...(config || {}) };
        const hasExplicitMode = !!(config && typeof config === 'object' && Object.prototype.hasOwnProperty.call(config, 'mode'));
        const explicitMode = hasExplicitMode
            ? (merged.mode === 'dual_write' ? 'dual_write' : 'local_only')
            : null;
        const legacyEnabled = !!(config && typeof config === 'object' && config.enabled);
        const mode = explicitMode || (legacyEnabled ? 'dual_write' : 'local_only');
        const enabled = mode === 'dual_write';
        return {
            enabled,
            mode,
            workerUrl: normalizeWorkerUrl(merged.workerUrl),
            apiKey: String(merged.apiKey || '').trim(),
            keyPrefix: sanitizeKeyPrefix(merged.keyPrefix)
        };
    }

    function renderCloudConfig(config) {
        cloudModeSelect.value = config.mode === 'dual_write' ? 'dual_write' : 'local_only';
        cloudWorkerUrlInput.value = config.workerUrl || '';
        cloudApiKeyInput.value = config.apiKey || '';
        cloudKeyPrefixInput.value = config.keyPrefix || DEFAULT_CLOUD_CONFIG.keyPrefix;

        if (config.enabled) {
            cloudModeBadge.textContent = 'Dual Write';
            cloudModeBadge.className = 'status-pill success';
        } else {
            cloudModeBadge.textContent = 'Local Only';
            cloudModeBadge.className = 'status-pill neutral';
        }
    }

    function renderCloudState(state) {
        const unsynced = Number.isFinite(state.unsyncedCount) ? state.unsyncedCount : 0;
        cloudUnsyncedCount.textContent = String(unsynced);

        if (state.lastError) {
            cloudLastError.textContent = String(state.lastError);
            cloudLastError.className = 'cloud-error-text';
        } else {
            cloudLastError.textContent = 'None';
            cloudLastError.className = '';
        }
    }

    function validateCloudConfig(config) {
        if (!config.enabled || config.mode !== 'dual_write') {
            return 'Set Backup Mode to Dual-write before testing.';
        }
        if (!isValidWorkersDevUrl(config.workerUrl)) {
            return 'Worker URL must match https://<name>.workers.dev';
        }
        if (!config.apiKey) {
            return 'API key is required.';
        }
        return null;
    }

    async function saveCloudConfig() {
        const normalized = normalizeCloudConfig(cloudConfig);
        if (normalized.workerUrl && !isValidWorkersDevUrl(normalized.workerUrl)) {
            throw new Error('Invalid workers.dev URL');
        }
        cloudConfig = normalized;
        renderCloudConfig(cloudConfig);
        await chrome.storage.local.set({ cloudConfig: cloudConfig });
    }
});
