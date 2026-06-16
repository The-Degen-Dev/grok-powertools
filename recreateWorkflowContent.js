(function (root, factory) {
    const utils =
        root && root.GrokRecreateWorkflowUtils
            ? root.GrokRecreateWorkflowUtils
            : typeof require === 'function'
              ? require('./recreateWorkflowUtils.js')
              : null;
    const actions = factory(utils, root);

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = actions;
    }

    if (root) {
        root.GrokRecreateContentActions = actions;
    }
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function (utils, root) {
    function fail(error) {
        const wrapped = new Error(error);
        wrapped.code = error;
        return wrapped;
    }

    function getUtils(options = {}) {
        const workflowUtils = options.utils || utils;
        if (!workflowUtils) throw fail('reference_capture_failed');
        return workflowUtils;
    }

    function waitForCondition(predicate, options = {}) {
        const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 10000;
        const intervalMs = Number.isFinite(options.intervalMs) ? options.intervalMs : 250;

        return new Promise((resolve, reject) => {
            let settled = false;
            let pollTimer = null;
            const deadlineTimer = setTimeout(() => {
                finish(null, fail(options.timeoutError || 'timeout'));
            }, timeoutMs);

            function finish(value, error) {
                if (settled) return;
                settled = true;
                clearTimeout(deadlineTimer);
                if (pollTimer) clearTimeout(pollTimer);

                if (error) {
                    reject(error);
                    return;
                }

                resolve(value);
            }

            function poll() {
                Promise.resolve()
                    .then(() => predicate())
                    .then((value) => {
                        if (settled) return;

                        if (value) {
                            finish(value);
                            return;
                        }

                        pollTimer = setTimeout(poll, intervalMs);
                    })
                    .catch((error) => finish(null, error));
            }

            poll();
        });
    }

    function readBlobAsDataUrl(blob) {
        if (!blob) return Promise.reject(fail('reference_missing'));

        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const dataUrl = String(reader.result || '');
                if (!dataUrl) {
                    reject(fail('reference_capture_failed'));
                    return;
                }
                resolve(dataUrl);
            };
            reader.onerror = () => reject(fail('reference_capture_failed'));
            reader.onabort = () => reject(fail('reference_capture_failed'));
            reader.readAsDataURL(blob);
        });
    }

    async function readFileAsRecreateReference(file, source = 'local') {
        if (!file) throw fail('reference_missing');

        const dataUrl = await readBlobAsDataUrl(file);
        return getUtils().normalizeRecreateReference({
            name: file.name || 'reference-image',
            mimeType: file.type,
            dataUrl,
            source
        });
    }

    function decodeBase64(base64) {
        if (typeof atob === 'function') return atob(base64);
        return Buffer.from(base64, 'base64').toString('binary');
    }

    function dataUrlToFile(reference) {
        const workflowUtils = getUtils();
        const normalized = workflowUtils.normalizeRecreateReference(reference);
        const parsed = workflowUtils.parseRecreateDataUrl(normalized.dataUrl);
        const binary = decodeBase64(parsed.base64);
        const bytes = new Uint8Array(binary.length);

        for (let index = 0; index < binary.length; index++) {
            bytes[index] = binary.charCodeAt(index);
        }

        return new File([bytes], normalized.name || 'reference-image', { type: normalized.mimeType });
    }

    function getElementStyle(element) {
        const view = element.ownerDocument && element.ownerDocument.defaultView;
        if (view && typeof view.getComputedStyle === 'function') return view.getComputedStyle(element);
        if (root && typeof root.getComputedStyle === 'function') return root.getComputedStyle(element);
        return null;
    }

    function isVisibleElement(element) {
        const rect = element.getBoundingClientRect();
        const style = getElementStyle(element);
        const opacity = style ? Number(style.opacity || 1) : 1;

        return (
            rect.width > 0 &&
            rect.height > 0 &&
            (!style || style.display !== 'none') &&
            (!style || style.visibility !== 'hidden') &&
            opacity > 0
        );
    }

    function collectGeneratedImageCandidates(documentRef = document) {
        return Array.from(documentRef.querySelectorAll('img'))
            .filter(isVisibleElement)
            .map((img) => {
                const rect = img.getBoundingClientRect();

                return {
                    element: img,
                    src: img.currentSrc || img.src || '',
                    alt: img.getAttribute('alt') || '',
                    naturalWidth: img.naturalWidth || 0,
                    naturalHeight: img.naturalHeight || 0,
                    rect: {
                        left: rect.left,
                        top: rect.top,
                        width: rect.width,
                        height: rect.height
                    }
                };
            });
    }

    function getDocumentRef(options = {}) {
        if (options.documentRef) return options.documentRef;
        if (typeof document !== 'undefined') return document;
        throw fail('reference_capture_failed');
    }

    function fetchViaBridgeAsBlobUrl(url, options = {}) {
        if (!url) return Promise.reject(fail('reference_missing'));

        const documentRef = getDocumentRef(options);
        const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 15000;
        const requestId = `recreate_fetch_${Date.now()}_${Math.random().toString(16).slice(2)}`;

        return new Promise((resolve, reject) => {
            let settled = false;
            const timer = setTimeout(() => {
                finish(null, fail('reference_capture_failed'));
            }, timeoutMs);

            function finish(blobUrl, error) {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                documentRef.removeEventListener('__gpt_fetch_media_result', onResult);

                if (error) {
                    reject(error);
                    return;
                }

                resolve(blobUrl);
            }

            function onResult(event) {
                const detail = event.detail || {};
                if (detail.requestId !== requestId) return;

                if (detail.error || !detail.blobUrl) {
                    finish(null, fail('reference_capture_failed'));
                    return;
                }

                finish(detail.blobUrl);
            }

            documentRef.addEventListener('__gpt_fetch_media_result', onResult);

            try {
                documentRef.dispatchEvent(
                    new CustomEvent('__gpt_fetch_media', {
                        detail: { url, requestId }
                    })
                );
            } catch {
                finish(null, fail('reference_capture_failed'));
            }
        });
    }

    async function sourceToDataUrl(src, options = {}) {
        const value = String(src || '');
        if (!value) throw fail('reference_missing');
        if (value.startsWith('data:image/')) return value;

        const workflowUtils = getUtils(options);
        const shouldUseBridge = workflowUtils.isTrustedGrokMediaUrl(value);
        let fetchUrl = null;

        try {
            fetchUrl = shouldUseBridge ? await fetchViaBridgeAsBlobUrl(value, options) : value;
            const response = await fetch(fetchUrl);
            if (!response || !response.ok) throw fail('reference_capture_failed');

            return await readBlobAsDataUrl(await response.blob());
        } catch {
            throw fail('reference_capture_failed');
        } finally {
            if (
                shouldUseBridge &&
                fetchUrl &&
                fetchUrl.startsWith('blob:') &&
                typeof URL !== 'undefined' &&
                typeof URL.revokeObjectURL === 'function'
            ) {
                URL.revokeObjectURL(fetchUrl);
            }
        }
    }

    async function selectCurrentGeneratedImage(options = {}) {
        const workflowUtils = getUtils(options);
        const documentRef = getDocumentRef(options);
        const documentElement = documentRef.documentElement || {};
        const view = documentRef.defaultView || root || {};
        const viewport = options.viewport || {
            width: view.innerWidth || documentElement.clientWidth || 0,
            height: view.innerHeight || documentElement.clientHeight || 0
        };
        const candidates = collectGeneratedImageCandidates(documentRef);
        const selected = workflowUtils.chooseBestGeneratedImageCandidate(candidates, viewport);
        if (!selected) throw fail('reference_missing');

        const dataUrl = await sourceToDataUrl(selected.src, { ...options, utils: workflowUtils, documentRef });
        return workflowUtils.normalizeRecreateReference({
            name: 'current-grok-image.png',
            mimeType: workflowUtils.parseRecreateDataUrl(dataUrl).mimeType,
            dataUrl,
            source: 'current-grok-image'
        });
    }

    return {
        collectGeneratedImageCandidates,
        dataUrlToFile,
        fetchViaBridgeAsBlobUrl,
        readBlobAsDataUrl,
        readFileAsRecreateReference,
        selectCurrentGeneratedImage,
        sourceToDataUrl,
        waitForCondition
    };
});
