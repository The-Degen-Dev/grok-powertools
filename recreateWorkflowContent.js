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

    const DEFAULT_IMAGINE_RESULT_TIMEOUT_MS = 7 * 60 * 1000;
    const DEFAULT_IMAGINE_PLACEHOLDER_TIMEOUT_MS = 90 * 1000;

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

    function delay(ms) {
        return new Promise((resolve) => {
            setTimeout(resolve, ms);
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

    function collectGeneratedResultCandidates(documentRef = document) {
        const workflowUtils = getUtils();
        return collectGeneratedImageCandidates(documentRef).filter((candidate) => {
            const rect = candidate.rect || {};
            const renderedWidth = Number(rect.width || 0);
            const renderedHeight = Number(rect.height || 0);
            const looksGenerated =
                typeof workflowUtils.isLikelyGeneratedImageCandidate === 'function'
                    ? workflowUtils.isLikelyGeneratedImageCandidate(candidate)
                    : candidate.alt === 'Generated image';

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
            candidate.src || '',
            candidate.alt || '',
            candidate.naturalWidth || 0,
            candidate.naturalHeight || 0
        ].join('|');
    }

    function createGeneratedResultSnapshot(documentRef = document) {
        const candidates = collectGeneratedResultCandidates(documentRef);
        const elementSignatures = new WeakMap();
        candidates.forEach((candidate) => {
            elementSignatures.set(candidate.element, getGeneratedResultCandidateSignature(candidate));
        });

        return {
            elements: new WeakSet(candidates.map((candidate) => candidate.element)),
            elementSignatures,
            signatures: new Set(candidates.map(getGeneratedResultCandidateSignature))
        };
    }

    function resultCandidateIsNew(candidate, previousSnapshot) {
        if (!previousSnapshot) return true;

        const signature = getGeneratedResultCandidateSignature(candidate);
        if (previousSnapshot.elementSignatures && previousSnapshot.elementSignatures.has(candidate.element)) {
            return previousSnapshot.elementSignatures.get(candidate.element) !== signature;
        }

        if (previousSnapshot.elements && previousSnapshot.elements.has(candidate.element)) return false;
        if (previousSnapshot.signatures && previousSnapshot.signatures.has(signature)) return false;
        return true;
    }

    function getGeneratedResultSourceKind(src) {
        const value = String(src || '');
        const workflowUtils = getUtils();

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

    function getOpenableSurfaceKind(candidate) {
        const element = candidate && candidate.element;
        if (!element) return 'none';

        let current = element;
        for (let depth = 0; current && depth < 5; depth++) {
            if (current.matches && current.matches('a[href]')) return 'link';
            if (current.matches && current.matches('button, [role="button"], [tabindex]')) return 'interactive';
            current = current.parentElement;
        }

        if (getGeneratedResultSourceKind(candidate.src) === 'trusted-grok-media' && trustedResultUrlLooksOpenable(candidate.src)) {
            return 'direct-media-url';
        }

        return 'none';
    }

    function isFullSizeGeneratedResultCandidate(candidate) {
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

    function isCredibleGeneratedResultCandidate(candidate) {
        const sourceKind = getGeneratedResultSourceKind(candidate.src);

        if (sourceKind === 'trusted-grok-media') {
            return isFullSizeGeneratedResultCandidate(candidate) && getOpenableSurfaceKind(candidate) !== 'none';
        }

        if (sourceKind === 'data-url' || sourceKind === 'blob-url') {
            return isFullSizeGeneratedResultCandidate(candidate);
        }

        return false;
    }

    function getDocumentLocation(documentRef = document) {
        const view = documentRef.defaultView || root || {};
        return view.location || {};
    }

    function pageLooksLikeImaginePost(documentRef = document) {
        const location = getDocumentLocation(documentRef);
        return String(location.pathname || '').includes('/imagine/post/');
    }

    function findTrustedOpenedPostMediaCandidate(documentRef = document) {
        return collectGeneratedImageCandidates(documentRef).find((candidate) => {
            const sourceKind = getGeneratedResultSourceKind(candidate.src);
            const rect = candidate.rect || {};
            const renderedMin = Math.min(Number(rect.width || 0), Number(rect.height || 0));
            const naturalWidth = Number(candidate.naturalWidth || 0);
            const naturalHeight = Number(candidate.naturalHeight || 0);

            return (
                sourceKind === 'trusted-grok-media' &&
                trustedResultUrlLooksOpenable(candidate.src) &&
                candidate.complete !== false &&
                Math.max(naturalWidth, naturalHeight) >= 768 &&
                Math.min(naturalWidth, naturalHeight) >= 512 &&
                renderedMin >= 120 &&
                !isInsidePowerToolsOverlay(candidate.element)
            );
        });
    }

    async function verifyTrustedMediaCandidate(candidate, options = {}) {
        const workflowUtils = getUtils(options);
        const dataUrl = await sourceToDataUrl(candidate.src, {
            ...options,
            timeoutMs: Number.isFinite(options.resultMediaFetchTimeoutMs)
                ? options.resultMediaFetchTimeoutMs
                : 15000,
            utils: workflowUtils
        });
        const parsed = workflowUtils.parseRecreateDataUrl(dataUrl);

        if (parsed.byteLength < 10 * 1024) {
            return { ok: false, error: 'result_media_too_small' };
        }

        return {
            ok: true,
            byteLength: parsed.byteLength
        };
    }

    async function verifyOpenedPostMedia(originalCandidate, options = {}) {
        const documentRef = getDocumentRef(options);
        const timeoutMs = Number.isFinite(options.openedPostTimeoutMs) ? options.openedPostTimeoutMs : 20000;
        const intervalMs = Number.isFinite(options.intervalMs) ? options.intervalMs : 500;

        const openedCandidate = await waitForCondition(
            () => findTrustedOpenedPostMediaCandidate(documentRef),
            {
                timeoutMs,
                intervalMs,
                timeoutError: 'result_post_open_failed'
            }
        );
        const mediaVerification = await verifyTrustedMediaCandidate(openedCandidate, options);
        if (!mediaVerification.ok) return mediaVerification;

        const location = getDocumentLocation(documentRef);
        return {
            ok: true,
            summary: {
                ...summarizeGeneratedResultCandidate(originalCandidate),
                openedSourceKind: getGeneratedResultSourceKind(openedCandidate.src),
                openedUrl: openedCandidate.src,
                postUrl: String(location.href || ''),
                byteLength: mediaVerification.byteLength,
                openable: true,
                openableSurface: 'opened-post'
            }
        };
    }

    function normalizeResultOpenabilityError(error) {
        const code = String((error && (error.code || error.message)) || '');
        if (code.startsWith('native_click_') || code.startsWith('result_post_')) return code;
        if (code === 'timeout') return 'result_post_open_failed';
        return 'result_media_fetch_failed';
    }

    async function verifyGeneratedResultCandidateOpenable(candidate, options = {}) {
        if (!isCredibleGeneratedResultCandidate(candidate)) {
            return { ok: false, error: 'result_candidate_not_credible' };
        }

        try {
            const sourceKind = getGeneratedResultSourceKind(candidate.src);
            if (sourceKind === 'data-url' || sourceKind === 'blob-url') {
                await clickElementNatively(candidate.element, {
                    ...options,
                    clickPointStrategy: 'upper-visible'
                });
                if (!pageLooksLikeImaginePost(getDocumentRef(options))) {
                    // Grok can route after a short delay even though the click has already landed.
                    await waitForCondition(() => pageLooksLikeImaginePost(getDocumentRef(options)), {
                        timeoutMs: Number.isFinite(options.openedPostTimeoutMs) ? options.openedPostTimeoutMs : 20000,
                        intervalMs: Number.isFinite(options.intervalMs) ? options.intervalMs : 500,
                        timeoutError: 'result_post_open_failed'
                    });
                }
                return await verifyOpenedPostMedia(candidate, options);
            }

            const mediaVerification = await verifyTrustedMediaCandidate(candidate, options);
            if (!mediaVerification.ok) return mediaVerification;

            return {
                ok: true,
                summary: {
                    ...summarizeGeneratedResultCandidate(candidate),
                    byteLength: mediaVerification.byteLength,
                    openable: true,
                    openableSurface: getOpenableSurfaceKind(candidate)
                }
            };
        } catch (error) {
            return {
                ok: false,
                error: normalizeResultOpenabilityError(error)
            };
        }
    }

    function isPlaceholderGeneratedResultCandidate(candidate) {
        const sourceKind = getGeneratedResultSourceKind(candidate.src);
        const naturalMax = Math.max(Number(candidate.naturalWidth || 0), Number(candidate.naturalHeight || 0));
        const rect = candidate.rect || {};
        const renderedMax = Math.max(Number(rect.width || 0), Number(rect.height || 0));

        return sourceKind === 'data-url' && naturalMax > 0 && naturalMax < 512 && renderedMax >= 180;
    }

    function summarizeGeneratedResultCandidate(candidate) {
        const rect = candidate.rect || {};

        return {
            sourceKind: getGeneratedResultSourceKind(candidate.src),
            openableSurface: getOpenableSurfaceKind(candidate),
            naturalWidth: Number(candidate.naturalWidth || 0),
            naturalHeight: Number(candidate.naturalHeight || 0),
            renderedWidth: Number(rect.width || 0),
            renderedHeight: Number(rect.height || 0)
        };
    }

    function inspectImagineResultState(documentRef = document, previousSnapshot = null) {
        const candidates = collectGeneratedResultCandidates(documentRef);
        const newCandidates = candidates.filter((candidate) => resultCandidateIsNew(candidate, previousSnapshot));
        const readyCandidate = newCandidates.find(isCredibleGeneratedResultCandidate) || null;
        const placeholderCandidates = newCandidates.filter(isPlaceholderGeneratedResultCandidate);
        const trustedCandidates = newCandidates.filter((candidate) => getGeneratedResultSourceKind(candidate.src) === 'trusted-grok-media');
        const fullSizeCandidates = newCandidates.filter(isFullSizeGeneratedResultCandidate);
        const sourceKinds = Array.from(
            new Set(newCandidates.map((candidate) => getGeneratedResultSourceKind(candidate.src)))
        );

        return {
            ready: !!readyCandidate,
            candidate: readyCandidate,
            summary: readyCandidate ? summarizeGeneratedResultCandidate(readyCandidate) : null,
            candidateCount: candidates.length,
            newCandidateCount: newCandidates.length,
            placeholderCount: placeholderCandidates.length,
            trustedCount: trustedCandidates.length,
            fullSizeCount: fullSizeCandidates.length,
            openableCount: readyCandidate ? 1 : 0,
            largestNaturalWidth: Math.max(0, ...newCandidates.map((candidate) => Number(candidate.naturalWidth || 0))),
            largestNaturalHeight: Math.max(0, ...newCandidates.map((candidate) => Number(candidate.naturalHeight || 0))),
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
        let lastState = inspectImagineResultState(documentRef, previousSnapshot);
        let lastOpenabilityError = null;
        const verificationCache = new Map();

        while (now() - startedAt <= resultTimeoutMs) {
            lastState = inspectImagineResultState(documentRef, previousSnapshot);
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

            await delay(intervalMs);
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

    function fetchViaBridgeAsDataUrl(url, options = {}) {
        if (!url) return Promise.reject(fail('reference_missing'));

        const documentRef = getDocumentRef(options);
        const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 15000;
        const requestId = `recreate_fetch_${Date.now()}_${Math.random().toString(16).slice(2)}`;

        return new Promise((resolve, reject) => {
            let settled = false;
            const timer = setTimeout(() => {
                finish(null, fail('reference_capture_failed'));
            }, timeoutMs);

            function finish(dataUrl, error) {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                documentRef.removeEventListener('__gpt_fetch_media_data_url_result', onResult);

                if (error) {
                    reject(error);
                    return;
                }

                resolve(dataUrl);
            }

            function onResult(event) {
                const detail = event.detail || {};
                if (detail.requestId !== requestId) return;

                if (detail.error || !String(detail.dataUrl || '').startsWith('data:image/')) {
                    finish(null, fail('reference_capture_failed'));
                    return;
                }

                finish(detail.dataUrl);
            }

            documentRef.addEventListener('__gpt_fetch_media_data_url_result', onResult);

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

    function shouldFetchViaBackgroundAsDataUrl(url) {
        try {
            const parsed = new URL(String(url || ''));
            return (
                parsed.protocol === 'https:' &&
                (parsed.hostname === 'imagine-public.x.ai' || parsed.hostname === 'images-public.x.ai')
            );
        } catch {
            return false;
        }
    }

    function fetchWithTimeout(url, fetchOptions, timeoutMs) {
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return fetch(url, fetchOptions);

        return new Promise((resolve, reject) => {
            const abortController = typeof AbortController !== 'undefined' ? new AbortController() : null;
            const timer = setTimeout(() => {
                if (abortController) abortController.abort();
                reject(fail('reference_capture_failed'));
            }, timeoutMs);

            const options = abortController
                ? { ...fetchOptions, signal: abortController.signal }
                : fetchOptions;

            fetch(url, options)
                .then(resolve, reject)
                .finally(() => clearTimeout(timer));
        });
    }

    async function fetchPublicImageAsDataUrl(url, options = {}) {
        if (!url) throw fail('reference_missing');

        try {
            const response = await fetchWithTimeout(
                String(url),
                { credentials: 'omit' },
                Number.isFinite(options.timeoutMs) ? options.timeoutMs : undefined
            );
            if (!response || !response.ok) throw fail('reference_capture_failed');

            const dataUrl = await readBlobAsDataUrl(await response.blob());
            if (!String(dataUrl || '').startsWith('data:image/')) throw fail('reference_capture_failed');

            return dataUrl;
        } catch {
            throw fail('reference_capture_failed');
        }
    }

    async function fetchViaBackgroundAsDataUrl(url, options = {}) {
        if (!url) throw fail('reference_missing');

        const runtime = getChromeRuntime(options);
        if (!runtime || typeof runtime.sendMessage !== 'function') throw fail('reference_capture_failed');

        try {
            const response = await runtime.sendMessage({
                action: 'FETCH_GPT_RECREATE_REFERENCE_DATA_URL',
                url: String(url)
            });

            if (!response || !response.ok || !String(response.dataUrl || '').startsWith('data:image/')) {
                throw fail('reference_capture_failed');
            }

            return response.dataUrl;
        } catch {
            throw fail('reference_capture_failed');
        }
    }

    async function sourceToDataUrl(src, options = {}) {
        const value = String(src || '');
        if (!value) throw fail('reference_missing');
        if (value.startsWith('data:image/')) return value;

        const workflowUtils = getUtils(options);
        if (workflowUtils.isTrustedGrokMediaUrl(value)) {
            if (shouldFetchViaBackgroundAsDataUrl(value)) {
                let publicFetchFailed = false;

                try {
                    return await fetchPublicImageAsDataUrl(value, { timeoutMs: options.timeoutMs });
                } catch {
                    publicFetchFailed = true;
                    // Fall through to the extension service worker.
                }

                try {
                    return await fetchViaBackgroundAsDataUrl(value, options);
                } catch {
                    // Fall through to the page bridge. Some Grok media is only reachable with page cookies.
                }

                try {
                    return await fetchViaBridgeAsDataUrl(value, options);
                } catch {
                    throw fail(publicFetchFailed ? 'reference_public_fetch_failed' : 'reference_capture_failed');
                }
            }

            try {
                return await fetchViaBridgeAsDataUrl(value, options);
            } catch {
                throw fail('reference_capture_failed');
            }
        }

        try {
            const response = await fetch(value);
            if (!response || !response.ok) throw fail('reference_capture_failed');

            return await readBlobAsDataUrl(await response.blob());
        } catch {
            throw fail('reference_capture_failed');
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

    function findEditor(documentRef = document) {
        const editors = Array.from(
            documentRef.querySelectorAll(
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

    function chatEditorStillContainsInstruction(documentRef, workflowUtils) {
        const editor = findEditor(documentRef);
        return (
            editor &&
            editorTextIncludesAll(editor, [
                'You are creating a Grok Imagine prompt from the attached reference image.',
                workflowUtils.FINAL_PROMPT_MARKER
            ])
        );
    }

    async function waitForChatSubmitAccepted(documentRef, workflowUtils, options = {}) {
        const timeoutMs = Number.isFinite(options.chatSubmitAcceptedTimeoutMs)
            ? options.chatSubmitAcceptedTimeoutMs
            : 1500;
        const intervalMs = Number.isFinite(options.intervalMs) ? options.intervalMs : 100;

        await waitForCondition(
            () => {
                if (!chatEditorStillContainsInstruction(documentRef, workflowUtils)) return true;

                try {
                    return !!extractAssistantPromptFromPage(documentRef);
                } catch (error) {
                    if (error && error.message === 'chat_prompt_marker_missing') return null;
                    throw error;
                }
            },
            {
                timeoutMs,
                intervalMs,
                timeoutError: 'chat_submit_not_sent'
            }
        );
    }

    function injectEditorText(text, documentRef = document) {
        const editor = findEditor(documentRef);
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

    function findVisibleButtonByLabels(labels, documentRef = document) {
        return Array.from(documentRef.querySelectorAll('button[aria-label]')).find(
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
        if (typeof options.nativeClick === 'function') {
            return await options.nativeClick(click);
        }

        const runtime = getChromeRuntime(options);
        if (!runtime || typeof runtime.sendMessage !== 'function') throw fail('native_click_unavailable');

        const response = await runtime.sendMessage({
            action: 'GPT_RECREATE_NATIVE_CLICK',
            click
        });

        if (!response || response.ok !== true) {
            throw fail((response && response.error) || 'native_click_unavailable');
        }

        return response;
    }

    function shouldUseNativeClick(options = {}) {
        return typeof options.nativeClick === 'function' || !!getChromeRuntime(options);
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
        const click = getElementClickPoint(element, options);

        return await withOverlayPointerPassThrough(element, options, async () => {
            if (shouldUseNativeClick(options)) {
                await sendNativeClick(click, options);
                return true;
            }

            if (options.syntheticClickFallback === false) throw fail('native_click_unavailable');
            if (!safelyClickElement(element, click)) throw fail('synthetic_click_failed');
            return true;
        });
    }

    async function clickChatSubmitButton(submitButton, documentRef, workflowUtils, options = {}) {
        try {
            await clickElementNatively(submitButton, { ...options, documentRef });
        } catch (error) {
            const code = String((error && error.code) || '');
            throw fail(code.startsWith('native_click_') ? code : 'chat_submit_failed');
        }

        try {
            await waitForChatSubmitAccepted(documentRef, workflowUtils, options);
            return;
        } catch (error) {
            if (!error || error.code !== 'chat_submit_not_sent') throw error;
        }

        const click = getElementClickPoint(submitButton, { ...options, documentRef });
        if (!safelyClickElement(submitButton, click)) {
            if (typeof submitButton.click !== 'function') throw fail('chat_submit_failed');
            submitButton.click();
        }

        await waitForChatSubmitAccepted(documentRef, workflowUtils, options);
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

    function findComposerRootByButtonLabels(editor, labels, documentRef = document) {
        let current = editor && editor.parentElement;

        while (current && current !== documentRef.body && current !== documentRef.documentElement) {
            if (
                isComposerRootCandidate(current, editor, documentRef) &&
                Array.from(current.querySelectorAll('button[aria-label]')).some(
                    (button) => buttonMatchesLabel(button, labels) && isVisibleElement(button) && isEnabledButton(button)
                )
            ) {
                return current;
            }

            current = current.parentElement;
        }

        return null;
    }

    function findUploadComposerRoot(documentRef = document) {
        const editor = findEditor(documentRef);
        if (!editor) return documentRef.body || documentRef;

        return findComposerRootByButtonLabels(editor, ['Attach', 'Upload'], documentRef) || editor.parentElement || documentRef.body || documentRef;
    }

    function findComposerSearchButton(documentRef = document) {
        const editor = findEditor(documentRef);
        if (!editor) return null;

        const composerRoot = findComposerRoot(editor, documentRef);
        if (!composerRoot) return null;

        return (
            Array.from(composerRoot.querySelectorAll('button[aria-label]')).find(
                (button) => buttonMatchesLabel(button, ['Search']) && isVisibleElement(button) && isEnabledButton(button)
            ) || null
        );
    }

    function ensureGrokSearchEnabled(documentRef = document) {
        const button = findComposerSearchButton(documentRef);
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

    function uploadInputScore(input, composerRoot) {
        if (isInsidePowerToolsOverlay(input)) return -1;

        const accept = String(input.getAttribute('accept') || '').toLowerCase();
        if (accept && !accept.includes('image') && !input.multiple) return -1;

        let score = 0;
        if (composerRoot && typeof composerRoot.contains === 'function' && composerRoot.contains(input)) score += 100;
        if (!accept) score += 10;
        if (accept.includes('image')) score += 8;
        if (input.multiple) score += 4;
        return score;
    }

    function findUploadInput(documentRef = document) {
        const composerRoot = findUploadComposerRoot(documentRef);
        const candidates = Array.from(documentRef.querySelectorAll('input[type="file"]'))
            .map((input) => ({ input, score: uploadInputScore(input, composerRoot) }))
            .filter((candidate) => candidate.score >= 0)
            .sort((left, right) => right.score - left.score);

        return candidates.length ? candidates[0].input : null;
    }

    function uploadReferenceFile(reference, documentRef = document) {
        const input = findUploadInput(documentRef);
        if (!input) throw fail('chat_upload_input_missing');

        setFileInputFiles(input, dataUrlToFile(reference));
        return true;
    }

    function getUploadPreviewSignature(img) {
        const src = String(img.currentSrc || img.src || '');
        const rect = img.getBoundingClientRect();
        return [
            src,
            img.getAttribute('alt') || '',
            img.naturalWidth || 0,
            img.naturalHeight || 0,
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

    function getVisibleUploadButtons(documentRef = document) {
        return Array.from(documentRef.querySelectorAll('button[aria-label]')).filter(
            (button) => buttonMatchesLabel(button, ['Attach', 'Upload']) && isVisibleElement(button) && isEnabledButton(button)
        );
    }

    function isNearUploadButton(img, uploadButtons) {
        const rect = img.getBoundingClientRect();
        return uploadButtons.some((button) => rectsAreNear(rect, button.getBoundingClientRect()));
    }

    function collectUploadPreviewCandidates(documentRef = document) {
        const composerRoot = findUploadComposerRoot(documentRef);
        const uploadButtons = getVisibleUploadButtons(documentRef);

        return Array.from(documentRef.querySelectorAll('img')).filter((img) => {
            const src = String(img.currentSrc || img.src || '');
            const rect = img.getBoundingClientRect();
            const maxVisibleSize = Math.max(img.naturalWidth || 0, img.naturalHeight || 0, rect.width || 0, rect.height || 0);
            const nearUploadControl = composerRoot.contains(img) || isNearUploadButton(img, uploadButtons);
            const looksLikeUpload =
                src.startsWith('blob:') ||
                src.startsWith('data:image/') ||
                src.includes('assets.grok.com/users/') ||
                /upload|attach|reference/i.test(img.getAttribute('alt') || '');

            return (
                !isInsidePowerToolsOverlay(img) &&
                isVisibleElement(img) &&
                maxVisibleSize > 20 &&
                looksLikeUpload &&
                nearUploadControl
            );
        });
    }

    function createUploadPreviewSnapshot(documentRef = document) {
        const candidates = collectUploadPreviewCandidates(documentRef);
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

    function hasUploadPreview(documentRef = document, previousSnapshot = null) {
        return collectUploadPreviewCandidates(documentRef).some((img) => {
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
        return /You are creating a Grok Imagine prompt/i.test(text) || /<one ready-to-paste Grok Imagine prompt>/i.test(text);
    }

    function extractAssistantPromptFromPage(documentRef = document) {
        const workflowUtils = getUtils();
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
            .filter((text) => text.includes(workflowUtils.FINAL_PROMPT_MARKER) && !textLooksLikeInstructionEcho(text));

        if (!texts.length) throw fail('chat_prompt_marker_missing');
        return workflowUtils.extractFinalImaginePrompt(texts[texts.length - 1]);
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
        const reference = workflowUtils.normalizeRecreateReference(request.reference);
        const instruction = workflowUtils.buildRecreateChatInstruction({
            bestPracticesEnabled: !!request.bestPracticesEnabled
        });

        if (request.bestPracticesEnabled) {
            ensureGrokSearchEnabled(documentRef);
        }

        const previewSnapshot = createUploadPreviewSnapshot(documentRef);
        await waitForCondition(() => findUploadInput(documentRef), {
            timeoutMs: uploadInputTimeoutMs,
            intervalMs,
            timeoutError: 'chat_upload_input_missing'
        });
        uploadReferenceFile(reference, documentRef);
        await waitForCondition(() => hasUploadPreview(documentRef, previewSnapshot), {
            timeoutMs: uploadPreviewTimeoutMs,
            intervalMs,
            timeoutError: 'chat_upload_preview_missing'
        });
        await waitForCondition(() => findEditor(documentRef), {
            timeoutMs: editorTimeoutMs,
            intervalMs,
            timeoutError: 'chat_editor_missing'
        });

        if (!injectEditorText(instruction, documentRef)) {
            throw fail('chat_editor_missing');
        }

        await waitForCondition(
            () => {
                const editor = findEditor(documentRef);
                return (
                    editor &&
                    editorTextIncludesAll(editor, [
                        'You are creating a Grok Imagine prompt from the attached reference image.',
                        workflowUtils.FINAL_PROMPT_MARKER
                    ])
                );
            },
            {
                timeoutMs: editorInjectionTimeoutMs,
                intervalMs,
                timeoutError: 'chat_editor_injection_failed'
            }
        );

        const submitButton = await waitForCondition(() => findVisibleButtonByLabels(['Submit', 'Send'], documentRef), {
            timeoutMs: submitTimeoutMs,
            intervalMs,
            timeoutError: 'chat_submit_missing'
        });
        await clickChatSubmitButton(submitButton, documentRef, workflowUtils, options);

        const generatedPrompt = await waitForCondition(
            () => {
                try {
                    return extractAssistantPromptFromPage(documentRef);
                } catch (error) {
                    if (error && error.message === 'chat_prompt_marker_missing') return null;
                    throw error;
                }
            },
            {
                timeoutMs,
                intervalMs,
                timeoutError: 'chat_answer_timeout'
            }
        );

        return {
            ok: true,
            runId: request.runId,
            generatedPrompt
        };
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
        const imageModeButton = Array.from(documentRef.querySelectorAll('button')).find(
            (button) => isVisibleElement(button) && button.textContent.trim() === 'Image' && isEnabledButton(button)
        );
        const promptVerificationText = getGeneratedPromptVerificationText(request.generatedPrompt);

        if (imageModeButton) safelyClickButton(imageModeButton);
        if (!injectEditorText(request.generatedPrompt, documentRef)) throw fail('imagine_editor_missing');

        await waitForCondition(
            () => {
                const editor = findEditor(documentRef);
                return editor && editorTextIncludes(editor, promptVerificationText);
            },
            {
                timeoutMs,
                intervalMs,
                timeoutError: 'imagine_editor_injection_failed'
            }
        );

        await waitForCondition(() => findVisibleButtonByLabels(['Submit'], documentRef), {
            timeoutMs,
            intervalMs,
            timeoutError: 'imagine_submit_disabled'
        });

        const previousResultSnapshot = createGeneratedResultSnapshot(documentRef);
        const submitButton = findVisibleButtonByLabels(['Submit'], documentRef);
        try {
            await clickElementNatively(submitButton, { ...options, documentRef });
        } catch (error) {
            const code = String((error && error.code) || '');
            throw fail(code.startsWith('native_click_') ? code : 'imagine_submit_failed');
        }
        const result = await waitForImagineResult(documentRef, previousResultSnapshot, {
            resultTimeoutMs,
            placeholderTimeoutMs,
            resultMediaFetchTimeoutMs,
            openedPostTimeoutMs: options.openedPostTimeoutMs,
            intervalMs,
            chromeRuntime: options.chromeRuntime,
            nativeClick: options.nativeClick,
            now: options.now
        });

        return {
            ok: true,
            runId: request.runId,
            submitted: true,
            resultReady: true,
            result
        };
    }

    return {
        collectGeneratedImageCandidates,
        collectGeneratedResultCandidates,
        clickElementNatively,
        createGeneratedResultSnapshot,
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
        runChatPromptStep,
        runImagineSubmitStep,
        selectCurrentGeneratedImage,
        setFileInputFiles,
        sourceToDataUrl,
        submitVisibleButton,
        uploadReferenceFile,
        waitForImagineResult,
        waitForCondition
    };
});
