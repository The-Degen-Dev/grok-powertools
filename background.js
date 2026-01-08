// Background Service Worker
console.log('Grok Downloader Background Service Started');

let isScraping = false;
let currentTabId = null;
const MAX_LOGS = 100;

// Global History Set
let processedUUIDs = new Set();
// Load history on startup
chrome.storage.local.get(['processedIds'], (result) => {
    if (result.processedIds) {
        processedUUIDs = new Set(result.processedIds);
        console.log(`Loaded ${processedUUIDs.size} processed UUIDs.`);
    }
});

function log(msg, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = `[${timestamp}] ${msg}`;
    console.log(logEntry);

    chrome.storage.local.get(['activityLogs'], (result) => {
        const logs = result.activityLogs || [];
        logs.unshift({ text: logEntry, type: type });
        if (logs.length > MAX_LOGS) logs.pop();
        chrome.storage.local.set({ activityLogs: logs });
        chrome.runtime.sendMessage({ action: 'UPDATE_LOGS', logs: logs }).catch(() => { });
    });
}

function saveHistory() {
    chrome.storage.local.set({ processedIds: Array.from(processedUUIDs) });
}

// --- HELPER: Centralized Filename Generation ---
async function generateFilename(url, suggestedFilename) {
    // 1. Extract UUID
    let filename = 'unknown';
    let uuid = null;

    try {
        // Typical URL: .../images/UUID.png?cache...
        const parts = url.split('/');
        const lastPart = parts[parts.length - 1];
        const cleanName = lastPart.split('?')[0];

        if (cleanName.includes('.')) {
            filename = cleanName.split('.')[0];
        } else {
            filename = cleanName;
        }

        // Try to match UUID pattern for robustness
        const uuidMatch = filename.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
        if (uuidMatch) {
            uuid = uuidMatch[0];
            filename = uuid; // Enforce UUID as filename
        } else if (suggestedFilename) {
            // Fallback to suggested if provided and no UUID found in URL
            filename = suggestedFilename.split('.')[0];
        }

        if (filename.length < 10) filename = Date.now().toString();
    } catch (e) {
        filename = Date.now().toString();
    }

    // 2. Deduplication Check
    if (uuid && processedUUIDs.has(uuid)) {
        console.log(`Skipping Duplicate: ${uuid}`);
        return null; // Signal cancel
    }

    // 3. Mark as processed (Optimistic)
    if (uuid) {
        processedUUIDs.add(uuid);
        saveHistory();
    }

    // 4. Build Path
    const dateStr = new Date().toISOString().split('T')[0];

    // Extension
    let ext = 'png';
    if (url.includes('.mp4')) ext = 'mp4';
    else if (url.includes('.jpg') || url.includes('.jpeg')) ext = 'jpg';

    const stored = await chrome.storage.local.get(['downloadPath', 'activeGrokUserId']);
    const rootFolder = stored.downloadPath || 'GrokVault';
    const userId = stored.activeGrokUserId || 'Shared_Account';

    // Construct: Root / UserID / Date / Filename
    return `${rootFolder}/${userId}/${dateStr}_Auto/${filename}.${ext}`;
}


// Handle messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'START_SCRAPE') {
        log('Background: Received START_SCRAPE.');
        isScraping = true;
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0] && (tabs[0].url.includes('x.com') || tabs[0].url.includes('grok.com'))) {
                currentTabId = tabs[0].id;

                // Helper to send message with retry
                const sendInit = () => {
                    chrome.tabs.sendMessage(currentTabId, { action: 'INIT_SCRAPE' }, (response) => {
                        if (chrome.runtime.lastError) {
                            console.warn('Injecting Content Script...');
                            chrome.scripting.executeScript({
                                target: { tabId: currentTabId },
                                files: ['content.js']
                            }, () => {
                                setTimeout(() => {
                                    chrome.tabs.sendMessage(currentTabId, { action: 'INIT_SCRAPE' });
                                    chrome.storage.local.set({ isScraping: true });
                                }, 500);
                            });
                        } else {
                            chrome.storage.local.set({ isScraping: true });
                        }
                    });
                };
                sendInit();
                sendResponse({ status: 'started' });
            } else {
                sendResponse({ status: 'no_tab' });
            }
        });
        return true;
    } else if (request.action === 'STOP_SCRAPE') {
        isScraping = false;
        chrome.storage.local.set({ isScraping: false });
        if (currentTabId) chrome.tabs.sendMessage(currentTabId, { action: 'ABORT_SCRAPE' });
        sendResponse({ status: 'stopped' });
    } else if (request.action === 'DOWNLOAD_MEDIA') {
        // Direct invocation
        // We can just rely on chrome.downloads.download which triggers onDeterminingFilename
        chrome.downloads.download({ url: request.url, conflictAction: 'overwrite' });
        sendResponse({ status: 'queued' });
    } else if (request.action === 'ADD_LOG') {
        log(request.text, request.type);
    }
});

// --- NEW TAB INTERCEPTOR ---
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    const stored = await chrome.storage.local.get(['isScraping']);
    if (!stored.isScraping) return;

    if (changeInfo.url) {
        const url = changeInfo.url;
        if (url.includes('imagine-public.x.ai') || url.match(/\.(png|jpg|jpeg|mp4|webp)(\?|$)/i)) {
            console.log('Background: Intercepted media tab. Processing:', url);

            // Generate Filename (Forces GrokVault path + Dedupe)
            const finalPath = await generateFilename(url);

            if (finalPath) {
                chrome.downloads.download({ url: url, filename: finalPath, conflictAction: 'overwrite' }, (id) => {
                    if (chrome.runtime.lastError) console.error('BG Download failed:', chrome.runtime.lastError);
                    else console.log('BG Download started:', id);
                });
                chrome.tabs.remove(tabId);
            } else {
                console.log('Download skipped (Duplicate). Closing tab.');
                chrome.tabs.remove(tabId);
            }
        }
    }
});

// --- STANDARD DOWNLOAD LISTENER ---
chrome.downloads.onDeterminingFilename.addListener(async (item, suggest) => {
    // If not scraping and not a Grok file, ignore
    if (!isScraping && !item.url.includes('imagine-public')) return;

    const finalPath = await generateFilename(item.url, item.filename);

    if (finalPath) {
        suggest({ filename: finalPath, conflictAction: 'overwrite' });
    } else {
        // Cancel download because it's a duplicate
        // To cancel, we simply do not suggest (BUT we must be careful, API doc says we MUST call suggest?)
        // Actually, we can just suggest a 'DUPLICATES_TRASH/...' folder or something, 
        // OR simply let it fail if we can.
        // Chrome API `cancel` is on `chrome.downloads.cancel(id)`, but we don't have ID yet in this synchronous event easily?
        // Actually `item.id` exists.
        chrome.downloads.cancel(item.id);
    }
});
