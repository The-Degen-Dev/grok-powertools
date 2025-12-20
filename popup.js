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

    // Load saved state
    chrome.storage.local.get(['isScraping', 'activityLogs', 'autoRetryEnabled', 'retryMaxCount', 'downloadPath'], (result) => {
        if (result.isScraping) {
            setRunningState(true);
        }
        if (result.activityLogs) {
            renderLogs(result.activityLogs);
        }

        // Load Settings
        autoRetryCheckbox.checked = result.autoRetryEnabled || false;
        maxRetriesInput.value = result.retryMaxCount || 3;
        downloadPathInput.value = result.downloadPath || 'GrokVault';
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
        chrome.runtime.sendMessage({ action: 'STOP_SCRAPE' }, (response) => {
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
        }
    });

    function setRunningState(isRunning) {
        startBtn.disabled = isRunning;
        stopBtn.disabled = !isRunning;
        statusText.textContent = isRunning ? 'Scanning timeline...' : 'Idle';
    }

    function renderLogs(logs) {
        logList.innerHTML = '';
        logs.forEach(log => {
            const li = document.createElement('li');
            li.textContent = log.text;
            if (log.type) li.classList.add(log.type);
            logList.appendChild(li);
        });
    }

    function addLog(text, type = 'normal') {
        chrome.runtime.sendMessage({ action: 'ADD_LOG', text: text, type: type });
    }
});
