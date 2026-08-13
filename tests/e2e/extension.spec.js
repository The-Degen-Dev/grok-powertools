const { test, expect } = require('@playwright/test');
const { Buffer } = require('buffer');
const fs = require('fs');
const path = require('path');

// Read content.js and CSS
const providerRegistryJsPath = path.join(__dirname, '../../providerRegistry.js');
const providerRunLedgerJsPath = path.join(__dirname, '../../providerRunLedger.js');
const chatGptImagesContentJsPath = path.join(__dirname, '../../chatgptImagesContent.js');
const utilsJsPath = path.join(__dirname, '../../recreateWorkflowUtils.js');
const contentActionsJsPath = path.join(__dirname, '../../recreateWorkflowContent.js');
const bridgeJsPath = path.join(__dirname, '../../bridge.js');
const contentJsPath = path.join(__dirname, '../../content.js');
const styleCssPath = path.join(__dirname, '../../overlay.css');
const providerRegistryJs = fs.readFileSync(providerRegistryJsPath, 'utf8');
const providerRunLedgerJs = fs.readFileSync(providerRunLedgerJsPath, 'utf8');
const chatGptImagesContentJs = fs.readFileSync(chatGptImagesContentJsPath, 'utf8');
const utilsJs = fs.readFileSync(utilsJsPath, 'utf8');
const contentActionsJs = fs.readFileSync(contentActionsJsPath, 'utf8');
const bridgeJs = fs.readFileSync(bridgeJsPath, 'utf8');
const contentJs = fs.readFileSync(contentJsPath, 'utf8');
const styleCss = fs.readFileSync(styleCssPath, 'utf8');
const { MAX_REFERENCE_BYTES } = require('../../recreateWorkflowUtils.js');

async function evaluateExtensionContent(page) {
    await page.evaluate(providerRegistryJs);
    await page.evaluate(providerRunLedgerJs);
    await page.evaluate(chatGptImagesContentJs);
    await page.evaluate(utilsJs);
    await page.evaluate(contentActionsJs);
    await page.evaluate(contentJs.replace(
        '        scraper.setOverlay(overlay);',
        '        scraper.setOverlay(overlay);\n        window.__gptE2e = { scraper, retry, overlay };'
    ));
}

async function evaluateExtensionContentWithMockedRecreateActions(page) {
    await page.evaluate(providerRegistryJs);
    await page.evaluate(providerRunLedgerJs);
    await page.evaluate(chatGptImagesContentJs);
    await page.evaluate(utilsJs);
    await page.evaluate(contentActionsJs);
    await page.evaluate(() => {
        window.__recreateCalls = [];
        window.GrokRecreateContentActions = {
            readFileAsRecreateReference: async (file, source) => {
                window.__recreateCalls.push({
                    action: 'file',
                    name: file.name,
                    source
                });
                return {
                    name: file.name,
                    mimeType: file.type,
                    dataUrl: 'data:image/png;base64,aGVsbG8=',
                    source,
                    byteLength: file.size
                };
            },
            selectCurrentGeneratedImage: async () => {
                window.__recreateCalls.push({ action: 'current' });
                return {
                    name: 'current-grok-image.png',
                    mimeType: 'image/png',
                    dataUrl: 'data:image/png;base64,aGVsbG8=',
                    source: 'current-grok-image',
                    byteLength: 5
                };
            },
            runChatPromptStep: async (request) => {
                window.__recreateCalls.push({
                    action: 'chat',
                    runId: request.runId,
                    hasReference: !!request.reference
                });
                return {
                    ok: true,
                    runId: request.runId,
                    generatedPrompt: 'Mock generated Imagine prompt'
                };
            },
            runImagineSubmitStep: async (request) => {
                window.__recreateCalls.push({
                    action: 'imagine',
                    runId: request.runId,
                    generatedPrompt: request.generatedPrompt
                });
                return {
                    ok: true,
                    runId: request.runId,
                    submitted: true
                };
            }
        };
    });
    await page.evaluate(contentJs);
}

async function gotoMockProviderPage(page, url) {
    await page.goto(url);
    await page.addStyleTag({ content: styleCss });
}

async function setupMockSavedAgentSync(page, {
    accountUuid,
    mediaUuids,
    responseByAction,
    runToken,
    agentMedia = true,
    agentMediaMode = 'exact_with_decoy',
    stopAfterNavigationClear = true,
    bridgeResponse = null
}) {
    await page.evaluate(({
        accountUuid,
        mediaUuids,
        responseByAction,
        runToken,
        agentMedia,
        agentMediaMode,
        stopAfterNavigationClear,
        bridgeResponse
    }) => {
        window.__chromeRuntimeResponseByAction = responseByAction;

        const { scraper } = window.__gptE2e;
        scraper.Config = { actionWait: 0, navWait: 0, surfaceWait: 100, historyWait: 100 };
        scraper.sleep = () => Promise.resolve();
        scraper.createRunToken = () => runToken;

        const savedUrl = 'https://grok.com/imagine/saved';
        const buildImage = (mediaUuid, id) => {
            const image = document.createElement('img');
            image.id = id;
            image.alt = 'Generated image';
            image.src = `https://assets.grok.com/users/${accountUuid}/generated/${mediaUuid}/image.jpg`;
            Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 1024 });
            Object.defineProperty(image, 'naturalHeight', { configurable: true, value: 1024 });
            return image;
        };

        const renderAgent = (mediaUuid) => {
            window.history.pushState({}, '', `/imagine/agent/mock-agent?conversation=${mediaUuid}`);
            document.body.innerHTML = '';
            const agentScroller = document.createElement('div');
            agentScroller.className = 'overflow-scroll';
            agentScroller.id = 'agent-gallery-scroller';
            agentScroller.scrollBy = (...args) => window.__agentScrollCalls.push(args);
            if (agentMedia) {
                const wrongMediaUuid = mediaUuids.find((candidate) => candidate !== mediaUuid)
                    || '00000000-0000-4000-8000-000000000000';
                const appendAgentNode = (nodeMediaUuid, id, suffix = 'preview.jpg') => {
                    const node = document.createElement('div');
                    node.className = 'react-flow__node-asset';
                    node.id = id;
                    const image = document.createElement('img');
                    image.alt = 'Agent media';
                    image.src = `https://assets.grok.com/users/${accountUuid}/generated/${nodeMediaUuid}/${suffix}`;
                    window.__agentRenderedMediaUrls.push(image.src);
                    node.appendChild(image);
                    agentScroller.appendChild(node);
                };
                appendAgentNode(wrongMediaUuid, 'wrong-agent-media');
                appendAgentNode(mediaUuid, 'expected-agent-media');
                if (agentMediaMode === 'ambiguous') {
                    appendAgentNode(mediaUuid, 'duplicate-agent-media', 'preview_image.jpg');
                }
            }
            document.body.appendChild(agentScroller);
        };

        const renderSaved = () => {
            document.body.innerHTML = '';
            const phase = window.__savedRenderCount === 0 ? 'initial' : 'returned';
            window.__savedRenderCount++;
            const scroller = document.createElement('div');
            scroller.className = 'overflow-scroll';
            scroller.id = 'saved-gallery-scroller';
            let scrollTop = phase === 'initial' ? 360 : 0;
            Object.defineProperties(scroller, {
                scrollTop: {
                    configurable: true,
                    get: () => scrollTop,
                    set: (value) => {
                        scrollTop = Number(value);
                        const detail = { phase, value: scrollTop };
                        window.__savedScrollWrites.push(detail);
                        window.__recordChromeEvent('saved_scroll_set', detail);
                    }
                },
                scrollHeight: { configurable: true, value: 2000 },
                clientHeight: { configurable: true, value: 800 }
            });
            scroller.scrollBy = (...args) => window.__savedScrollByCalls.push({ phase, args });
            const list = document.createElement('div');
            list.setAttribute('role', 'list');
            mediaUuids.forEach((mediaUuid, index) => {
                const card = document.createElement('article');
                card.setAttribute('role', 'listitem');
                const image = buildImage(mediaUuid, `${index === 0 ? 'first' : 'second'}-saved-image`);
                image.addEventListener('click', () => renderAgent(mediaUuid));
                card.appendChild(image);
                list.appendChild(card);
            });
            scroller.appendChild(list);
            document.body.appendChild(scroller);
        };

        window.__agentScrollCalls = [];
        window.__agentRenderedMediaUrls = [];
        window.__savedScrollByCalls = [];
        window.__savedScrollWrites = [];
        window.__savedRenderCount = 0;
        window.__historyBackCalls = 0;
        Object.defineProperty(window.history, 'back', {
            configurable: true,
            value: () => {
                window.__historyBackCalls++;
                window.history.replaceState({}, '', savedUrl);
                window.dispatchEvent(new PopStateEvent('popstate'));
            }
        });
        window.addEventListener('popstate', () => {
            renderSaved();
        }, { once: true });
        if (stopAfterNavigationClear) {
            let stopRequested = false;
            window.__chromeStorageSetObservers.push((values) => {
                if (stopRequested
                    || values.scrapeNavigation !== null
                    || values.currentItemId !== null
                    || Object.keys(values).length !== 2) {
                    return;
                }
                stopRequested = true;
                void (scraper.backupMode
                    ? scraper.stopBackupMode('e2e_after_navigation_restore')
                    : scraper.stop('e2e_after_navigation_restore'));
            });
        }
        if (bridgeResponse) {
            document.addEventListener('__gpt_fetch_media', (event) => {
                document.dispatchEvent(new CustomEvent('__gpt_fetch_media_result', {
                    detail: { requestId: event.detail.requestId, ...bridgeResponse }
                }));
            });
        }
        window.history.replaceState({}, '', savedUrl);
        renderSaved();
    }, {
        accountUuid,
        mediaUuids,
        responseByAction,
        runToken,
        agentMedia,
        agentMediaMode,
        stopAfterNavigationClear,
        bridgeResponse
    });
}

