// Background Service Worker
console.log('Grok Downloader Background Service Started');

let isScraping = false;
let currentTabId = null;

const MAX_LOGS = 100;

function log(msg, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = `[${timestamp}] ${msg}`;
    console.log(logEntry);

    chrome.storage.local.get(['activityLogs'], (result) => {
        const logs = result.activityLogs || [];
        logs.unshift({ text: logEntry, type: type }); // Prepend new log
        if (logs.length > MAX_LOGS) logs.pop();

        chrome.storage.local.set({ activityLogs: logs });
        // Still send runtime message for live updates if popup is open
        chrome.runtime.sendMessage({ action: 'UPDATE_LOGS', logs: logs }).catch(() => { });
    });
}

// Handle messages from Popup or Content Script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'START_SCRAPE') {
        log('Background: Received START_SCRAPE.');
        isScraping = true;

        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            console.log('Background: Tabs found:', tabs);

            if (tabs[0] && (tabs[0].url.includes('x.com') || tabs[0].url.includes('grok.com'))) {
                currentTabId = tabs[0].id;
                console.log(`Background: Sending INIT_SCRAPE to tab ${currentTabId}`);

                // Helper to send message
                const sendMessage = () => {
                    chrome.tabs.sendMessage(currentTabId, { action: 'INIT_SCRAPE' }, (response) => {
                        if (chrome.runtime.lastError) {
                            console.warn('Background: Content script not ready. Injecting now...', chrome.runtime.lastError.message);

                            // INJECT CONTENT SCRIPT MANUALLY
                            chrome.scripting.executeScript({
                                target: { tabId: currentTabId },
                                files: ['content.js']
                            }, () => {
                                if (chrome.runtime.lastError) {
                                    console.error('Background: Injection failed:', chrome.runtime.lastError.message);
                                } else {
                                    console.log('Background: Injection success. Retrying message...');
                                    // Retry message after short delay to allow partial execution
                                    setTimeout(() => {
                                        chrome.tabs.sendMessage(currentTabId, { action: 'INIT_SCRAPE' }, (resp2) => {
                                            console.log('Background: Retry response:', resp2);
                                            if (!chrome.runtime.lastError) {
                                                chrome.storage.local.set({ isScraping: true });
                                            } else {
                                                console.error('Background: Retry message failed:', chrome.runtime.lastError.message);
                                            }
                                        });
                                    }, 500);
                                }
                            });
                        } else {
                            console.log('Background: Message sent successfully, response:', response);
                            chrome.storage.local.set({ isScraping: true });
                        }
                    });
                };

                sendMessage();
                sendResponse({ status: 'started' });
            } else {
                console.warn('No valid Grok tab found. URL:', tabs[0] ? tabs[0].url : 'undefined');
                sendResponse({ status: 'no_tab' });
            }
        });
        return true; // Keep channel open
    } else if (request.action === 'STOP_SCRAPE') {
        isScraping = false;
        chrome.storage.local.set({ isScraping: false });
        if (currentTabId) {
            chrome.tabs.sendMessage(currentTabId, { action: 'ABORT_SCRAPE' });
        }
        sendResponse({ status: 'stopped' });
    } else if (request.action === 'DOWNLOAD_MEDIA') {
        handleDownload(request.url, request.date, request.postId, request.ext);
        sendResponse({ status: 'queued' });
    } else if (request.action === 'ADD_LOG') {
        log(request.text, request.type);
    } else if (request.action === 'CLOSE_TAB') {
        if (sender.tab && sender.tab.id) {
            console.log('Background: Closing tab', sender.tab.id);
            chrome.tabs.remove(sender.tab.id);
        }
    }
});

chrome.downloads.onDeterminingFilename.addListener(async (item, suggest) => {
    // Only affect downloads if we are scraping? Or always for Grok domain?
    if (!isScraping && !item.url.includes('imagine-public')) return; // passive check

    // Extract UUID from URL for consistent naming
    // URL: .../images/UUID.png?cache...
    // Fallback to timestamp if UUID not found
    let filename = 'unknown';

    try {
        // Try simple string split first if URL object fails or is complex
        // Typically: https://imagine-public.x.ai/imagine-public/images/0d30f5dd-6e56-4dd5-aa85-fc2df0358aa3.png?cache=1&dl=1
        const parts = item.url.split('/');
        const lastPart = parts[parts.length - 1]; // 0d30f5dd....png?cache=1...
        const cleanName = lastPart.split('?')[0]; // 0d30f5dd....png

        if (cleanName.includes('.')) {
            filename = cleanName.split('.')[0]; // 0d30f5dd...
        } else {
            filename = cleanName;
        }

        if (filename.length < 10) filename = Date.now().toString(); // Fallback if too short
    } catch (e) {
        filename = Date.now().toString();
    }

    const dateStr = new Date().toISOString().split('T')[0];

    // Add extension back if item.filename has it
    const originalExt = item.filename.split('.').pop();

    // Fetch custom path & User Context
    const stored = await chrome.storage.local.get(['downloadPath', 'activeGrokUserId']);
    const rootFolder = stored.downloadPath || 'GrokVault';
    const userId = stored.activeGrokUserId || 'Shared_Account';

    // Construct Path: Root / UserID / Date / Filename
    const finalName = `${rootFolder}/${userId}/${dateStr}_Auto/${filename}.${originalExt}`;

    suggest({
        filename: finalName,
        conflictAction: 'overwrite' // Prevent duplicates "copy (1)"
    });
});

function handleDownload(url, dateStr, postId, ext) {
    // We delegate naming to onDeterminingFilename listener above
    chrome.downloads.download({
        url: url,
        conflictAction: 'overwrite'
    }, (downloadId) => {
        if (chrome.runtime.lastError) {
            console.error('Download failed:', chrome.runtime.lastError);
        } else {
            console.log('Download started:', downloadId);
        }
    });
}
