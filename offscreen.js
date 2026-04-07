// offscreen.js — Runs in an offscreen document (has DOM access, can read file:// URLs)
// Used to read downloaded files for R2 upload in Cloud Only / Dual Write mode

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action !== 'READ_FILE_FOR_UPLOAD') return false;

    console.log('[Offscreen] Received READ_FILE_FOR_UPLOAD for:', request.filePath);

    (async () => {
        try {
            console.log('[Offscreen] Fetching file://' + request.filePath);
            const resp = await fetch('file://' + request.filePath);
            if (!resp.ok) throw new Error(`Failed to read file: HTTP ${resp.status}`);
            console.log('[Offscreen] File fetched, reading blob...');
            const blob = await resp.blob();

            // Convert to ArrayBuffer then to base64 for transfer
            const buffer = await blob.arrayBuffer();
            const bytes = new Uint8Array(buffer);
            let binary = '';
            for (let i = 0; i < bytes.length; i++) {
                binary += String.fromCharCode(bytes[i]);
            }
            const base64 = btoa(binary);

            sendResponse({
                ok: true,
                base64,
                size: blob.size,
                type: blob.type || request.contentType || 'application/octet-stream'
            });
        } catch (e) {
            sendResponse({ ok: false, error: e.message });
        }
    })();
    return true; // async response
});