async function setupMockPromptedBatch(page, {
    accountUuid,
    mediaUuid,
    secondMediaUuid = null,
    includeDecoys = false,
    stopAfterAddPrompt = false
}) {
    await page.evaluate(({
        accountUuid,
        mediaUuid,
        secondMediaUuid,
        includeDecoys,
        stopAfterAddPrompt
    }) => {
        const { retry } = window.__gptE2e;
        const savedUrl = 'https://grok.com/imagine/saved';
        const makeVisible = (element, width = 100) => {
            element.getBoundingClientRect = () => ({
                x: 20,
                y: 20,
                top: 20,
                left: 20,
                right: 20 + width,
                bottom: 60,
                width,
                height: 40
            });
            return element;
        };

        retry.createBatchRunToken = () => 'e2e-prompted-batch';
        window.__promptedBatchEvents = {
            savedClicks: [],
            savedTransitions: [],
            menuChoices: [],
            menuMediaUuids: [],
            promptWrites: [],
            promptWriteResults: [],
            promptAtSubmit: null,
            submitCount: 0,
            editCount: 0,
            decoyAddPromptCount: 0,
            decoyPromptAtSubmit: null,
            decoySubmitCount: 0,
            backCount: 0,
            scrollToCalls: [],
            sleepDurations: [],
            focusedQuiescenceMs: 0,
            focusedQuiescenceRequests: [],
            focusedQuiescenceReleases: []
        };
        const quiescence = {
            requested: 0,
            released: 0,
            pending: []
        };
        window.__getPromptedBatchQuiescence = () => ({
            requested: quiescence.requested,
            released: quiescence.released,
            pending: quiescence.pending.map(({ index, ms, mediaUuid }) => ({
                index,
                ms,
                mediaUuid
            }))
        });
        window.__releaseNextPromptedBatchQuiescence = () => {
            const deferred = quiescence.pending.shift();
            if (!deferred) return null;
            quiescence.released++;
            window.__promptedBatchEvents.focusedQuiescenceMs += deferred.ms;
            const released = {
                index: deferred.index,
                ms: deferred.ms,
                mediaUuid: deferred.mediaUuid
            };
            window.__promptedBatchEvents.focusedQuiescenceReleases.push(released);
            deferred.resolve();
            return released;
        };
        retry.sleep = (ms) => {
            window.__promptedBatchEvents.sleepDurations.push(ms);
            const selectedMediaUuid = document.activeElement?.getAttribute?.('data-selected-prompt-media');
            if (!selectedMediaUuid) return Promise.resolve();

            const request = {
                index: ++quiescence.requested,
                ms,
                mediaUuid: selectedMediaUuid
            };
            window.__promptedBatchEvents.focusedQuiescenceRequests.push(request);
            return new Promise((resolve) => {
                quiescence.pending.push({ ...request, resolve });
            });
        };
        Object.defineProperty(window, 'scrollY', { configurable: true, value: 480 });
        window.scrollTo = (...args) => window.__promptedBatchEvents.scrollToCalls.push(args);
        document.addEventListener('__gpt_set_prompted_video_content', (event) => {
            window.__promptedBatchEvents.promptWrites.push(event.detail.text);
        });
        document.addEventListener('__gpt_set_prompted_video_content_result', (event) => {
            window.__promptedBatchEvents.promptWriteResults.push(event.detail.ok);
        });

        const renderSaved = () => {
            document.body.innerHTML = '';
            const list = document.createElement('div');
            list.setAttribute('role', 'list');
            [mediaUuid, secondMediaUuid].filter(Boolean).forEach((savedMediaUuid) => {
                const card = document.createElement('article');
                card.setAttribute('role', 'listitem');
                const image = document.createElement('img');
                image.alt = 'Generated image';
                image.src = `https://assets.grok.com/users/${accountUuid}/generated/${savedMediaUuid}/image.jpg`;
                Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 1024 });
                Object.defineProperty(image, 'naturalHeight', { configurable: true, value: 1024 });
                image.scrollIntoView = () => {};
                image.addEventListener('click', () => {
                    window.__promptedBatchEvents.savedClicks.push(savedMediaUuid);
                    window.__promptedBatchEvents.savedTransitions.push({
                        mediaUuid: savedMediaUuid,
                        goalCount: retry.goalCount,
                        batchRunning: retry.batchRunning,
                        batchIndex: retry.batchIndex,
                        batchQueueLength: retry.batchQueue.length
                    });
                    renderAgent(savedMediaUuid);
                });
                const makeVideo = document.createElement('button');
                makeVideo.setAttribute('aria-label', 'Make video');
                card.append(image, makeVideo);
                list.appendChild(card);
            });
            document.body.appendChild(list);
        };

        const renderAgent = (selectedMediaUuid) => {
            window.history.pushState({}, '', `/imagine/agent/mock-agent?conversation=${selectedMediaUuid}`);
            document.body.innerHTML = '';
            const asset = document.createElement('div');
            asset.className = 'react-flow__node-asset';
            const assetImage = document.createElement('img');
            assetImage.src = `https://assets.grok.com/users/${accountUuid}/generated/${selectedMediaUuid}/preview.jpg`;
            asset.appendChild(assetImage);

            const decoys = [];
            if (includeDecoys) {
                const decoyMenu = makeVisible(document.createElement('div'));
                decoyMenu.setAttribute('role', 'menu');
                decoyMenu.id = 'decoy-video-menu';
                decoyMenu.setAttribute('data-state', 'open');
                const decoyAddPrompt = makeVisible(document.createElement('div'));
                decoyAddPrompt.setAttribute('role', 'menuitem');
                decoyAddPrompt.textContent = 'Add Prompt';
                decoyAddPrompt.addEventListener('click', () => {
                    window.__promptedBatchEvents.decoyAddPromptCount++;
                });
                decoyMenu.appendChild(decoyAddPrompt);

                const decoyQueryBar = document.createElement('div');
                decoyQueryBar.className = 'query-bar';
                decoyQueryBar.id = 'decoy-query-bar';
                const decoyInput = makeVisible(document.createElement('div'));
                decoyInput.id = 'decoy-prompt-input';
                decoyInput.setAttribute('contenteditable', 'true');
                decoyInput.setAttribute('role', 'textbox');
                decoyInput.setAttribute('aria-label', 'Ask Grok anything');
                const decoySubmit = makeVisible(document.createElement('button'), 48);
                decoySubmit.setAttribute('aria-label', 'Make video');
                decoySubmit.addEventListener('click', () => {
                    window.__promptedBatchEvents.decoyPromptAtSubmit = decoyInput.textContent;
                    window.__promptedBatchEvents.decoySubmitCount++;
                });
                decoyQueryBar.append(decoyInput, decoySubmit);
                decoys.push(decoyMenu, decoyQueryBar);
            }

            const preciseEdit = makeVisible(document.createElement('button'));
            preciseEdit.setAttribute('aria-label', 'Edit');
            preciseEdit.addEventListener('click', () => {
                window.__promptedBatchEvents.editCount++;
            });

            const makeVideo = makeVisible(document.createElement('button'));
            const triggerId = `selected-make-video-${selectedMediaUuid}`;
            const menuId = `selected-video-menu-${selectedMediaUuid}`;
            makeVideo.id = triggerId;
            makeVideo.setAttribute('aria-label', 'Make Video');
            makeVideo.setAttribute('aria-haspopup', 'menu');
            makeVideo.setAttribute('aria-controls', menuId);
            makeVideo.setAttribute('aria-expanded', 'false');
            makeVideo.setAttribute('data-state', 'closed');
            makeVideo.addEventListener('click', () => {
                makeVideo.setAttribute('aria-expanded', 'true');
                makeVideo.setAttribute('data-state', 'open');
                const menu = makeVisible(document.createElement('div'));
                menu.id = menuId;
                menu.setAttribute('role', 'menu');
                menu.setAttribute('aria-labelledby', triggerId);
                menu.setAttribute('data-state', 'open');
                const addPrompt = makeVisible(document.createElement('div'));
                addPrompt.setAttribute('role', 'menuitem');
                addPrompt.textContent = 'Add Prompt';
                addPrompt.addEventListener('click', () => {
                    window.__promptedBatchEvents.menuChoices.push('Add Prompt');
                    window.__promptedBatchEvents.menuMediaUuids.push(selectedMediaUuid);
                    const queryBar = document.createElement('div');
                    queryBar.className = 'query-bar';
                    queryBar.id = `selected-query-bar-${selectedMediaUuid}`;
                    const input = makeVisible(document.createElement('div'));
                    input.id = `selected-prompt-input-${selectedMediaUuid}`;
                    input.setAttribute('contenteditable', 'true');
                    input.setAttribute('role', 'textbox');
                    input.setAttribute('aria-label', 'Ask Grok anything');
                    input.setAttribute('data-selected-prompt-media', selectedMediaUuid);
                    input.tabIndex = -1;
                    const submit = makeVisible(document.createElement('button'), 48);
                    submit.setAttribute('aria-label', 'Make video');
                    submit.addEventListener('click', () => {
                        window.__promptedBatchEvents.promptAtSubmit = input.textContent;
                        window.__promptedBatchEvents.submitCount++;
                    });
                    queryBar.append(input, submit);
                    document.body.appendChild(queryBar);
                    input.focus();
                    const shouldStop = stopAfterAddPrompt === true
                        || stopAfterAddPrompt === selectedMediaUuid;
                    if (shouldStop) retry.stopBatch();
                });
                menu.appendChild(addPrompt);
                document.body.appendChild(menu);
            });

            const back = makeVisible(document.createElement('button'));
            back.setAttribute('aria-label', 'Back');
            back.addEventListener('click', () => {
                window.__promptedBatchEvents.backCount++;
                window.history.replaceState({}, '', savedUrl);
                renderSaved();
            });
            document.body.append(asset, ...decoys, preciseEdit, makeVideo, back);
        };

        window.history.replaceState({}, '', savedUrl);
        renderSaved();
    }, { accountUuid, mediaUuid, secondMediaUuid, includeDecoys, stopAfterAddPrompt });
}

