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

    function injectEditorText(text, documentRef = document) {
        const editor = findEditor(documentRef);
        if (!editor) return false;

        if (typeof editor.focus === 'function') editor.focus();

        if (editor.matches('textarea')) {
            setTextareaValue(editor, String(text || ''));
            return true;
        }

        documentRef.dispatchEvent(createDomCustomEvent(documentRef, '__gpt_set_editor_content', { text: String(text || '') }));
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

    function safelyClickButton(button) {
        try {
            const rect = button.getBoundingClientRect();
            const coordinates = {
                clientX: Number(rect.left || 0) + Number(rect.width || 0) / 2,
                clientY: Number(rect.top || 0) + Number(rect.height || 0) / 2
            };

            ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((type) => {
                button.dispatchEvent(createPointerLikeEvent(button, type, coordinates));
            });
            return true;
        } catch {
            return false;
        }
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
        let current = editor && editor.parentElement;

        while (current && current !== documentRef.body && current !== documentRef.documentElement) {
            if (
                isComposerRootCandidate(current, editor, documentRef) &&
                Array.from(current.querySelectorAll('button[aria-label]')).some(
                    (button) => buttonMatchesLabel(button, ['Search']) && isVisibleElement(button) && isEnabledButton(button)
                )
            ) {
                return current;
            }

            current = current.parentElement;
        }

        return null;
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

    function findUploadInput(documentRef = document) {
        return (
            Array.from(documentRef.querySelectorAll('input[type="file"]')).find((input) => {
                const accept = String(input.getAttribute('accept') || '').toLowerCase();
                return !accept || accept.includes('image') || input.multiple;
            }) || null
        );
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

    function collectUploadPreviewCandidates(documentRef = document) {
        return Array.from(documentRef.querySelectorAll('img')).filter((img) => {
            const src = String(img.currentSrc || img.src || '');
            const rect = img.getBoundingClientRect();
            const maxVisibleSize = Math.max(img.naturalWidth || 0, img.naturalHeight || 0, rect.width || 0, rect.height || 0);
            const looksLikeUpload =
                src.startsWith('blob:') ||
                src.startsWith('data:image/') ||
                src.includes('assets.grok.com/users/') ||
                /upload|attach|reference/i.test(img.getAttribute('alt') || '');

            return isVisibleElement(img) && maxVisibleSize > 20 && looksLikeUpload;
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
        const submitTimeoutMs = Number.isFinite(options.submitTimeoutMs) ? options.submitTimeoutMs : 10000;
        const reference = workflowUtils.normalizeRecreateReference(request.reference);

        if (request.bestPracticesEnabled) {
            ensureGrokSearchEnabled(documentRef);
        }

        const previewSnapshot = createUploadPreviewSnapshot(documentRef);
        uploadReferenceFile(reference, documentRef);
        await waitForCondition(() => hasUploadPreview(documentRef, previewSnapshot), {
            timeoutMs: uploadPreviewTimeoutMs,
            intervalMs,
            timeoutError: 'chat_upload_preview_missing'
        });

        if (
            !injectEditorText(
                workflowUtils.buildRecreateChatInstruction({
                    bestPracticesEnabled: !!request.bestPracticesEnabled
                }),
                documentRef
            )
        ) {
            throw fail('chat_editor_missing');
        }

        await waitForCondition(() => submitVisibleButton(['Submit', 'Send'], documentRef), {
            timeoutMs: submitTimeoutMs,
            intervalMs,
            timeoutError: 'chat_submit_missing'
        });

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
        const imageModeButton = Array.from(documentRef.querySelectorAll('button')).find(
            (button) => isVisibleElement(button) && button.textContent.trim() === 'Image' && isEnabledButton(button)
        );

        if (imageModeButton) safelyClickButton(imageModeButton);
        if (!injectEditorText(request.generatedPrompt, documentRef)) throw fail('imagine_editor_missing');

        await waitForCondition(() => findVisibleButtonByLabels(['Submit'], documentRef), {
            timeoutMs,
            intervalMs,
            timeoutError: 'imagine_submit_disabled'
        });

        if (!submitVisibleButton(['Submit'], documentRef)) throw fail('imagine_submit_failed');
        return {
            ok: true,
            runId: request.runId,
            submitted: true
        };
    }

    return {
        collectGeneratedImageCandidates,
        dataUrlToFile,
        collectUploadPreviewCandidates,
        createUploadPreviewSnapshot,
        ensureGrokSearchEnabled,
        extractAssistantPromptFromPage,
        fetchViaBridgeAsBlobUrl,
        findEditor,
        hasUploadPreview,
        injectEditorText,
        readBlobAsDataUrl,
        readFileAsRecreateReference,
        runChatPromptStep,
        runImagineSubmitStep,
        selectCurrentGeneratedImage,
        setFileInputFiles,
        sourceToDataUrl,
        submitVisibleButton,
        uploadReferenceFile,
        waitForCondition
    };
});
