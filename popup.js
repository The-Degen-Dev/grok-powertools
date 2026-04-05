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
    const cloudLastTest = document.getElementById('cloudLastTest');
    const cloudLastTestMessage = document.getElementById('cloudLastTestMessage');
    const cloudLastError = document.getElementById('cloudLastError');
    const cloudTestBtn = document.getElementById('cloudTestBtn');
    const cloudRetryBtn = document.getElementById('cloudRetryBtn');
    const cloudBackfillBtn = document.getElementById('cloudBackfillBtn');
    const cloudClearBtn = document.getElementById('cloudClearBtn');
    const cloudMediaBackupBtn = document.getElementById('cloudMediaBackupBtn');
    const r2BackupProgress = document.getElementById('r2BackupProgress');
    const r2BackupStatus = document.getElementById('r2BackupStatus');
    const r2BackupDetails = document.getElementById('r2BackupDetails');
    const r2BackupStopBtn = document.getElementById('r2BackupStopBtn');
    const WORKERS_DEV_FORMAT_HELP = 'Worker URL must match https://<worker>.<subdomain>.workers.dev';
    const SHARED_CLOUD_SYNC = (typeof globalThis !== 'undefined' && globalThis.CloudSyncUtils)
        ? globalThis.CloudSyncUtils
        : null;
    const CLOUD_MODES = {
        localOnly: 'local_only',
        cloudOnly: 'cloud_only',
        dualWrite: 'dual_write'
    };
    const VALID_CLOUD_MODES = new Set([CLOUD_MODES.localOnly, CLOUD_MODES.cloudOnly, CLOUD_MODES.dualWrite]);

    const DEFAULT_CLOUD_CONFIG = {
        enabled: false,
        mode: CLOUD_MODES.localOnly,
        workerUrl: '',
        apiKey: '',
        keyPrefix: 'grok-powertools/v1'
    };
    const DEFAULT_CLOUD_STATE = {
        unsyncedCount: 0,
        lastError: null,
        lastSyncAt: null,
        retryScheduledAt: null,
        processing: false,
        lastTestAt: null,
        lastTestResult: null,
        lastTestMessage: null
    };

    let cloudConfig = { ...DEFAULT_CLOUD_CONFIG };
    let cloudState = { ...DEFAULT_CLOUD_STATE };

    // Load saved state
    chrome.storage.local.get([
        'isScraping',
        'activityLogs',
        'autoRetryEnabled',
        'retryMaxCount',
        'downloadPath',
        'cloudConfig',
        'cloudSyncState',
        'isR2Backup',
        'r2BackupState'
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
        renderCloudState(result.cloudSyncState || {});

        if (result.isR2Backup) {
            cloudMediaBackupBtn.disabled = true;
            r2BackupProgress.style.display = 'block';
            r2BackupStatus.textContent = 'Running...';
            r2BackupStopBtn.style.display = 'inline-block';
            if (result.r2BackupState) {
                const s = result.r2BackupState;
                r2BackupDetails.textContent = `${s.uploaded || 0} uploaded / ${s.errors || 0} errors`;
            }
        }

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
        const selectedMode = VALID_CLOUD_MODES.has(cloudModeSelect.value)
            ? cloudModeSelect.value
            : CLOUD_MODES.localOnly;
        cloudConfig.mode = selectedMode;
        cloudConfig.enabled = selectedMode !== CLOUD_MODES.localOnly;
        await saveCloudConfig();
        addLog(`Cloud backup mode: ${describeCloudMode(cloudConfig.mode)}`, 'info');
    });

    cloudWorkerUrlInput.addEventListener('change', async () => {
        cloudConfig.workerUrl = normalizeWorkerUrl(cloudWorkerUrlInput.value);
        if (cloudConfig.workerUrl && !isValidWorkersDevUrl(cloudConfig.workerUrl)) {
            addLog(WORKERS_DEV_FORMAT_HELP, 'error');
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
            renderCloudState({
                ...cloudState,
                lastError: `validation: ${validationError}`,
                lastTestAt: new Date().toISOString(),
                lastTestResult: 'error',
                lastTestMessage: `validation: ${validationError}`
            });
            return;
        }

        cloudTestBtn.disabled = true;
        renderCloudState({
            ...cloudState,
            lastTestAt: new Date().toISOString(),
            lastTestResult: 'running',
            lastTestMessage: 'Testing upload pipeline...'
        });
        addLog('Testing upload pipeline...', 'info');

        chrome.runtime.sendMessage({ action: 'CLOUD_TEST_CONNECTION', config: cloudConfig }, (response) => {
            cloudTestBtn.disabled = false;
            if (chrome.runtime.lastError) {
                const runtimeError = `runtime: ${chrome.runtime.lastError.message}`;
                addLog(`Cloud connection failed: ${runtimeError}`, 'error');
                renderCloudState({
                    ...cloudState,
                    lastError: runtimeError,
                    lastTestAt: new Date().toISOString(),
                    lastTestResult: 'error',
                    lastTestMessage: runtimeError
                });
                return;
            }

            renderCloudState(response?.state || {});

            if (response && response.ok && response.result && response.result.ok) {
                const msg = response.result.testUpload
                    ? 'Full pipeline OK (health + presign + R2 upload)'
                    : 'Cloud connection OK';
                addLog(msg, 'success');
            } else {
                const errorText = response?.error || response?.result?.error || 'Cloud connection failed';
                addLog(errorText, 'error');
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

    document.getElementById('resetProcessedIdsBtn').addEventListener('click', () => {
        const btn = document.getElementById('resetProcessedIdsBtn');
        btn.disabled = true;
        chrome.storage.local.set({ processedIds: [] }, () => {
            addLog('Processed IDs cleared. Scraper will re-scan all items.', 'success');
            btn.disabled = false;
        });
    });

    cloudClearBtn.addEventListener('click', () => {
        cloudClearBtn.disabled = true;
        chrome.runtime.sendMessage({ action: 'CLOUD_CLEAR_STATUS' }, (response) => {
            cloudClearBtn.disabled = false;
            if (chrome.runtime.lastError) {
                addLog(`Failed to clear cloud status: ${chrome.runtime.lastError.message}`, 'error');
                return;
            }

            if (response && response.ok) {
                renderLogs(Array.isArray(response.logs) ? response.logs : []);
                renderCloudState(response.state || {});
            } else {
                addLog(response?.error || 'Failed to clear cloud status', 'error');
            }
        });
    });

    cloudMediaBackupBtn.addEventListener('click', () => {
        const validationError = validateCloudConfig(cloudConfig);
        if (validationError) {
            addLog(validationError, 'error');
            return;
        }

        cloudMediaBackupBtn.disabled = true;
        r2BackupProgress.style.display = 'block';
        r2BackupStatus.textContent = 'Starting...';
        r2BackupStopBtn.style.display = 'inline-block';

        chrome.runtime.sendMessage({ action: 'START_R2_BACKUP' }, (response) => {
            if (response?.status === 'started') {
                r2BackupStatus.textContent = 'Running...';
                addLog('Full Media Backup started', 'success');
            } else {
                cloudMediaBackupBtn.disabled = false;
                r2BackupStopBtn.style.display = 'none';
                r2BackupStatus.textContent = 'Failed';
                addLog(response?.error || 'Failed to start backup', 'error');
            }
        });
    });

    r2BackupStopBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'STOP_R2_BACKUP' }, () => {
            cloudMediaBackupBtn.disabled = false;
            r2BackupStopBtn.style.display = 'none';
            r2BackupStatus.textContent = 'Stopped';
            addLog('Backup stopped by user', 'warning');
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
        } else if (message.action === 'UPDATE_R2_BACKUP_PROGRESS') {
            const s = message.stats || {};
            r2BackupStatus.textContent = `Running... (${s.totalSeen || 0} seen)`;
            r2BackupDetails.textContent = `${s.uploaded || 0} uploaded / ${s.errors || 0} errors`;
        } else if (message.action === 'R2_BACKUP_DONE') {
            cloudMediaBackupBtn.disabled = false;
            r2BackupStopBtn.style.display = 'none';
            r2BackupStatus.textContent = 'Complete';
            const s = message.stats || {};
            r2BackupDetails.textContent = `${s.uploaded || 0} uploaded / ${s.errors || 0} errors`;
            addLog(`Backup complete: ${s.uploaded || 0} uploaded`, 'success');
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
        if (SHARED_CLOUD_SYNC && typeof SHARED_CLOUD_SYNC.normalizeWorkerUrl === 'function') {
            return SHARED_CLOUD_SYNC.normalizeWorkerUrl(url);
        }

        const trimmed = String(url || '').trim();
        if (!trimmed) return '';

        try {
            return new URL(trimmed).origin;
        } catch (e) {
            return trimmed.replace(/\/+$/, '');
        }
    }

    function isValidWorkersDevUrl(url) {
        if (SHARED_CLOUD_SYNC && typeof SHARED_CLOUD_SYNC.validateWorkersDevUrl === 'function') {
            return SHARED_CLOUD_SYNC.validateWorkersDevUrl(url);
        }

        try {
            const parsed = new URL(normalizeWorkerUrl(url));
            if (parsed.protocol !== 'https:') return false;

            const hostname = parsed.hostname.toLowerCase();
            if (hostname === 'workers.dev') return false;
            if (!hostname.endsWith('.workers.dev')) return false;

            const prefix = hostname.slice(0, -'.workers.dev'.length);
            if (!prefix) return false;

            const labels = prefix.split('.');
            return labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
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
            ? (VALID_CLOUD_MODES.has(merged.mode) ? merged.mode : CLOUD_MODES.localOnly)
            : null;
        const legacyEnabled = !!(config && typeof config === 'object' && config.enabled);
        const mode = explicitMode || (legacyEnabled ? CLOUD_MODES.dualWrite : CLOUD_MODES.localOnly);
        const enabled = mode !== CLOUD_MODES.localOnly;
        return {
            enabled,
            mode,
            workerUrl: normalizeWorkerUrl(merged.workerUrl),
            apiKey: String(merged.apiKey || '').trim(),
            keyPrefix: sanitizeKeyPrefix(merged.keyPrefix)
        };
    }

    function renderCloudConfig(config) {
        const mode = VALID_CLOUD_MODES.has(config.mode) ? config.mode : CLOUD_MODES.localOnly;
        cloudModeSelect.value = mode;
        cloudWorkerUrlInput.value = config.workerUrl || '';
        cloudApiKeyInput.value = config.apiKey || '';
        cloudKeyPrefixInput.value = config.keyPrefix || DEFAULT_CLOUD_CONFIG.keyPrefix;

        if (mode === CLOUD_MODES.localOnly) {
            cloudModeBadge.textContent = 'Local Only';
            cloudModeBadge.className = 'status-pill neutral';
        } else if (mode === CLOUD_MODES.cloudOnly) {
            cloudModeBadge.textContent = 'Cloud Only';
            cloudModeBadge.className = 'status-pill success';
        } else {
            cloudModeBadge.textContent = 'Dual Write';
            cloudModeBadge.className = 'status-pill success';
        }
    }

    function renderCloudState(state) {
        const normalizedState = {
            ...DEFAULT_CLOUD_STATE,
            ...(state || {})
        };
        cloudState = normalizedState;

        const unsynced = Number.isFinite(normalizedState.unsyncedCount) ? normalizedState.unsyncedCount : 0;
        cloudUnsyncedCount.textContent = String(unsynced);

        if (normalizedState.lastError) {
            cloudLastError.textContent = String(normalizedState.lastError);
            cloudLastError.className = 'cloud-error-text';
        } else {
            cloudLastError.textContent = 'None';
            cloudLastError.className = '';
        }

        renderLastTest(normalizedState);
    }

    function validateCloudConfig(config) {
        if (!config.enabled || config.mode === CLOUD_MODES.localOnly) {
            return 'Set Backup Mode to Cloud only or Dual-write before testing.';
        }
        if (!isValidWorkersDevUrl(config.workerUrl)) {
            return WORKERS_DEV_FORMAT_HELP;
        }
        if (!config.apiKey) {
            return 'API key is required.';
        }
        return null;
    }

    async function saveCloudConfig() {
        const normalized = normalizeCloudConfig(cloudConfig);
        if (normalized.workerUrl && !isValidWorkersDevUrl(normalized.workerUrl)) {
            throw new Error(WORKERS_DEV_FORMAT_HELP);
        }
        cloudConfig = normalized;
        renderCloudConfig(cloudConfig);
        await chrome.storage.local.set({ cloudConfig: cloudConfig });
    }

    function describeCloudMode(mode) {
        if (mode === CLOUD_MODES.cloudOnly) return 'Cloud only (R2)';
        if (mode === CLOUD_MODES.dualWrite) return 'Dual-write (Local + R2)';
        return 'Local only';
    }

    function renderLastTest(state) {
        const testTime = state.lastTestAt ? new Date(state.lastTestAt) : null;
        const hasValidTime = !!(testTime && !Number.isNaN(testTime.getTime()));
        const timeLabel = hasValidTime ? testTime.toLocaleTimeString() : null;

        if (state.lastTestResult === 'running') {
            cloudLastTest.textContent = 'Running...';
            cloudLastTest.className = 'cloud-test-text-running';
            cloudLastTestMessage.textContent = state.lastTestMessage || 'Testing cloud connection...';
            cloudLastTestMessage.className = 'cloud-message-text';
            return;
        }

        if (state.lastTestResult === 'success') {
            cloudLastTest.textContent = timeLabel ? `OK at ${timeLabel}` : 'OK';
            cloudLastTest.className = 'cloud-test-text-success';
            cloudLastTestMessage.textContent = state.lastTestMessage || 'Cloud connection OK';
            cloudLastTestMessage.className = 'cloud-message-text success';
            return;
        }

        if (state.lastTestResult === 'error') {
            cloudLastTest.textContent = timeLabel ? `Failed at ${timeLabel}` : 'Failed';
            cloudLastTest.className = 'cloud-test-text-error';
            cloudLastTestMessage.textContent = state.lastTestMessage || 'Cloud connection failed';
            cloudLastTestMessage.className = 'cloud-message-text error';
            return;
        }

        cloudLastTest.textContent = 'Never';
        cloudLastTest.className = '';
        cloudLastTestMessage.textContent = 'None';
        cloudLastTestMessage.className = '';
    }
});