async function dispatchRuntimeMessage(page, message) {
    return page.evaluate(async (runtimeMessage) => {
        const responses = [];
        const listeners = window.__chromeMessageListeners || [];

        for (const listener of listeners) {
            let responded = false;
            let responseValue;
            const sendResponse = (value) => {
                responded = true;
                responseValue = value;
            };
            const result = listener(runtimeMessage, { tab: { id: 1, url: window.location.href } }, sendResponse);

            if (result === true) {
                for (let attempt = 0; attempt < 20 && !responded; attempt++) {
                    await new Promise((resolve) => setTimeout(resolve, 0));
                }
            }

            if (responded) responses.push(responseValue);
        }

        return responses;
    }, message);
}

test.describe('Grok Power Tools E2E', () => {
    test.beforeEach(async ({ page }) => {
        // Mock Chrome API in the browser context
        await page.addInitScript(() => {
            const localState = {};
            const syncState = {};
            const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
            const record = (type, detail) => {
                const event = {
                    sequence: window.__chromeEventSequence++,
                    type,
                    ...detail
                };
                window.__chromeEvents.push(event);
                return event;
            };
            const readStorage = (state, keys) => {
                if (keys === null || typeof keys === 'undefined') return { ...state };
                if (Array.isArray(keys)) {
                    return keys.reduce((acc, key) => {
                        acc[key] = state[key];
                        return acc;
                    }, {});
                }
                if (typeof keys === 'string') return { [keys]: state[keys] };
                if (typeof keys === 'object') {
                    return Object.keys(keys).reduce((acc, key) => {
                        acc[key] = Object.prototype.hasOwnProperty.call(state, key) ? state[key] : keys[key];
                        return acc;
                    }, {});
                }
                return {};
            };
            window.__chromeRuntimeMessages = [];
            window.__chromeRuntimeResponseByAction = {};
            window.__chromeMessageListeners = [];
            window.__chromeEvents = [];
            window.__chromeEventSequence = 0;
            window.__chromeStorageSetObservers = [];
            window.__chromeStorageLocalState = localState;
            window.__chromeStorageSyncState = syncState;
            window.__recordChromeEvent = record;
            const getRuntimeResponse = (message) => {
                const responseByAction = window.__chromeRuntimeResponseByAction || {};
                const action = message?.action;
                if (Object.prototype.hasOwnProperty.call(responseByAction, action)) {
                    const configured = responseByAction[action];
                    return typeof configured === 'function' ? configured(message) : configured;
                }
                if (action === 'VALIDATE_CLOUD_CONFIG') return { valid: true };
                if (action === 'VALIDATE_SCRAPE_RESUME') return { valid: true };
                return { ok: true };
            };
            window.chrome = {
                runtime: {
                    getURL: (resourcePath) => resourcePath,
                    sendMessage: (message, callback) => {
                        const copiedMessage = clone(message);
                        window.__chromeRuntimeMessages.push(copiedMessage);
                        record('runtime_message', { message: copiedMessage });
                        const response = getRuntimeResponse(message);
                        return Promise.resolve(response).then((value) => {
                            const copiedResponse = clone(value);
                            record('runtime_response', { action: message?.action, response: copiedResponse });
                            if (callback) callback(copiedResponse);
                            return copiedResponse;
                        });
                    },
                    onMessage: {
                        addListener: (listener) => {
                            window.__chromeMessageListeners.push(listener);
                        }
                    }
                },
                storage: {
                    onChanged: {
                        addListener: () => { },
                        removeListener: () => { }
                    },
                    local: {
                        get: (keys, cb) => {
                            const result = readStorage(localState, keys);
                            if (cb) cb(result);
                            return Promise.resolve(result);
                        },
                        set: (data, cb) => {
                            record('storage_set', { area: 'local', values: clone(data || {}) });
                            Object.assign(localState, data || {});
                            window.__chromeStorageSetObservers.forEach((observer) => observer(clone(data || {})));
                            if (cb) cb();
                            return Promise.resolve();
                        }
                    },
                    sync: {
                        get: (keys, cb) => {
                            const result = readStorage(syncState, keys);
                            if (cb) cb(result);
                            return Promise.resolve(result);
                        },
                        set: (data, cb) => {
                            record('storage_set', { area: 'sync', values: clone(data || {}) });
                            Object.assign(syncState, data || {});
                            if (cb) cb();
                            return Promise.resolve();
                        }
                    }
                }
            };
        });

        await page.route('**/*', (route) => route.fulfill({
            status: 200,
            contentType: 'text/html',
            body: '<!doctype html><html><head><title>Mock Provider</title></head><body></body></html>'
        }));

        await gotoMockProviderPage(page, 'https://grok.com/imagine/saved');
    });

    test('Overlay should render on the page', async ({ page }) => {
        // Evaluate the content scripts
        await evaluateExtensionContent(page);

        // Check if overlay exists
        const overlay = page.locator('#grok-powertools-overlay');
        await expect(overlay).toBeVisible();

        // Check text
        await expect(overlay).toContainText('Grok Power Tools');
    });

    test('Minimize button should work', async ({ page }) => {
        await evaluateExtensionContent(page);

        const overlay = page.locator('#grok-powertools-overlay');
        const minBtn = page.locator('#gptMinBtn');

        // Initial state: not minimized
        await expect(overlay).not.toHaveClass(/minimized/);

        // Click minimize
        await minBtn.click();

        // Should be minimized
        await expect(overlay).toHaveClass(/minimized/);

        // Click to restore (the whole overlay)
        await overlay.click();

        // Should be restored
        await expect(overlay).not.toHaveClass(/minimized/);
    });

    test('Page-origin full R2 backup command should fail closed', async ({ page }) => {
        await evaluateExtensionContent(page);

        await page.evaluate(() => {
            document.dispatchEvent(new CustomEvent('grok-powertools-command', {
                detail: { action: 'INIT_R2_BACKUP', mode: 'full' }
            }));
        });
        await page.waitForTimeout(50);

        const runtimeMessages = await page.evaluate(() => window.__chromeRuntimeMessages);
        expect(runtimeMessages).not.toContainEqual({ action: 'VALIDATE_CLOUD_CONFIG' });
    });

    test('Page-origin R2 canary command is bounded and carries acceptance metadata', async ({ page }) => {
        await evaluateExtensionContent(page);

        await page.evaluate(() => {
            document.dispatchEvent(new CustomEvent('grok-powertools-command', {
                detail: {
                    action: 'INIT_R2_CANARY',
                    runId: 'run-20260609-001',
                    correlationId: 'corr-1',
                    keyPrefix: 'acceptance/run-20260609-001'
                }
            }));
        });
        await page.waitForTimeout(50);

        const runtimeMessages = await page.evaluate(() => window.__chromeRuntimeMessages);
        expect(runtimeMessages).toContainEqual(expect.objectContaining({
            action: 'VALIDATE_CLOUD_CONFIG'
        }));
    });

    test('Start Sync transfers the exact Saved media through Agent Mode', async ({ page }) => {
        const accountUuid = '11111111-1111-4111-8111-111111111111';
        const firstMediaUuid = '22222222-2222-4222-8222-222222222222';
        const secondMediaUuid = '33333333-3333-4333-8333-333333333333';
        const firstSavedUrl = `https://assets.grok.com/users/${accountUuid}/generated/${firstMediaUuid}/image.jpg`;

        await evaluateExtensionContent(page);
        await setupMockSavedAgentSync(page, {
            accountUuid,
            mediaUuids: [firstMediaUuid, secondMediaUuid],
            responseByAction: {
                GET_CLOUD_CONFIG: { config: { mode: 'local_only' } },
                DOWNLOAD_MEDIA: { status: 'queued' }
            },
            runToken: 'e2e-start-sync'
        });

        await expect(await page.evaluate(() => window.__gptE2e.scraper.start())).toEqual({
            status: 'started',
            surface: 'saved_gallery',
            runToken: 'e2e-start-sync'
        });

        await expect.poll(async () => page.evaluate(() => window.__chromeStorageLocalState.processedIds || [])).toEqual([firstSavedUrl]);

        const runtimeMessages = await page.evaluate(() => window.__chromeRuntimeMessages);
        expect(runtimeMessages).toContainEqual({
            action: 'DOWNLOAD_MEDIA',
            url: `https://assets.grok.com/users/${accountUuid}/generated/${firstMediaUuid}/preview.jpg`,
            isVideo: false,
            promptText: '',
            blobDataUrl: null
        });
        expect(runtimeMessages).not.toContainEqual(expect.objectContaining({
            url: expect.stringContaining(secondMediaUuid)
        }));
        expect(await page.evaluate(() => window.__agentRenderedMediaUrls)).toEqual([
            `https://assets.grok.com/users/${accountUuid}/generated/${secondMediaUuid}/preview.jpg`,
            `https://assets.grok.com/users/${accountUuid}/generated/${firstMediaUuid}/preview.jpg`
        ]);
        await expect(page.locator('#second-saved-image')).toHaveCount(1);
        await expect.poll(async () => page.evaluate(() => window.__historyBackCalls)).toBe(1);
        expect(await page.evaluate(() => window.__agentScrollCalls)).toEqual([]);
        expect(await page.evaluate(() => window.__savedScrollByCalls)).toEqual([]);
        expect(await page.evaluate(() => window.__savedScrollWrites)).toEqual([
            { phase: 'returned', value: 360 }
        ]);
        expect(await page.locator('#saved-gallery-scroller').evaluate((scroller) => scroller.scrollTop)).toBe(360);

        const transferEvents = await page.evaluate(() => window.__chromeEvents);
        const navigationSetIndex = transferEvents.findIndex((event) =>
            event.type === 'storage_set'
            && event.area === 'local'
            && event.values.currentItemId === firstSavedUrl
            && event.values.scrapeNavigation?.currentItemId === firstSavedUrl
            && event.values.scrapeNavigation?.expectedIdentity === firstMediaUuid
            && event.values.scrapeNavigation?.galleryScrollTop === 360
        );
        const downloadMessageIndex = transferEvents.findIndex((event) =>
            event.type === 'runtime_message'
            && event.message?.action === 'DOWNLOAD_MEDIA'
        );
        const queuedResponseIndex = transferEvents.findIndex((event) =>
            event.type === 'runtime_response'
            && event.action === 'DOWNLOAD_MEDIA'
            && event.response?.status === 'queued'
        );
        const processedIdIndex = transferEvents.findIndex((event) =>
            event.type === 'storage_set'
            && event.area === 'local'
            && event.values.processedIds?.some((id) => id.includes(firstMediaUuid))
        );
        const scrollRestoreIndex = transferEvents.findIndex((event) =>
            event.type === 'saved_scroll_set'
            && event.phase === 'returned'
            && event.value === 360
        );
        const navigationClearIndex = transferEvents.findIndex((event) =>
            event.type === 'storage_set'
            && event.area === 'local'
            && Object.keys(event.values).length === 2
            && event.values.scrapeNavigation === null
            && event.values.currentItemId === null
        );
        expect(navigationSetIndex).toBeGreaterThanOrEqual(0);
        expect(downloadMessageIndex).toBeGreaterThan(navigationSetIndex);
        expect(queuedResponseIndex).toBeGreaterThan(downloadMessageIndex);
        expect(processedIdIndex).toBeGreaterThan(queuedResponseIndex);
        expect(scrollRestoreIndex).toBeGreaterThan(processedIdIndex);
        expect(navigationClearIndex).toBeGreaterThan(scrollRestoreIndex);
        expect(await page.evaluate(() => ({
            currentItemId: window.__chromeStorageLocalState.currentItemId,
            scrapeNavigation: window.__chromeStorageLocalState.scrapeNavigation,
            processedIds: window.__chromeStorageLocalState.processedIds
        }))).toEqual({
            currentItemId: null,
            scrapeNavigation: null,
            processedIds: [firstSavedUrl]
        });
    });

    test('Start Sync fails closed when Agent Mode contains two exact media matches', async ({ page }) => {
        const accountUuid = '12121212-1212-4212-8212-121212121212';
        const expectedMediaUuid = '34343434-3434-4434-8434-343434343434';
        const wrongMediaUuid = '56565656-5656-4656-8656-565656565656';

        await evaluateExtensionContent(page);
        await setupMockSavedAgentSync(page, {
            accountUuid,
            mediaUuids: [expectedMediaUuid, wrongMediaUuid],
            responseByAction: {
                GET_CLOUD_CONFIG: { config: { mode: 'local_only' } },
                DOWNLOAD_MEDIA: { status: 'queued' }
            },
            runToken: 'e2e-agent-ambiguity',
            agentMediaMode: 'ambiguous'
        });

        await expect(await page.evaluate(() => window.__gptE2e.scraper.start())).toEqual({
            status: 'started',
            surface: 'saved_gallery',
            runToken: 'e2e-agent-ambiguity'
        });
        await expect.poll(async () => page.evaluate(() => ({
            scraperState: window.__chromeStorageLocalState.scraperState,
            stopReason: window.__chromeStorageLocalState.scrapeStopReason
        }))).toEqual({
            scraperState: 'idle',
            stopReason: 'agent_media_ambiguous'
        });

        expect(await page.evaluate(() => window.__chromeRuntimeMessages)).not.toContainEqual(
            expect.objectContaining({ action: 'DOWNLOAD_MEDIA' })
        );
        expect(await page.evaluate(() => window.__chromeEvents)).not.toContainEqual(
            expect.objectContaining({
                type: 'storage_set',
                values: expect.objectContaining({ processedIds: expect.any(Array) })
            })
        );
        expect(await page.evaluate(() => window.__chromeStorageLocalState.processedIds || [])).toEqual([]);
        expect(await page.evaluate(() => window.__agentRenderedMediaUrls)).toEqual([
            `https://assets.grok.com/users/${accountUuid}/generated/${wrongMediaUuid}/preview.jpg`,
            `https://assets.grok.com/users/${accountUuid}/generated/${expectedMediaUuid}/preview.jpg`,
            `https://assets.grok.com/users/${accountUuid}/generated/${expectedMediaUuid}/preview_image.jpg`
        ]);
        expect(await page.evaluate(() => window.__agentScrollCalls)).toEqual([]);
    });

    test('Cloud-only Start Sync sends bridge media before persisting the upload', async ({ page }) => {
        const accountUuid = '44444444-4444-4444-8444-444444444444';
        const mediaUuid = '55555555-5555-4555-8555-555555555555';
        const savedUrl = `https://assets.grok.com/users/${accountUuid}/generated/${mediaUuid}/image.jpg`;
        const agentUrl = `https://assets.grok.com/users/${accountUuid}/generated/${mediaUuid}/preview.jpg`;
        const blobDataUrl = 'data:image/jpeg;base64,Y2xvdWQtb25seS1maXh0dXJl';

        await evaluateExtensionContent(page);
        await setupMockSavedAgentSync(page, {
            accountUuid,
            mediaUuids: [mediaUuid],
            responseByAction: {
                GET_CLOUD_CONFIG: { config: { mode: 'cloud_only' } },
                DOWNLOAD_MEDIA: { status: 'uploaded' }
            },
            runToken: 'e2e-cloud-only',
            bridgeResponse: { dataUrl: blobDataUrl, size: 18, type: 'image/jpeg' }
        });

        await expect(await page.evaluate(() => window.__gptE2e.scraper.start())).toEqual({
            status: 'started',
            surface: 'saved_gallery',
            runToken: 'e2e-cloud-only'
        });

        await expect.poll(async () => page.evaluate(() => window.__chromeStorageLocalState.processedIds || [])).toEqual([savedUrl]);
        const runtimeMessages = await page.evaluate(() => window.__chromeRuntimeMessages);
        expect(runtimeMessages).toContainEqual({ action: 'GET_CLOUD_CONFIG' });
        expect(runtimeMessages).toContainEqual({
            action: 'DOWNLOAD_MEDIA',
            url: agentUrl,
            isVideo: false,
            promptText: '',
            blobDataUrl
        });

        const transferEvents = await page.evaluate(() => window.__chromeEvents);
        const uploadedResponseIndex = transferEvents.findIndex((event) =>
            event.type === 'runtime_response'
            && event.action === 'DOWNLOAD_MEDIA'
            && event.response?.status === 'uploaded'
        );
        const processedIdIndex = transferEvents.findIndex((event) =>
            event.type === 'storage_set'
            && event.area === 'local'
            && event.values.processedIds?.includes(savedUrl)
        );
        expect(uploadedResponseIndex).toBeGreaterThanOrEqual(0);
        expect(processedIdIndex).toBeGreaterThan(uploadedResponseIndex);
    });

    test('Cloud-only bridge failure never marks Saved media as processed', async ({ page }) => {
        const accountUuid = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
        const mediaUuid = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

        await evaluateExtensionContent(page);
        await setupMockSavedAgentSync(page, {
            accountUuid,
            mediaUuids: [mediaUuid],
            responseByAction: {
                GET_CLOUD_CONFIG: { config: { mode: 'cloud_only' } },
                DOWNLOAD_MEDIA: { status: 'uploaded' }
            },
            runToken: 'e2e-cloud-bridge-failure',
            bridgeResponse: { error: 'authenticated fetch denied' }
        });

        await page.evaluate(() => window.__gptE2e.scraper.start());
        await expect.poll(async () => page.evaluate(() => window.__chromeStorageLocalState.scraperState)).toBe('idle');
        expect(await page.evaluate(() => window.__chromeStorageLocalState.processedIds || [])).toEqual([]);
        expect(await page.evaluate(() => window.__chromeRuntimeMessages)).not.toContainEqual(
            expect.objectContaining({ action: 'DOWNLOAD_MEDIA' })
        );
    });

    test('Cloud-only upload failure never marks Saved media as processed', async ({ page }) => {
        const accountUuid = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
        const mediaUuid = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
        const blobDataUrl = 'data:image/jpeg;base64,dXBsb2FkLWZhaWx1cmU=';

        await evaluateExtensionContent(page);
        await setupMockSavedAgentSync(page, {
            accountUuid,
            mediaUuids: [mediaUuid],
            responseByAction: {
                GET_CLOUD_CONFIG: { config: { mode: 'cloud_only' } },
                DOWNLOAD_MEDIA: { status: 'error', error: 'R2 upload rejected' }
            },
            runToken: 'e2e-cloud-upload-failure',
            bridgeResponse: { dataUrl: blobDataUrl, size: 15, type: 'image/jpeg' }
        });

        await page.evaluate(() => window.__gptE2e.scraper.start());
        await expect.poll(async () => page.evaluate(() => window.__chromeStorageLocalState.scraperState)).toBe('idle');
        expect(await page.evaluate(() => window.__chromeStorageLocalState.processedIds || [])).toEqual([]);
        expect(await page.evaluate(() => window.__chromeRuntimeMessages)).toContainEqual(expect.objectContaining({
            action: 'DOWNLOAD_MEDIA',
            blobDataUrl
        }));
    });

    test('R2 backup persists only after the R2 action acknowledges the Agent media', async ({ page }) => {
        const accountUuid = '01234567-89ab-4cde-8fab-0123456789ab';
        const mediaUuid = 'fedcba98-7654-4cba-8fed-cba987654321';
        const blobDataUrl = 'data:image/jpeg;base64,ci0yLWZpeHR1cmU=';
        const backupProcessedId = 'r2/agent-media/fedcba98-7654-4cba-8fed-cba987654321';
        const acceptance = { runId: 'e2e-r2-run', correlationId: 'e2e-r2-correlation' };

        await evaluateExtensionContent(page);
        await setupMockSavedAgentSync(page, {
            accountUuid,
            mediaUuids: [mediaUuid],
            responseByAction: {
                VALIDATE_CLOUD_CONFIG: { valid: true },
                R2_BACKUP_UPLOAD: { status: 'already_present', backupProcessedId }
            },
            runToken: 'e2e-r2-backup',
            bridgeResponse: { dataUrl: blobDataUrl, size: 12, type: 'image/jpeg' }
        });

        await expect(page.evaluate((acceptance) => window.__gptE2e.scraper.startBackupMode({
            mode: 'full',
            acceptance
        }), acceptance)).resolves.toEqual({
            status: 'started',
            surface: 'saved_gallery',
            runToken: 'e2e-r2-backup'
        });
        await expect.poll(async () => page.evaluate(() => window.__chromeStorageLocalState.processedIds || [])).toContain(backupProcessedId);

        const runtimeMessages = await page.evaluate(() => window.__chromeRuntimeMessages);
        expect(runtimeMessages).toContainEqual({ action: 'VALIDATE_CLOUD_CONFIG' });
        expect(runtimeMessages).toContainEqual({
            action: 'R2_BACKUP_UPLOAD',
            url: `https://assets.grok.com/users/${accountUuid}/generated/${mediaUuid}/preview.jpg`,
            isVideo: false,
            promptText: '',
            blobDataUrl,
            skipLocalDownload: false,
            acceptance
        });

        const backupEvents = await page.evaluate(() => window.__chromeEvents);
        const acknowledgementIndex = backupEvents.findIndex((event) =>
            event.type === 'runtime_response'
            && event.action === 'R2_BACKUP_UPLOAD'
            && event.response?.status === 'already_present'
        );
        const processedIdIndex = backupEvents.findIndex((event) =>
            event.type === 'storage_set'
            && event.area === 'local'
            && event.values.processedIds?.includes(backupProcessedId)
        );
        expect(acknowledgementIndex).toBeGreaterThanOrEqual(0);
        expect(processedIdIndex).toBeGreaterThan(acknowledgementIndex);
    });

    test('R2 upload error never persists a backup processed ID', async ({ page }) => {
        const accountUuid = '13572468-1357-4468-8357-135724681357';
        const mediaUuid = '24681357-2468-4357-8468-246813572468';
        const blobDataUrl = 'data:image/jpeg;base64,cjItZXJyb3ItZml4dHVyZQ==';
        const rejectedBackupProcessedId = 'r2/rejected/24681357-2468-4357-8468-246813572468';

        await evaluateExtensionContent(page);
        await setupMockSavedAgentSync(page, {
            accountUuid,
            mediaUuids: [mediaUuid],
            responseByAction: {
                VALIDATE_CLOUD_CONFIG: { valid: true },
                R2_BACKUP_UPLOAD: {
                    status: 'error',
                    error: 'mock R2 rejection',
                    backupProcessedId: rejectedBackupProcessedId
                }
            },
            runToken: 'e2e-r2-upload-error',
            bridgeResponse: { dataUrl: blobDataUrl, size: 16, type: 'image/jpeg' }
        });

        await expect(page.evaluate(() => window.__gptE2e.scraper.startBackupMode({
            mode: 'full'
        }))).resolves.toEqual({
            status: 'started',
            surface: 'saved_gallery',
            runToken: 'e2e-r2-upload-error'
        });
        await expect.poll(async () => page.evaluate(() => ({
            scraperState: window.__chromeStorageLocalState.scraperState,
            stopReason: window.__chromeStorageLocalState.r2BackupState?.stopReason
        }))).toEqual({
            scraperState: 'idle',
            stopReason: 'media_transfer_failed'
        });

        expect(await page.evaluate(() => window.__chromeRuntimeMessages)).toContainEqual({
            action: 'R2_BACKUP_UPLOAD',
            url: `https://assets.grok.com/users/${accountUuid}/generated/${mediaUuid}/preview.jpg`,
            isVideo: false,
            promptText: '',
            blobDataUrl,
            skipLocalDownload: false,
            acceptance: null
        });
        const backupEvents = await page.evaluate(() => window.__chromeEvents);
        expect(backupEvents).toContainEqual(expect.objectContaining({
            type: 'runtime_response',
            action: 'R2_BACKUP_UPLOAD',
            response: expect.objectContaining({
                status: 'error',
                backupProcessedId: rejectedBackupProcessedId
            })
        }));
        expect(backupEvents).not.toContainEqual(expect.objectContaining({
            type: 'storage_set',
            area: 'local',
            values: expect.objectContaining({ processedIds: expect.any(Array) })
        }));
        expect(await page.evaluate(() => window.__chromeStorageLocalState.processedIds || [])).toEqual([]);
    });

    test('Prompted Batch routes Saved media through Add Prompt and Make video', async ({ page }) => {
        const accountUuid = '66666666-6666-4666-8666-666666666666';
        const mediaUuid = '77777777-7777-4777-8777-777777777777';
        const secondMediaUuid = '88888888-8888-4888-8888-888888888888';

        await evaluateExtensionContent(page);
        await page.evaluate(bridgeJs);
        await setupMockPromptedBatch(page, {
            accountUuid,
            mediaUuid,
            secondMediaUuid,
            includeDecoys: true,
            stopAfterAddPrompt: secondMediaUuid
        });

        const batchPromise = page.evaluate(() => window.__gptE2e.retry.startBatch(
            'prompted',
            'slow orbit around the generated sculpture',
            { videoGoal: 2, galleryLimit: 2 }
        ));
        let batchOutcome = { status: 'pending' };
        void batchPromise.then(
            (value) => {
                batchOutcome = { status: 'fulfilled', value };
            },
            (error) => {
                batchOutcome = { status: 'rejected', message: error.message };
            }
        );

        const firstSelectedInputId = `selected-prompt-input-${mediaUuid}`;
        const readQuiescenceState = () => page.evaluate((selectedInputId) => {
            const events = window.__promptedBatchEvents;
            return {
                gate: window.__getPromptedBatchQuiescence(),
                promptWrites: events.promptWrites,
                promptWriteResults: events.promptWriteResults,
                selectedPromptText: document.getElementById(selectedInputId)?.textContent ?? null,
                promptAtSubmit: events.promptAtSubmit,
                submitCount: events.submitCount,
                editCount: events.editCount,
                decoyAddPromptCount: events.decoyAddPromptCount,
                decoyPromptText: document.getElementById('decoy-prompt-input')?.textContent ?? null,
                decoyPromptAtSubmit: events.decoyPromptAtSubmit,
                decoySubmitCount: events.decoySubmitCount
            };
        }, firstSelectedInputId);

        for (let poll = 1; poll <= 5; poll++) {
            const expectedGate = {
                requested: poll,
                released: poll - 1,
                pending: [{ index: poll, ms: 100, mediaUuid }]
            };
            await expect.poll(
                async () => (await readQuiescenceState()).gate,
                { timeout: 1000, intervals: [10, 20, 50] }
            ).toEqual(expectedGate);

            expect(await readQuiescenceState()).toEqual({
                gate: expectedGate,
                promptWrites: [],
                promptWriteResults: [],
                selectedPromptText: '',
                promptAtSubmit: null,
                submitCount: 0,
                editCount: 0,
                decoyAddPromptCount: 0,
                decoyPromptText: '',
                decoyPromptAtSubmit: null,
                decoySubmitCount: 0
            });
            await expect(page.evaluate(() => (
                window.__releaseNextPromptedBatchQuiescence()
            ))).resolves.toEqual({ index: poll, ms: 100, mediaUuid });
        }

        await expect.poll(
            () => batchOutcome,
            { timeout: 2000, intervals: [10, 20, 50] }
        ).toEqual({ status: 'fulfilled', value: true });
        expect(await page.evaluate(() => window.__getPromptedBatchQuiescence())).toEqual({
            requested: 5,
            released: 5,
            pending: []
        });

        const events = await page.evaluate(() => window.__promptedBatchEvents);
        expect(events.savedClicks).toEqual([mediaUuid, secondMediaUuid]);
        expect(events.savedTransitions).toEqual([
            {
                mediaUuid,
                goalCount: 0,
                batchRunning: true,
                batchIndex: 0,
                batchQueueLength: 2
            },
            {
                mediaUuid: secondMediaUuid,
                goalCount: 1,
                batchRunning: true,
                batchIndex: 0,
                batchQueueLength: 1
            }
        ]);
        expect(events.decoyAddPromptCount).toBe(0);
        expect(events.decoyPromptAtSubmit).toBeNull();
        expect(events.decoySubmitCount).toBe(0);
        expect(events.menuChoices).toEqual(['Add Prompt', 'Add Prompt']);
        expect(events.menuMediaUuids).toEqual([mediaUuid, secondMediaUuid]);
        expect(events.promptWrites).toEqual(['slow orbit around the generated sculpture']);
        expect(events.promptWriteResults).toEqual([true]);
        expect(events.promptAtSubmit).toBe('slow orbit around the generated sculpture');
        expect(events.submitCount).toBe(1);
        expect(events.editCount).toBe(0);
        expect(events.backCount).toBe(1);
        expect(events.scrollToCalls).toContainEqual([0, 480]);
        expect(events.focusedQuiescenceMs).toBe(500);
        expect(events.focusedQuiescenceRequests).toEqual(Array.from({ length: 5 }, (_, index) => ({
            index: index + 1,
            ms: 100,
            mediaUuid
        })));
        expect(events.focusedQuiescenceReleases).toEqual(events.focusedQuiescenceRequests);
        const selectedTriggerId = `selected-make-video-${secondMediaUuid}`;
        const selectedMenuId = `selected-video-menu-${secondMediaUuid}`;
        await expect(page.locator(`#${selectedTriggerId}`)).toHaveAttribute('aria-controls', selectedMenuId);
        await expect(page.locator(`#${selectedTriggerId}`)).toHaveAttribute('data-state', 'open');
        await expect(page.locator(`#${selectedMenuId}`)).toHaveAttribute('aria-labelledby', selectedTriggerId);
        await expect(page.locator(`#${selectedMenuId}`)).toHaveAttribute('data-state', 'open');
        await expect(page.locator('#decoy-video-menu')).toBeVisible();
        await expect(page.locator('#decoy-video-menu')).not.toHaveAttribute('aria-labelledby', /.+/);
        await expect(page.locator('#decoy-prompt-input')).toBeVisible();
        await expect(page.locator('#decoy-prompt-input')).toHaveText('');
        await expect(page.locator(`#selected-prompt-input-${secondMediaUuid}`)).toHaveText('');
        expect(await page.evaluate(() => document.activeElement?.id)).toBe(`selected-prompt-input-${secondMediaUuid}`);
        await expect(page.evaluate(() => ({
            goalCount: window.__gptE2e.retry.goalCount,
            batchIndex: window.__gptE2e.retry.batchIndex,
            batchQueueLength: window.__gptE2e.retry.batchQueue.length,
            batchRunning: window.__gptE2e.retry.batchRunning
        }))).resolves.toEqual({
            goalCount: 1,
            batchIndex: 0,
            batchQueueLength: 1,
            batchRunning: false
        });
    });

    test('Stop during the Agent-media wait prevents a transfer', async ({ page }) => {
        const accountUuid = '88888888-8888-4888-8888-888888888888';
        const mediaUuid = '99999999-9999-4999-8999-999999999999';

        await evaluateExtensionContent(page);
        await setupMockSavedAgentSync(page, {
            accountUuid,
            mediaUuids: [mediaUuid],
            responseByAction: {
                GET_CLOUD_CONFIG: { config: { mode: 'local_only' } },
                DOWNLOAD_MEDIA: { status: 'queued' }
            },
            runToken: 'e2e-stop-agent-wait',
            agentMedia: false
        });
        await page.evaluate(() => {
            const { scraper } = window.__gptE2e;
            scraper.sleep = async () => {
                if (window.location.pathname.startsWith('/imagine/agent')) {
                    await scraper.stop('e2e_stop_while_waiting_for_agent_media');
                }
            };
        });

        await expect(await page.evaluate(() => window.__gptE2e.scraper.start())).toEqual({
            status: 'started',
            surface: 'saved_gallery',
            runToken: 'e2e-stop-agent-wait'
        });
        await expect.poll(async () => page.evaluate(() => window.__chromeStorageLocalState.scraperState)).toBe('idle');

        const runtimeMessages = await page.evaluate(() => window.__chromeRuntimeMessages);
        expect(runtimeMessages).not.toContainEqual(expect.objectContaining({ action: 'DOWNLOAD_MEDIA' }));
        expect(await page.evaluate(() => window.__chromeStorageLocalState.processedIds || [])).toEqual([]);
        expect(await page.evaluate(() => window.__agentScrollCalls)).toEqual([]);
    });

    test('Stop after Add Prompt prevents scoped injection and Make video submission', async ({ page }) => {
        const accountUuid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
        const mediaUuid = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

        await evaluateExtensionContent(page);
        await page.evaluate(bridgeJs);
        await setupMockPromptedBatch(page, { accountUuid, mediaUuid, stopAfterAddPrompt: true });

        await expect(page.evaluate(() => window.__gptE2e.retry.startBatch(
            'prompted',
            'this prompt must not reach the video composer',
            { videoGoal: 1, galleryLimit: 1 }
        ))).resolves.toBe(true);

        const events = await page.evaluate(() => window.__promptedBatchEvents);
        expect(events.savedClicks).toEqual([mediaUuid]);
        expect(events.menuChoices).toEqual(['Add Prompt']);
        expect(events.promptWrites).toEqual([]);
        expect(events.promptWriteResults).toEqual([]);
        expect(events.submitCount).toBe(0);
        expect(events.editCount).toBe(0);
    });

    test('Provider and recreate helper globals should be available before content script', async ({ page }) => {
        await page.evaluate(providerRegistryJs);
        await page.evaluate(providerRunLedgerJs);
        await page.evaluate(chatGptImagesContentJs);
        await page.evaluate(utilsJs);
        await page.evaluate(contentActionsJs);

        const globals = await page.evaluate(() => ({
            hasProviderRegistry: !!window.GrokPowerToolsProviderRegistry,
            hasProviderRunLedger: !!window.GrokPowerToolsProviderRunLedger,
            hasChatGptImagesActions: !!window.ChatGPTImagesContentActions,
            hasUtils: !!window.GrokRecreateWorkflowUtils,
            hasContentActions: !!window.GrokRecreateContentActions
        }));

        expect(globals).toEqual({
            hasProviderRegistry: true,
            hasProviderRunLedger: true,
            hasChatGptImagesActions: true,
            hasUtils: true,
            hasContentActions: true
        });
    });

    test('ChatGPT Images overlay should track native send and write provider history', async ({ page }) => {
        await gotoMockProviderPage(page, 'https://chatgpt.com/images/');
        await page.evaluate(() => {
            const existing = document.createElement('img');
            existing.src = 'https://cdn.example.com/existing-gallery.png';
            existing.alt = 'existing gallery image';
            Object.defineProperty(existing, 'naturalWidth', { configurable: true, value: 1024 });
            Object.defineProperty(existing, 'naturalHeight', { configurable: true, value: 1024 });
            existing.getBoundingClientRect = () => ({ left: 20, top: 240, width: 320, height: 320 });
            document.body.appendChild(existing);

            const fallback = document.createElement('textarea');
            fallback.name = 'prompt-textarea';
            fallback.placeholder = 'Describe a new image';
            fallback.value = 'stale hidden fallback prompt';
            fallback.style.display = 'none';
            document.body.appendChild(fallback);

            const input = document.createElement('div');
            input.id = 'prompt-textarea';
            input.setAttribute('contenteditable', 'true');
            input.setAttribute('role', 'textbox');
            input.setAttribute('aria-label', 'Chat with ChatGPT');
            input.getBoundingClientRect = () => ({ left: 20, top: 20, width: 320, height: 40 });
            document.body.appendChild(input);

            const send = document.createElement('button');
            send.dataset.testid = 'send-button';
            send.setAttribute('aria-label', 'Send prompt');
            send.textContent = 'Send prompt';
            send.getBoundingClientRect = () => ({ left: 20, top: 20, width: 120, height: 40 });
            send.addEventListener('click', () => {
                const generated = document.createElement('img');
                generated.src = 'https://cdn.example.com/gpt-img-provider-001.png';
                generated.alt = 'generated canary image';
                Object.defineProperty(generated, 'naturalWidth', { configurable: true, value: 1024 });
                Object.defineProperty(generated, 'naturalHeight', { configurable: true, value: 1024 });
                generated.getBoundingClientRect = () => ({ left: 20, top: 90, width: 320, height: 320 });
                document.body.appendChild(generated);
            });
            document.body.appendChild(send);
        });

        await evaluateExtensionContent(page);

        const overlay = page.locator('#grok-powertools-overlay');
        await expect(overlay).toBeVisible();
        await expect(page.locator('#gptProviderLabel')).toHaveText('Provider: ChatGPT Images');
        await expect(page.locator('#gptChatGptImageSection')).toHaveCount(0);
        await expect(page.locator('#gptChatGptPrompt')).toHaveCount(0);
        await expect(page.locator('#gptChatGptGenerateBtn')).toHaveCount(0);
        await expect(page.locator('#gptRecreateSection')).toBeHidden();
        await expect(page.locator('#gptAutoRetrySection')).toBeHidden();

        await page.locator('#prompt-textarea[contenteditable="true"]').fill('GPT-IMG-PROVIDER-001 harmless blue glass cube');
        await page.locator('button[data-testid="send-button"]').click();
        await expect(page.locator('#gptStatusBadge')).toHaveText('Generated image ready');

        const storageState = await page.evaluate(() => window.__chromeStorageLocalState);
        expect(storageState.providerRunHistory[0]).toEqual(expect.objectContaining({
            providerId: 'chatgpt-images',
            workflow: 'text-to-image',
            prompt: 'GPT-IMG-PROVIDER-001 harmless blue glass cube',
            status: 'generated',
            resultMediaUrl: 'https://cdn.example.com/gpt-img-provider-001.png'
        }));
        expect(storageState.providerRunHistory[0].resultMediaUrl).not.toBe('https://cdn.example.com/existing-gallery.png');
    });

    test('Recreate content bridge should handle status messages', async ({ page }) => {
        await evaluateExtensionContentWithMockedRecreateActions(page);

        const listenerCount = await page.evaluate(() => window.__chromeMessageListeners.length);
        const responses = await dispatchRuntimeMessage(page, {
            action: 'GPT_RECREATE_STATUS',
            runId: 'run-status',
            phase: 'chat',
            message: 'Chat step ready',
            type: 'success'
        });

        expect(listenerCount).toBeGreaterThan(0);
        expect(responses).toContainEqual({ ok: true, runId: 'run-status' });
        await expect(page.locator('#gptRecreateStatus')).toHaveText('chat: Chat step ready');
    });

    test('Recreate Image controls should render', async ({ page }) => {
        await evaluateExtensionContent(page);

        const overlay = page.locator('#grok-powertools-overlay');
        await expect(overlay).toContainText('Recreate Media');
        await expect(overlay).toContainText('Drop, paste, choose image/video/GIF, or use current Grok image');
        await expect(page.locator('#gptRecreateFileInput')).toHaveCount(1);
        await expect(page.locator('#gptRecreateFileInput')).toHaveAttribute('accept', /image\/png/);
        await expect(page.locator('#gptRecreateFileInput')).toHaveAttribute('accept', /video\/mp4/);
        await expect(page.locator('#gptRecreateChooseBtn')).toBeVisible();
        await expect(page.locator('#gptRecreateCurrentBtn')).toBeVisible();
        await expect(page.locator('#gptRecreateBestPractices')).not.toBeChecked();
        await expect(page.locator('#gptRecreateStartBtn')).toBeVisible();
        await expect(page.locator('#gptRecreateStopBtn')).toBeHidden();
        await expect(page.locator('#gptRecreateStatus')).toHaveText('No reference selected.');
    });

    test('Recreate Image controls should start from mocked local file selection', async ({ page }) => {
        await evaluateExtensionContentWithMockedRecreateActions(page);

        await page.locator('#gptRecreateFileInput').setInputFiles({
            name: 'sample.png',
            mimeType: 'image/png',
            buffer: Buffer.from('sample-image')
        });
        await expect(page.locator('#gptRecreateStatus')).toContainText('sample.png');

        await page.locator('#gptRecreateStartBtn').click();
        await expect(page.locator('#gptRecreateStatus')).toHaveText('Generated image ready.');

        const runtimeMessages = await page.evaluate(() => window.__chromeRuntimeMessages);
        expect(runtimeMessages).toContainEqual(expect.objectContaining({
            action: 'START_GPT_RECREATE',
            bestPracticesEnabled: false,
            reference: expect.objectContaining({
                name: 'sample.png',
                source: 'local'
            })
        }));

        const calls = await page.evaluate(() => window.__recreateCalls);
        expect(calls).toContainEqual({
            action: 'file',
            name: 'sample.png',
            source: 'local'
        });
    });

    test('Recreate Image controls should send explicit Grok Search opt-in', async ({ page }) => {
        await evaluateExtensionContentWithMockedRecreateActions(page);

        await page.locator('#gptRecreateFileInput').setInputFiles({
            name: 'sample.png',
            mimeType: 'image/png',
            buffer: Buffer.from('sample-image')
        });
        await page.locator('#gptRecreateSection .gpt-toggle-switch').click();
        await expect(page.locator('#gptRecreateBestPractices')).toBeChecked();

        await page.locator('#gptRecreateStartBtn').click();
        await expect(page.locator('#gptRecreateStatus')).toHaveText('Generated image ready.');

        const runtimeMessages = await page.evaluate(() => window.__chromeRuntimeMessages);
        expect(runtimeMessages).toContainEqual(expect.objectContaining({
            action: 'START_GPT_RECREATE',
            bestPracticesEnabled: true,
            reference: expect.objectContaining({
                name: 'sample.png',
                source: 'local'
            })
        }));
    });

    test('Recreate Image controls should reject oversized files before reading', async ({ page }) => {
        await evaluateExtensionContentWithMockedRecreateActions(page);

        await page.locator('#gptRecreateFileInput').setInputFiles({
            name: 'oversized.png',
            mimeType: 'image/png',
            buffer: Buffer.alloc(MAX_REFERENCE_BYTES + 1)
        });

        await expect(page.locator('#gptRecreateStatus')).toHaveText('reference_invalid');
        const calls = await page.evaluate(() => window.__recreateCalls);
        expect(calls).toEqual([]);
    });

    test('Recreate Image controls should clear prior reference after invalid reselection', async ({ page }) => {
        await evaluateExtensionContentWithMockedRecreateActions(page);

        await page.locator('#gptRecreateFileInput').setInputFiles({
            name: 'sample.png',
            mimeType: 'image/png',
            buffer: Buffer.from('sample-image')
        });
        await expect(page.locator('#gptRecreateStatus')).toContainText('sample.png');

        await page.locator('#gptRecreateFileInput').setInputFiles({
            name: 'oversized.png',
            mimeType: 'image/png',
            buffer: Buffer.alloc(MAX_REFERENCE_BYTES + 1)
        });
        await expect(page.locator('#gptRecreateStatus')).toHaveText('reference_invalid');

        await page.locator('#gptRecreateStartBtn').click();
        await expect(page.locator('#gptRecreateStatus')).toHaveText('Select a reference media file first.');

        const runtimeMessages = await page.evaluate(() => window.__chromeRuntimeMessages);
        expect(runtimeMessages).not.toContainEqual(expect.objectContaining({
            action: 'START_GPT_RECREATE'
        }));
    });

    test('Recreate Image paste should only apply inside recreate controls', async ({ page }) => {
        await evaluateExtensionContentWithMockedRecreateActions(page);

        await page.evaluate(() => {
            const file = new File(['paste-image'], 'paste.png', { type: 'image/png' });
            const event = new Event('paste', { bubbles: true, cancelable: true });
            Object.defineProperty(event, 'clipboardData', {
                value: {
                    items: [{ type: 'image/png', getAsFile: () => file }]
                }
            });
            document.body.dispatchEvent(event);
        });
        await expect(page.locator('#gptRecreateStatus')).toHaveText('No reference selected.');

        await page.locator('#gptRecreateDropzone').click();
        await page.evaluate(() => {
            const file = new File(['paste-image'], 'paste.png', { type: 'image/png' });
            const event = new Event('paste', { bubbles: true, cancelable: true });
            Object.defineProperty(event, 'clipboardData', {
                value: {
                    items: [{ type: 'image/png', getAsFile: () => file }]
                }
            });
            document.getElementById('gptRecreateDropzone').dispatchEvent(event);
        });

        await expect(page.locator('#gptRecreateStatus')).toContainText('paste.png');
        const calls = await page.evaluate(() => window.__recreateCalls);
        expect(calls).toEqual([
            { action: 'file', name: 'paste.png', source: 'paste' }
        ]);
    });

    test('Recreate Image stop should wait for pending start to settle', async ({ page }) => {
        await evaluateExtensionContentWithMockedRecreateActions(page);

        await page.locator('#gptRecreateFileInput').setInputFiles({
            name: 'sample.png',
            mimeType: 'image/png',
            buffer: Buffer.from('sample-image')
        });
        await page.evaluate(() => {
            window.__resolveRecreateStart = null;
            window.chrome.runtime.sendMessage = (message) => {
                window.__chromeRuntimeMessages.push(message);
                if (message?.action === 'START_GPT_RECREATE') {
                    return new Promise((resolve) => {
                        window.__resolveRecreateStart = resolve;
                    });
                }
                if (message?.action === 'ABORT_GPT_RECREATE') {
                    return Promise.resolve({ ok: true });
                }
                return Promise.resolve({ ok: true });
            };
        });

        await page.locator('#gptRecreateStartBtn').click();
        await expect(page.locator('#gptRecreateStartBtn')).toBeHidden();
        await expect(page.locator('#gptRecreateStopBtn')).toBeVisible();

        await page.locator('#gptRecreateStopBtn').click();
        await expect(page.locator('#gptRecreateStatus')).toHaveText('Stopping...');
        await expect(page.locator('#gptRecreateStartBtn')).toBeHidden();
        await expect(page.locator('#gptRecreateStopBtn')).toBeDisabled();

        await page.evaluate(() => {
            window.__resolveRecreateStart({ ok: false, error: 'workflow_aborted' });
        });
        await expect(page.locator('#gptRecreateStatus')).toHaveText('Stopped.');
        await expect(page.locator('#gptRecreateStartBtn')).toBeVisible();
        await expect(page.locator('#gptRecreateStopBtn')).toBeHidden();
    });

    test('Recreate content bridge should dispatch mocked chat and imagine actions', async ({ page }) => {
        await evaluateExtensionContentWithMockedRecreateActions(page);

        const chatResponses = await dispatchRuntimeMessage(page, {
            action: 'GPT_RECREATE_CHAT_STEP',
            runId: 'run-actions',
            reference: {
                name: 'sample.png',
                mimeType: 'image/png',
                dataUrl: 'data:image/png;base64,aGVsbG8=',
                source: 'local'
            },
            bestPracticesEnabled: false
        });
        const imagineResponses = await dispatchRuntimeMessage(page, {
            action: 'GPT_RECREATE_IMAGINE_STEP',
            runId: 'run-actions',
            generatedPrompt: 'Mock generated Imagine prompt',
            autoSubmit: true
        });
        const calls = await page.evaluate(() => window.__recreateCalls);

        expect(chatResponses).toContainEqual({
            ok: true,
            runId: 'run-actions',
            generatedPrompt: 'Mock generated Imagine prompt'
        });
        expect(imagineResponses).toContainEqual({
            ok: true,
            runId: 'run-actions',
            submitted: true
        });
        expect(calls).toEqual([
            { action: 'chat', runId: 'run-actions', hasReference: true },
            { action: 'imagine', runId: 'run-actions', generatedPrompt: 'Mock generated Imagine prompt' }
        ]);
        await expect(page.locator('#gptHistoryList')).toContainText('Mock generated Imagine prompt');
    });
});
