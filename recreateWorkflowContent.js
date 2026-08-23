(function (root, factory) {
    const utils =
        root && root.GrokRecreateWorkflowUtils
            ? root.GrokRecreateWorkflowUtils
            : typeof require === 'function'
              ? require('./recreateWorkflowUtils.js')
              : null;
    const grokAdapter =
        root && root.GrokPowerToolsGrokImagineAdapter
            ? root.GrokPowerToolsGrokImagineAdapter
            : typeof require === 'function'
              ? require('./grokImagineAdapter.js')
              : null;
    const actions = factory(utils, grokAdapter, root);

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = actions;
    }

    if (root) {
        root.GrokRecreateContentActions = actions;
    }
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function (utils, grokAdapter, root) {
    function fail(error) {
        const wrapped = new Error(error);
        wrapped.code = error;
        return wrapped;
    }

    const DEFAULT_IMAGINE_RESULT_TIMEOUT_MS = 7 * 60 * 1000;
    const DEFAULT_IMAGINE_PLACEHOLDER_TIMEOUT_MS = 90 * 1000;

    function abortError() {
        return fail('workflow_aborted');
    }

    function throwIfAborted(signal) {
        if (signal && signal.aborted) throw abortError();
    }

    function isAbortFailure(error, signal = null) {
        return !!(
            signal?.aborted
            || error?.code === 'workflow_aborted'
            || error?.name === 'AbortError'
        );
    }

    function withAbort(promise, signal) {
        if (!signal) return Promise.resolve(promise);
        throwIfAborted(signal);

        return new Promise((resolve, reject) => {
            let settled = false;
            const onAbort = () => finish(null, abortError());

            function finish(value, error) {
                if (settled) return;
                settled = true;
                signal.removeEventListener('abort', onAbort);
                if (error) {
                    reject(error);
                    return;
                }
                resolve(value);
            }

            signal.addEventListener('abort', onAbort, { once: true });
            Promise.resolve(promise).then(
                (value) => finish(value),
                (error) => finish(null, error)
            );
        });
    }

    function getUtils(options = {}) {
        const workflowUtils = options.utils || utils;
        if (!workflowUtils) throw fail('reference_capture_failed');
        return workflowUtils;
    }

    function getGrokAdapter(options = {}) {
        return options.grokAdapter || grokAdapter || null;
    }

    function waitForCondition(predicate, options = {}) {
        const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 10000;
        const intervalMs = Number.isFinite(options.intervalMs) ? options.intervalMs : 250;
        const signal = options.signal || null;

        return new Promise((resolve, reject) => {
            let settled = false;
            let pollTimer = null;
            const onAbort = () => finish(null, abortError());
            const deadlineTimer = setTimeout(() => {
                finish(null, fail(options.timeoutError || 'timeout'));
            }, timeoutMs);

            function finish(value, error) {
                if (settled) return;
                settled = true;
                clearTimeout(deadlineTimer);
                if (pollTimer) clearTimeout(pollTimer);
                if (signal) signal.removeEventListener('abort', onAbort);

                if (error) {
                    reject(error);
                    return;
                }

                resolve(value);
            }

            function poll() {
                Promise.resolve()
                    .then(() => throwIfAborted(signal))
                    .then(() => predicate())
                    .then((value) => {
                        if (settled) return;
                        throwIfAborted(signal);

                        if (value) {
                            finish(value);
                            return;
                        }

                        pollTimer = setTimeout(poll, intervalMs);
                    })
                    .catch((error) => finish(null, error));
            }

            if (signal) {
                if (signal.aborted) {
                    finish(null, abortError());
                    return;
                }
                signal.addEventListener('abort', onAbort, { once: true });
            }
            poll();
        });
    }

    function delay(ms, signal = null) {
        return withAbort(new Promise((resolve) => {
            setTimeout(resolve, ms);
        }), signal);
    }

    function readBlobAsDataUrl(blob, options = {}) {
        if (!blob) return Promise.reject(fail('reference_missing'));
        const signal = options.signal || null;

        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            let settled = false;
            const onAbort = () => {
                try {
                    reader.abort();
                } catch {
                    // Reader may already be settled.
                }
                finish(null, abortError());
            };

            function finish(value, error) {
                if (settled) return;
                settled = true;
                if (signal) signal.removeEventListener('abort', onAbort);
                if (error) {
                    reject(error);
                    return;
                }
                resolve(value);
            }

            reader.onload = () => {
                const dataUrl = String(reader.result || '');
                if (!dataUrl) {
                    finish(null, fail('reference_capture_failed'));
                    return;
                }
                finish(dataUrl);
            };
            reader.onerror = () => finish(null, fail('reference_capture_failed'));
            reader.onabort = () => finish(null, signal?.aborted ? abortError() : fail('reference_capture_failed'));
            if (signal) {
                if (signal.aborted) {
                    finish(null, abortError());
                    return;
                }
                signal.addEventListener('abort', onAbort, { once: true });
            }
            reader.readAsDataURL(blob);
        });
    }

    async function readFileAsRecreateReference(file, source = 'local') {
        if (!file) throw fail('reference_missing');

        const dataUrl = await readBlobAsDataUrl(file);
        const workflowUtils = getUtils();
        const parsed = workflowUtils.parseRecreateMediaDataUrl
            ? workflowUtils.parseRecreateMediaDataUrl(dataUrl)
            : workflowUtils.parseRecreateDataUrl(dataUrl);
        const kind = parsed.kind === 'video' ? 'video' : 'image';

        return getUtils().normalizeRecreateReference({
            name: file.name || (kind === 'video' ? 'reference-video' : 'reference-image'),
            mimeType: file.type || parsed.mimeType,
            dataUrl,
            source,
            kind
        });
    }

    function decodeBase64(base64) {
        if (typeof atob === 'function') return atob(base64);
        return Buffer.from(base64, 'base64').toString('binary');
    }

    function dataUrlToFile(reference) {
        const workflowUtils = getUtils();
        const normalized = workflowUtils.normalizeRecreateReference(reference);
        const parsed = workflowUtils.parseRecreateMediaDataUrl
            ? workflowUtils.parseRecreateMediaDataUrl(normalized.dataUrl)
            : workflowUtils.parseRecreateDataUrl(normalized.dataUrl);
        const binary = decodeBase64(parsed.base64);
        const bytes = new Uint8Array(binary.length);

        for (let index = 0; index < binary.length; index++) {
            bytes[index] = binary.charCodeAt(index);
        }

        return new File([bytes], normalized.name || 'reference-image', { type: normalized.mimeType });
    }

    function dataUrlToBytes(dataUrl, options = {}) {
        const workflowUtils = getUtils(options);
        const parsed = workflowUtils.parseRecreateMediaDataUrl
            ? workflowUtils.parseRecreateMediaDataUrl(dataUrl)
            : workflowUtils.parseRecreateDataUrl(dataUrl);
        const binary = decodeBase64(parsed.base64);
        const bytes = new Uint8Array(binary.length);

        for (let index = 0; index < binary.length; index++) {
            bytes[index] = binary.charCodeAt(index);
        }

        return bytes;
    }

    async function sha256Bytes(bytes) {
        try {
            const cryptoApi = root && root.crypto ? root.crypto : typeof crypto !== 'undefined' ? crypto : null;
            if (cryptoApi && cryptoApi.subtle && typeof cryptoApi.subtle.digest === 'function') {
                const digest = await cryptoApi.subtle.digest('SHA-256', bytes);
                return Array.from(new Uint8Array(digest))
                    .map((byte) => byte.toString(16).padStart(2, '0'))
                    .join('');
            }
        } catch {
            // Fall through to Node fallback in tests.
        }

        try {
            if (typeof require === 'function') {
                return require('crypto').createHash('sha256').update(Buffer.from(bytes)).digest('hex');
            }
        } catch {
            // Ignore unavailable hashing.
        }

        return null;
    }

    async function hashReferenceDataUrl(dataUrl, options = {}) {
        if (!dataUrl) return null;
        try {
            return await sha256Bytes(dataUrlToBytes(dataUrl, options));
        } catch {
            return null;
        }
    }

    function getReferenceKind(reference) {
        return reference && reference.kind === 'video' ? 'video' : 'image';
    }

    function dataUrlMatchesMediaKind(dataUrl, mediaKind) {
        const value = String(dataUrl || '').trim();
        if (mediaKind === 'video') return value.startsWith('data:video/') || value.startsWith('data:image/gif;');
        return value.startsWith('data:image/');
    }

    function expectedMediaKind(options = {}) {
        return options.expectedKind === 'video' || options.mediaKind === 'video' ? 'video' : 'image';
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
                    complete: img.complete !== false,
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

    function getVideoCandidateSource(video) {
        const directSrc = video.currentSrc || video.src || '';
        if (directSrc) return directSrc;

        const source = video.querySelector && video.querySelector('source[src]');
        return source ? source.getAttribute('src') || '' : '';
    }

    function getVideoBufferedSeconds(video) {
        try {
            if (!video.buffered || !video.buffered.length) return 0;
            return Number(video.buffered.end(video.buffered.length - 1) || 0);
        } catch {
            return 0;
        }
    }

    function collectGeneratedVideoCandidates(documentRef = document) {
        return Array.from(documentRef.querySelectorAll('video'))
            .filter(isVisibleElement)
            .map((video) => {
                const rect = video.getBoundingClientRect();

                return {
                    element: video,
                    mediaKind: 'video',
                    src: getVideoCandidateSource(video),
                    poster: video.getAttribute('poster') || '',
                    readyState: Number(video.readyState || 0),
                    duration: Number(video.duration || 0),
                    bufferedSeconds: getVideoBufferedSeconds(video),
                    videoWidth: Number(video.videoWidth || 0),
                    videoHeight: Number(video.videoHeight || 0),
                    rect: {
                        left: rect.left,
                        top: rect.top,
                        width: rect.width,
                        height: rect.height
                    }
                };
            });
    }

    function collectGeneratedResultCandidates(documentRef = document, mediaKind = 'image') {
        const workflowUtils = getUtils();
        const candidates = mediaKind === 'video'
            ? collectGeneratedVideoCandidates(documentRef)
            : collectGeneratedImageCandidates(documentRef);

        return candidates.filter((candidate) => {
            const rect = candidate.rect || {};
            const renderedWidth = Number(rect.width || 0);
            const renderedHeight = Number(rect.height || 0);
            const looksGenerated = mediaKind === 'video'
                ? getGeneratedResultSourceKind(candidate.src, 'video') !== 'other'
                : (
                    typeof workflowUtils.isLikelyGeneratedImageCandidate === 'function'
                        ? workflowUtils.isLikelyGeneratedImageCandidate(candidate)
                        : candidate.alt === 'Generated image'
                );

            return (
                looksGenerated &&
                !isInsidePowerToolsOverlay(candidate.element) &&
                renderedWidth >= 120 &&
                renderedHeight >= 120
            );
        });
    }

    function getGeneratedResultCandidateSignature(candidate) {
        return [
            candidate.mediaKind || 'image',
            candidate.src || '',
            candidate.poster || '',
            candidate.alt || '',
            candidate.naturalWidth || 0,
            candidate.naturalHeight || 0,
            candidate.videoWidth || 0,
            candidate.videoHeight || 0,
            candidate.duration || 0
        ].join('|');
    }

    function normalizePersistedResultUrl(value) {
        try {
            const parsed = new URL(String(value || ''));
            if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
            parsed.search = '';
            parsed.hash = '';
            return parsed.toString().slice(0, 2048);
        } catch {
            return '';
        }
    }

    function getPersistedGeneratedResultCandidateSignature(candidate, mediaKind = candidate?.mediaKind || 'image') {
        const kind = mediaKind === 'video' ? 'video' : 'image';
        const dimensions = kind === 'video'
            ? {
                width: Number(candidate?.videoWidth || 0),
                height: Number(candidate?.videoHeight || 0)
            }
            : {
                width: Number(candidate?.naturalWidth || 0),
                height: Number(candidate?.naturalHeight || 0)
            };

        return JSON.stringify({
            version: 1,
            mediaKind: kind,
            sourceKind: getGeneratedResultSourceKind(candidate?.src, kind),
            url: normalizePersistedResultUrl(candidate?.src),
            poster: normalizePersistedResultUrl(candidate?.poster),
            ...dimensions
        });
    }

    function getGeneratedAssetId(value) {
        return String(value || '').match(
            /\/generated\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i
        )?.[1]?.toLowerCase() || '';
    }

    function createGeneratedResultSnapshot(documentRef = document, mediaKind = 'image') {
        const candidates = collectGeneratedResultCandidates(documentRef, mediaKind);
        const elementSignatures = new WeakMap();
        candidates.forEach((candidate) => {
            elementSignatures.set(candidate.element, getGeneratedResultCandidateSignature(candidate));
        });

        return {
            elements: new WeakSet(candidates.map((candidate) => candidate.element)),
            elementSignatures,
            signatures: new Set(candidates.map(getGeneratedResultCandidateSignature)),
            persistedSignatures: new Set(
                candidates.map((candidate) => getPersistedGeneratedResultCandidateSignature(candidate, mediaKind))
            ),
            assetIds: new Set(candidates.map((candidate) => getGeneratedAssetId(candidate.src)).filter(Boolean))
        };
    }

    function resultCandidateIsNew(candidate, previousSnapshot) {
        if (!previousSnapshot) return true;

        const signature = getGeneratedResultCandidateSignature(candidate);
        const persistedSignature = getPersistedGeneratedResultCandidateSignature(
            candidate,
            candidate?.mediaKind || 'image'
        );
        const assetId = getGeneratedAssetId(candidate.src);
        if (assetId && previousSnapshot.assetIds?.has(assetId)) return false;
        if (previousSnapshot.persistedSignatures?.has(persistedSignature)) return false;
        if (previousSnapshot.elementSignatures && previousSnapshot.elementSignatures.has(candidate.element)) {
            return previousSnapshot.elementSignatures.get(candidate.element) !== signature;
        }

        if (previousSnapshot.elements && previousSnapshot.elements.has(candidate.element)) return false;
        if (previousSnapshot.signatures && previousSnapshot.signatures.has(signature)) return false;
        return true;
    }

    async function recordRunReceipt(payload, options = {}) {
        if (!options.authority) return;
        const runtime = getChromeRuntime(options);
        if (!runtime || typeof runtime.sendMessage !== 'function') throw fail('workflow_unavailable');
        const response = await withAbort(runtime.sendMessage({
            action: 'GPT_RECREATE_RESULT_BASELINE',
            authority: options.authority,
            ...payload
        }), options.signal);
        if (!response || response.ok !== true) {
            throw fail((response && response.error) || 'recreate_authority_persist_failed');
        }
        return response;
    }

    async function confirmOperationDocument(options = {}) {
        return await recordRunReceipt({ documentReceipt: true }, options);
    }

    async function recordSubmissionState(submissionState, options = {}) {
        return await recordRunReceipt({ submissionState }, options);
    }

    async function recordResultBaseline(previousSnapshot, mediaKind, options = {}) {
        return await recordRunReceipt({
            mediaKind,
            assetIds: Array.from(previousSnapshot?.assetIds || []),
            signatures: Array.from(previousSnapshot?.persistedSignatures || [])
        }, options);
    }

    function getGeneratedResultSourceKind(src, mediaKind = 'image') {
        const value = String(src || '');
        const workflowUtils = getUtils();

        if (mediaKind === 'video') {
            if (typeof workflowUtils.isTrustedGrokVideoUrl === 'function' && workflowUtils.isTrustedGrokVideoUrl(value)) {
                return 'trusted-grok-video';
            }
            if (value.startsWith('data:video/') || value.startsWith('data:image/gif;')) return 'data-url';
            if (value.startsWith('blob:')) return 'blob-url';
            if (!value) return 'empty';
            return 'other';
        }

        if (typeof workflowUtils.isTrustedGrokMediaUrl === 'function' && workflowUtils.isTrustedGrokMediaUrl(value)) {
            return 'trusted-grok-media';
        }
        if (value.startsWith('data:image/')) return 'data-url';
        if (value.startsWith('blob:')) return 'blob-url';
        if (!value) return 'empty';
        return 'other';
    }

    function trustedResultUrlLooksOpenable(src) {
        try {
            const parsed = new URL(String(src || ''));
            const path = parsed.pathname.toLowerCase();
            return !/(?:preview|thumbnail|thumb|avatar|placeholder|blur)/.test(path);
        } catch {
            return false;
        }
    }

    function getOpenableSurfaceKind(candidate, mediaKind = 'image') {
        const element = candidate && candidate.element;
        if (!element) return 'none';

        let current = element;
        for (let depth = 0; current && depth < 5; depth++) {
            if (current.matches && current.matches('a[href]')) return 'link';
            if (current.matches && current.matches('button, [role="button"], [tabindex]')) return 'interactive';
            current = current.parentElement;
        }

        const sourceKind = getGeneratedResultSourceKind(candidate.src, mediaKind);
        if (
            (sourceKind === 'trusted-grok-media' || sourceKind === 'trusted-grok-video') &&
            trustedResultUrlLooksOpenable(candidate.src)
        ) {
            return 'direct-media-url';
        }

        return 'none';
    }

    function isFullSizeGeneratedResultCandidate(candidate, mediaKind = 'image') {
        if (mediaKind === 'video') {
            const rect = candidate.rect || {};
            const renderedMin = Math.min(Number(rect.width || 0), Number(rect.height || 0));
            const videoMax = Math.max(Number(candidate.videoWidth || 0), Number(candidate.videoHeight || 0));
            const hasVideoMetadata =
                Number(candidate.readyState || 0) >= 1 ||
                Number.isFinite(candidate.duration) && Number(candidate.duration) > 0 ||
                videoMax >= 256;

            return renderedMin >= 120 && hasVideoMetadata;
        }

        const naturalWidth = Number(candidate.naturalWidth || 0);
        const naturalHeight = Number(candidate.naturalHeight || 0);
        const naturalMax = Math.max(naturalWidth, naturalHeight);
        const naturalMin = Math.min(naturalWidth, naturalHeight);
        const rect = candidate.rect || {};
        const renderedMin = Math.min(Number(rect.width || 0), Number(rect.height || 0));

        return (
            candidate.complete !== false &&
            naturalMax >= 768 &&
            naturalMin >= 512 &&
            renderedMin >= 120
        );
    }

    function isCredibleGeneratedResultCandidate(candidate, mediaKind = 'image') {
        const sourceKind = getGeneratedResultSourceKind(candidate.src, mediaKind);

        if (mediaKind === 'video') {
            if (sourceKind === 'trusted-grok-video') {
                return isFullSizeGeneratedResultCandidate(candidate, mediaKind) && getOpenableSurfaceKind(candidate, mediaKind) !== 'none';
            }

            if (sourceKind === 'data-url' || sourceKind === 'blob-url') {
                return isFullSizeGeneratedResultCandidate(candidate, mediaKind);
            }

            return false;
        }

        if (sourceKind === 'trusted-grok-media') {
            return isFullSizeGeneratedResultCandidate(candidate, mediaKind) && getOpenableSurfaceKind(candidate, mediaKind) !== 'none';
        }

        if (sourceKind === 'data-url' || sourceKind === 'blob-url') {
            return isFullSizeGeneratedResultCandidate(candidate, mediaKind);
        }

        return false;
    }

    function getDocumentLocation(documentRef = document) {
        const view = documentRef.defaultView || {};
        return view.location || {};
    }

    function pageLooksLikeImagineResultSurface(documentRef = document) {
        const location = getDocumentLocation(documentRef);
        const pathname = String(location.pathname || '');
        return pathname === '/imagine' || pathname.startsWith('/imagine/');
    }

    async function verifyTrustedMediaCandidate(candidate, options = {}) {
        const workflowUtils = getUtils(options);
        const mediaKind = options.mediaKind === 'video' ? 'video' : 'image';
        const dataUrl = await sourceToDataUrl(candidate.src, {
            ...options,
            timeoutMs: Number.isFinite(options.resultMediaFetchTimeoutMs)
                ? options.resultMediaFetchTimeoutMs
                : 15000,
            expectedKind: mediaKind,
            utils: workflowUtils
        });
        const parsed = mediaKind === 'video' && workflowUtils.parseRecreateMediaDataUrl
            ? workflowUtils.parseRecreateMediaDataUrl(dataUrl)
            : workflowUtils.parseRecreateDataUrl(dataUrl);

        if (parsed.byteLength < 10 * 1024) {
            return { ok: false, error: 'result_media_too_small' };
        }

        return {
            ok: true,
            byteLength: parsed.byteLength,
            mediaHash: await hashReferenceDataUrl(dataUrl, { utils: workflowUtils })
        };
    }

    async function verifyInlineMediaCandidate(candidate, options = {}) {
        const workflowUtils = getUtils(options);
        const mediaKind = options.mediaKind === 'video' ? 'video' : 'image';
        const dataUrl = await sourceToDataUrl(candidate.src, {
            ...options,
            timeoutMs: Number.isFinite(options.resultMediaFetchTimeoutMs)
                ? options.resultMediaFetchTimeoutMs
                : 15000,
            expectedKind: mediaKind,
            utils: workflowUtils
        });
        const parsed = mediaKind === 'video' && workflowUtils.parseRecreateMediaDataUrl
            ? workflowUtils.parseRecreateMediaDataUrl(dataUrl)
            : workflowUtils.parseRecreateDataUrl(dataUrl);

        if (parsed.byteLength < 10 * 1024) {
            return { ok: false, error: 'result_media_too_small' };
        }

        return {
            ok: true,
            byteLength: parsed.byteLength,
            mediaHash: await hashReferenceDataUrl(dataUrl, { utils: workflowUtils })
        };
    }

    function normalizeResultOpenabilityError(error) {
        const code = String((error && (error.code || error.message)) || '');
        if (code.startsWith('native_click_') || code.startsWith('result_post_')) return code;
        if (code === 'timeout') return 'result_post_open_failed';
        return 'result_media_fetch_failed';
    }

    async function verifyGeneratedResultCandidateOpenable(candidate, options = {}) {
        const mediaKind = options.mediaKind === 'video' ? 'video' : 'image';
        if (!isCredibleGeneratedResultCandidate(candidate, mediaKind)) {
            return { ok: false, error: 'result_candidate_not_credible' };
        }

        try {
            const sourceKind = getGeneratedResultSourceKind(candidate.src, mediaKind);
            if (sourceKind === 'data-url' || sourceKind === 'blob-url') {
                const mediaVerification = await verifyInlineMediaCandidate(candidate, options);
                if (!mediaVerification.ok) return mediaVerification;

                return {
                    ok: true,
                    summary: {
                        ...summarizeGeneratedResultCandidate(candidate, mediaKind),
                        byteLength: mediaVerification.byteLength,
                        outputMediaHash: mediaVerification.mediaHash || null,
                        openable: true,
                        openableSurface: sourceKind === 'blob-url' ? 'inline-blob-media' : 'inline-data-media'
                    }
                };
            }

            const mediaVerification = await verifyTrustedMediaCandidate(candidate, options);
            if (!mediaVerification.ok) return mediaVerification;

            return {
                ok: true,
                summary: {
                    ...summarizeGeneratedResultCandidate(candidate, mediaKind),
                    byteLength: mediaVerification.byteLength,
                    outputMediaHash: mediaVerification.mediaHash || null,
                    openable: true,
                    openableSurface: getOpenableSurfaceKind(candidate, mediaKind)
                }
            };
        } catch (error) {
            if (isAbortFailure(error, options.signal)) throw abortError();
            return {
                ok: false,
                error: normalizeResultOpenabilityError(error)
            };
        }
    }

    function isPlaceholderGeneratedResultCandidate(candidate, mediaKind = 'image') {
        const sourceKind = getGeneratedResultSourceKind(candidate.src, mediaKind);
        if (mediaKind === 'video') {
            const rect = candidate.rect || {};
            const renderedMax = Math.max(Number(rect.width || 0), Number(rect.height || 0));
            return sourceKind === 'data-url' && Number(candidate.readyState || 0) < 1 && renderedMax >= 180;
        }

        const naturalMax = Math.max(Number(candidate.naturalWidth || 0), Number(candidate.naturalHeight || 0));
        const rect = candidate.rect || {};
        const renderedMax = Math.max(Number(rect.width || 0), Number(rect.height || 0));

        return sourceKind === 'data-url' && naturalMax > 0 && naturalMax < 512 && renderedMax >= 180;
    }

    function summarizeGeneratedResultCandidate(candidate, mediaKind = 'image') {
        const rect = candidate.rect || {};
        const sourceKind = getGeneratedResultSourceKind(candidate.src, mediaKind);
        const trustedUrl = sourceKind === 'trusted-grok-media' || sourceKind === 'trusted-grok-video'
            ? candidate.src
            : '';

        return {
            mediaKind,
            sourceKind,
            openableSurface: getOpenableSurfaceKind(candidate, mediaKind),
            url: trustedUrl,
            naturalWidth: Number(candidate.naturalWidth || 0),
            naturalHeight: Number(candidate.naturalHeight || 0),
            videoWidth: Number(candidate.videoWidth || 0),
            videoHeight: Number(candidate.videoHeight || 0),
            duration: Number(candidate.duration || 0),
            bufferedSeconds: Number(candidate.bufferedSeconds || 0),
            renderedWidth: Number(rect.width || 0),
            renderedHeight: Number(rect.height || 0)
        };
    }

    function inspectImagineResultState(documentRef = document, previousSnapshot = null, options = {}) {
        const mediaKind = options.mediaKind === 'video' ? 'video' : 'image';
        const candidates = collectGeneratedResultCandidates(documentRef, mediaKind);
        const newCandidates = candidates.filter((candidate) => resultCandidateIsNew(candidate, previousSnapshot));
        const readyCandidate = newCandidates.find((candidate) => isCredibleGeneratedResultCandidate(candidate, mediaKind)) || null;
        const placeholderCandidates = newCandidates.filter((candidate) => isPlaceholderGeneratedResultCandidate(candidate, mediaKind));
        const trustedCandidates = newCandidates.filter((candidate) => {
            const sourceKind = getGeneratedResultSourceKind(candidate.src, mediaKind);
            return sourceKind === 'trusted-grok-media' || sourceKind === 'trusted-grok-video';
        });
        const fullSizeCandidates = newCandidates.filter((candidate) => isFullSizeGeneratedResultCandidate(candidate, mediaKind));
        const sourceKinds = Array.from(
            new Set(newCandidates.map((candidate) => getGeneratedResultSourceKind(candidate.src, mediaKind)))
        );

        return {
            mediaKind,
            ready: !!readyCandidate,
            candidate: readyCandidate,
            summary: readyCandidate ? summarizeGeneratedResultCandidate(readyCandidate, mediaKind) : null,
            candidateCount: candidates.length,
            newCandidateCount: newCandidates.length,
            placeholderCount: placeholderCandidates.length,
            trustedCount: trustedCandidates.length,
            fullSizeCount: fullSizeCandidates.length,
            openableCount: readyCandidate ? 1 : 0,
            largestNaturalWidth: Math.max(0, ...newCandidates.map((candidate) => Number(candidate.naturalWidth || 0))),
            largestNaturalHeight: Math.max(0, ...newCandidates.map((candidate) => Number(candidate.naturalHeight || 0))),
            largestVideoWidth: Math.max(0, ...newCandidates.map((candidate) => Number(candidate.videoWidth || 0))),
            largestVideoHeight: Math.max(0, ...newCandidates.map((candidate) => Number(candidate.videoHeight || 0))),
            sourceKinds
        };
    }

    function buildImagineResultDiagnostics(state, timing = {}) {
        return {
            resultCandidateCount: state ? state.candidateCount : 0,
            newResultCandidateCount: state ? state.newCandidateCount : 0,
            placeholderResultCount: state ? state.placeholderCount : 0,
            trustedResultCount: state ? state.trustedCount : 0,
            fullSizeResultCount: state ? state.fullSizeCount : 0,
            openableResultCount: state ? state.openableCount : 0,
            largestNaturalWidth: state ? state.largestNaturalWidth : 0,
            largestNaturalHeight: state ? state.largestNaturalHeight : 0,
            largestVideoWidth: state ? state.largestVideoWidth : 0,
            largestVideoHeight: state ? state.largestVideoHeight : 0,
            mediaKind: state ? state.mediaKind : 'image',
            sourceKinds: state ? state.sourceKinds : [],
            ...timing
        };
    }

    function createImagineResultError(code, state, timing = {}) {
        const error = fail(code);
        error.diagnostics = buildImagineResultDiagnostics(state, timing);
        return error;
    }

    async function waitForImagineResult(documentRef = document, previousSnapshot = null, options = {}) {
        const resultTimeoutMs = Number.isFinite(options.resultTimeoutMs)
            ? options.resultTimeoutMs
            : DEFAULT_IMAGINE_RESULT_TIMEOUT_MS;
        const placeholderTimeoutMs = Number.isFinite(options.placeholderTimeoutMs)
            ? options.placeholderTimeoutMs
            : DEFAULT_IMAGINE_PLACEHOLDER_TIMEOUT_MS;
        const intervalMs = Number.isFinite(options.intervalMs) ? options.intervalMs : 500;
        const now = typeof options.now === 'function' ? options.now : Date.now;
        const startedAt = now();
        let firstPlaceholderAt = null;
        const mediaKind = options.mediaKind === 'video' ? 'video' : 'image';
        let lastState = inspectImagineResultState(documentRef, previousSnapshot, { mediaKind });
        let lastOpenabilityError = null;
        const verificationCache = new Map();

        while (now() - startedAt <= resultTimeoutMs) {
            throwIfAborted(options.signal);
            lastState = inspectImagineResultState(documentRef, previousSnapshot, { mediaKind });
            if (lastState.ready && lastState.candidate) {
                const signature = getGeneratedResultCandidateSignature(lastState.candidate);
                let verification = verificationCache.get(signature);
                if (!verification) {
                    verification = await verifyGeneratedResultCandidateOpenable(lastState.candidate, {
                        ...options,
                        documentRef
                    });
                    verificationCache.set(signature, verification);
                }
                throwIfAborted(options.signal);

                if (verification.ok) return verification.summary;
                lastOpenabilityError = verification.error;
            }

            if (lastState.placeholderCount > 0) {
                if (firstPlaceholderAt === null) firstPlaceholderAt = now();
                const placeholderObservedMs = Math.max(0, now() - firstPlaceholderAt);
                if (placeholderObservedMs >= placeholderTimeoutMs) {
                    throw createImagineResultError('imagine_result_placeholder', lastState, {
                        resultTimeoutMs,
                        placeholderTimeoutMs,
                        openabilityError: lastOpenabilityError || undefined,
                        placeholderObservedMs
                    });
                }
            } else {
                firstPlaceholderAt = null;
            }

            await delay(intervalMs, options.signal);
        }

        throw createImagineResultError(
            lastState && lastState.ready && lastOpenabilityError
                ? 'imagine_result_unopenable'
                : lastState && lastState.placeholderCount > 0
                  ? 'imagine_result_placeholder'
                  : 'imagine_result_timeout',
            lastState,
            {
                resultTimeoutMs,
                placeholderTimeoutMs,
                openabilityError: lastOpenabilityError || undefined,
                placeholderObservedMs: firstPlaceholderAt === null ? 0 : Math.max(0, now() - firstPlaceholderAt)
            }
        );
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
        const signal = options.signal || null;

        return new Promise((resolve, reject) => {
            let settled = false;
            const onAbort = () => finish(null, abortError());
            const timer = setTimeout(() => {
                finish(null, fail('reference_capture_failed'));
            }, timeoutMs);

            function finish(blobUrl, error) {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                documentRef.removeEventListener('__gpt_fetch_media_result', onResult);
                if (signal) signal.removeEventListener('abort', onAbort);

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
            if (signal) {
                if (signal.aborted) {
                    finish(null, abortError());
                    return;
                }
                signal.addEventListener('abort', onAbort, { once: true });
            }

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

    function fetchViaBridgeAsDataUrl(url, options = {}) {
        if (!url) return Promise.reject(fail('reference_missing'));

        const documentRef = getDocumentRef(options);
        const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 15000;
        const requestId = `recreate_fetch_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        const signal = options.signal || null;

        return new Promise((resolve, reject) => {
            let settled = false;
            const onAbort = () => finish(null, abortError());
            const timer = setTimeout(() => {
                finish(null, fail('reference_capture_failed'));
            }, timeoutMs);

            function finish(dataUrl, error) {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                documentRef.removeEventListener('__gpt_fetch_media_data_url_result', onResult);
                if (signal) signal.removeEventListener('abort', onAbort);

                if (error) {
                    reject(error);
                    return;
                }

                resolve(dataUrl);
            }

            function onResult(event) {
                const detail = event.detail || {};
                if (detail.requestId !== requestId) return;

                if (detail.error || !dataUrlMatchesMediaKind(detail.dataUrl, expectedMediaKind(options))) {
                    finish(null, fail('reference_capture_failed'));
                    return;
                }

                finish(detail.dataUrl);
            }

            documentRef.addEventListener('__gpt_fetch_media_data_url_result', onResult);
            if (signal) {
                if (signal.aborted) {
                    finish(null, abortError());
                    return;
                }
                signal.addEventListener('abort', onAbort, { once: true });
            }

            try {
                documentRef.dispatchEvent(
                    new CustomEvent('__gpt_fetch_media_data_url', {
                        detail: { url, requestId }
                    })
                );
            } catch {
                finish(null, fail('reference_capture_failed'));
            }
        });
    }

    function getChromeRuntime(options = {}) {
        if (options.chromeRuntime) return options.chromeRuntime;
        if (options.chromeApi && options.chromeApi.runtime) return options.chromeApi.runtime;
        if (root && root.chrome && root.chrome.runtime) return root.chrome.runtime;
        if (typeof chrome !== 'undefined' && chrome.runtime) return chrome.runtime;
        return null;
    }

    function shouldFetchViaBackgroundAsDataUrl(url, mediaKind = 'image') {
        try {
            const parsed = new URL(String(url || ''));
            if (mediaKind === 'video') {
                return parsed.protocol === 'https:' && parsed.hostname === 'imagine-public.x.ai';
            }

            return (
                parsed.protocol === 'https:' &&
                (parsed.hostname === 'imagine-public.x.ai' || parsed.hostname === 'images-public.x.ai')
            );
        } catch {
            return false;
        }
    }

    function fetchWithTimeout(url, fetchOptions = {}, timeoutMs) {
        const externalSignal = fetchOptions.signal || null;
        throwIfAborted(externalSignal);
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
            return withAbort(fetch(url, fetchOptions), externalSignal);
        }

        return new Promise((resolve, reject) => {
            const abortController = typeof AbortController !== 'undefined' ? new AbortController() : null;
            let settled = false;
            const onExternalAbort = () => {
                if (abortController) abortController.abort();
                finish(null, abortError());
            };
            const timer = setTimeout(() => {
                if (abortController) abortController.abort();
                finish(null, fail('reference_capture_failed'));
            }, timeoutMs);

            const options = abortController
                ? { ...fetchOptions, signal: abortController.signal }
                : fetchOptions;

            function finish(value, error) {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
                if (error) {
                    reject(error);
                    return;
                }
                resolve(value);
            }

            if (externalSignal) {
                externalSignal.addEventListener('abort', onExternalAbort, { once: true });
            }

            fetch(url, options)
                .then((response) => finish(response), (error) => {
                    finish(null, externalSignal?.aborted ? abortError() : error);
                });
        });
    }

    async function fetchPublicImageAsDataUrl(url, options = {}) {
        if (!url) throw fail('reference_missing');
        const mediaKind = expectedMediaKind(options);

        try {
            const response = await fetchWithTimeout(
                String(url),
                { credentials: 'omit', signal: options.signal },
                Number.isFinite(options.timeoutMs) ? options.timeoutMs : undefined
            );
            if (!response || !response.ok) throw fail('reference_capture_failed');

            const dataUrl = await readBlobAsDataUrl(await response.blob(), options);
            if (!dataUrlMatchesMediaKind(dataUrl, mediaKind)) throw fail('reference_capture_failed');

            return dataUrl;
        } catch (error) {
            if (isAbortFailure(error, options.signal)) throw abortError();
            throw fail('reference_capture_failed');
        }
    }

    async function fetchViaBackgroundAsDataUrl(url, options = {}) {
        if (!url) throw fail('reference_missing');
        const mediaKind = expectedMediaKind(options);

        const runtime = getChromeRuntime(options);
        if (!runtime || typeof runtime.sendMessage !== 'function') throw fail('reference_capture_failed');

        try {
            const message = {
                action: 'FETCH_GPT_RECREATE_REFERENCE_DATA_URL',
                url: String(url)
            };
            if (options.authority) message.authority = options.authority;
            const response = await withAbort(runtime.sendMessage(message), options.signal);

            if (!response || !response.ok || !dataUrlMatchesMediaKind(response.dataUrl, mediaKind)) {
                throw fail('reference_capture_failed');
            }

            return response.dataUrl;
        } catch (error) {
            if (isAbortFailure(error, options.signal)) throw abortError();
            throw fail('reference_capture_failed');
        }
    }

    async function sourceToDataUrl(src, options = {}) {
        const value = String(src || '');
        if (!value) throw fail('reference_missing');
        const mediaKind = expectedMediaKind(options);
        if (dataUrlMatchesMediaKind(value, mediaKind)) return value;

        const workflowUtils = getUtils(options);
        const isTrustedMedia = mediaKind === 'video'
            ? workflowUtils.isTrustedGrokVideoUrl && workflowUtils.isTrustedGrokVideoUrl(value)
            : workflowUtils.isTrustedGrokMediaUrl(value);

        if (isTrustedMedia) {
            if (shouldFetchViaBackgroundAsDataUrl(value, mediaKind)) {
                let publicFetchFailed = false;

                try {
                    return await fetchPublicImageAsDataUrl(value, { ...options, expectedKind: mediaKind, timeoutMs: options.timeoutMs });
                } catch (error) {
                    if (isAbortFailure(error, options.signal)) throw abortError();
                    publicFetchFailed = true;
                    // Fall through to the extension service worker.
                }

                try {
                    return await fetchViaBackgroundAsDataUrl(value, options);
                } catch (error) {
                    if (isAbortFailure(error, options.signal)) throw abortError();
                    // Fall through to the page bridge. Some Grok media is only reachable with page cookies.
                }

                try {
                    return await fetchViaBridgeAsDataUrl(value, options);
                } catch (error) {
                    if (isAbortFailure(error, options.signal)) throw abortError();
                    throw fail(publicFetchFailed ? 'reference_public_fetch_failed' : 'reference_capture_failed');
                }
            }

            try {
                return await fetchViaBridgeAsDataUrl(value, options);
            } catch (error) {
                if (isAbortFailure(error, options.signal)) throw abortError();
                throw fail('reference_capture_failed');
            }
        }

        try {
            const response = await fetch(value, options.signal ? { signal: options.signal } : undefined);
            if (!response || !response.ok) throw fail('reference_capture_failed');

            const dataUrl = await readBlobAsDataUrl(await response.blob(), options);
            if (!dataUrlMatchesMediaKind(dataUrl, mediaKind)) throw fail('reference_capture_failed');
            return dataUrl;
        } catch (error) {
            if (isAbortFailure(error, options.signal)) throw abortError();
            throw fail('reference_capture_failed');
        }
    }

    function decodeHtmlEntities(value) {
        return String(value || '')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>');
    }

    function extractHtmlMetaContent(html, key) {
        const escapedKey = String(key || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const patterns = [
            new RegExp(`<meta[^>]+property=["']${escapedKey}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i'),
            new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${escapedKey}["'][^>]*>`, 'i'),
            new RegExp(`<meta[^>]+name=["']${escapedKey}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i'),
            new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${escapedKey}["'][^>]*>`, 'i')
        ];

        for (const pattern of patterns) {
            const match = String(html || '').match(pattern);
            if (match && match[1]) return decodeHtmlEntities(match[1]);
        }

        return '';
    }

    async function fetchGrokPostMetadata(postUrl, options = {}) {
        const workflowUtils = getUtils(options);
        if (!workflowUtils.isTrustedGrokPostUrl || !workflowUtils.isTrustedGrokPostUrl(postUrl)) {
            throw fail('reference_invalid');
        }

        try {
            const response = await fetchWithTimeout(
                String(postUrl),
                { credentials: 'include', signal: options.signal },
                Number.isFinite(options.timeoutMs) ? options.timeoutMs : 15000
            );
            if (!response || !response.ok) throw fail('reference_capture_failed');

            const html = await response.text();
            const videoUrl = extractHtmlMetaContent(html, 'og:video');
            if (!videoUrl || !workflowUtils.isTrustedGrokVideoUrl(videoUrl)) throw fail('reference_capture_failed');

            return {
                videoUrl,
                metadata: {
                    sourcePostUrl: String(postUrl),
                    sourceVideoUrl: videoUrl,
                    sourcePrompt: extractHtmlMetaContent(html, 'description') || ''
                }
            };
        } catch (error) {
            if (isAbortFailure(error, options.signal)) throw abortError();
            if (error && error.code) throw error;
            throw fail('reference_capture_failed');
        }
    }

    function probeImageMetadata(dataUrl, options = {}) {
        const documentRef = getDocumentRef(options);
        const view = documentRef.defaultView || root || {};
        const ImageConstructor = view.Image || (typeof Image !== 'undefined' ? Image : null);
        if (!ImageConstructor) return Promise.resolve({});

        return new Promise((resolve) => {
            let settled = false;
            const image = new ImageConstructor();
            const timer = setTimeout(() => finish({}), Number.isFinite(options.metadataProbeTimeoutMs) ? options.metadataProbeTimeoutMs : 1500);

            function finish(metadata) {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(metadata || {});
            }

            image.onload = () => finish({
                width: Number(image.naturalWidth || image.width || 0),
                height: Number(image.naturalHeight || image.height || 0)
            });
            image.onerror = () => finish({});
            image.src = dataUrl;
        });
    }

    function probeVideoMetadata(dataUrl, options = {}) {
        const documentRef = getDocumentRef(options);
        if (!documentRef.createElement) return Promise.resolve({});

        return new Promise((resolve) => {
            let settled = false;
            const video = documentRef.createElement('video');
            const timeoutMs = Number.isFinite(options.metadataProbeTimeoutMs) ? options.metadataProbeTimeoutMs : 3000;
            const timer = setTimeout(() => finish({}), timeoutMs);

            function finish(metadata) {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                video.removeAttribute('src');
                resolve(metadata || {});
            }

            video.preload = 'metadata';
            video.muted = true;
            video.playsInline = true;
            video.onloadedmetadata = () => finish({
                durationSec: Number.isFinite(video.duration) ? Number(video.duration.toFixed(3)) : 0,
                width: Number(video.videoWidth || 0),
                height: Number(video.videoHeight || 0)
            });
            video.onerror = () => finish({});
            video.src = dataUrl;
        });
    }

    function createVideoFrameSampleTimes(durationSec) {
        const duration = Number(durationSec || 0);
        if (!Number.isFinite(duration) || duration <= 0) return [];

        const sampleCount = duration > 8 ? 7 : 5;
        if (sampleCount <= 1) return [0];

        const lastTime = Math.max(0, duration - 0.05);
        return Array.from({ length: sampleCount }, (_value, index) => {
            const rawTime = lastTime * (index / (sampleCount - 1));
            return Number(rawTime.toFixed(3));
        });
    }

    function waitForVideoCallback(setup, timeoutMs) {
        return new Promise((resolve, reject) => {
            let settled = false;
            const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                reject(fail('video_frame_sampling_failed'));
            }, timeoutMs);

            function finish(value) {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(value);
            }

            function failCallback() {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                reject(fail('video_frame_sampling_failed'));
            }

            try {
                setup(finish, failCallback);
            } catch {
                failCallback();
            }
        });
    }

    async function sampleVideoContactSheet(dataUrl, options = {}) {
        if (typeof options.frameSampler === 'function') {
            const sampled = await options.frameSampler(dataUrl, options);
            return sampled && typeof sampled === 'object' ? sampled : {};
        }

        const documentRef = getDocumentRef(options);
        if (!documentRef.createElement) return {};
        const view = documentRef.defaultView || root || {};
        if (/jsdom/i.test(String(view.navigator && view.navigator.userAgent || ''))) return {};

        const video = documentRef.createElement('video');
        const canvas = documentRef.createElement('canvas');
        if (!video || !canvas || typeof canvas.getContext !== 'function' || typeof canvas.toDataURL !== 'function') {
            return {};
        }

        let context = null;
        try {
            context = canvas.getContext('2d');
        } catch {
            context = null;
        }
        if (!context || typeof context.drawImage !== 'function') return {};

        const timeoutMs = Number.isFinite(options.frameSamplingTimeoutMs)
            ? options.frameSamplingTimeoutMs
            : 3500;
        const tileWidth = Number.isFinite(options.frameSampleTileWidth) ? options.frameSampleTileWidth : 180;

        try {
            video.preload = 'auto';
            video.muted = true;
            video.playsInline = true;
            await waitForVideoCallback((finish, failCallback) => {
                video.onloadedmetadata = () => finish();
                video.onerror = failCallback;
                video.src = dataUrl;
            }, timeoutMs);

            const durationSec = Number.isFinite(video.duration) ? Number(video.duration) : 0;
            const sourceWidth = Number(video.videoWidth || 0);
            const sourceHeight = Number(video.videoHeight || 0);
            const sampleTimesSec = createVideoFrameSampleTimes(durationSec);
            if (!sampleTimesSec.length || sourceWidth <= 0 || sourceHeight <= 0) return {};

            const tileHeight = Math.max(1, Math.round(tileWidth * (sourceHeight / sourceWidth)));
            const columns = Math.min(4, sampleTimesSec.length);
            const rows = Math.ceil(sampleTimesSec.length / columns);
            canvas.width = columns * tileWidth;
            canvas.height = rows * tileHeight;

            for (let index = 0; index < sampleTimesSec.length; index += 1) {
                const sampleTime = sampleTimesSec[index];
                await waitForVideoCallback((finish, failCallback) => {
                    video.onseeked = () => finish();
                    video.onerror = failCallback;
                    video.currentTime = sampleTime;
                }, timeoutMs);
                const x = (index % columns) * tileWidth;
                const y = Math.floor(index / columns) * tileHeight;
                context.drawImage(video, x, y, tileWidth, tileHeight);
            }

            return {
                contactSheetDataUrl: canvas.toDataURL('image/jpeg', 0.82),
                frameSampleCount: sampleTimesSec.length,
                sampleTimesSec,
                contactSheetWidth: canvas.width,
                contactSheetHeight: canvas.height,
                contactSheetMimeType: 'image/jpeg'
            };
        } catch (error) {
            if (options.throwFrameSamplingErrors) throw error;
            return {};
        } finally {
            if (typeof video.removeAttribute === 'function') video.removeAttribute('src');
        }
    }

    async function enrichReferenceMetadata(reference, options = {}) {
        const mediaKind = getReferenceKind(reference);
        const existingMetadata = reference.metadata && typeof reference.metadata === 'object' ? reference.metadata : {};
        let probedMetadata = {};
        let sampledFrames = {};

        if (reference.dataUrl && mediaKind === 'video') {
            probedMetadata = reference.mimeType === 'image/gif'
                ? await probeImageMetadata(reference.dataUrl, options)
                : await probeVideoMetadata(reference.dataUrl, options);

            if (reference.mimeType === 'image/gif') {
                probedMetadata = {
                    ...probedMetadata,
                    frameSampleCount: 0,
                    gifFrameSamplingLimited: true
                };
            } else {
                sampledFrames = await sampleVideoContactSheet(reference.dataUrl, options);
                probedMetadata = {
                    ...probedMetadata,
                    frameSampleCount: Number(sampledFrames.frameSampleCount || 0),
                    frameSamplingLimited: !sampledFrames.contactSheetDataUrl
                };
            }
        }

        const mergedFrames = {
            ...(reference.frames && typeof reference.frames === 'object' ? reference.frames : {}),
            ...sampledFrames
        };
        const enriched = {
            ...reference,
            metadata: {
                ...probedMetadata,
                ...existingMetadata
            }
        };
        if (Object.keys(mergedFrames).length) enriched.frames = mergedFrames;
        return enriched;
    }

    async function resolveReferenceForUpload(reference, options = {}) {
        const workflowUtils = getUtils(options);
        const mediaKind = getReferenceKind(reference);

        if (reference.dataUrl) {
            return await enrichReferenceMetadata(reference, options);
        }

        if (mediaKind !== 'video' || !reference.url) throw fail('reference_invalid');

        let videoUrl = reference.url;
        let source = reference.source || 'grok-video-url';
        let metadata = reference.metadata && typeof reference.metadata === 'object' ? { ...reference.metadata } : {};

        if (workflowUtils.isTrustedGrokPostUrl && workflowUtils.isTrustedGrokPostUrl(reference.url)) {
            const postMetadata = await fetchGrokPostMetadata(reference.url, options);
            videoUrl = postMetadata.videoUrl;
            source = 'grok-post-url';
            metadata = {
                ...postMetadata.metadata,
                ...metadata
            };
        } else if (!workflowUtils.isTrustedGrokVideoUrl || !workflowUtils.isTrustedGrokVideoUrl(videoUrl)) {
            throw fail('reference_invalid');
        }

        const dataUrl = await sourceToDataUrl(videoUrl, {
            ...options,
            expectedKind: 'video',
            utils: workflowUtils
        });
        const parsed = workflowUtils.parseRecreateMediaDataUrl(dataUrl);
        const normalized = workflowUtils.normalizeRecreateReference({
            ...reference,
            kind: 'video',
            name: reference.name || 'grok-reference-video.mp4',
            mimeType: parsed.mimeType,
            dataUrl,
            source,
            metadata: {
                sourceVideoUrl: videoUrl,
                ...metadata
            }
        });

        return await enrichReferenceMetadata(normalized, options);
    }

    async function selectCurrentGeneratedImage(options = {}) {
        return await selectCurrentGeneratedMedia(options);
    }

    async function selectCurrentGeneratedMedia(options = {}) {
        const workflowUtils = getUtils(options);
        const documentRef = getDocumentRef(options);
        const adapter = getGrokAdapter(options);
        const location = options.locationRef || documentRef.defaultView?.location || root?.location;
        throwIfAborted(options.signal);
        const surface = adapter?.detectGrokSurface
            ? adapter.detectGrokSurface({ root: documentRef, location })
            : 'unsupported';
        const resolved = adapter?.resolveCurrentSourceMedia
            ? adapter.resolveCurrentSourceMedia({
                root: documentRef,
                surface,
                location,
                sourcePostIdHint: options.sourcePostIdHint
            })
            : { status: 'unsupported' };
        if (resolved.status === 'ambiguous') throw fail('reference_ambiguous');
        if (resolved.status !== 'matched' && (surface === 'agent_media' || surface === 'legacy_detail')) {
            throw fail('reference_missing');
        }

        if (resolved.status !== 'matched') throw fail('reference_source_unproven');
        const mediaKind = resolved.descriptor.mediaKind === 'video' ? 'video' : 'image';
        const sourceUrl = resolved.sourceUrl;
        const descriptor = resolved.descriptor;
        const dataUrl = await sourceToDataUrl(sourceUrl, {
            ...options,
            utils: workflowUtils,
            documentRef,
            expectedKind: mediaKind
        });
        throwIfAborted(options.signal);
        const parsed = workflowUtils.parseRecreateMediaDataUrl
            ? workflowUtils.parseRecreateMediaDataUrl(dataUrl)
            : workflowUtils.parseRecreateDataUrl(dataUrl);
        return workflowUtils.normalizeRecreateReference({
            name: mediaKind === 'video' ? 'current-grok-video.mp4' : 'current-grok-image.png',
            kind: mediaKind,
            mimeType: parsed.mimeType,
            dataUrl,
            source: mediaKind === 'video' ? 'grok-video-url' : 'current-grok-image',
            metadata: {
                sourceAssetId: descriptor.sourceAssetId,
                sourcePostId: descriptor.sourcePostId,
                conversationId: descriptor.conversationId || '',
                sourceSurface: descriptor.surface
            }
        });
    }

    function getEventTargetDocument(target) {
        if (target && target.ownerDocument) return target.ownerDocument;
        if (target && target.nodeType === 9) return target;
        if (typeof document !== 'undefined') return document;
        return null;
    }

    function createDomEvent(documentRef, type) {
        const view = (documentRef && documentRef.defaultView) || root || {};
        const EventConstructor = view.Event || Event;
        return new EventConstructor(type, { bubbles: true });
    }

    function createDomCustomEvent(documentRef, type, detail) {
        const view = (documentRef && documentRef.defaultView) || root || {};
        const CustomEventConstructor = view.CustomEvent || CustomEvent;
        return new CustomEventConstructor(type, { bubbles: true, detail });
    }

    function setFileInputFiles(input, file) {
        if (!input || input.type !== 'file' || !file) throw fail('chat_upload_input_missing');

        const documentRef = getEventTargetDocument(input);
        const view = (documentRef && documentRef.defaultView) || root || {};
        const DataTransferConstructor =
            view.DataTransfer || (typeof DataTransfer !== 'undefined' ? DataTransfer : null);
        let assigned = false;

        if (DataTransferConstructor) {
            try {
                const dataTransfer = new DataTransferConstructor();
                dataTransfer.items.add(file);
                input.files = dataTransfer.files;
                assigned = input.files && input.files.length === 1;
            } catch {
                assigned = false;
            }
        }

        if (!assigned) {
            Object.defineProperty(input, 'files', {
                configurable: true,
                value: {
                    0: file,
                    length: 1,
                    item: (index) => (index === 0 ? file : null)
                }
            });
        }

        input.dispatchEvent(createDomEvent(documentRef, 'input'));
        input.dispatchEvent(createDomEvent(documentRef, 'change'));
    }

    function isHiddenByStyle(element) {
        const style = getElementStyle(element);
        const opacity = style ? Number(style.opacity || 1) : 1;
        return !!style && (style.display === 'none' || style.visibility === 'hidden' || opacity <= 0);
    }

    function isUsableEditor(element) {
        if (!element || isHiddenByStyle(element) || !isVisibleElement(element)) return false;
        if (element.matches('textarea')) {
            return !element.disabled && !element.readOnly;
        }

        const editableState = String(element.getAttribute('contenteditable') || element.contentEditable || '').toLowerCase();
        return editableState === 'true' || editableState === 'plaintext-only' || element.isContentEditable;
    }

    function getEditorContractText(element) {
        return [
            element.getAttribute('aria-label'),
            element.getAttribute('placeholder'),
            element.getAttribute('data-placeholder')
        ]
            .filter(Boolean)
            .join(' ');
    }

    function matchesGrokEditorContract(element) {
        const labelText = getEditorContractText(element);
        return /ask\s+grok(?:\s+anything)?/i.test(labelText) || /(?:message|prompt)\s+grok/i.test(labelText);
    }

    function editorLabelScore(element) {
        let score = 0;

        if (element.matches('textarea[aria-required="true"]')) score += 4;
        if (matchesGrokEditorContract(element)) score += 3;
        if (element.matches('textarea')) score += 2;

        return score;
    }

    function findEditor(documentRef = document, scopeRoot = null) {
        const queryRoot = scopeRoot && typeof scopeRoot.querySelectorAll === 'function'
            ? scopeRoot
            : documentRef;
        const editors = Array.from(
            queryRoot.querySelectorAll(
                'textarea, [contenteditable], [role="textbox"], div[aria-label], div[data-placeholder]'
            )
        ).filter((element) => isUsableEditor(element) && matchesGrokEditorContract(element));
        if (!editors.length) return null;

        return editors
            .map((element, index) => ({ element, index, score: editorLabelScore(element) }))
            .sort((a, b) => b.score - a.score || a.index - b.index)[0].element;
    }

    function setTextareaValue(textarea, text) {
        const documentRef = getEventTargetDocument(textarea);
        const view = (documentRef && documentRef.defaultView) || root || {};
        const prototype = view.HTMLTextAreaElement && view.HTMLTextAreaElement.prototype;
        const descriptor = prototype && Object.getOwnPropertyDescriptor(prototype, 'value');
        const tracker = textarea._valueTracker;

        if (tracker) tracker.setValue('');

        if (descriptor && descriptor.set) {
            descriptor.set.call(textarea, text);
        } else {
            textarea.value = text;
        }

        textarea.dispatchEvent(createDomEvent(documentRef, 'input'));
        textarea.dispatchEvent(createDomEvent(documentRef, 'change'));
    }

    function dispatchRichEditorInput(editor, text, documentRef) {
        const view = (documentRef && documentRef.defaultView) || root || {};

        try {
            const InputEventConstructor = view.InputEvent || root.InputEvent;
            if (InputEventConstructor) {
                editor.dispatchEvent(
                    new InputEventConstructor('input', {
                        bubbles: true,
                        cancelable: true,
                        inputType: 'insertText',
                        data: text
                    })
                );
            } else {
                editor.dispatchEvent(createDomEvent(documentRef, 'input'));
            }
        } catch {
            editor.dispatchEvent(createDomEvent(documentRef, 'input'));
        }

        editor.dispatchEvent(createDomEvent(documentRef, 'change'));
    }

    function replaceContentEditableText(editor, text, documentRef = document) {
        const view = (documentRef && documentRef.defaultView) || root || {};

        if (typeof editor.focus === 'function') editor.focus();

        try {
            const selection = view.getSelection && view.getSelection();
            const range = documentRef.createRange && documentRef.createRange();
            if (selection && range) {
                range.selectNodeContents(editor);
                selection.removeAllRanges();
                selection.addRange(range);
            }
        } catch {
            // Selection can fail on detached or synthetic editors; fall back below.
        }

        let inserted = false;
        try {
            inserted = !!(documentRef.execCommand && documentRef.execCommand('insertText', false, text));
        } catch {
            inserted = false;
        }

        if (!inserted) {
            editor.textContent = text;
            dispatchRichEditorInput(editor, text, documentRef);
        }
    }

    function normalizeEditorText(value) {
        return String(value || '')
            .replace(/\u00a0/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function getEditorCurrentText(editor) {
        if (!editor) return '';
        if (editor.matches && editor.matches('textarea')) return editor.value || '';
        return editor.innerText || editor.textContent || '';
    }

    function editorTextIncludes(editor, expectedText) {
        const currentText = normalizeEditorText(getEditorCurrentText(editor));
        const expected = normalizeEditorText(expectedText);
        return !!expected && currentText.includes(expected);
    }

    function editorTextIncludesAll(editor, expectedTexts) {
        return expectedTexts.every((expectedText) => editorTextIncludes(editor, expectedText));
    }

    function getGeneratedPromptVerificationText(prompt) {
        return normalizeEditorText(prompt).slice(0, 96);
    }

    function chatEditorStillContainsInstruction(documentRef, workflowUtils, mediaKind = 'image', composerRoot = null) {
        const editor = findEditor(documentRef, composerRoot);
        const expectedTexts = mediaKind === 'video'
            ? [
                'You are creating one ready-to-paste Grok Imagine Video prompt',
                workflowUtils.FINAL_VIDEO_PROMPT_MARKER
            ]
            : [
                'You are creating a Grok Imagine prompt from the attached reference image.',
                workflowUtils.FINAL_PROMPT_MARKER
            ];
        return (
            editor &&
            editorTextIncludesAll(editor, expectedTexts)
        );
    }

    async function waitForChatSubmitAccepted(documentRef, workflowUtils, mediaKind = 'image', composerRoot = null, options = {}) {
        const timeoutMs = Number.isFinite(options.chatSubmitAcceptedTimeoutMs)
            ? options.chatSubmitAcceptedTimeoutMs
            : 1500;
        const intervalMs = Number.isFinite(options.intervalMs) ? options.intervalMs : 100;

        await waitForCondition(
            () => {
                if (!chatEditorStillContainsInstruction(documentRef, workflowUtils, mediaKind, composerRoot)) return true;

                try {
                    return !!extractAssistantPromptFromPage(documentRef, mediaKind);
                } catch (error) {
                    if (error && error.message === 'chat_prompt_marker_missing') return null;
                    throw error;
                }
            },
            {
                timeoutMs,
                intervalMs,
                timeoutError: 'chat_submit_not_sent',
                signal: options.signal
            }
        );
    }

    function injectEditorText(text, documentRef = document, editorOverride = null) {
        const editor = editorOverride || findEditor(documentRef);
        if (!editor) return false;
        const nextText = String(text || '');

        if (typeof editor.focus === 'function') editor.focus();

        if (editor.matches('textarea')) {
            setTextareaValue(editor, nextText);
            return true;
        }

        documentRef.dispatchEvent(createDomCustomEvent(documentRef, '__gpt_set_editor_content', { text: nextText }));
        if (!editorTextIncludes(editor, getGeneratedPromptVerificationText(nextText))) {
            replaceContentEditableText(editor, nextText, documentRef);
        }
        return true;
    }

    function normalizeAriaLabel(value) {
        return String(value || '')
            .trim()
            .toLowerCase();
    }

    function buttonMatchesLabel(button, labels) {
        const ariaLabel = normalizeAriaLabel(button.getAttribute('aria-label'));
        return labels.some((label) => ariaLabel === normalizeAriaLabel(label));
    }

    function isEnabledButton(button) {
        return !button.disabled && button.getAttribute('aria-disabled') !== 'true';
    }

    function findVisibleButtonByLabels(labels, documentRef = document, scopeRoot = null) {
        const queryRoot = scopeRoot && typeof scopeRoot.querySelectorAll === 'function'
            ? scopeRoot
            : documentRef;
        return Array.from(queryRoot.querySelectorAll('button[aria-label]')).find(
            (button) => buttonMatchesLabel(button, labels) && isVisibleElement(button) && isEnabledButton(button)
        );
    }

    function createPointerLikeEvent(button, type, coordinates) {
        const documentRef = getEventTargetDocument(button);
        const view = (documentRef && documentRef.defaultView) || root || {};
        const isPointerEvent = type.startsWith('pointer');
        const EventFallback = typeof Event !== 'undefined' ? Event : null;
        const EventConstructor =
            (isPointerEvent && view.PointerEvent) ||
            view.MouseEvent ||
            view.Event ||
            (typeof MouseEvent !== 'undefined' ? MouseEvent : null) ||
            EventFallback;
        const eventOptions = {
            bubbles: true,
            cancelable: true,
            view,
            button: 0,
            buttons: type.endsWith('down') ? 1 : 0,
            clientX: coordinates.clientX,
            clientY: coordinates.clientY,
            screenX: coordinates.clientX,
            screenY: coordinates.clientY,
            pointerId: 1,
            pointerType: 'mouse',
            isPrimary: true
        };

        return new EventConstructor(type, eventOptions);
    }

    function getViewportMetrics(documentRef = document) {
        const view = documentRef.defaultView || root || {};
        const documentElement = documentRef.documentElement || {};

        return {
            width: Number(view.innerWidth || documentElement.clientWidth || 0),
            height: Number(view.innerHeight || documentElement.clientHeight || 0)
        };
    }

    function clampClickCoordinate(value, min, max) {
        const number = Number(value);
        if (!Number.isFinite(number)) return min;
        return Math.min(Math.max(number, min), max);
    }

    function getElementClickPoint(element, options = {}) {
        const documentRef = getEventTargetDocument(element) || getDocumentRef(options);
        const rect = element.getBoundingClientRect();
        const viewport = getViewportMetrics(documentRef);
        const left = Number(rect.left || 0);
        const top = Number(rect.top || 0);
        const width = Number(rect.width || 0);
        const height = Number(rect.height || 0);
        const viewportWidth = viewport.width || left + width + 1;
        const viewportHeight = viewport.height || top + height + 1;
        const visibleTop = clampClickCoordinate(top, 1, Math.max(1, viewportHeight - 1));
        const visibleBottom = clampClickCoordinate(top + height, 1, Math.max(1, viewportHeight - 1));
        const visibleHeight = Math.max(1, visibleBottom - visibleTop);
        const x = clampClickCoordinate(left + width / 2, 1, Math.max(1, viewportWidth - 1));
        const y =
            options.clickPointStrategy === 'upper-visible'
                ? visibleTop + Math.min(40, Math.max(12, visibleHeight * 0.25))
                : top + height / 2;

        return {
            x,
            y: clampClickCoordinate(y, 1, Math.max(1, viewportHeight - 1))
        };
    }

    async function sendNativeClick(click, options = {}) {
        throwIfAborted(options.signal);
        if (typeof options.nativeClick === 'function') {
            const pending = options.authority
                ? options.nativeClick(click, options.authority)
                : options.nativeClick(click);
            return await withAbort(pending, options.signal);
        }

        const runtime = getChromeRuntime(options);
        if (!runtime || typeof runtime.sendMessage !== 'function') throw fail('native_click_unavailable');

        const message = {
            action: 'GPT_RECREATE_NATIVE_CLICK',
            click
        };
        if (options.authority) message.authority = options.authority;
        if (options.submissionState) message.submissionState = options.submissionState;
        const response = await withAbort(runtime.sendMessage(message), options.signal);

        if (!response || response.ok !== true) {
            const error = fail((response && response.error) || 'native_click_unavailable');
            error.clickState = response?.clickState || 'unknown';
            throw error;
        }

        return response;
    }

    function shouldUseNativeClick(options = {}) {
        const runtime = getChromeRuntime(options);
        return typeof options.nativeClick === 'function' || !!(runtime && typeof runtime.sendMessage === 'function');
    }

    function getPowerToolsOverlay(documentRef = document) {
        return documentRef && typeof documentRef.querySelector === 'function'
            ? documentRef.querySelector('#grok-powertools-overlay')
            : null;
    }

    async function withOverlayPointerPassThrough(targetElement, options, callback) {
        const documentRef = getEventTargetDocument(targetElement) || getDocumentRef(options);
        const overlay = getPowerToolsOverlay(documentRef);

        if (!overlay || isInsidePowerToolsOverlay(targetElement)) return await callback();

        const previousPointerEvents = overlay.style.pointerEvents;

        overlay.style.pointerEvents = 'none';
        try {
            return await callback();
        } finally {
            overlay.style.pointerEvents = previousPointerEvents;
        }
    }

    async function clickElementNatively(element, options = {}) {
        if (!element) throw fail('native_click_unavailable');
        throwIfAborted(options.signal);
        const click = getElementClickPoint(element, options);

        return await withOverlayPointerPassThrough(element, options, async () => {
            throwIfAborted(options.signal);
            if (shouldUseNativeClick(options)) {
                await sendNativeClick(click, options);
                throwIfAborted(options.signal);
                return true;
            }

            if (options.syntheticClickFallback === false) throw fail('native_click_unavailable');
            if (!safelyClickElement(element, click)) throw fail('synthetic_click_failed');
            return true;
        });
    }

    async function clickChatSubmitButton(
        submitButton,
        documentRef,
        workflowUtils,
        mediaKind = 'image',
        composerRoot = null,
        options = {}
    ) {
        throwIfAborted(options.signal);
        try {
            await clickElementNatively(submitButton, { ...options, documentRef });
        } catch (error) {
            if (isAbortFailure(error, options.signal)) throw abortError();
            const code = String((error && error.code) || '');
            throw fail(code.startsWith('native_click_') ? code : 'chat_submit_failed');
        }

        try {
            await waitForChatSubmitAccepted(documentRef, workflowUtils, mediaKind, composerRoot, options);
            return;
        } catch (error) {
            if (!error || error.code !== 'chat_submit_not_sent') throw error;
        }

        const click = getElementClickPoint(submitButton, { ...options, documentRef });
        throwIfAborted(options.signal);
        if (!safelyClickElement(submitButton, click)) {
            if (typeof submitButton.click !== 'function') throw fail('chat_submit_failed');
            submitButton.click();
        }

        await waitForChatSubmitAccepted(documentRef, workflowUtils, mediaKind, composerRoot, options);
    }

    function safelyClickElement(element, coordinates = null) {
        try {
            const click = coordinates || getElementClickPoint(element);
            const eventCoordinates = {
                clientX: click.x,
                clientY: click.y
            };

            ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((type) => {
                element.dispatchEvent(createPointerLikeEvent(element, type, eventCoordinates));
            });
            return true;
        } catch {
            return false;
        }
    }

    function safelyClickButton(button) {
        return safelyClickElement(button);
    }

    function submitVisibleButton(labels, documentRef = document) {
        const button = findVisibleButtonByLabels(labels, documentRef);
        if (!button) return false;

        return safelyClickButton(button);
    }

    function buttonStateLooksActive(button) {
        const activeValues = new Set(['true', 'checked', 'on', 'active', 'selected']);
        return (
            activeValues.has(normalizeAriaLabel(button.getAttribute('aria-pressed'))) ||
            activeValues.has(normalizeAriaLabel(button.getAttribute('aria-checked'))) ||
            activeValues.has(normalizeAriaLabel(button.getAttribute('aria-selected'))) ||
            activeValues.has(normalizeAriaLabel(button.getAttribute('data-state'))) ||
            activeValues.has(normalizeAriaLabel(button.getAttribute('data-active')))
        );
    }

    function getRectMetrics(element) {
        const rect = element.getBoundingClientRect();
        return {
            left: Number(rect.left || 0),
            top: Number(rect.top || 0),
            width: Number(rect.width || 0),
            height: Number(rect.height || 0)
        };
    }

    function isComposerRootCandidate(element, editor, documentRef) {
        if (!element || element === documentRef.body || element === documentRef.documentElement) return false;
        if (!isVisibleElement(element)) return false;

        const rootRect = getRectMetrics(element);
        const editorRect = getRectMetrics(editor);
        const maxHeight = Math.max(360, editorRect.height * 8);
        const maxWidth = Math.max(1280, editorRect.width * 4);

        return rootRect.height <= maxHeight && rootRect.width <= maxWidth;
    }

    function findComposerRoot(editor, documentRef = document) {
        return findComposerRootByButtonLabels(editor, ['Search'], documentRef);
    }

    const CHAT_ATTACHMENT_LABELS = [
        'Attach',
        'Upload',
        'Attach files',
        'Upload file',
        'Add files',
        'Add attachment'
    ];

    function controlMatchesAnyLabel(element, labels) {
        const text = normalizeAriaLabel([
            element?.getAttribute?.('aria-label'),
            element?.getAttribute?.('title'),
            element?.textContent
        ].filter(Boolean).join(' '));
        return labels.some((label) => {
            const expected = normalizeAriaLabel(label);
            return text === expected || text.startsWith(`${expected} `);
        });
    }

    function findScopedControlByLabels(scopeRoot, labels) {
        if (!scopeRoot || typeof scopeRoot.querySelectorAll !== 'function') return null;
        return Array.from(scopeRoot.querySelectorAll('button, [role="button"]')).find((element) => (
            controlMatchesAnyLabel(element, labels) &&
            isVisibleElement(element) &&
            isEnabledButton(element)
        )) || null;
    }

    function findComposerRootByButtonLabels(editor, labels, documentRef = document) {
        let current = editor && editor.parentElement;

        while (current && current !== documentRef.body && current !== documentRef.documentElement) {
            if (
                isComposerRootCandidate(current, editor, documentRef) &&
                !!findScopedControlByLabels(current, labels)
            ) {
                return current;
            }

            current = current.parentElement;
        }

        return null;
    }

    function findUploadComposerRoot(documentRef = document) {
        const editor = findEditor(documentRef);
        if (!editor) return null;

        const buttonRoot = findComposerRootByButtonLabels(editor, CHAT_ATTACHMENT_LABELS, documentRef);
        if (buttonRoot) return buttonRoot;

        let current = editor.parentElement;
        while (current && current !== documentRef.body && current !== documentRef.documentElement) {
            if (isComposerRootCandidate(current, editor, documentRef)
                && current.querySelector('input[type="file"]')) {
                return current;
            }
            current = current.parentElement;
        }

        return null;
    }

    function findComposerSearchButton(documentRef = document, composerRootOverride = null) {
        const editor = findEditor(documentRef, composerRootOverride);
        if (!editor) return null;

        const composerRoot = composerRootOverride || findComposerRoot(editor, documentRef);
        if (!composerRoot) return null;

        return (
            Array.from(composerRoot.querySelectorAll('button[aria-label]')).find(
                (button) => buttonMatchesLabel(button, ['Search']) && isVisibleElement(button) && isEnabledButton(button)
            ) || null
        );
    }

    function ensureGrokSearchEnabled(documentRef = document, composerRoot = null) {
        const button = findComposerSearchButton(documentRef, composerRoot);
        if (!button) throw fail('chat_search_unavailable');

        if (!buttonStateLooksActive(button)) {
            if (!safelyClickButton(button)) throw fail('chat_search_unavailable');
        }

        if (!buttonStateLooksActive(button)) throw fail('chat_search_unavailable');
        return true;
    }

    function isInsidePowerToolsOverlay(element) {
        return !!(element && typeof element.closest === 'function' && element.closest('#grok-powertools-overlay'));
    }

    function uploadInputScore(input, composerRoot, reference = null) {
        if (isInsidePowerToolsOverlay(input)) return -1;

        const accept = String(input.getAttribute('accept') || '').toLowerCase();
        const mediaKind = getReferenceKind(reference);
        const acceptsMedia =
            !accept ||
            accept.includes(mediaKind) ||
            (mediaKind === 'video' && (accept.includes('image/gif') || accept.includes('video'))) ||
            (mediaKind === 'image' && accept.includes('image'));
        if (accept && !acceptsMedia && !input.multiple) return -1;

        let score = 0;
        if (composerRoot && typeof composerRoot.contains === 'function' && composerRoot.contains(input)) score += 100;
        if (!accept) score += 10;
        if (accept.includes(mediaKind)) score += 12;
        if (accept.includes('image')) score += 8;
        if (accept.includes('video')) score += 8;
        if (input.multiple) score += 4;
        return score;
    }

    function findUploadInput(documentRef = document, reference = null, composerRootOverride = null) {
        const composerRoot = composerRootOverride || findUploadComposerRoot(documentRef);
        if (!composerRoot) return null;
        const candidates = Array.from(composerRoot.querySelectorAll('input[type="file"]'))
            .map((input) => ({ input, score: uploadInputScore(input, composerRoot, reference) }))
            .filter((candidate) => candidate.score >= 0)
            .sort((left, right) => right.score - left.score);

        return candidates.length ? candidates[0].input : null;
    }

    function uploadReferenceFile(reference, documentRef = document, composerRoot = null) {
        const input = findUploadInput(documentRef, reference, composerRoot);
        if (!input) throw fail('chat_upload_input_missing');

        setFileInputFiles(input, dataUrlToFile(reference));
        return true;
    }

    async function ensureChatUploadInput(reference, documentRef, composerRoot, options = {}) {
        let input = findUploadInput(documentRef, reference, composerRoot);
        if (input) return input;

        const attachmentControl = findScopedControlByLabels(composerRoot, CHAT_ATTACHMENT_LABELS);
        if (!attachmentControl) throw fail('chat_upload_control_missing');
        await clickElementNatively(attachmentControl, { ...options, documentRef });
        input = await waitForCondition(
            () => findUploadInput(documentRef, reference, composerRoot),
            {
                timeoutMs: Number.isFinite(options.uploadInputTimeoutMs) ? options.uploadInputTimeoutMs : 15000,
                intervalMs: Number.isFinite(options.intervalMs) ? options.intervalMs : 250,
                timeoutError: 'chat_upload_input_missing',
                signal: options.signal
            }
        );
        return input;
    }

    function getUploadPreviewSignature(element) {
        const src = String(element.currentSrc || element.src || element.getAttribute('poster') || '');
        const rect = element.getBoundingClientRect();
        return [
            element.tagName || '',
            src,
            element.getAttribute('alt') || '',
            element.textContent || '',
            element.naturalWidth || 0,
            element.naturalHeight || 0,
            element.videoWidth || 0,
            element.videoHeight || 0,
            rect.left || 0,
            rect.top || 0,
            rect.width || 0,
            rect.height || 0
        ].join('|');
    }

    function rectsAreNear(leftRect, rightRect, maxDistance = 260) {
        if (!leftRect || !rightRect) return false;
        if (leftRect.width <= 0 || leftRect.height <= 0 || rightRect.width <= 0 || rightRect.height <= 0) return false;

        const leftCenterX = Number(leftRect.left || 0) + Number(leftRect.width || 0) / 2;
        const leftCenterY = Number(leftRect.top || 0) + Number(leftRect.height || 0) / 2;
        const rightCenterX = Number(rightRect.left || 0) + Number(rightRect.width || 0) / 2;
        const rightCenterY = Number(rightRect.top || 0) + Number(rightRect.height || 0) / 2;

        return Math.abs(leftCenterX - rightCenterX) <= maxDistance && Math.abs(leftCenterY - rightCenterY) <= maxDistance;
    }

    function getVisibleUploadButtons(documentRef = document, composerRoot = null) {
        const queryRoot = composerRoot || documentRef;
        return Array.from(queryRoot.querySelectorAll('button, [role="button"]')).filter(
            (button) => controlMatchesAnyLabel(button, CHAT_ATTACHMENT_LABELS) && isVisibleElement(button) && isEnabledButton(button)
        );
    }

    function isNearUploadButton(element, uploadButtons) {
        const rect = element.getBoundingClientRect();
        return uploadButtons.some((button) => rectsAreNear(rect, button.getBoundingClientRect()));
    }

    function collectUploadPreviewCandidates(documentRef = document, reference = null, composerRootOverride = null) {
        const composerRoot = composerRootOverride || findUploadComposerRoot(documentRef);
        if (!composerRoot) return [];
        const uploadButtons = getVisibleUploadButtons(documentRef, composerRoot);
        const mediaKind = getReferenceKind(reference);
        const mediaElements = Array.from(composerRoot.querySelectorAll('img, video')).filter((element) => {
            const src = String(element.currentSrc || element.src || element.getAttribute('poster') || '');
            const rect = element.getBoundingClientRect();
            const maxVisibleSize = Math.max(
                element.naturalWidth || 0,
                element.naturalHeight || 0,
                element.videoWidth || 0,
                element.videoHeight || 0,
                rect.width || 0,
                rect.height || 0
            );
            const nearUploadControl = composerRoot.contains(element) || isNearUploadButton(element, uploadButtons);
            const looksLikeUpload =
                src.startsWith('blob:') ||
                src.startsWith('data:image/') ||
                src.startsWith('data:video/') ||
                src.includes('assets.grok.com/users/') ||
                /upload|attach|reference/i.test(element.getAttribute('alt') || '');

            return (
                !isInsidePowerToolsOverlay(element) &&
                isVisibleElement(element) &&
                maxVisibleSize > 20 &&
                looksLikeUpload &&
                nearUploadControl
            );
        });

        const fileName = String(reference && reference.name || '').trim().toLowerCase();
        const textChips = fileName
            ? Array.from(composerRoot.querySelectorAll('button, [role="button"], [data-testid], [class*="file"], [class*="upload"]')).filter((element) => {
                if (isInsidePowerToolsOverlay(element) || !isVisibleElement(element)) return false;
                if (!(composerRoot.contains(element) || isNearUploadButton(element, uploadButtons))) return false;
                return String(element.textContent || '').toLowerCase().includes(fileName);
            })
            : [];

        return mediaKind === 'video'
            ? [...mediaElements, ...textChips]
            : mediaElements;
    }

    function createUploadPreviewSnapshot(documentRef = document, reference = null, composerRoot = null) {
        const candidates = collectUploadPreviewCandidates(documentRef, reference, composerRoot);
        const elementSignatures = new WeakMap();
        candidates.forEach((candidate) => {
            elementSignatures.set(candidate, getUploadPreviewSignature(candidate));
        });

        return {
            elements: new WeakSet(candidates),
            elementSignatures,
            signatures: new Set(candidates.map(getUploadPreviewSignature))
        };
    }

    function hasUploadPreview(documentRef = document, previousSnapshot = null, reference = null, composerRoot = null) {
        return collectUploadPreviewCandidates(documentRef, reference, composerRoot).some((img) => {
            if (!previousSnapshot) return true;
            const signature = getUploadPreviewSignature(img);
            if (previousSnapshot.elementSignatures && previousSnapshot.elementSignatures.has(img)) {
                return previousSnapshot.elementSignatures.get(img) !== signature;
            }
            if (previousSnapshot.elements && previousSnapshot.elements.has(img)) return false;
            if (previousSnapshot.signatures && previousSnapshot.signatures.has(signature)) return false;
            return true;
        });
    }

    function textLooksLikeInstructionEcho(text) {
        return (
            /You are creating (?:one ready-to-paste )?Grok Imagine/i.test(text) ||
            /<one ready-to-paste Grok Imagine(?: Video)? prompt>/i.test(text)
        );
    }

    function extractAssistantPromptFromPage(documentRef = document, mediaKind = 'image') {
        const workflowUtils = getUtils();
        const marker = mediaKind === 'video' && workflowUtils.FINAL_VIDEO_PROMPT_MARKER
            ? workflowUtils.FINAL_VIDEO_PROMPT_MARKER
            : workflowUtils.FINAL_PROMPT_MARKER;
        const containers = Array.from(
            documentRef.querySelectorAll(
                [
                    '[data-testid="assistant-message"]',
                    '[data-testid*="assistant"]',
                    '[data-message-author-role="assistant"]',
                    '[data-author="assistant"]',
                    '[aria-label*="Assistant"]',
                    '[class*="assistant"]',
                    '[class*="response"]',
                    '[class*="markdown"]',
                    'article'
                ].join(', ')
            )
        );
        const texts = containers
            .map((element) => element.innerText || element.textContent || '')
            .filter((text) => text.includes(marker) && !textLooksLikeInstructionEcho(text));

        if (!texts.length) throw fail('chat_prompt_marker_missing');
        if (mediaKind === 'video' && typeof workflowUtils.extractFinalImagineVideoPrompt === 'function') {
            return workflowUtils.extractFinalImagineVideoPrompt(texts[texts.length - 1]);
        }
        return workflowUtils.extractFinalImaginePrompt(texts[texts.length - 1]);
    }

    async function waitForGeneratedChatPrompt(documentRef, mediaKind, options = {}) {
        return await waitForCondition(
            () => {
                try {
                    return extractAssistantPromptFromPage(documentRef, mediaKind);
                } catch (error) {
                    if (error && error.message === 'chat_prompt_marker_missing') return null;
                    throw error;
                }
            },
            {
                timeoutMs: Number.isFinite(options.timeoutMs) ? options.timeoutMs : 120000,
                intervalMs: Number.isFinite(options.intervalMs) ? options.intervalMs : 750,
                timeoutError: 'chat_answer_timeout',
                signal: options.signal
            }
        );
    }

    async function runChatPromptStep(request, options = {}) {
        const workflowUtils = getUtils(options);
        const documentRef = getDocumentRef(options);
        const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 120000;
        const intervalMs = Number.isFinite(options.intervalMs) ? options.intervalMs : 750;
        const uploadPreviewTimeoutMs = Number.isFinite(options.uploadPreviewTimeoutMs)
            ? options.uploadPreviewTimeoutMs
            : 15000;
        const uploadInputTimeoutMs = Number.isFinite(options.uploadInputTimeoutMs)
            ? options.uploadInputTimeoutMs
            : 15000;
        const submitTimeoutMs = Number.isFinite(options.submitTimeoutMs) ? options.submitTimeoutMs : 10000;
        const editorTimeoutMs = Number.isFinite(options.editorTimeoutMs)
            ? options.editorTimeoutMs
            : Math.min(timeoutMs, submitTimeoutMs);
        const editorInjectionTimeoutMs = Number.isFinite(options.editorInjectionTimeoutMs)
            ? options.editorInjectionTimeoutMs
            : Math.min(submitTimeoutMs, 10000);
        await confirmOperationDocument(options);
        if (request.recoverOnly === true) {
            const mediaKind = request.referenceKind === 'video' ? 'video' : 'image';
            return {
                ok: true,
                runId: request.runId,
                generatedPrompt: await waitForGeneratedChatPrompt(documentRef, mediaKind, {
                    ...options,
                    timeoutMs,
                    intervalMs
                })
            };
        }
        let reference = workflowUtils.normalizeRecreateReference(request.reference);
        const mediaKind = getReferenceKind(reference);
        throwIfAborted(options.signal);
        reference = await resolveReferenceForUpload(reference, {
            ...options,
            documentRef,
            expectedKind: mediaKind,
            utils: workflowUtils
        });
        const instruction = mediaKind === 'video' && typeof workflowUtils.buildVideoRecreateChatInstruction === 'function'
            ? workflowUtils.buildVideoRecreateChatInstruction({
                bestPracticesEnabled: !!request.bestPracticesEnabled,
                metadata: reference.metadata || {}
            })
            : workflowUtils.buildRecreateChatInstruction({
                bestPracticesEnabled: !!request.bestPracticesEnabled
            });
        const editorVerificationText = mediaKind === 'video'
            ? ['You are creating one ready-to-paste Grok Imagine Video prompt', workflowUtils.FINAL_VIDEO_PROMPT_MARKER]
            : ['You are creating a Grok Imagine prompt from the attached reference image.', workflowUtils.FINAL_PROMPT_MARKER];
        const composerRoot = await waitForCondition(() => findUploadComposerRoot(documentRef), {
            timeoutMs: editorTimeoutMs,
            intervalMs,
            timeoutError: 'chat_composer_missing',
            signal: options.signal
        });

        if (request.bestPracticesEnabled) {
            throwIfAborted(options.signal);
            ensureGrokSearchEnabled(documentRef, composerRoot);
        }

        const previewSnapshot = createUploadPreviewSnapshot(documentRef, reference, composerRoot);
        await ensureChatUploadInput(reference, documentRef, composerRoot, {
            ...options,
            uploadInputTimeoutMs,
            intervalMs
        });
        throwIfAborted(options.signal);
        uploadReferenceFile(reference, documentRef, composerRoot);
        await waitForCondition(() => hasUploadPreview(documentRef, previewSnapshot, reference, composerRoot), {
            timeoutMs: uploadPreviewTimeoutMs,
            intervalMs,
            timeoutError: 'chat_upload_preview_missing',
            signal: options.signal
        });
        await waitForCondition(() => findEditor(documentRef, composerRoot), {
            timeoutMs: editorTimeoutMs,
            intervalMs,
            timeoutError: 'chat_editor_missing',
            signal: options.signal
        });

        throwIfAborted(options.signal);
        const chatEditor = findEditor(documentRef, composerRoot);
        if (!injectEditorText(instruction, documentRef, chatEditor)) {
            throw fail('chat_editor_missing');
        }

        await waitForCondition(
            () => {
                const editor = findEditor(documentRef, composerRoot);
                return (
                    editor &&
                    editorTextIncludesAll(editor, editorVerificationText)
                );
            },
            {
                timeoutMs: editorInjectionTimeoutMs,
                intervalMs,
                timeoutError: 'chat_editor_injection_failed',
                signal: options.signal
            }
        );

        const submitButton = await waitForCondition(
            () => findVisibleButtonByLabels(['Submit', 'Send'], documentRef, composerRoot), {
            timeoutMs: submitTimeoutMs,
            intervalMs,
            timeoutError: 'chat_submit_missing',
            signal: options.signal
            }
        );
        throwIfAborted(options.signal);
        await clickChatSubmitButton(
            submitButton,
            documentRef,
            workflowUtils,
            mediaKind,
            composerRoot,
            options
        );

        const generatedPrompt = await waitForGeneratedChatPrompt(documentRef, mediaKind, {
            ...options,
            timeoutMs,
            intervalMs
        });

        return {
            ok: true,
            runId: request.runId,
            generatedPrompt,
            referenceSummary: {
                kind: mediaKind,
                source: reference.source,
                name: reference.name,
                mimeType: reference.mimeType,
                byteLength: reference.byteLength,
                sourceHash: await hashReferenceDataUrl(reference.dataUrl, { utils: workflowUtils }),
                sourceUrl: reference.url || (reference.metadata && reference.metadata.sourceVideoUrl) || '',
                durationSec: reference.metadata && Number.isFinite(reference.metadata.durationSec)
                    ? reference.metadata.durationSec
                    : null,
                width: reference.metadata && Number.isFinite(reference.metadata.width)
                    ? reference.metadata.width
                    : null,
                height: reference.metadata && Number.isFinite(reference.metadata.height)
                    ? reference.metadata.height
                    : null,
                frameSampleCount: reference.metadata && Number.isFinite(reference.metadata.frameSampleCount)
                    ? reference.metadata.frameSampleCount
                    : 0,
                hasContactSheet: !!(reference.frames && reference.frames.contactSheetDataUrl)
            }
        };
    }

    function getControlText(element) {
        return [
            element.textContent,
            element.getAttribute('aria-label'),
            element.getAttribute('value')
        ]
            .filter(Boolean)
            .join(' ')
            .trim();
    }

    function controlLooksSelected(element) {
        if (!element) return false;
        if (element.checked === true) return true;
        const ariaChecked = String(element.getAttribute('aria-checked') || '').toLowerCase();
        const dataState = String(element.getAttribute('data-state') || '').toLowerCase();
        const ariaPressed = String(element.getAttribute('aria-pressed') || '').toLowerCase();
        return ariaChecked === 'true' || dataState === 'checked' || dataState === 'active' || ariaPressed === 'true';
    }

    function findImagineModeControl(label, documentRef = document, scopeRoot = null) {
        const expected = String(label || '').trim().toLowerCase();
        const queryRoot = scopeRoot && typeof scopeRoot.querySelectorAll === 'function'
            ? scopeRoot
            : documentRef;
        const controls = Array.from(
            queryRoot.querySelectorAll('button, [role="radio"], [role="tab"], label, input[type="radio"]')
        ).filter((element) => {
            if (isInsidePowerToolsOverlay(element)) return false;
            if (element.matches && element.matches('input[type="radio"]')) {
                const id = element.id ? documentRef.querySelector(`label[for="${element.id}"]`) : null;
                const labelText = id ? getControlText(id) : getControlText(element);
                return labelText.toLowerCase() === expected;
            }
            return isVisibleElement(element) && getControlText(element).toLowerCase() === expected;
        });

        return controls[0] || null;
    }

    function findImagineComposerRoot(editor, documentRef = document) {
        if (!editor) return null;
        const hasImagineControls = (candidate) => {
            if (!candidate || !isVisibleElement(candidate)) return false;
            const submit = findVisibleButtonByLabels(['Submit', 'Send'], documentRef, candidate);
            const imageMode = findImagineModeControl('Image', documentRef, candidate);
            const videoMode = findImagineModeControl('Video', documentRef, candidate);
            return !!(submit && imageMode && videoMode);
        };
        const queryBar = editor.closest?.('.query-bar');
        if (hasImagineControls(queryBar)) return queryBar;

        let current = editor.parentElement;
        while (current && current !== documentRef.body && current !== documentRef.documentElement) {
            if (isComposerRootCandidate(current, editor, documentRef) && hasImagineControls(current)) {
                return current;
            }
            current = current.parentElement;
        }
        return null;
    }

    async function selectImagineMode(mediaKind, documentRef = document, composerRoot = null, options = {}) {
        const label = mediaKind === 'video' ? 'Video' : 'Image';
        const control = findImagineModeControl(label, documentRef, composerRoot);
        if (!control) {
            throw fail(mediaKind === 'video' ? 'imagine_video_mode_missing' : 'imagine_image_mode_missing');
        }

        if (!controlLooksSelected(control)) {
            const clickTarget = control.matches?.('input[type="radio"]')
                ? (control.id && composerRoot?.querySelector?.(`label[for="${control.id}"]`)) || control
                : control;
            await clickElementNatively(clickTarget, { ...options, documentRef });
        }

        await waitForCondition(() => {
            const current = findImagineModeControl(label, documentRef, composerRoot);
            return current && controlLooksSelected(current);
        }, {
            timeoutMs: Number.isFinite(options.modeSelectionTimeoutMs) ? options.modeSelectionTimeoutMs : 5000,
            intervalMs: Number.isFinite(options.intervalMs) ? options.intervalMs : 100,
            timeoutError: 'imagine_mode_selection_failed',
            signal: options.signal
        });
        return true;
    }

    function setPromptCaptureHint(documentRef, mediaKind) {
        const root = documentRef?.documentElement;
        if (!root?.dataset) return;
        root.dataset.gptPromptCaptureType = mediaKind === 'video' ? 'video' : 'image';
    }

    function clearPromptCaptureHint(documentRef) {
        const root = documentRef?.documentElement;
        if (root?.dataset) delete root.dataset.gptPromptCaptureType;
    }

    async function runImagineSubmitStep(request, options = {}) {
        const documentRef = getDocumentRef(options);
        const intervalMs = Number.isFinite(options.intervalMs) ? options.intervalMs : 250;
        const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 15000;
        const resultTimeoutMs = Number.isFinite(options.resultTimeoutMs)
            ? options.resultTimeoutMs
            : Number.isFinite(request.resultTimeoutMs)
              ? request.resultTimeoutMs
              : DEFAULT_IMAGINE_RESULT_TIMEOUT_MS;
        const placeholderTimeoutMs = Number.isFinite(options.placeholderTimeoutMs)
            ? options.placeholderTimeoutMs
            : Number.isFinite(request.placeholderTimeoutMs)
              ? request.placeholderTimeoutMs
              : DEFAULT_IMAGINE_PLACEHOLDER_TIMEOUT_MS;
        const resultMediaFetchTimeoutMs = Number.isFinite(options.resultMediaFetchTimeoutMs)
            ? options.resultMediaFetchTimeoutMs
            : Number.isFinite(request.resultMediaFetchTimeoutMs)
              ? request.resultMediaFetchTimeoutMs
              : 15000;
        const mediaKind = request.targetMode === 'video' || request.referenceKind === 'video' || request.mediaKind === 'video'
            ? 'video'
            : 'image';
        const promptVerificationText = getGeneratedPromptVerificationText(request.generatedPrompt);
        const startingUrl = String(getDocumentLocation(documentRef).href || '');

        await confirmOperationDocument(options);
        throwIfAborted(options.signal);
        const imagineEditor = await waitForCondition(() => findEditor(documentRef), {
            timeoutMs,
            intervalMs,
            timeoutError: 'imagine_editor_missing',
            signal: options.signal
        });
        const composerRoot = findImagineComposerRoot(imagineEditor, documentRef);
        if (!composerRoot) throw fail('imagine_composer_missing');
        await selectImagineMode(mediaKind, documentRef, composerRoot, options);
        throwIfAborted(options.signal);
        const activeImagineEditor = findEditor(documentRef, composerRoot);
        if (!injectEditorText(request.generatedPrompt, documentRef, activeImagineEditor)) throw fail('imagine_editor_missing');

        await waitForCondition(
            () => {
                const editor = findEditor(documentRef, composerRoot);
                return editor && editorTextIncludes(editor, promptVerificationText);
            },
            {
                timeoutMs,
                intervalMs,
                timeoutError: 'imagine_editor_injection_failed',
                signal: options.signal
            }
        );

        await waitForCondition(() => findVisibleButtonByLabels(['Submit', 'Send'], documentRef, composerRoot), {
            timeoutMs,
            intervalMs,
            timeoutError: 'imagine_submit_disabled',
            signal: options.signal
        });

        throwIfAborted(options.signal);
        const previousResultSnapshot = createGeneratedResultSnapshot(documentRef, mediaKind);
        await recordResultBaseline(previousResultSnapshot, mediaKind, options);
        throwIfAborted(options.signal);
        const submitButton = findVisibleButtonByLabels(['Submit', 'Send'], documentRef, composerRoot);
        setPromptCaptureHint(documentRef, mediaKind);
        try {
            if (typeof options.nativeClick === 'function') {
                await recordSubmissionState('dispatching', options);
            }
            await clickElementNatively(submitButton, {
                ...options,
                documentRef,
                submissionState: 'dispatching'
            });
            await recordSubmissionState('click_sent', options);
            await waitForCondition(() => {
                const currentUrl = String(getDocumentLocation(documentRef).href || '');
                if (currentUrl && startingUrl && currentUrl !== startingUrl) return true;
                const currentEditor = findEditor(documentRef, composerRoot);
                if (!currentEditor || !editorTextIncludes(currentEditor, promptVerificationText)) return true;
                return collectGeneratedResultCandidates(documentRef, mediaKind)
                    .some((candidate) => resultCandidateIsNew(candidate, previousResultSnapshot));
            }, {
                timeoutMs: Math.max(timeoutMs, 30000),
                intervalMs,
                timeoutError: 'imagine_submission_unverified',
                signal: options.signal
            });
            await recordSubmissionState('provider_accepted', options);
        } catch (error) {
            if (isAbortFailure(error, options.signal)) throw abortError();
            if (error?.clickState === 'not_dispatched') {
                await recordSubmissionState('not_dispatched', options).catch(() => {});
            } else if (error?.clickState === 'click_sent') {
                await recordSubmissionState('click_sent', options).catch(() => {});
            } else if (error?.clickState === 'unknown') {
                await recordSubmissionState('unknown', options).catch(() => {});
            }
            const code = String((error && error.code) || '');
            throw fail(
                code.startsWith('native_click_') || code.startsWith('recreate_')
                    ? code
                    : 'imagine_submit_failed'
            );
        } finally {
            clearPromptCaptureHint(documentRef);
        }
        const result = await waitForImagineResult(
            documentRef,
            previousResultSnapshot,
            {
            resultTimeoutMs,
            placeholderTimeoutMs,
            resultMediaFetchTimeoutMs,
            openedPostTimeoutMs: options.openedPostTimeoutMs,
            intervalMs,
            mediaKind,
            chromeRuntime: options.chromeRuntime,
            nativeClick: options.nativeClick,
            now: options.now,
            signal: options.signal,
            authority: options.authority
            }
        );
        await recordSubmissionState('result_claimed', options);

        return {
            ok: true,
            runId: request.runId,
            mediaKind,
            submitted: true,
            resultReady: true,
            result
        };
    }

    async function runImaginePostValidationStep(request, options = {}) {
        const documentRef = getDocumentRef(options);
        const intervalMs = Number.isFinite(options.intervalMs) ? options.intervalMs : 250;
        const resultTimeoutMs = Number.isFinite(options.resultTimeoutMs)
            ? options.resultTimeoutMs
            : Number.isFinite(request.resultTimeoutMs)
              ? request.resultTimeoutMs
              : DEFAULT_IMAGINE_RESULT_TIMEOUT_MS;
        const placeholderTimeoutMs = Number.isFinite(options.placeholderTimeoutMs)
            ? options.placeholderTimeoutMs
            : Number.isFinite(request.placeholderTimeoutMs)
              ? request.placeholderTimeoutMs
              : DEFAULT_IMAGINE_PLACEHOLDER_TIMEOUT_MS;
        const resultMediaFetchTimeoutMs = Number.isFinite(options.resultMediaFetchTimeoutMs)
            ? options.resultMediaFetchTimeoutMs
            : Number.isFinite(request.resultMediaFetchTimeoutMs)
              ? request.resultMediaFetchTimeoutMs
              : 15000;
        const mediaKind = request.targetMode === 'video' || request.referenceKind === 'video' || request.mediaKind === 'video'
            ? 'video'
            : 'image';

        await confirmOperationDocument(options);
        throwIfAborted(options.signal);
        if (!pageLooksLikeImagineResultSurface(documentRef)) throw fail('imagine_result_surface_missing');

        const previousSnapshot = {
            elements: new WeakSet(),
            elementSignatures: new WeakMap(),
            signatures: new Set(),
            persistedSignatures: new Set(Array.isArray(request.baselineSignatures) ? request.baselineSignatures : []),
            assetIds: new Set(Array.isArray(request.baselineAssetIds) ? request.baselineAssetIds : [])
        };
        const result = await waitForImagineResult(
            documentRef,
            previousSnapshot,
            {
            ...options,
            resultTimeoutMs,
            placeholderTimeoutMs,
            resultMediaFetchTimeoutMs,
            intervalMs,
            mediaKind,
            chromeRuntime: options.chromeRuntime,
            nativeClick: options.nativeClick,
            now: options.now,
            signal: options.signal,
            authority: options.authority
            }
        );

        return {
            ok: true,
            runId: request.runId,
            mediaKind,
            submitted: true,
            resultReady: true,
            result
        };
    }

    return {
        collectGeneratedImageCandidates,
        collectGeneratedVideoCandidates,
        collectGeneratedResultCandidates,
        clickElementNatively,
        createGeneratedResultSnapshot,
        getPersistedGeneratedResultCandidateSignature,
        dataUrlToFile,
        collectUploadPreviewCandidates,
        createUploadPreviewSnapshot,
        ensureGrokSearchEnabled,
        extractAssistantPromptFromPage,
        fetchPublicImageAsDataUrl,
        fetchViaBackgroundAsDataUrl,
        fetchViaBridgeAsDataUrl,
        fetchViaBridgeAsBlobUrl,
        findEditor,
        hasUploadPreview,
        injectEditorText,
        getElementClickPoint,
        readBlobAsDataUrl,
        readFileAsRecreateReference,
        resolveReferenceForUpload,
        runChatPromptStep,
        runImagineSubmitStep,
        runImaginePostValidationStep,
        selectCurrentGeneratedImage,
        selectCurrentGeneratedMedia,
        setFileInputFiles,
        sourceToDataUrl,
        submitVisibleButton,
        uploadReferenceFile,
        waitForImagineResult,
        waitForCondition
    };
});
