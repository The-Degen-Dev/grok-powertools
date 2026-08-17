const { test, expect, chromium } = require('@playwright/test');
const { Buffer } = require('buffer');
const fs = require('fs');
const os = require('os');
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
    runEpoch = 1,
    agentMedia = true,
    agentMediaMode = 'exact_with_decoy',
    savedActivationMode = 'click',
    stopAfterNavigationClear = true,
    bridgeResponse = null
}) {
    await page.evaluate(({
        accountUuid,
        mediaUuids,
        responseByAction,
        runToken,
        runEpoch,
        agentMedia,
        agentMediaMode,
        savedActivationMode,
        stopAfterNavigationClear,
        bridgeResponse
    }) => {
        window.__chromeRuntimeResponseByAction = responseByAction;

        const { scraper } = window.__gptE2e;
        scraper.Config = { actionWait: 0, navWait: 0, surfaceWait: 100, historyWait: 100 };
        scraper.sleep = () => Promise.resolve();
        window.__gptE2eRunLease = { runToken, runEpoch };

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
            window.__savedOpenedIdentities.push(mediaUuid);
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
            const scopeToolbar = document.createElement('div');
            const allScope = document.createElement('button');
            const likedScope = document.createElement('button');
            allScope.textContent = 'All';
            allScope.className = 'bg-primary text-background hover:bg-primary';
            likedScope.textContent = 'Liked';
            scopeToolbar.append(allScope, likedScope);
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
                if (savedActivationMode === 'full_pointer_sequence') {
                    const expectedEvents = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
                    const activationEvents = [];
                    expectedEvents.forEach((eventName) => {
                        card.addEventListener(eventName, () => {
                            activationEvents.push(eventName);
                            window.__savedActivationEvents.push({ mediaUuid, events: [...activationEvents] });
                            if (
                                eventName === 'click'
                                && activationEvents.join(',') === expectedEvents.join(',')
                            ) renderAgent(mediaUuid);
                        });
                    });
                } else {
                    image.addEventListener('click', () => renderAgent(mediaUuid));
                }
                card.appendChild(image);
                list.appendChild(card);
            });
            scroller.appendChild(list);
            document.body.append(scopeToolbar, scroller);
        };

        window.__agentScrollCalls = [];
        window.__savedOpenedIdentities = [];
        window.__agentRenderedMediaUrls = [];
        window.__savedScrollByCalls = [];
        window.__savedScrollWrites = [];
        window.__savedActivationEvents = [];
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
        runEpoch,
        agentMedia,
        agentMediaMode,
        savedActivationMode,
        stopAfterNavigationClear,
        bridgeResponse
    });
    await installTask8SavedWorkflowTracker(page);
}

async function setupVirtualizedSavedBackup(page, { accountUuid, mediaUuids, runToken }) {
    await page.evaluate(({ accountUuid, mediaUuids, runToken }) => {
        const { scraper } = window.__gptE2e;
        const savedUrl = 'https://grok.com/imagine/saved';
        const pageSize = 6;
        let windowIndex = 0;
        let clock = 1800000000000;
        const originalDateNow = Date.now;
        Date.now = () => clock;
        scraper.Config = { actionWait: 0, navWait: 0, surfaceWait: 100, historyWait: 0 };
        scraper.sleep = async (delay = 0) => {
            clock += Number(delay) || 0;
        };
        window.__restoreVirtualDateNow = () => { Date.now = originalDateNow; };
        window.__virtualTransfers = [];
        window.__virtualAgentScrollCalls = [];
        window.__virtualSavedScrollCalls = [];
        window.__virtualValidReceiptReturns = 0;
        window.__virtualFirstUnchangedBottom = null;
        window.__gptE2eRunLease = { runToken, runEpoch: 1 };
        window.__chromeRuntimeResponseByAction = {
            R2_BACKUP_CHECK_PRESENT: { status: 'missing' },
            R2_BACKUP_UPLOAD: (message) => {
                window.__virtualTransfers.push({
                    identity: message.url.match(/generated\/([^/]+)/)?.[1] || '',
                    isVideo: message.isVideo
                });
                return {
                    status: 'uploaded',
                    backupProcessedId: `r2/virtual/${message.url.match(/generated\/([^/]+)/)?.[1] || 'unknown'}`
                };
            }
        };

        const currentWindowIdentities = () => mediaUuids.slice(
            windowIndex * pageSize,
            (windowIndex + 1) * pageSize
        );
        const appendScope = () => {
            const toolbar = document.createElement('div');
            const all = document.createElement('button');
            const liked = document.createElement('button');
            all.textContent = 'All';
            all.className = 'bg-primary text-background hover:bg-primary';
            liked.textContent = 'Liked';
            toolbar.append(all, liked);
            document.body.appendChild(toolbar);
        };
        const validatePendingReceipt = () => {
            const receipt = window.__chromeStorageLocalState.scrapeNavigation?.savedViewportReceipt;
            if (!receipt) return;
            const identities = currentWindowIdentities();
            const sourceIndex = identities.indexOf(receipt.sourceIdentity);
            const expectedNext = sourceIndex >= 0 ? identities[sourceIndex + 1] || null : null;
            if (receipt.version === 3
                && sourceIndex >= 0
                && receipt.expectedNextIdentity === expectedNext
                && receipt.origin?.pathname === '/imagine/saved'
                && receipt.origin?.scope === 'all') {
                window.__virtualValidReceiptReturns++;
            }
        };

        const renderAgent = (identity) => {
            window.history.pushState({}, '', `/imagine/agent/virtual?conversation=${identity}`);
            document.body.innerHTML = '';
            const scroller = document.createElement('div');
            scroller.className = 'overflow-scroll';
            scroller.id = 'virtual-agent-gallery';
            scroller.scrollBy = (...args) => window.__virtualAgentScrollCalls.push(args);
            const node = document.createElement('div');
            node.className = 'react-flow__node-asset';
            const mediaIndex = mediaUuids.indexOf(identity);
            const isVideo = mediaIndex % 5 === 0;
            const media = document.createElement(isVideo ? 'video' : 'img');
            if (!isVideo) media.alt = 'Agent media';
            media.src = `https://assets.grok.com/users/${accountUuid}/generated/${identity}/${isVideo ? 'video.mp4' : 'preview.jpg'}`;
            node.appendChild(media);
            scroller.appendChild(node);
            document.body.appendChild(scroller);
        };

        const renderSaved = () => {
            document.body.innerHTML = '';
            appendScope();
            const scroller = document.createElement('div');
            scroller.className = 'overflow-scroll';
            scroller.id = 'virtual-saved-gallery';
            let scrollTop = windowIndex * 600;
            Object.defineProperties(scroller, {
                scrollTop: {
                    configurable: true,
                    get: () => scrollTop,
                    set: (value) => { scrollTop = Number(value); }
                },
                scrollHeight: { configurable: true, value: 3000 },
                clientHeight: { configurable: true, value: 600 }
            });
            const list = document.createElement('div');
            list.setAttribute('role', 'list');
            currentWindowIdentities().forEach((identity) => {
                const card = document.createElement('article');
                card.setAttribute('role', 'listitem');
                const image = document.createElement('img');
                image.alt = 'Generated image';
                image.src = `https://assets.grok.com/users/${accountUuid}/generated/${identity}/image.jpg`;
                image.addEventListener('click', () => renderAgent(identity));
                card.appendChild(image);
                list.appendChild(card);
            });
            scroller.appendChild(list);
            scroller.scrollBy = (_x, y) => {
                window.__virtualSavedScrollCalls.push({
                    windowIndex,
                    y,
                    durabilityChecks: window.__chromeRuntimeMessages.filter((message) => (
                        message.action === 'GET_SCRAPE_DURABILITY'
                    )).length
                });
                const nextScrollTop = Math.min(2400, scrollTop + Number(y || 0));
                const unchangedBottom = windowIndex === 4 && nextScrollTop === scrollTop;
                scrollTop = nextScrollTop;
                if (unchangedBottom && window.__virtualFirstUnchangedBottom === null) {
                    window.__virtualFirstUnchangedBottom = {
                        transferCount: window.__virtualTransfers.length,
                        completionSeen: window.__chromeRuntimeMessages.some((message) => (
                            message.action === 'R2_BACKUP_COMPLETE'
                        ))
                    };
                }
                const nextWindowIndex = Math.min(4, Math.floor(scrollTop / 600));
                if (nextWindowIndex !== windowIndex) {
                    windowIndex = nextWindowIndex;
                    renderSaved();
                }
            };
            document.body.appendChild(scroller);
            validatePendingReceipt();
        };

        document.addEventListener('__gpt_fetch_media', (event) => {
            const isVideo = String(event.detail.url || '').endsWith('.mp4');
            document.dispatchEvent(new CustomEvent('__gpt_fetch_media_result', {
                detail: {
                    requestId: event.detail.requestId,
                    dataUrl: isVideo
                        ? 'data:video/mp4;base64,dmlkZW8='
                        : 'data:image/jpeg;base64,aW1hZ2U=',
                    size: 5,
                    type: isVideo ? 'video/mp4' : 'image/jpeg'
                }
            }));
        });
        Object.defineProperty(window.history, 'back', {
            configurable: true,
            value: () => {
                window.history.replaceState({}, '', savedUrl);
                renderSaved();
                window.dispatchEvent(new PopStateEvent('popstate'));
            }
        });
        window.history.replaceState({}, '', savedUrl);
        renderSaved();
    }, { accountUuid, mediaUuids, runToken });
}

function readHarnessStorage(state, keys) {
    if (keys == null) return { ...state };
    if (typeof keys === 'string') return { [keys]: state[keys] };
    if (Array.isArray(keys)) {
        return keys.reduce((selected, key) => {
            if (Object.prototype.hasOwnProperty.call(state, key)) selected[key] = state[key];
            return selected;
        }, {});
    }
    return Object.keys(keys).reduce((selected, key) => {
        selected[key] = Object.prototype.hasOwnProperty.call(state, key) ? state[key] : keys[key];
        return selected;
    }, {});
}

function createListenerTarget() {
    const listeners = [];
    return {
        listeners,
        addListener: (listener) => { listeners.push(listener); }
    };
}

async function createProductionDualWriteHarness({
    runToken,
    mediaUuids,
    terminalOutcome = 'r2_present'
}) {
    const tabId = 1;
    const runEpoch = 1;
    const lease = {
        version: 1,
        epoch: runEpoch,
        token: runToken,
        tabId,
        kind: 'sync',
        status: 'active',
        startedAt: 1810000000000
    };
    const localState = {
        scraperState: 'running',
        scrapeRunToken: runToken,
        scrapeRunEpoch: runEpoch,
        isScraping: true,
        isR2Backup: false,
        processedIds: [],
        cloudConfig: {
            enabled: true,
            mode: 'dual_write',
            workerUrl: 'https://task-8-fixture.example.workers.dev',
            apiKey: 'test-placeholder',
            keyPrefix: 'grok-powertools/v1'
        }
    };
    const sessionState = { activeScrapeRunToken: lease };
    const runtimeMessages = [];
    const productionRequests = [];
    const storageWrites = [];
    const productionTransitions = [];
    const durabilitySnapshots = [];
    const observedTransitions = new Set();
    const downloadItems = new Map();
    const pendingFilenameHandlers = new Map();
    const runtimeOnMessage = createListenerTarget();
    let nextDownloadId = 800;
    let background = null;
    let completionPromise = null;
    let processedBeforeDurability = null;
    let processedAfterDurability = null;

    const recordProductionTransitions = (values) => {
        const operations = values.pendingDownloadOperations;
        if (operations && typeof operations === 'object') {
            Object.values(operations).forEach((operation) => {
                const identity = operation?.mediaId;
                if (!mediaUuids.includes(identity)) return;
                const candidates = [
                    operation.downloadState === 'in_progress' ? `queued:${identity}` : null,
                    operation.downloadState === 'complete' ? `download_complete:${identity}` : null,
                    operation.r2State === 'present' ? `r2_present:${identity}` : null
                ].filter(Boolean);
                candidates.forEach((transition) => {
                    if (observedTransitions.has(transition)) return;
                    observedTransitions.add(transition);
                    productionTransitions.push(transition);
                });
            });
        }
        if (Array.isArray(values.processedIds)) {
            values.processedIds.forEach((identity) => {
                const transition = `processed:${identity}`;
                if (!mediaUuids.includes(identity) || observedTransitions.has(transition)) return;
                observedTransitions.add(transition);
                productionTransitions.push(transition);
            });
        }
    };

    const chromeApi = {
        alarms: {
            clear: async () => true,
            create: async () => {},
            onAlarm: createListenerTarget()
        },
        downloads: {
            cancel: () => {},
            download: (options, callback) => {
                const id = nextDownloadId++;
                const item = {
                    id,
                    url: options.url,
                    finalUrl: options.url,
                    state: 'in_progress',
                    filename: 'image.jpg',
                    mime: options.url.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg'
                };
                downloadItems.set(id, item);
                const filenameHandling = Promise.resolve().then(async () => {
                    callback(id);
                    await background.handleDownloadFilename(item, () => {});
                });
                pendingFilenameHandlers.set(id, filenameHandling);
                filenameHandling.finally(() => pendingFilenameHandlers.delete(id));
            },
            erase: (_query, callback) => callback?.([]),
            onChanged: createListenerTarget(),
            onDeterminingFilename: createListenerTarget(),
            removeFile: (_downloadId, callback) => callback?.(),
            search: async ({ id }) => {
                const item = downloadItems.get(id);
                return item ? [item] : [];
            }
        },
        offscreen: {
            createDocument: async () => {}
        },
        runtime: {
            id: 'task-8-production-background',
            lastError: null,
            getURL: (resourcePath) => resourcePath,
            onMessage: runtimeOnMessage,
            sendMessage: async (message) => {
                runtimeMessages.push(message);
                if (message?.action === 'READ_FILE_FOR_UPLOAD') return { ok: false };
                return { ok: true };
            }
        },
        scripting: {
            executeScript: (_options, callback) => callback?.()
        },
        storage: {
            local: {
                get: async (keys) => readHarnessStorage(localState, keys),
                remove: async (keys) => {
                    for (const key of Array.isArray(keys) ? keys : [keys]) delete localState[key];
                },
                set: async (values) => {
                    storageWrites.push(JSON.parse(JSON.stringify(values)));
                    Object.assign(localState, values);
                    recordProductionTransitions(values);
                }
            },
            session: {
                get: async (keys) => readHarnessStorage(sessionState, keys),
                remove: async (keys) => {
                    for (const key of Array.isArray(keys) ? keys : [keys]) delete sessionState[key];
                },
                set: async (values) => { Object.assign(sessionState, values); }
            },
            onChanged: createListenerTarget()
        },
        tabs: {
            onRemoved: createListenerTarget(),
            onUpdated: createListenerTarget(),
            query: (_query, callback) => callback([{ id: tabId, url: 'https://grok.com/imagine/saved' }]),
            remove: () => {},
            sendMessage: (_tabId, _message, callback) => callback?.({ status: 'stopped' })
        }
    };

    const originalChrome = global.chrome;
    const backgroundPath = require.resolve('../../background.js');
    delete require.cache[backgroundPath];
    global.chrome = chromeApi;
    background = require('../../background.js');
    await background.ensureBackgroundStateReady();
    await background.ensureScrapeLeaseHydrated();

    const dispatchProductionMessage = (request) => {
        const listener = runtimeOnMessage.listeners[0];
        if (!listener) throw new Error('Production background runtime listener was not registered.');
        productionRequests.push({ ...request });
        return new Promise((resolve, reject) => {
            let settled = false;
            const sendResponse = (value) => {
                if (settled) return;
                settled = true;
                resolve(value);
            };
            try {
                const keepPortOpen = listener(request, { tab: { id: tabId } }, sendResponse);
                if (keepPortOpen !== true && !settled) resolve(undefined);
            } catch (error) {
                reject(error);
            }
        });
    };

    const completeQueuedOperations = async () => {
        const operations = background.getPendingDownloadOperationsForTest();
        for (const identity of mediaUuids) {
            const operation = Object.values(operations).find((candidate) => candidate.mediaId === identity);
            if (!operation) throw new Error(`Missing production download operation for ${identity}`);
            const item = downloadItems.get(operation.downloadId);
            item.state = 'complete';
            await background.handleDownloadChanged({
                id: operation.downloadId,
                state: { current: 'complete' }
            });
            const completed = background.getPendingDownloadOperationsForTest()[operation.downloadId];
            if (completed?.downloadState !== 'complete') {
                throw new Error(`Production download completion was not observed for ${identity}`);
            }
            await background.markDownloadOperationR2Present(
                operation.downloadId,
                { status: 'uploaded' }
            );
        }
    };

    const failQueuedOperations = async () => {
        const operations = background.getPendingDownloadOperationsForTest();
        for (const operation of Object.values(operations)) {
            await background.updateDownloadOperation(operation.downloadId, {
                attempts: background.getCloudSyncForTest().MAX_RETRY_ATTEMPTS,
                lastError: 'task_8_forced_terminal_failure'
            });
        }
    };

    return {
        async request(request) {
            const response = await dispatchProductionMessage(request);
            if (request.action === 'DOWNLOAD_MEDIA') {
                await Promise.all(Array.from(pendingFilenameHandlers.values()));
                if (terminalOutcome === 'failed'
                    && Object.keys(background.getPendingDownloadOperationsForTest()).length === mediaUuids.length
                    && !completionPromise) {
                    processedBeforeDurability = [...(localState.processedIds || [])];
                    completionPromise = failQueuedOperations();
                    await completionPromise;
                    processedAfterDurability = [...(localState.processedIds || [])];
                }
            }
            if (request.action === 'GET_SCRAPE_DURABILITY') {
                durabilitySnapshots.push({ ...response });
            }
            if (request.action === 'GET_SCRAPE_DURABILITY'
                && response?.status === 'pending'
                && Object.keys(background.getPendingDownloadOperationsForTest()).length === mediaUuids.length
                && !completionPromise) {
                processedBeforeDurability = [...(localState.processedIds || [])];
                completionPromise = completeQueuedOperations();
                await completionPromise;
                processedAfterDurability = [...(localState.processedIds || [])];
            }
            return response;
        },
        async settle() {
            if (completionPromise) await completionPromise;
            await Promise.resolve();
        },
        evidence() {
            return {
                productionBackgroundTransitions: [...productionTransitions],
                processedBeforeDurability: [...(processedBeforeDurability || [])],
                processedAfterDurability: [...(processedAfterDurability || [])],
                processedIds: [...(localState.processedIds || [])],
                pendingOperations: background.getPendingDownloadOperationsForTest(),
                productionRequestActions: productionRequests.map(({ action }) => action),
                runtimeActions: runtimeMessages.map((message) => message?.action).filter(Boolean),
                durabilitySnapshots: durabilitySnapshots.map((snapshot) => ({ ...snapshot })),
                processedWrites: storageWrites.filter((values) => (
                    Object.prototype.hasOwnProperty.call(values, 'processedIds')
                )).length
            };
        },
        dispose() {
            delete require.cache[backgroundPath];
            if (typeof originalChrome === 'undefined') delete global.chrome;
            else global.chrome = originalChrome;
        }
    };
}

async function setupVirtualizedSavedSync(page, {
    accountUuid,
    mediaUuids,
    runToken,
    transferMode = 'cloud_only'
}) {
    await page.evaluate(({ accountUuid, mediaUuids, runToken, transferMode }) => {
        const { scraper } = window.__gptE2e;
        const savedUrl = 'https://grok.com/imagine/saved';
        const pageSize = 6;
        let windowIndex = 0;
        let renderGeneration = 0;
        let clock = 1810000000000;
        const originalDateNow = Date.now;
        Date.now = () => clock;
        scraper.Config = { actionWait: 0, navWait: 0, surfaceWait: 100, historyWait: 0 };
        scraper.sleep = async (delay = 0) => {
            clock += Number(delay) || 0;
        };
        window.__restoreVirtualSyncDateNow = () => { Date.now = originalDateNow; };
        window.__virtualSyncEvidence = {
            openedIdentities: [],
            transferredIdentities: [],
            mediaTypes: [],
            agentGalleryScrollCalls: 0,
            savedRenderGenerations: [],
            openedGenerations: [],
            rejectedActivations: [],
            validReceiptReturns: 0,
            completionReason: null
        };
        window.__gptE2eRunLease = { runToken, runEpoch: 1 };

        const sourceUrlFor = (identity) => (
            `https://assets.grok.com/users/${accountUuid}/generated/${identity}/image.jpg`
        );
        const currentWindowIdentities = () => mediaUuids.slice(
            windowIndex * pageSize,
            (windowIndex + 1) * pageSize
        );
        window.__chromeRuntimeResponseByAction = {
            GET_CLOUD_CONFIG: { config: { mode: transferMode } },
            DOWNLOAD_MEDIA: async (message) => {
                const identity = message.url.match(/generated\/([^/]+)/)?.[1] || '';
                window.__virtualSyncEvidence.transferredIdentities.push(identity);
                window.__virtualSyncEvidence.mediaTypes.push(message.isVideo ? 'video' : 'image');
                if (transferMode !== 'dual_write') return { status: 'uploaded' };
                return window.__productionBackgroundRequest(message);
            },
            GET_SCRAPE_DURABILITY: async () => {
                if (transferMode !== 'dual_write') {
                    return {
                        status: 'durable',
                        inFlightTasks: 0,
                        pendingDownloads: 0,
                        pendingOperations: 0,
                        pendingQueueItems: 0,
                        failedItems: 0
                    };
                }
                return window.__productionBackgroundRequest({
                    action: 'GET_SCRAPE_DURABILITY',
                    runToken,
                    runEpoch: 1,
                    kind: 'sync'
                });
            }
        };

        const appendScope = () => {
            const toolbar = document.createElement('div');
            const all = document.createElement('button');
            const liked = document.createElement('button');
            all.textContent = 'All';
            all.className = 'bg-primary text-background hover:bg-primary';
            liked.textContent = 'Liked';
            toolbar.append(all, liked);
            document.body.appendChild(toolbar);
        };
        const validatePendingReceipt = () => {
            const receipt = window.__chromeStorageLocalState.scrapeNavigation?.savedViewportReceipt;
            if (!receipt) return;
            const identities = currentWindowIdentities();
            const sourceIndex = identities.indexOf(receipt.sourceIdentity);
            const expectedNext = sourceIndex >= 0 ? identities[sourceIndex + 1] || null : null;
            if (receipt.version === 3
                && sourceIndex >= 0
                && receipt.expectedNextIdentity === expectedNext
                && receipt.origin?.pathname === '/imagine/saved'
                && receipt.origin?.scope === 'all') {
                window.__virtualSyncEvidence.validReceiptReturns++;
            }
        };
        const renderAgent = (identity) => {
            window.__virtualSyncEvidence.openedIdentities.push(identity);
            window.history.pushState({}, '', `/imagine/agent/virtual-sync?conversation=${identity}`);
            document.body.innerHTML = '';
            const scroller = document.createElement('div');
            scroller.className = 'overflow-scroll';
            scroller.id = 'virtual-sync-agent-gallery';
            scroller.scrollBy = () => { window.__virtualSyncEvidence.agentGalleryScrollCalls++; };
            const node = document.createElement('div');
            node.className = 'react-flow__node-asset';
            const isVideo = mediaUuids.indexOf(identity) % 2 === 1;
            const media = document.createElement(isVideo ? 'video' : 'img');
            if (!isVideo) media.alt = 'Agent media';
            media.src = `https://assets.grok.com/users/${accountUuid}/generated/${identity}/${
                isVideo ? 'video.mp4' : 'preview.jpg'
            }`;
            node.appendChild(media);
            scroller.appendChild(node);
            document.body.appendChild(scroller);
        };
        const renderSaved = () => {
            document.body.innerHTML = '';
            renderGeneration++;
            window.__virtualSyncEvidence.savedRenderGenerations.push(renderGeneration);
            appendScope();
            const scroller = document.createElement('div');
            scroller.className = 'overflow-scroll';
            scroller.id = `virtual-sync-saved-gallery-${renderGeneration}`;
            let scrollTop = windowIndex * 600;
            Object.defineProperties(scroller, {
                scrollTop: {
                    configurable: true,
                    get: () => scrollTop,
                    set: (value) => { scrollTop = Number(value); }
                },
                scrollHeight: { configurable: true, value: Math.max(600, Math.ceil(mediaUuids.length / 6) * 600) },
                clientHeight: { configurable: true, value: 600 }
            });
            const list = document.createElement('div');
            list.setAttribute('role', 'list');
            currentWindowIdentities().forEach((identity) => {
                const mountedGeneration = renderGeneration;
                const card = document.createElement('article');
                card.setAttribute('role', 'listitem');
                card.dataset.renderGeneration = String(renderGeneration);
                const image = document.createElement('img');
                image.alt = 'Generated image';
                image.src = sourceUrlFor(identity);
                image.addEventListener('click', () => {
                    if (!image.isConnected || mountedGeneration !== renderGeneration) {
                        window.__virtualSyncEvidence.rejectedActivations.push({
                            identity,
                            mountedGeneration,
                            currentGeneration: renderGeneration,
                            isConnected: image.isConnected
                        });
                        return;
                    }
                    window.__virtualSyncEvidence.openedGenerations.push({
                        identity,
                        generation: mountedGeneration
                    });
                    renderAgent(identity);
                });
                card.appendChild(image);
                list.appendChild(card);
            });
            scroller.appendChild(list);
            scroller.scrollBy = (_x, y) => {
                const maxWindowIndex = Math.max(0, Math.ceil(mediaUuids.length / pageSize) - 1);
                const maxScrollTop = maxWindowIndex * 600;
                scrollTop = Math.min(maxScrollTop, scrollTop + Number(y || 0));
                const nextWindowIndex = Math.min(maxWindowIndex, Math.floor(scrollTop / 600));
                if (nextWindowIndex !== windowIndex) {
                    windowIndex = nextWindowIndex;
                    renderSaved();
                }
            };
            document.body.appendChild(scroller);
            validatePendingReceipt();
        };

        document.addEventListener('__gpt_fetch_media', (event) => {
            const isVideo = String(event.detail.url || '').endsWith('.mp4');
            document.dispatchEvent(new CustomEvent('__gpt_fetch_media_result', {
                detail: {
                    requestId: event.detail.requestId,
                    dataUrl: isVideo
                        ? 'data:video/mp4;base64,dmlkZW8='
                        : 'data:image/jpeg;base64,aW1hZ2U=',
                    size: 5,
                    type: isVideo ? 'video/mp4' : 'image/jpeg'
                }
            }));
        });
        Object.defineProperty(window.history, 'back', {
            configurable: true,
            value: () => {
                window.history.replaceState({}, '', savedUrl);
                renderSaved();
                window.dispatchEvent(new PopStateEvent('popstate'));
            }
        });
        window.__chromeStorageSetObservers.push((values) => {
            const completionReason = values.scrapeStopReason;
            if (completionReason) window.__virtualSyncEvidence.completionReason = completionReason;
        });
        window.history.replaceState({}, '', savedUrl);
        renderSaved();
    }, { accountUuid, mediaUuids, runToken, transferMode });
    await installTask8SavedWorkflowTracker(page);
}

async function setupMockSavedLegacyDetailSync(page, {
    accountUuid,
    mediaUuids,
    runToken,
    runEpoch = 1,
    liveVideoContract = false
}) {
    await page.evaluate(({
        accountUuid,
        mediaUuids,
        runToken,
        runEpoch,
        liveVideoContract
    }) => {
        const { scraper } = window.__gptE2e;
        const savedUrl = 'https://grok.com/imagine/saved';
        const expectedPointerEvents = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
        const blobDataUrl = 'data:image/jpeg;base64,bGVnYWN5LWRldGFpbC1maXh0dXJl';

        scraper.Config = { actionWait: 0, navWait: 0, surfaceWait: 100, historyWait: 100 };
        scraper.sleep = () => Promise.resolve();
        window.__gptE2eRunLease = { runToken, runEpoch };
        window.__legacyDetailEvents = {
            opened: [],
            transfers: [],
            returned: [],
            backControlEvents: [],
            thumbnailClicks: []
        };
        window.__chromeRuntimeResponseByAction = {
            GET_CLOUD_CONFIG: { config: { mode: 'cloud_only' } },
            DOWNLOAD_MEDIA: (message) => {
                window.__legacyDetailEvents.transfers.push(message.url);
                return { status: 'uploaded' };
            }
        };
        document.addEventListener('__gpt_fetch_media', (event) => {
            document.dispatchEvent(new CustomEvent('__gpt_fetch_media_result', {
                detail: {
                    requestId: event.detail.requestId,
                    dataUrl: blobDataUrl,
                    size: 21,
                    type: 'image/jpeg'
                }
            }));
        });

        const makeVisible = (element, top = 20, left = 20, width = 100, height = 40) => {
            element.getBoundingClientRect = () => ({
                x: left,
                y: top,
                top,
                left,
                right: left + width,
                bottom: top + height,
                width,
                height
            });
            return element;
        };

        const renderDetail = (mediaUuid) => {
            window.history.pushState({}, '', `/imagine/post/${mediaUuid}?conversation=mock`);
            document.body.innerHTML = '';
            window.__legacyDetailEvents.opened.push(mediaUuid);

            const media = liveVideoContract
                ? makeVisible(document.createElement('video'), 80, 120, 323, 594)
                : makeVisible(document.createElement('img'), 80, 120, 900, 700);
            if (liveVideoContract) {
                media.src = `https://assets.grok.com/users/${accountUuid}/generated/${mediaUuid}/generated_video.mp4`;
                media.poster = `https://assets.grok.com/users/${accountUuid}/generated/${mediaUuid}/preview_image.jpg`;
                Object.defineProperty(media, 'readyState', { configurable: true, value: 4 });
            } else {
                media.alt = 'Generated image';
                media.src = `https://assets.grok.com/users/${accountUuid}/generated/${mediaUuid}/image.jpg`;
                Object.defineProperties(media, {
                    naturalWidth: { configurable: true, value: 1024 },
                    naturalHeight: { configurable: true, value: 1024 }
                });
            }

            const placeholderVideo = liveVideoContract
                ? makeVisible(document.createElement('video'), 80, 120, 323, 594)
                : null;
            if (placeholderVideo) {
                placeholderVideo.poster = media.poster;
                Object.defineProperty(placeholderVideo, 'readyState', { configurable: true, value: 0 });
            }

            const download = makeVisible(document.createElement('button'));
            download.setAttribute('aria-label', 'Download');

            const back = makeVisible(document.createElement(liveVideoContract ? 'a' : 'button'));
            back.setAttribute('aria-label', 'Back');
            if (liveVideoContract) back.href = '/imagine/saved';
            const backEvents = [];
            expectedPointerEvents.forEach((eventName) => {
                back.addEventListener(eventName, () => {
                    backEvents.push(eventName);
                    window.__legacyDetailEvents.backControlEvents.push(eventName);
                    if (eventName !== 'click') return;
                    if (backEvents.join(',') === expectedPointerEvents.join(',')) {
                        window.history.back();
                        return;
                    }
                    void scraper.stop('e2e_bare_back_control_click');
                });
            });

            const timeline = document.createElement('div');
            timeline.className = 'overflow-y-auto';
            const timelineMediaUuids = [
                '70707070-7070-4070-8070-707070707070',
                mediaUuid,
                '71717171-7171-4171-8171-717171717171'
            ];
            timelineMediaUuids.forEach((timelineMediaUuid, index) => {
                const button = makeVisible(document.createElement('button'), 80 + (index * 52), 20, 40, 40);
                const thumbnail = makeVisible(document.createElement('img'), 80 + (index * 52), 20, 40, 40);
                thumbnail.alt = `Thumbnail ${index + 1}`;
                thumbnail.src = `https://assets.grok.com/users/${accountUuid}/generated/${timelineMediaUuid}/image.jpg`;
                button.addEventListener('click', () => {
                    window.__legacyDetailEvents.thumbnailClicks.push(timelineMediaUuid);
                    media.src = thumbnail.src;
                    window.history.replaceState({}, '', `/imagine/post/${timelineMediaUuid}?conversation=mock`);
                });
                button.appendChild(thumbnail);
                timeline.appendChild(button);
            });

            document.body.append(timeline, media, ...(placeholderVideo ? [placeholderVideo] : []), download, back);
        };

        const renderSaved = () => {
            document.body.innerHTML = '';
            const scopeToolbar = document.createElement('div');
            const allScope = makeVisible(document.createElement('button'));
            const likedScope = makeVisible(document.createElement('button'));
            allScope.textContent = 'All';
            allScope.className = 'bg-primary text-background hover:bg-primary';
            likedScope.textContent = 'Liked';
            scopeToolbar.append(allScope, likedScope);

            const scroller = document.createElement('div');
            scroller.className = 'overflow-scroll';
            scroller.id = 'legacy-saved-gallery-scroller';
            let scrollTop = 420;
            Object.defineProperties(scroller, {
                scrollTop: {
                    configurable: true,
                    get: () => scrollTop,
                    set: (value) => { scrollTop = Number(value); }
                },
                scrollHeight: { configurable: true, value: 2000 },
                clientHeight: { configurable: true, value: 800 }
            });
            scroller.scrollBy = () => {};

            const list = document.createElement('div');
            list.setAttribute('role', 'list');
            mediaUuids.forEach((mediaUuid, index) => {
                const card = document.createElement('article');
                card.setAttribute('role', 'listitem');
                const image = makeVisible(document.createElement('img'), 100 + (index * 220), 20, 200, 200);
                image.alt = 'Generated image';
                image.src = `https://assets.grok.com/users/${accountUuid}/generated/${mediaUuid}/image.jpg`;
                Object.defineProperties(image, {
                    naturalWidth: { configurable: true, value: 1024 },
                    naturalHeight: { configurable: true, value: 1024 }
                });
                const activationEvents = [];
                expectedPointerEvents.forEach((eventName) => {
                    card.addEventListener(eventName, () => {
                        activationEvents.push(eventName);
                        if (
                            eventName === 'click'
                            && activationEvents.join(',') === expectedPointerEvents.join(',')
                        ) renderDetail(mediaUuid);
                    });
                });
                card.appendChild(image);
                list.appendChild(card);
            });
            scroller.appendChild(list);
            document.body.append(scopeToolbar, scroller);
        };

        Object.defineProperty(window.history, 'back', {
            configurable: true,
            value: () => {
                const mediaUuid = window.location.pathname.split('/').filter(Boolean).at(-1);
                window.__legacyDetailEvents.returned.push(mediaUuid);
                window.history.replaceState({}, '', savedUrl);
                renderSaved();
            }
        });

        let completedReturns = 0;
        window.__chromeStorageSetObservers.push((values) => {
            if (
                values.scrapeNavigation !== null
                || values.currentItemId !== null
                || Object.keys(values).length !== 2
            ) return;
            completedReturns++;
            if (completedReturns === mediaUuids.length) {
                void scraper.stop('e2e_after_two_legacy_returns');
            }
        });

        window.history.replaceState({}, '', savedUrl);
        renderSaved();
    }, { accountUuid, mediaUuids, runToken, runEpoch, liveVideoContract });
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
        const makeVisible = (element, width = 100, top = 20, left = 20) => {
            element.getBoundingClientRect = () => ({
                x: left,
                y: top,
                top,
                left,
                right: left + width,
                bottom: top + 40,
                width,
                height: 40
            });
            return element;
        };

        retry.createBatchRunToken = () => 'e2e-prompted-batch';
        window.__resolvePromptedBatchNativeClickTarget = (x, y) => {
            const submit = retry.promptedVideoComposerRoot
                ?.querySelector('button[aria-label="Send"], button[aria-label="Make video"]');
            const candidates = [
                submit,
                ...document.querySelectorAll('button[aria-label="Back"], a[aria-label="Back"]')
            ].filter(Boolean);
            return candidates.find((candidate) => {
                const rect = candidate.getBoundingClientRect();
                return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
            }) || null;
        };
        document.elementFromPoint = window.__resolvePromptedBatchNativeClickTarget;
        window.__promptedBatchEvents = {
            savedClicks: [],
            savedTransitions: [],
            menuChoices: [],
            menuMediaUuids: [],
            promptWrites: [],
            promptWriteResults: [],
            promptAtSubmit: null,
            submitCount: 0,
            resultCount: 0,
            resultAssetIds: [],
            editCount: 0,
            decoyAddPromptCount: 0,
            decoyPromptAtSubmit: null,
            decoySubmitCount: 0,
            agentAssetClicks: [],
            agentToolbarActionCount: 0,
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
            if (ms !== 100 || !selectedMediaUuid) return Promise.resolve();

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
            const scopeToolbar = document.createElement('div');
            const allScope = makeVisible(document.createElement('button'));
            const likedScope = makeVisible(document.createElement('button'));
            allScope.textContent = 'All';
            allScope.className = 'bg-primary text-background hover:bg-primary';
            likedScope.textContent = 'Liked';
            scopeToolbar.append(allScope, likedScope);
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
            document.body.append(scopeToolbar, list);
        };

        const renderAgent = (selectedMediaUuid) => {
            window.history.pushState({}, '', `/imagine/agent/mock-agent?conversation=${selectedMediaUuid}`);
            document.body.innerHTML = '';
            const asset = document.createElement('div');
            asset.className = 'react-flow__node-asset';
            asset.setAttribute('data-id', `asset-${selectedMediaUuid}`);
            const assetImage = document.createElement('img');
            assetImage.src = `https://assets.grok.com/users/${accountUuid}/generated/${selectedMediaUuid}/preview.jpg`;
            asset.appendChild(assetImage);
            asset.addEventListener('click', () => {
                asset.classList.add('selected');
                window.__promptedBatchEvents.agentAssetClicks.push(selectedMediaUuid);
            });

            const assetToolbar = document.createElement('div');
            assetToolbar.className = 'react-flow__node-toolbar';
            assetToolbar.setAttribute('data-id', `asset-${selectedMediaUuid}`);
            const dangerousToolbarAction = makeVisible(document.createElement('button'));
            dangerousToolbarAction.setAttribute('aria-label', 'Make Video');
            dangerousToolbarAction.setAttribute('aria-haspopup', 'menu');
            dangerousToolbarAction.addEventListener('click', () => {
                window.__promptedBatchEvents.agentToolbarActionCount++;
            });
            assetToolbar.appendChild(dangerousToolbarAction);

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
                    const generationBar = document.createElement('div');
                    generationBar.id = `selected-generation-bar-${selectedMediaUuid}`;
                    const input = makeVisible(document.createElement('div'));
                    input.id = `selected-prompt-input-${selectedMediaUuid}`;
                    input.setAttribute('contenteditable', 'true');
                    input.setAttribute('role', 'textbox');
                    input.setAttribute('aria-label', 'Ask Grok anything');
                    input.setAttribute('data-selected-prompt-media', selectedMediaUuid);
                    input.tabIndex = -1;
                    const createRadioGroup = (label, options, selected) => {
                        const group = document.createElement('div');
                        group.setAttribute('role', 'radiogroup');
                        group.setAttribute('aria-label', label);
                        options.forEach((option) => {
                            const radio = document.createElement('button');
                            radio.setAttribute('role', 'radio');
                            radio.setAttribute('aria-checked', option === selected ? 'true' : 'false');
                            if (label === 'Generation mode') radio.setAttribute('aria-label', option);
                            radio.textContent = option;
                            group.appendChild(radio);
                        });
                        return group;
                    };
                    const mode = createRadioGroup(
                        'Generation mode',
                        ['Image', 'Video', 'Agent'],
                        'Video'
                    );
                    const resolution = createRadioGroup(
                        'Video resolution',
                        ['480p', '720p', '1080p'],
                        '480p'
                    );
                    const duration = createRadioGroup(
                        'Video duration',
                        ['6s', '10s', '15s'],
                        '6s'
                    );
                    const submit = makeVisible(document.createElement('button'), 48);
                    submit.setAttribute('aria-label', 'Send');
                    submit.disabled = true;
                    input.addEventListener('input', () => {
                        submit.disabled = !input.textContent.trim();
                    });
                    submit.addEventListener('click', () => {
                        window.__promptedBatchEvents.promptAtSubmit = input.textContent;
                        window.__promptedBatchEvents.submitCount++;
                        submit.disabled = true;
                        const result = document.createElement('video');
                        result.src = `https://assets.grok.com/users/${accountUuid}/generated/${selectedMediaUuid}/generated_video.mp4`;
                        Object.defineProperty(result, 'readyState', { configurable: true, value: 4 });
                        asset.appendChild(result);
                        window.__promptedBatchEvents.resultCount++;
                        window.__promptedBatchEvents.resultAssetIds.push(asset.getAttribute('data-id'));
                    });
                    generationBar.append(input, mode, resolution, duration, submit);
                    document.body.appendChild(generationBar);
                    input.focus();
                    const shouldStop = stopAfterAddPrompt === true
                        || stopAfterAddPrompt === selectedMediaUuid;
                    if (shouldStop) retry.stopBatch();
                });
                menu.appendChild(addPrompt);
                document.body.appendChild(menu);
            });

            const back = makeVisible(document.createElement('button'), 100, 80);
            back.setAttribute('aria-label', 'Back');
            back.addEventListener('click', () => {
                window.__promptedBatchEvents.backCount++;
                window.history.replaceState({}, '', savedUrl);
                renderSaved();
            });
            document.body.append(asset, assetToolbar, ...decoys, preciseEdit, makeVideo, back);
        };

        window.history.replaceState({}, '', savedUrl);
        renderSaved();
    }, { accountUuid, mediaUuid, secondMediaUuid, includeDecoys, stopAfterAddPrompt });
}

async function setupMockPromptedResultsBatch(page, {
    accountUuid,
    mediaUuids,
    insertVideoBeforeSource = false,
    insertGeneratedBeforeSource = false,
    deferGeneratedResult = false
}) {
    await page.evaluate(({
        accountUuid,
        mediaUuids,
        insertVideoBeforeSource,
        deferGeneratedResult
    }) => {
        const { retry } = window.__gptE2e;
        const conversationId = 'prompted-batch-conversation';
        const resultsUrl = `https://grok.com/imagine?conversation=${conversationId}`;
        const promptText = 'slow orbit through warm afternoon light';
        let clock = Date.now();
        Date.now = () => clock;
        window.__task8AdvanceClock = (milliseconds) => { clock += milliseconds; };
        const makeVisible = (element, top = 20, left = 20, width = 100) => {
            element.getBoundingClientRect = () => ({
                x: left,
                y: top,
                top,
                left,
                right: left + width,
                bottom: top + 40,
                width,
                height: 40
            });
            return element;
        };

        retry.createBatchRunToken = () => 'e2e-prompted-results-batch';
        retry.sleep = async (delay = 0) => {
            clock += Number(delay) || 0;
            await Promise.resolve();
        };
        window.__resolvePromptedBatchNativeClickTarget = (x, y) => {
            const submit = retry.promptedVideoComposerRoot
                ?.querySelector('button[aria-label="Send"], button[aria-label="Make video"]');
            const candidates = [
                submit,
                ...document.querySelectorAll('button[aria-label="Back"], a[aria-label="Back"]')
            ].filter(Boolean);
            return candidates.find((candidate) => {
                const rect = candidate.getBoundingClientRect();
                return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
            }) || null;
        };
        document.elementFromPoint = window.__resolvePromptedBatchNativeClickTarget;
        window.__promptedResultsEvents = {
            opened: [],
            menuChoices: [],
            submitted: [],
            returned: [],
            preciseEditClicks: 0,
            promptWrites: []
        };
        window.__promptedResultsItemEvents = mediaUuids.map((sourceIdentity) => ({
            sourceIdentity,
            openIdentity: null,
            makeVideoClicks: 0,
            addPromptClicks: 0,
            preciseEditClicks: 0,
            promptWrites: [],
            submitClicks: 0,
            submitIdentity: null,
            acceptedConversationId: null,
            returnStatus: null,
            returnIdentity: null,
            nextIdentity: null
        }));
        window.__promptedResultsMountEvidence = {
            currentGeneration: 0,
            openedGenerations: [],
            rejectedActivations: []
        };
        const getItemEvents = (sourceIdentity) => window.__promptedResultsItemEvents.find((item) => (
            item.sourceIdentity === sourceIdentity
        ));
        let activeDetailIdentity = null;
        window.__promptedResultsReplacements = {};
        window.__promptedResultsCompleted = {};
        document.addEventListener('__gpt_set_prompted_video_content', (event) => {
            window.__promptedResultsEvents.promptWrites.push(event.detail.text);
            getItemEvents(activeDetailIdentity)?.promptWrites.push(event.detail.text);
        });

        const createRadioGroup = (label, options, selected) => {
            const group = document.createElement('div');
            group.setAttribute('role', 'radiogroup');
            group.setAttribute('aria-label', label);
            options.forEach((option) => {
                const radio = document.createElement('button');
                radio.setAttribute('role', 'radio');
                radio.setAttribute('aria-checked', option === selected ? 'true' : 'false');
                if (label === 'Generation mode') radio.setAttribute('aria-label', option);
                radio.textContent = option;
                group.appendChild(radio);
            });
            return group;
        };

        const renderDetail = (mediaUuid) => {
            activeDetailIdentity = mediaUuid;
            window.history.pushState({}, '', `/imagine/post/${mediaUuid}?conversation=${conversationId}`);
            document.body.innerHTML = '';

            const preciseEdit = makeVisible(document.createElement('button'));
            preciseEdit.setAttribute('aria-label', 'Edit');
            preciseEdit.textContent = 'Precise Edit';
            preciseEdit.addEventListener('click', () => {
                window.__promptedResultsEvents.preciseEditClicks++;
                getItemEvents(mediaUuid).preciseEditClicks++;
            });

            const makeVideo = makeVisible(document.createElement('button'));
            const triggerId = `results-make-video-${mediaUuid}`;
            const menuId = `results-video-menu-${mediaUuid}`;
            makeVideo.id = triggerId;
            makeVideo.setAttribute('aria-label', 'Make Video');
            makeVideo.setAttribute('aria-haspopup', 'menu');
            makeVideo.setAttribute('aria-controls', menuId);
            makeVideo.setAttribute('aria-expanded', 'false');
            makeVideo.setAttribute('data-state', 'closed');
            makeVideo.addEventListener('click', () => {
                getItemEvents(mediaUuid).makeVideoClicks++;
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
                    getItemEvents(mediaUuid).addPromptClicks++;
                    window.__promptedResultsEvents.menuChoices.push(mediaUuid);
                    const composer = document.createElement('div');
                    const input = makeVisible(document.createElement('div'));
                    input.setAttribute('contenteditable', 'true');
                    input.setAttribute('role', 'textbox');
                    input.setAttribute('aria-label', 'Ask Grok anything');
                    input.tabIndex = -1;
                    const submit = makeVisible(document.createElement('button'), 20, 20, 48);
                    submit.setAttribute('aria-label', 'Send');
                    submit.disabled = true;
                    input.addEventListener('input', () => {
                        submit.disabled = !input.textContent.trim();
                    });
                    submit.addEventListener('click', () => {
                        const itemEvents = getItemEvents(mediaUuid);
                        itemEvents.submitClicks++;
                        itemEvents.submitIdentity = mediaUuid;
                        itemEvents.acceptedConversationId = new URLSearchParams(window.location.search)
                            .get('conversation');
                        window.__promptedResultsEvents.submitted.push({
                            mediaUuid,
                            prompt: input.textContent
                        });
                        submit.disabled = true;
                        if (!deferGeneratedResult) {
                            if (insertVideoBeforeSource) {
                                window.__promptedResultsCompleted[mediaUuid] = `a${mediaUuid.slice(1)}`;
                            } else {
                                window.__promptedResultsReplacements[mediaUuid] = `a${mediaUuid.slice(1)}`;
                            }
                            const video = document.createElement('video');
                            video.src = `https://assets.grok.com/users/${accountUuid}/generated/${mediaUuid}/generated_video.mp4`;
                            Object.defineProperty(video, 'readyState', { configurable: true, value: 4 });
                            document.body.appendChild(video);
                            const complete = document.createElement('button');
                            complete.setAttribute('aria-label', 'Video Generation Complete');
                            document.body.appendChild(complete);
                        }
                    });
                    composer.append(
                        input,
                        createRadioGroup('Generation mode', ['Image', 'Video', 'Agent'], 'Video'),
                        createRadioGroup('Video resolution', ['480p', '720p', '1080p'], '480p'),
                        createRadioGroup('Video duration', ['6s', '10s', '15s'], '6s'),
                        submit
                    );
                    document.body.appendChild(composer);
                    input.focus();
                });
                menu.appendChild(addPrompt);
                document.body.appendChild(menu);
            });

            const back = makeVisible(document.createElement('a'), 80, 20, 100);
            back.setAttribute('aria-label', 'Back');
            back.href = '/imagine';
            const backEvents = [];
            ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((eventName) => {
                back.addEventListener(eventName, (event) => {
                    backEvents.push(eventName);
                    if (eventName !== 'click') return;
                    event.preventDefault();
                    if (backEvents.join(',') !== 'pointerdown,mousedown,pointerup,mouseup,click') return;
                    window.__promptedResultsEvents.returned.push(mediaUuid);
                    const itemEvents = getItemEvents(mediaUuid);
                    itemEvents.returnStatus = 'returned';
                    itemEvents.returnIdentity = mediaUuid;
                    window.history.replaceState({}, '', resultsUrl);
                    renderResults();
                });
            });
            document.body.append(preciseEdit, makeVideo, back);
        };

        const renderResults = () => {
            document.body.innerHTML = '';
            const mountedGeneration = ++window.__promptedResultsMountEvidence.currentGeneration;
            const nativePrompt = document.createElement('div');
            nativePrompt.setAttribute('contenteditable', 'true');
            nativePrompt.textContent = promptText;
            const list = document.createElement('div');
            list.setAttribute('role', 'list');
            mediaUuids.forEach((mediaUuid, index) => {
                const insertedMediaUuid = window.__promptedResultsCompleted[mediaUuid];
                if (insertedMediaUuid) {
                    const insertedCard = makeVisible(document.createElement('article'), index * 280, 20);
                    insertedCard.setAttribute('role', 'listitem');
                    const insertedLink = document.createElement('a');
                    insertedLink.href = `/imagine/post/${insertedMediaUuid}`;
                    const insertedImage = document.createElement('img');
                    insertedImage.alt = 'Generated image';
                    insertedImage.src = `https://assets.grok.com/users/${accountUuid}/generated/${insertedMediaUuid}/image.jpg`;
                    insertedLink.appendChild(insertedImage);
                    const videoOptions = document.createElement('button');
                    videoOptions.setAttribute('aria-label', 'Video Options');
                    insertedCard.append(insertedLink, videoOptions);
                    list.appendChild(insertedCard);
                }
                const currentMediaUuid = window.__promptedResultsReplacements[mediaUuid] || mediaUuid;
                const wasConverted = currentMediaUuid !== mediaUuid;
                const cardTop = insertVideoBeforeSource
                    ? index * 280 + (insertedMediaUuid ? 140 : 0)
                    : index * 140;
                const card = makeVisible(document.createElement('article'), cardTop, 20);
                card.setAttribute('role', 'listitem');
                const link = document.createElement('a');
                link.href = `/imagine/post/${currentMediaUuid}`;
                const image = document.createElement('img');
                image.alt = 'Generated image';
                image.src = `https://assets.grok.com/users/${accountUuid}/generated/${currentMediaUuid}/image.jpg`;
                image.scrollIntoView = () => {};
                link.appendChild(image);
                link.addEventListener('click', (event) => {
                    event.preventDefault();
                    if (!link.isConnected
                        || mountedGeneration !== window.__promptedResultsMountEvidence.currentGeneration) {
                        window.__promptedResultsMountEvidence.rejectedActivations.push({
                            identity: mediaUuid,
                            mountedGeneration,
                            currentGeneration: window.__promptedResultsMountEvidence.currentGeneration,
                            isConnected: link.isConnected
                        });
                        return;
                    }
                    const previousIdentity = window.__promptedResultsEvents.opened.at(-1) || null;
                    if (previousIdentity) getItemEvents(previousIdentity).nextIdentity = mediaUuid;
                    getItemEvents(mediaUuid).openIdentity = mediaUuid;
                    window.__promptedResultsMountEvidence.openedGenerations.push({
                        identity: mediaUuid,
                        generation: mountedGeneration
                    });
                    window.__promptedResultsEvents.opened.push(mediaUuid);
                    renderDetail(mediaUuid);
                });
                card.appendChild(link);
                const action = document.createElement('button');
                action.setAttribute('aria-label', wasConverted ? 'Video Options' : 'Make video');
                card.appendChild(action);
                list.appendChild(card);
            });
            document.body.append(nativePrompt, list);
        };

        window.history.replaceState({}, '', resultsUrl);
        renderResults();
    }, {
        accountUuid,
        mediaUuids,
        insertVideoBeforeSource: insertVideoBeforeSource || insertGeneratedBeforeSource,
        deferGeneratedResult
    });
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

async function installTask8SavedWorkflowTracker(page) {
    await page.evaluate(() => {
        if (window.__task8WorkflowTracker) return;

        const { scraper } = window.__gptE2e;
        const activeWorkflows = new Set();
        const determineModeAndExecute = scraper.determineModeAndExecute.bind(scraper);
        const originalDateNow = Date.now;
        let clock = Date.now();

        Date.now = () => clock;
        scraper.sleep = async (delay = 0) => {
            clock += Number(delay) || 0;
            await Promise.resolve();
        };
        scraper.determineModeAndExecute = (...args) => {
            const workflow = Promise.resolve().then(() => determineModeAndExecute(...args));
            activeWorkflows.add(workflow);
            void workflow.finally(() => activeWorkflows.delete(workflow)).catch(() => {});
            return workflow;
        };
        window.__task8WorkflowTracker = {
            activeWorkflows,
            advance: (milliseconds) => { clock += milliseconds; },
            restore: () => { Date.now = originalDateNow; }
        };
    });
}

async function settleTask8Controller(page) {
    return page.evaluate(async () => {
        const { scraper, retry } = window.__gptE2e;
        const tracker = window.__task8WorkflowTracker;
        if (tracker) tracker.advance(120000);
        else window.__task8AdvanceClock?.(120000);

        const namedPromises = [
            window.__task8PromptedWorkflow,
            window.__stopDuringTransfer,
            window.__stopDuringReturn,
            scraper?._lastStoppedRun?.cleanupPromise,
            scraper?._activeStopReturn?.promise,
            scraper?._returnToSavedInFlight?.promise
        ].filter((candidate) => candidate && typeof candidate.then === 'function');
        if (namedPromises.length > 0) await Promise.allSettled(namedPromises);

        for (let attempt = 0; attempt < 100; attempt++) {
            const active = tracker ? [...tracker.activeWorkflows] : [];
            if (active.length > 0) await Promise.allSettled(active);
            await Promise.resolve();
            await new Promise((resolve) => setTimeout(resolve, 0));

            const idle = (!tracker || tracker.activeWorkflows.size === 0)
                && (window.__chromeRuntimePendingCount || 0) === 0
                && !scraper?._returnToSavedInFlight
                && !scraper?._activeStopReturn;
            if (idle) break;
        }

        return {
            scraperIdle: scraper?.state?.isRunning !== true,
            batchIdle: retry?.batchRunning !== true && retry?.batchRunToken == null,
            activeWorkflows: tracker?.activeWorkflows.size || 0,
            pendingRuntimeResponses: window.__chromeRuntimePendingCount || 0,
            returnInFlight: Boolean(scraper?._returnToSavedInFlight),
            stopReturnInFlight: Boolean(scraper?._activeStopReturn)
        };
    });
}

function expectTask8ControllerIdle(settlement) {
    expect(settlement).toEqual({
        scraperIdle: true,
        batchIdle: true,
        activeWorkflows: 0,
        pendingRuntimeResponses: 0,
        returnInFlight: false,
        stopReturnInFlight: false
    });
}

async function readSavedNegativeEvidence(page) {
    return page.evaluate(() => ({
        openedIdentities: [...(window.__savedOpenedIdentities || [])],
        processedIds: [...(window.__chromeStorageLocalState.processedIds || [])],
        processedWrites: window.__chromeEvents.filter((event) => (
            event.type === 'storage_set'
            && event.area === 'local'
            && Object.prototype.hasOwnProperty.call(event.values || {}, 'processedIds')
        )),
        transferCount: window.__chromeRuntimeMessages.filter((message) => (
            message.action === 'DOWNLOAD_MEDIA'
        )).length
    }));
}

async function expectNoLateSavedMutation(page, expectedOpenedIdentities, expectedTransferCount) {
    expectTask8ControllerIdle(await settleTask8Controller(page));
    const before = await readSavedNegativeEvidence(page);
    expectTask8ControllerIdle(await settleTask8Controller(page));
    const after = await readSavedNegativeEvidence(page);
    expect(after.openedIdentities).toEqual(expectedOpenedIdentities);
    expect(after.openedIdentities).toEqual(before.openedIdentities);
    expect(after.transferCount).toBe(expectedTransferCount);
    expect(after.transferCount).toBe(before.transferCount);
    expect(after.processedIds).toEqual([]);
    expect(after.processedWrites).toEqual([]);
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
            window.__chromeRuntimePendingCount = 0;
            window.__chromeStorageSetObservers = [];
            window.__chromeStorageChangeListeners = [];
            window.__chromeStorageLocalState = localState;
            window.__chromeStorageSyncState = syncState;
            window.__recordChromeEvent = record;
            const setLocalStorage = (data) => {
                record('storage_set', { area: 'local', values: clone(data || {}) });
                const changes = Object.fromEntries(Object.entries(data || {}).map(([key, value]) => [
                    key,
                    { oldValue: clone(localState[key]), newValue: clone(value) }
                ]));
                Object.assign(localState, data || {});
                window.__chromeStorageSetObservers.forEach((observer) => observer(clone(data || {})));
                window.__chromeStorageChangeListeners.forEach((listener) => listener(changes, 'local'));
            };
            const getRuntimeResponse = (message) => {
                const responseByAction = window.__chromeRuntimeResponseByAction || {};
                const action = message?.action;
                if (Object.prototype.hasOwnProperty.call(responseByAction, action)) {
                    const configured = responseByAction[action];
                    return typeof configured === 'function' ? configured(message) : configured;
                }
                if (action === 'GET_SCRAPE_DURABILITY') {
                    return {
                        status: 'durable',
                        inFlightTasks: 0,
                        pendingDownloads: 0,
                        pendingOperations: 0,
                        pendingQueueItems: 0,
                        failedItems: 0
                    };
                }
                if (action === 'VALIDATE_CLOUD_CONFIG') return { valid: true };
                if (action === 'VALIDATE_SCRAPE_RESUME') return { valid: true, reason: 'active_owner' };
                if (action === 'SCRAPE_RUN_STATE_WRITE') {
                    setLocalStorage(message.values || {});
                    return { status: 'ok' };
                }
                if (action === 'PROCESSED_IDS_ADD' || action === 'SCRAPE_PROCESSED_IDS_ADD') {
                    const processedIds = Array.from(new Set([
                        ...(Array.isArray(localState.processedIds) ? localState.processedIds : []),
                        ...(Array.isArray(message.ids) ? message.ids : [])
                    ].filter(Boolean)));
                    setLocalStorage({ processedIds });
                    return { status: 'ok', processedIds };
                }
                if (action === 'PROCESSED_IDS_RESET') {
                    setLocalStorage({ processedIds: [] });
                    return { status: 'ok', processedIds: [] };
                }
                if (action === 'GPT_PROMPTED_VIDEO_NATIVE_CLICK') {
                    const click = message.click || {};
                    const target = window.__resolvePromptedBatchNativeClickTarget?.(click.x, click.y);
                    if (!target || target.disabled || target.getAttribute('aria-disabled') === 'true') {
                        return { ok: false, error: 'native_click_invalid' };
                    }
                    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((eventName) => {
                        const EventCtor = eventName.startsWith('pointer') && window.PointerEvent
                            ? window.PointerEvent
                            : window.MouseEvent;
                        target.dispatchEvent(new EventCtor(eventName, {
                            bubbles: true,
                            cancelable: true,
                            clientX: click.x,
                            clientY: click.y,
                            button: 0
                        }));
                    });
                    return { ok: true };
                }
                if (action === 'SCRAPE_COMPLETE' || action === 'R2_BACKUP_COMPLETE') {
                    const stopReason = message.stats?.stopReason || 'complete';
                    const values = {
                        scraperState: 'idle',
                        currentIndex: 0,
                        scrapeRunToken: null,
                        scrapeRunEpoch: null,
                        scrapeNavigation: null,
                        currentItemId: null,
                        scrapeBackupOptions: null,
                        isScraping: false,
                        isR2Backup: false,
                        scrapeStopReason: stopReason
                    };
                    if (action === 'R2_BACKUP_COMPLETE') {
                        values.r2BackupState = {
                            ...(localState.r2BackupState || {}),
                            isRunning: false,
                            stopReason
                        };
                    }
                    setLocalStorage(values);
                    return { status: 'ok' };
                }
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
                        window.__chromeRuntimePendingCount++;
                        return Promise.resolve(response).then((value) => {
                            const copiedResponse = clone(value);
                            record('runtime_response', { action: message?.action, response: copiedResponse });
                            if (callback) callback(copiedResponse);
                            return copiedResponse;
                        }).finally(() => {
                            window.__chromeRuntimePendingCount--;
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
                        addListener: (listener) => window.__chromeStorageChangeListeners.push(listener),
                        removeListener: (listener) => {
                            window.__chromeStorageChangeListeners = window.__chromeStorageChangeListeners
                                .filter((candidate) => candidate !== listener);
                        }
                    },
                    local: {
                        get: (keys, cb) => {
                            const result = readStorage(localState, keys);
                            if (cb) cb(result);
                            return Promise.resolve(result);
                        },
                        set: (data, cb) => {
                            setLocalStorage(data);
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

    test('Saved completion waits through pending durability responses before reporting complete', async ({ page }) => {
        await evaluateExtensionContent(page);
        await page.evaluate(() => {
            const { scraper } = window.__gptE2e;
            scraper.state.isRunning = true;
            scraper.runToken = 'e2e-durability-sync';
            scraper.runEpoch = 41;
            scraper.backupMode = false;
            scraper.sleep = () => Promise.resolve();
            window.__durabilityChecks = [];
            let checks = 0;
            window.__chromeRuntimeResponseByAction.GET_SCRAPE_DURABILITY = () => {
                checks++;
                window.__durabilityChecks.push({
                    check: checks,
                    completionSent: window.__chromeRuntimeMessages.some((message) => (
                        message.action === 'SCRAPE_COMPLETE' || message.action === 'R2_BACKUP_COMPLETE'
                    ))
                });
                if (checks <= 2) {
                    return {
                        status: 'pending',
                        inFlightTasks: checks === 1 ? 1 : 0,
                        pendingDownloads: 0,
                        pendingOperations: checks === 2 ? 1 : 0,
                        pendingQueueItems: 0,
                        failedItems: 0
                    };
                }
                return {
                    status: 'durable',
                    inFlightTasks: 0,
                    pendingDownloads: 0,
                    pendingOperations: 0,
                    pendingQueueItems: 0,
                    failedItems: 0
                };
            };
            window.__durabilityCompletion = scraper.stop('complete');
        });

        await expect.poll(() => page.evaluate(() => window.__durabilityChecks.length)).toBe(3);
        await page.evaluate(() => window.__durabilityCompletion);

        expect(await page.evaluate(() => window.__durabilityChecks)).toEqual([
            { check: 1, completionSent: false },
            { check: 2, completionSent: false },
            { check: 3, completionSent: false }
        ]);
        const actions = await page.evaluate(() => window.__chromeRuntimeMessages.map((message) => message.action));
        expect(actions.filter((action) => action === 'GET_SCRAPE_DURABILITY')).toHaveLength(3);
        expect(actions.filter((action) => action === 'SCRAPE_COMPLETE')).toHaveLength(1);
        expect(actions.indexOf('SCRAPE_COMPLETE')).toBeGreaterThan(actions.lastIndexOf('GET_SCRAPE_DURABILITY'));
    });

    test('failed durability keeps Saved backup pending telemetry and never reports Complete', async ({ page }) => {
        await evaluateExtensionContent(page);
        await page.evaluate(() => {
            const { scraper } = window.__gptE2e;
            scraper.state.isRunning = true;
            scraper.runToken = 'e2e-durability-backup';
            scraper.runEpoch = 42;
            scraper.backupMode = true;
            scraper.backupStats = {
                totalSeen: 1,
                uploaded: 0,
                alreadyPresent: 0,
                queued: 1,
                pendingTransfers: 0,
                errors: 0
            };
            window.__chromeRuntimeResponseByAction.GET_SCRAPE_DURABILITY = {
                status: 'failed',
                inFlightTasks: 0,
                pendingDownloads: 0,
                pendingOperations: 1,
                pendingQueueItems: 0,
                failedItems: 1
            };
            window.__durabilityCompletion = scraper.stopBackupMode('complete');
        });

        await page.evaluate(() => window.__durabilityCompletion);
        const completion = await page.evaluate(() => window.__chromeRuntimeMessages.find((message) => (
            message.action === 'R2_BACKUP_COMPLETE'
        )));

        expect(completion.stats).toMatchObject({
            stopReason: 'durability_failed',
            queued: 1,
            pendingTransfers: 1
        });
        expect(completion.stats.stopReason).not.toBe('complete');
    });

    test('virtualized Saved backup transfers thirty mixed identities once before durable exhaustion', async ({ page }) => {
        const accountUuid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
        const mediaUuids = Array.from({ length: 30 }, (_, index) => (
            `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
        ));

        await evaluateExtensionContent(page);
        await setupVirtualizedSavedBackup(page, {
            accountUuid,
            mediaUuids,
            runToken: 'e2e-virtualized-saved-backup'
        });
        await expect(page.evaluate(() => window.__gptE2e.scraper.startBackupMode({
            ...window.__gptE2eRunLease,
            mode: 'full'
        }))).resolves.toMatchObject({ status: 'started' });

        await expect.poll(() => page.evaluate(() => (
            window.__chromeStorageLocalState.r2BackupState?.stopReason || null
        )), { timeout: 15000 }).toBe('complete');
        const result = await page.evaluate(() => {
            const completionIndex = window.__chromeRuntimeMessages.findIndex((message) => (
                message.action === 'R2_BACKUP_COMPLETE'
            ));
            const lastDurabilityIndex = window.__chromeRuntimeMessages.findLastIndex((message) => (
                message.action === 'GET_SCRAPE_DURABILITY'
            ));
            const completion = window.__chromeRuntimeMessages[completionIndex];
            const scan = window.__chromeStorageLocalState.r2BackupState?.scan;
            window.__restoreVirtualDateNow();
            return {
                transfers: window.__virtualTransfers,
                agentScrollCalls: window.__virtualAgentScrollCalls,
                validReceiptReturns: window.__virtualValidReceiptReturns,
                firstUnchangedBottom: window.__virtualFirstUnchangedBottom,
                completionIndex,
                lastDurabilityIndex,
                completion,
                scan,
                savedScrollCalls: window.__virtualSavedScrollCalls
            };
        });

        expect(result.transfers).toHaveLength(30);
        expect(new Set(result.transfers.map((transfer) => transfer.identity))).toEqual(new Set(mediaUuids));
        expect(result.transfers.some((transfer) => transfer.isVideo)).toBe(true);
        expect(result.transfers.some((transfer) => !transfer.isVideo)).toBe(true);
        expect(result.agentScrollCalls).toEqual([]);
        expect(result.validReceiptReturns).toBe(30);
        expect(result.firstUnchangedBottom).toEqual({ transferCount: 30, completionSeen: false });
        expect(result.completion.stats).toMatchObject({ totalSeen: 30, stopReason: 'complete' });
        expect(result.completionIndex).toBeGreaterThan(result.lastDurabilityIndex);
        expect(result.savedScrollCalls.length).toBeGreaterThan(8);
        expect(result.savedScrollCalls.every((call, index) => call.durabilityChecks >= index + 1)).toBe(true);
        expect(result.scan).toMatchObject({
            totalUniqueSeen: 30,
            durableIdentityCount: 30,
            stableBottomRounds: 8
        });
        expect(Object.keys(result.scan).sort()).toEqual([
            'durableIdentityCount',
            'lastNewIdentityAt',
            'scanAttempts',
            'stableBottomRounds',
            'totalUniqueSeen',
            'updatedAt'
        ]);
        expect(Object.values(result.scan).every(Number.isFinite)).toBe(true);
        expect(Object.values(result.scan).some(Array.isArray)).toBe(false);
    });

    test('virtualized Saved Cloud-only sync durably transfers thirty alternating Agent assets', async ({ page }) => {
        const accountUuid = 'abababab-abab-4bab-8bab-abababababab';
        const mediaUuids = Array.from({ length: 30 }, (_, index) => (
            `30000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
        ));

        await evaluateExtensionContent(page);
        await setupVirtualizedSavedSync(page, {
            accountUuid,
            mediaUuids,
            runToken: 'e2e-virtualized-cloud-only-sync'
        });
        await expect(page.evaluate(() => window.__gptE2e.scraper.start(
            window.__gptE2eRunLease
        ))).resolves.toMatchObject({ status: 'started' });

        await expect.poll(() => page.evaluate(() => (
            window.__virtualSyncEvidence.completionReason
        )), { timeout: 15000 }).toBe('complete');
        const evidence = await page.evaluate(() => {
            const result = {
                ...window.__virtualSyncEvidence,
                processedIds: [...(window.__chromeStorageLocalState.processedIds || [])]
            };
            window.__restoreVirtualSyncDateNow();
            return result;
        });
        const expectedProcessedIds = mediaUuids.map((identity) => (
            `https://assets.grok.com/users/${accountUuid}/generated/${identity}/image.jpg`
        ));

        expect(new Set(evidence.transferredIdentities).size).toBe(30);
        expect(evidence.transferredIdentities).toHaveLength(30);
        expect(evidence.transferredIdentities).toEqual(mediaUuids);
        expect(evidence.mediaTypes).toEqual(Array.from(
            { length: 30 },
            (_, index) => index % 2 === 1 ? 'video' : 'image'
        ));
        expect(evidence.agentGalleryScrollCalls).toBe(0);
        expect(evidence.openedIdentities).toEqual(mediaUuids);
        expect(evidence.openedGenerations.map(({ identity }) => identity)).toEqual(mediaUuids);
        expect(evidence.openedGenerations.every(({ generation }, index, entries) => (
            index === 0 || generation > entries[index - 1].generation
        ))).toBe(true);
        expect(evidence.rejectedActivations).toEqual([]);
        expect(evidence.validReceiptReturns).toBe(30);
        expect(new Set(evidence.savedRenderGenerations).size).toBe(
            evidence.savedRenderGenerations.length
        );
        expect(evidence.savedRenderGenerations.length).toBeGreaterThan(30);
        expect(evidence.processedIds).toEqual(expectedProcessedIds);
        expect(evidence.completionReason).toBe('complete');
    });

    test('virtualized Saved Dual-write sync persists three IDs only after downloads become R2-present', async ({ page }) => {
        const accountUuid = 'bcbcbcbc-bcbc-4cbc-8cbc-bcbcbcbcbcbc';
        const mediaUuids = [
            '30000000-0000-4000-8000-000000000003',
            '30000000-0000-4000-8000-000000000014',
            '30000000-0000-4000-8000-000000000025'
        ];
        const runToken = 'e2e-virtualized-dual-write-sync';
        const productionBackground = await createProductionDualWriteHarness({
            runToken,
            mediaUuids
        });

        try {
            await page.exposeFunction(
                '__productionBackgroundRequest',
                (message) => productionBackground.request(message)
            );
            await evaluateExtensionContent(page);
            await setupVirtualizedSavedSync(page, {
                accountUuid,
                mediaUuids,
                runToken,
                transferMode: 'dual_write'
            });
            await expect(page.evaluate(() => window.__gptE2e.scraper.start(
                window.__gptE2eRunLease
            ))).resolves.toMatchObject({ status: 'started' });

            await expect.poll(() => page.evaluate(() => (
                window.__virtualSyncEvidence.completionReason
            )), { timeout: 15000 }).not.toBeNull();
            await productionBackground.settle();
            const pageEvidence = await page.evaluate(() => {
                const result = { ...window.__virtualSyncEvidence };
                window.__restoreVirtualSyncDateNow();
                return result;
            });
            const evidence = {
                ...pageEvidence,
                ...productionBackground.evidence()
            };
            expect({
                completionReason: evidence.completionReason,
                durabilitySnapshots: evidence.durabilitySnapshots,
                pendingOperations: evidence.pendingOperations
            }).toMatchObject({
                completionReason: 'complete',
                pendingOperations: {}
            });
            expect(evidence.transferredIdentities).toEqual(mediaUuids);
            expect(evidence.openedGenerations.map(({ identity }) => identity)).toEqual(mediaUuids);
            expect(evidence.openedGenerations.every(({ generation }, index, entries) => (
                index === 0 || generation > entries[index - 1].generation
            ))).toBe(true);
            expect(evidence.rejectedActivations).toEqual([]);
            expect(evidence.processedBeforeDurability).toEqual([]);
            expect(evidence.processedAfterDurability).toEqual(mediaUuids);
            expect(evidence.processedIds).toEqual(mediaUuids);
            expect(evidence.processedWrites).toBe(3);
            expect(evidence.pendingOperations).toEqual({});
            expect(evidence.completionReason).toBe('complete');
            expect(evidence.productionRequestActions.filter((action) => (
                action === 'DOWNLOAD_MEDIA'
            ))).toHaveLength(3);
            expect(evidence.productionRequestActions).toContain('GET_SCRAPE_DURABILITY');
            for (const identity of mediaUuids) {
                const queuedIndex = evidence.productionBackgroundTransitions.indexOf(`queued:${identity}`);
                const downloadIndex = evidence.productionBackgroundTransitions.indexOf(
                    `download_complete:${identity}`
                );
                const r2Index = evidence.productionBackgroundTransitions.indexOf(`r2_present:${identity}`);
                const processedIndex = evidence.productionBackgroundTransitions.indexOf(`processed:${identity}`);
                expect(queuedIndex).toBeGreaterThanOrEqual(0);
                expect(downloadIndex).toBeGreaterThan(queuedIndex);
                expect(r2Index).toBeGreaterThan(downloadIndex);
                expect(processedIndex).toBeGreaterThan(r2Index);
            }
        } finally {
            productionBackground.dispose();
        }
    });

    test('virtualized Saved backup reports scan_limit after all one thousand guarded attempts', async ({ page }) => {
        await evaluateExtensionContent(page);
        const result = await page.evaluate(async () => {
            const { scraper } = window.__gptE2e;
            const identity = '20000000-0000-4000-8000-000000000001';
            let clock = 1900000000000;
            let scrollCalls = 0;
            const originalDateNow = Date.now;
            Date.now = () => clock;
            scraper.sleep = async (delay = 0) => { clock += Number(delay) || 0; };
            scraper.state.isRunning = true;
            scraper.runToken = 'e2e-virtualized-scan-limit';
            scraper.runEpoch = 1;
            scraper.backupMode = true;
            scraper.backupOptions = { mode: 'full', limit: null, options: {} };
            scraper.backupStats = {
                totalSeen: 0,
                uploaded: 0,
                alreadyPresent: 0,
                queued: 0,
                pendingTransfers: 0,
                errors: 0,
                startedAt: clock
            };
            scraper._backupVisited = new Set([
                `https://assets.grok.com/users/account/generated/${identity}/image.jpg`
            ]);
            scraper._runVisited = new Set();
            scraper._savedScanLedger = null;
            document.body.innerHTML = `
                <div>
                    <button class="bg-primary text-background hover:bg-primary">All</button>
                    <button>Liked</button>
                </div>
                <div id="limit-scroller" class="overflow-scroll">
                    <div role="list">
                        <article role="listitem">
                            <img alt="Generated image"
                                src="https://assets.grok.com/users/account/generated/${identity}/image.jpg">
                        </article>
                    </div>
                    <div id="limit-loader" role="progressbar" style="display:block;width:10px;height:10px"></div>
                </div>`;
            const scroller = document.querySelector('#limit-scroller');
            Object.defineProperties(scroller, {
                scrollTop: { configurable: true, value: 0, writable: true },
                scrollHeight: { configurable: true, value: 600 },
                clientHeight: { configurable: true, value: 600 }
            });
            scroller.scrollBy = () => { scrollCalls++; };
            await scraper.executeListView(scraper.runToken);
            Date.now = originalDateNow;
            const completion = window.__chromeRuntimeMessages.findLast((message) => (
                message.action === 'R2_BACKUP_COMPLETE'
            ));
            return {
                scrollCalls,
                completion,
                transferCount: window.__chromeRuntimeMessages.filter((message) => (
                    message.action === 'R2_BACKUP_UPLOAD'
                )).length
            };
        });

        expect(result.scrollCalls).toBe(1000);
        expect(result.transferCount).toBe(0);
        expect(result.completion.stats.stopReason).toBe('scan_limit');
        expect(result.completion.stats.stopReason).not.toBe('complete');
    });

    test('cold reinjection registers one scraper listener before deferred hydration completes', async ({ page }) => {
        await page.evaluate(providerRegistryJs);
        await page.evaluate(providerRunLedgerJs);
        await page.evaluate(chatGptImagesContentJs);
        await page.evaluate(utilsJs);
        await page.evaluate(contentActionsJs);
        await page.evaluate(() => {
            const originalGet = chrome.storage.local.get.bind(chrome.storage.local);
            const pendingGets = [];
            window.__chromeRuntimeResponseByAction.VALIDATE_SCRAPE_RESUME = {
                valid: false,
                reason: 'stale_authority'
            };
            window.__chromeRuntimeResponseByAction.SCRAPE_RUN_STATE_WRITE = {
                status: 'ignored',
                reason: 'stale_authority'
            };
            chrome.storage.local.get = (keys, callback) => new Promise((resolve, reject) => {
                pendingGets.push(() => {
                    originalGet(keys, callback).then(resolve, reject);
                });
            });
            window.__releaseDeferredContentHydration = () => {
                pendingGets.splice(0).forEach((release) => release());
            };
        });

        await page.evaluate(contentJs);
        const firstSnapshot = await page.evaluate(() => {
            window.__firstInjectedScraper = window.__gptPowerToolsRuntime.scraper;
            return {
                listenerCount: window.__chromeMessageListeners.length,
                hasPendingHydration: Boolean(window.__gptPowerToolsRuntime.scraper._initPromise)
            };
        });

        await page.evaluate(contentJs);
        const immediate = await page.evaluate(() => {
            const responses = [];
            const message = { action: 'INIT_SCRAPE', runToken: 'injected-run', runEpoch: 31 };
            const accepted = window.__chromeMessageListeners.filter((listener) => (
                listener(message, { tab: { id: 42 } }, (response) => responses.push(response)) === true
            ));
            return {
                listenerCount: window.__chromeMessageListeners.length,
                sameInstance: window.__firstInjectedScraper === window.__gptPowerToolsRuntime.scraper,
                acceptedCount: accepted.length,
                pendingLease: window.__gptPowerToolsRuntime.scraper._pendingInitLease,
                responseCount: responses.length
            };
        });

        expect(firstSnapshot.hasPendingHydration).toBe(true);
        expect(immediate).toMatchObject({
            listenerCount: firstSnapshot.listenerCount,
            sameInstance: true,
            acceptedCount: 1,
            pendingLease: {
                kind: 'sync',
                runToken: 'injected-run',
                runEpoch: 31
            },
            responseCount: 0
        });

        await page.evaluate(() => window.__releaseDeferredContentHydration());
        await expect.poll(() => page.evaluate(() => window.__chromeStorageLocalState.scraperState))
            .toBeUndefined();
    });

    test('cold detail-page Stop returns to Saved before deferred hydration completes', async ({ page }) => {
        const navigation = {
            runToken: 'cold-detail-run',
            runEpoch: 32,
            galleryUrl: 'https://grok.com/imagine/saved',
            savedViewportReceipt: null
        };
        await page.evaluate(providerRegistryJs);
        await page.evaluate(providerRunLedgerJs);
        await page.evaluate(chatGptImagesContentJs);
        await page.evaluate(utilsJs);
        await page.evaluate(contentActionsJs);
        await page.evaluate((stopNavigation) => {
            window.history.replaceState({}, '', '/imagine/post/cold-detail');
            const originalGet = chrome.storage.local.get.bind(chrome.storage.local);
            const pendingGets = [];
            chrome.storage.local.get = (keys, callback) => new Promise((resolve, reject) => {
                pendingGets.push(() => originalGet(keys, callback).then(resolve, reject));
            });
            window.__releaseDeferredContentHydration = () => {
                pendingGets.splice(0).forEach((release) => release());
            };
            window.__historyBackCalls = 0;
            Object.defineProperty(window.history, 'back', {
                configurable: true,
                value: () => {
                    window.__historyBackCalls++;
                    window.history.replaceState({}, '', stopNavigation.galleryUrl);
                }
            });
        }, navigation);

        await page.evaluate(contentJs);
        const responses = await dispatchRuntimeMessage(page, {
            action: 'ABORT_SCRAPE',
            runToken: navigation.runToken,
            runEpoch: navigation.runEpoch,
            stopNavigation: navigation
        });

        expect(responses).toContainEqual({ status: 'stopped' });
        expect(await page.evaluate(() => window.__historyBackCalls)).toBe(1);
        expect(await page.evaluate(() => window.location.pathname)).toBe('/imagine/saved');
        expect(await page.evaluate(() => window.__gptPowerToolsRuntime.scraper.state.isRunning)).toBe(false);
        await page.evaluate(() => window.__releaseDeferredContentHydration());
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
        expect(runtimeMessages).toContainEqual({
            action: 'START_R2_BACKUP',
            mode: 'canary',
            limit: 1,
            options: { stopAfterMediaAttempt: true },
            acceptance: {
                runId: 'run-20260609-001',
                correlationId: 'corr-1',
                keyPrefix: 'acceptance/run-20260609-001'
            }
        });
        expect(runtimeMessages).not.toContainEqual(expect.objectContaining({
            action: 'VALIDATE_CLOUD_CONFIG'
        }));
    });

    test('Start Sync queues the exact Saved media without content-side persistence', async ({ page }) => {
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

        await expect(await page.evaluate(() => window.__gptE2e.scraper.start(window.__gptE2eRunLease))).toEqual({
            status: 'started',
            surface: 'saved_gallery',
            runToken: 'e2e-start-sync',
            runEpoch: 1
        });

        await expect.poll(async () => page.evaluate(() => ({
            currentItemId: window.__chromeStorageLocalState.currentItemId,
            scrapeNavigation: window.__chromeStorageLocalState.scrapeNavigation,
            scraperState: window.__chromeStorageLocalState.scraperState
        }))).toEqual({
            currentItemId: null,
            scrapeNavigation: null,
            scraperState: 'idle'
        });

        const runtimeMessages = await page.evaluate(() => window.__chromeRuntimeMessages);
        expect(runtimeMessages).toContainEqual({
            action: 'DOWNLOAD_MEDIA',
            runToken: 'e2e-start-sync',
            runEpoch: 1,
            kind: 'sync',
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
        const navigationClearIndex = transferEvents.findIndex((event, index) =>
            index > scrollRestoreIndex
            && event.type === 'storage_set'
            && event.area === 'local'
            && event.values.scrapeNavigation === null
            && event.values.currentItemId === null
        );
        expect(navigationSetIndex).toBeGreaterThanOrEqual(0);
        expect(downloadMessageIndex).toBeGreaterThan(navigationSetIndex);
        expect(queuedResponseIndex).toBeGreaterThan(downloadMessageIndex);
        expect(processedIdIndex).toBe(-1);
        expect(scrollRestoreIndex).toBeGreaterThan(queuedResponseIndex);
        expect(navigationClearIndex).toBeGreaterThan(scrollRestoreIndex);
        expect(await page.evaluate(() => ({
            currentItemId: window.__chromeStorageLocalState.currentItemId,
            scrapeNavigation: window.__chromeStorageLocalState.scrapeNavigation,
            processedIds: window.__chromeStorageLocalState.processedIds
        }))).toEqual({
            currentItemId: null,
            scrapeNavigation: null,
            processedIds: undefined
        });
    });

    test('Start Sync activates Grok 2 Saved cards with the full pointer sequence', async ({ page }) => {
        const accountUuid = '14141414-1414-4414-8414-141414141414';
        const firstMediaUuid = '25252525-2525-4525-8525-252525252525';
        const secondMediaUuid = '36363636-3636-4636-8636-363636363636';

        await evaluateExtensionContent(page);
        await setupMockSavedAgentSync(page, {
            accountUuid,
            mediaUuids: [firstMediaUuid, secondMediaUuid],
            responseByAction: {
                GET_CLOUD_CONFIG: { config: { mode: 'local_only' } },
                DOWNLOAD_MEDIA: { status: 'queued' }
            },
            runToken: 'e2e-grok2-saved-activation',
            savedActivationMode: 'full_pointer_sequence'
        });

        await expect(await page.evaluate(() => window.__gptE2e.scraper.start(window.__gptE2eRunLease))).toEqual({
            status: 'started',
            surface: 'saved_gallery',
            runToken: 'e2e-grok2-saved-activation',
            runEpoch: 1
        });

        await expect.poll(async () => page.evaluate(() => window.__chromeRuntimeMessages.some((message) => (
            message.action === 'DOWNLOAD_MEDIA'
        )))).toBe(true);
        await expect.poll(async () => page.evaluate(() => window.__historyBackCalls)).toBe(1);
        expect(await page.evaluate(() => window.__savedActivationEvents.at(-1)?.events || [])).toEqual([
            'pointerdown',
            'mousedown',
            'pointerup',
            'mouseup',
            'click'
        ]);
        expect(await page.evaluate(() => window.__chromeStorageLocalState.scrapeStopReason)).not.toBe(
            'surface_transition_timeout'
        );
    });

    test('Cloud-only Start Sync returns through two current Grok post videos', async ({ page }) => {
        const accountUuid = '47474747-4747-4747-8747-474747474747';
        const firstMediaUuid = '58585858-5858-4858-8858-585858585858';
        const secondMediaUuid = '69696969-6969-4969-8969-696969696969';

        await evaluateExtensionContent(page);
        await setupMockSavedLegacyDetailSync(page, {
            accountUuid,
            mediaUuids: [firstMediaUuid, secondMediaUuid],
            runToken: 'e2e-two-legacy-details',
            liveVideoContract: true
        });

        await expect(await page.evaluate(() => window.__gptE2e.scraper.start(window.__gptE2eRunLease))).toEqual({
            status: 'started',
            surface: 'saved_gallery',
            runToken: 'e2e-two-legacy-details',
            runEpoch: 1
        });

        await expect.poll(async () => page.evaluate(() => ({
            scraperState: window.__chromeStorageLocalState.scraperState,
            stopReason: window.__chromeStorageLocalState.scrapeStopReason
        }))).toEqual({
            scraperState: 'idle',
            stopReason: 'e2e_after_two_legacy_returns'
        });

        const events = await page.evaluate(() => window.__legacyDetailEvents);
        expect(events.opened).toEqual([firstMediaUuid, secondMediaUuid]);
        expect(events.transfers).toEqual([
            `https://assets.grok.com/users/${accountUuid}/generated/${firstMediaUuid}/generated_video.mp4`,
            `https://assets.grok.com/users/${accountUuid}/generated/${secondMediaUuid}/generated_video.mp4`
        ]);
        expect(events.returned).toEqual([firstMediaUuid, secondMediaUuid]);
        expect(events.backControlEvents).toEqual([]);
        expect(events.thumbnailClicks).toEqual([]);
        await expect(page).toHaveURL('https://grok.com/imagine/saved');

        const transferMessages = await page.evaluate(() => window.__chromeRuntimeMessages.filter((message) => (
            message.action === 'DOWNLOAD_MEDIA'
        )));
        expect(transferMessages).toHaveLength(2);
        expect(transferMessages).toEqual(expect.arrayContaining([
            expect.objectContaining({
                runToken: 'e2e-two-legacy-details',
                kind: 'sync',
                url: expect.stringContaining(firstMediaUuid),
                blobDataUrl: expect.stringMatching(/^data:image\/jpeg;base64,/)
            }),
            expect.objectContaining({
                runToken: 'e2e-two-legacy-details',
                kind: 'sync',
                url: expect.stringContaining(secondMediaUuid),
                blobDataUrl: expect.stringMatching(/^data:image\/jpeg;base64,/)
            })
        ]));
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

        await expect(await page.evaluate(() => window.__gptE2e.scraper.start(window.__gptE2eRunLease))).toEqual({
            status: 'started',
            surface: 'saved_gallery',
            runToken: 'e2e-agent-ambiguity',
            runEpoch: 1
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
        await expectNoLateSavedMutation(page, [expectedMediaUuid], 0);
    });

    test('gallery return timeout causes no late next-item action or processed-ID mutation', async ({ page }) => {
        const accountUuid = 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd';
        const mediaUuids = [
            '40000000-0000-4000-8000-000000000001',
            '40000000-0000-4000-8000-000000000002'
        ];

        await evaluateExtensionContent(page);
        await setupMockSavedAgentSync(page, {
            accountUuid,
            mediaUuids,
            responseByAction: {
                GET_CLOUD_CONFIG: { config: { mode: 'dual_write' } },
                DOWNLOAD_MEDIA: { status: 'queued' }
            },
            runToken: 'e2e-gallery-return-timeout',
            stopAfterNavigationClear: false
        });
        await page.evaluate(() => {
            const { scraper } = window.__gptE2e;
            scraper.Config.historyWait = 1;
            const waitForSurface = scraper.waitForSurface.bind(scraper);
            let waitCalls = 0;
            scraper.waitForSurface = (...args) => {
                waitCalls++;
                return waitCalls === 2 ? Promise.resolve(null) : waitForSurface(...args);
            };
            scraper.navigateToGalleryUrl = () => {
                throw new Error('mock gallery return timeout');
            };
        });
        await page.evaluate(() => window.__gptE2e.scraper.start(window.__gptE2eRunLease));

        await expect.poll(() => page.evaluate(() => (
            window.__chromeStorageLocalState.scrapeStopReason
        ))).toBe('gallery_return_failed');
        await expectNoLateSavedMutation(page, [mediaUuids[0]], 1);
    });

    test('durability failure causes no late next-item action or processed-ID mutation', async ({ page }) => {
        const accountUuid = 'dededede-dede-4ede-8ede-dededededede';
        const mediaUuid = '40000000-0000-4000-8000-000000000003';
        const runToken = 'e2e-sync-durability-failure';
        const productionBackground = await createProductionDualWriteHarness({
            runToken,
            mediaUuids: [mediaUuid],
            terminalOutcome: 'failed'
        });

        try {
            await page.exposeFunction(
                '__productionBackgroundRequest',
                (message) => productionBackground.request(message)
            );
            await evaluateExtensionContent(page);
            await setupVirtualizedSavedSync(page, {
                accountUuid,
                mediaUuids: [mediaUuid],
                runToken,
                transferMode: 'dual_write'
            });
            await page.evaluate(() => {
                window.__savedOpenedIdentities = window.__virtualSyncEvidence.openedIdentities;
                let stopRequested = false;
                window.__chromeStorageSetObservers.push((values) => {
                    if (stopRequested
                        || values.scrapeNavigation !== null
                        || values.currentItemId !== null
                        || Object.keys(values).length !== 2) {
                        return;
                    }
                    stopRequested = true;
                    void window.__gptE2e.scraper.stop('complete');
                });
            });
            await page.evaluate(() => window.__gptE2e.scraper.start(window.__gptE2eRunLease));

            await expect.poll(() => page.evaluate(() => (
                window.__virtualSyncEvidence.completionReason
            ))).toBe('durability_failed');
            await expectNoLateSavedMutation(page, [mediaUuid], 1);
            expect(productionBackground.evidence().processedIds).toEqual([]);
            await page.evaluate(() => window.__restoreVirtualSyncDateNow());
        } finally {
            productionBackground.dispose();
        }
    });

    test('Stop after source click causes no late next-item action or processed-ID mutation', async ({ page }) => {
        const accountUuid = 'efefefef-efef-4fef-8fef-efefefefefef';
        const mediaUuids = [
            '40000000-0000-4000-8000-000000000004',
            '40000000-0000-4000-8000-000000000005'
        ];

        await evaluateExtensionContent(page);
        await setupMockSavedAgentSync(page, {
            accountUuid,
            mediaUuids,
            responseByAction: {
                GET_CLOUD_CONFIG: { config: { mode: 'cloud_only' } },
                DOWNLOAD_MEDIA: { status: 'uploaded' }
            },
            runToken: 'e2e-stop-after-source-click',
            stopAfterNavigationClear: false
        });
        await page.evaluate(() => {
            const { scraper } = window.__gptE2e;
            const waitForSurface = scraper.waitForSurface.bind(scraper);
            let stopped = false;
            scraper.waitForSurface = async (...args) => {
                if (!stopped && window.location.pathname.startsWith('/imagine/agent/')) {
                    stopped = true;
                    await scraper.stop('e2e_stop_after_source_click');
                    return null;
                }
                return waitForSurface(...args);
            };
        });
        await page.evaluate(() => window.__gptE2e.scraper.start(window.__gptE2eRunLease));

        await expect.poll(() => page.evaluate(() => (
            window.__chromeStorageLocalState.scrapeStopReason
        ))).toBe('e2e_stop_after_source_click');
        await expectNoLateSavedMutation(page, [mediaUuids[0]], 0);
    });

    test('Stop during transfer causes no late next-item action or processed-ID mutation', async ({ page }) => {
        const accountUuid = 'fafafafa-fafa-4afa-8afa-fafafafafafa';
        const mediaUuids = [
            '40000000-0000-4000-8000-000000000006',
            '40000000-0000-4000-8000-000000000007'
        ];

        await evaluateExtensionContent(page);
        await setupMockSavedAgentSync(page, {
            accountUuid,
            mediaUuids,
            responseByAction: {
                GET_CLOUD_CONFIG: { config: { mode: 'cloud_only' } }
            },
            runToken: 'e2e-stop-during-transfer',
            stopAfterNavigationClear: false,
            bridgeResponse: {
                dataUrl: 'data:image/jpeg;base64,c3RvcC1kdXJpbmctdHJhbnNmZXI=',
                size: 20,
                type: 'image/jpeg'
            }
        });
        await page.evaluate(() => {
            window.__chromeRuntimeResponseByAction.DOWNLOAD_MEDIA = () => new Promise((resolve) => {
                window.__resolveStoppedTransfer = resolve;
            });
        });
        await page.evaluate(() => window.__gptE2e.scraper.start(window.__gptE2eRunLease));
        await expect.poll(() => page.evaluate(() => (
            typeof window.__resolveStoppedTransfer === 'function'
        ))).toBe(true);
        await page.evaluate(() => {
            const { scraper } = window.__gptE2e;
            window.__stopDuringTransfer = scraper.stop('e2e_stop_during_transfer');
            window.__resolveStoppedTransfer({ status: 'uploaded' });
        });
        await page.evaluate(() => window.__stopDuringTransfer);

        await expectNoLateSavedMutation(page, [mediaUuids[0]], 1);
    });

    test('Stop during return causes no late next-item action or processed-ID mutation', async ({ page }) => {
        const accountUuid = 'acacacac-acac-4cac-8cac-acacacacacac';
        const mediaUuids = [
            '40000000-0000-4000-8000-000000000008',
            '40000000-0000-4000-8000-000000000009'
        ];

        await evaluateExtensionContent(page);
        await setupMockSavedAgentSync(page, {
            accountUuid,
            mediaUuids,
            responseByAction: {
                GET_CLOUD_CONFIG: { config: { mode: 'dual_write' } },
                DOWNLOAD_MEDIA: { status: 'queued' }
            },
            runToken: 'e2e-stop-during-return',
            stopAfterNavigationClear: false
        });
        await page.evaluate(() => {
            const { scraper } = window.__gptE2e;
            const historyBack = window.history.back.bind(window.history);
            let stopped = false;
            Object.defineProperty(window.history, 'back', {
                configurable: true,
                value: () => {
                    if (!stopped) {
                        stopped = true;
                        window.__stopDuringReturn = scraper.stop('e2e_stop_during_return');
                    }
                    historyBack();
                }
            });
        });
        await page.evaluate(() => window.__gptE2e.scraper.start(window.__gptE2eRunLease));
        await expect.poll(() => page.evaluate(() => Boolean(window.__stopDuringReturn))).toBe(true);
        await page.evaluate(() => window.__stopDuringReturn);

        await expectNoLateSavedMutation(page, [mediaUuids[0]], 1);
    });

    test('extension-context invalidation causes no late next-item action or processed-ID mutation', async ({ page }) => {
        const accountUuid = 'bdbdbdbd-bdbd-4dbd-8dbd-bdbdbdbdbdbd';
        const mediaUuids = [
            '40000000-0000-4000-8000-000000000010',
            '40000000-0000-4000-8000-000000000011'
        ];

        await evaluateExtensionContent(page);
        await setupMockSavedAgentSync(page, {
            accountUuid,
            mediaUuids,
            responseByAction: {
                GET_CLOUD_CONFIG: { config: { mode: 'cloud_only' } }
            },
            runToken: 'e2e-extension-context-invalidation',
            stopAfterNavigationClear: false,
            bridgeResponse: {
                dataUrl: 'data:image/jpeg;base64,aW52YWxpZGF0ZWQtY29udGV4dA==',
                size: 19,
                type: 'image/jpeg'
            }
        });
        await page.evaluate(() => {
            const sendMessage = window.chrome.runtime.sendMessage.bind(window.chrome.runtime);
            window.chrome.runtime.sendMessage = (message, callback) => {
                if (message?.action === 'DOWNLOAD_MEDIA') {
                    window.__invalidatedTransferAttempts = (
                        window.__invalidatedTransferAttempts || 0
                    ) + 1;
                    throw new Error('Extension context invalidated.');
                }
                return sendMessage(message, callback);
            };
        });
        await page.evaluate(() => window.__gptE2e.scraper.start(window.__gptE2eRunLease));

        await expect.poll(() => page.evaluate(() => window.__gptE2e.scraper.state.isRunning)).toBe(false);
        await expectNoLateSavedMutation(page, [mediaUuids[0]], 0);
        expect(await page.evaluate(() => window.__invalidatedTransferAttempts)).toBe(1);
        expect(await page.evaluate(() => (
            window.__gptE2e.overlay.el.querySelector('#gptStatusBadge')?.textContent
        ))).toBe('Grok Power Tools reloaded. Refresh this Grok tab before continuing.');
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

        await expect(await page.evaluate(() => window.__gptE2e.scraper.start(window.__gptE2eRunLease))).toEqual({
            status: 'started',
            surface: 'saved_gallery',
            runToken: 'e2e-cloud-only',
            runEpoch: 1
        });

        await expect.poll(async () => page.evaluate(() => window.__chromeStorageLocalState.processedIds || [])).toEqual([savedUrl]);
        const runtimeMessages = await page.evaluate(() => window.__chromeRuntimeMessages);
        expect(runtimeMessages).toContainEqual({ action: 'GET_CLOUD_CONFIG' });
        expect(runtimeMessages).toContainEqual({
            action: 'DOWNLOAD_MEDIA',
            runToken: 'e2e-cloud-only',
            runEpoch: 1,
            kind: 'sync',
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

        await page.evaluate(() => window.__gptE2e.scraper.start(window.__gptE2eRunLease));
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

        await page.evaluate(() => window.__gptE2e.scraper.start(window.__gptE2eRunLease));
        await expect.poll(async () => page.evaluate(() => window.__chromeStorageLocalState.scraperState)).toBe('idle');
        expect(await page.evaluate(() => window.__chromeStorageLocalState.processedIds || [])).toEqual([]);
        expect(await page.evaluate(() => window.__chromeRuntimeMessages)).toContainEqual(expect.objectContaining({
            action: 'DOWNLOAD_MEDIA',
            blobDataUrl
        }));
    });

    test('R2 presence skips Grok bytes and persists only after the read-only proof', async ({ page }) => {
        const accountUuid = '01234567-89ab-4cde-8fab-0123456789ab';
        const mediaUuid = 'fedcba98-7654-4cba-8fed-cba987654321';
        const backupProcessedId = `media_${mediaUuid}`;
        const acceptance = { runId: 'e2e-r2-run', correlationId: 'e2e-r2-correlation' };

        await evaluateExtensionContent(page);
        await setupMockSavedAgentSync(page, {
            accountUuid,
            mediaUuids: [mediaUuid],
            responseByAction: {
                VALIDATE_CLOUD_CONFIG: { valid: true },
                R2_BACKUP_CHECK_PRESENT: { status: 'already_present', assetId: backupProcessedId }
            },
            runToken: 'e2e-r2-backup'
        });

        await expect(page.evaluate((acceptance) => window.__gptE2e.scraper.startBackupMode({
            ...window.__gptE2eRunLease,
            mode: 'full',
            acceptance
        }), acceptance)).resolves.toEqual({
            status: 'started',
            surface: 'saved_gallery',
            runToken: 'e2e-r2-backup',
            runEpoch: 1
        });
        await expect.poll(async () => page.evaluate(() => window.__chromeStorageLocalState.processedIds || [])).toContain(backupProcessedId);

        const runtimeMessages = await page.evaluate(() => window.__chromeRuntimeMessages);
        expect(runtimeMessages).toContainEqual({ action: 'VALIDATE_CLOUD_CONFIG' });
        expect(runtimeMessages).toContainEqual({
            action: 'R2_BACKUP_CHECK_PRESENT',
            runToken: 'e2e-r2-backup',
            runEpoch: 1,
            kind: 'r2_backup',
            url: `https://assets.grok.com/users/${accountUuid}/generated/${mediaUuid}/preview.jpg`,
            isVideo: false
        });
        expect(runtimeMessages).not.toContainEqual(expect.objectContaining({ action: 'R2_BACKUP_UPLOAD' }));

        const backupEvents = await page.evaluate(() => window.__chromeEvents);
        const acknowledgementIndex = backupEvents.findIndex((event) =>
            event.type === 'runtime_response'
            && event.action === 'R2_BACKUP_CHECK_PRESENT'
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
                R2_BACKUP_CHECK_PRESENT: { status: 'missing' },
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
            ...window.__gptE2eRunLease,
            mode: 'full'
        }))).resolves.toEqual({
            status: 'started',
            surface: 'saved_gallery',
            runToken: 'e2e-r2-upload-error',
            runEpoch: 1
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
            runToken: 'e2e-r2-upload-error',
            runEpoch: 1,
            kind: 'r2_backup',
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

    test('Prompted Batch routes Saved media through Add Prompt and scoped Grok 2.0 Send', async ({ page }) => {
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
                selectedSubmitDisabled: document.getElementById(selectedInputId)
                    ?.parentElement?.querySelector('button[aria-label="Send"]')?.disabled ?? null,
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
                selectedSubmitDisabled: true,
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
        expect(events.agentAssetClicks).toEqual([mediaUuid, secondMediaUuid]);
        expect(events.agentToolbarActionCount).toBe(0);
        expect(events.menuChoices).toEqual(['Add Prompt', 'Add Prompt']);
        expect(events.menuMediaUuids).toEqual([mediaUuid, secondMediaUuid]);
        expect(events.promptWrites).toEqual(['slow orbit around the generated sculpture']);
        expect(events.promptWriteResults).toEqual([true]);
        expect(events.promptAtSubmit).toBe('slow orbit around the generated sculpture');
        expect(events.submitCount).toBe(1);
        expect(events.resultCount).toBe(1);
        expect(events.resultAssetIds).toEqual([`asset-${mediaUuid}`]);
        expect(events.editCount).toBe(0);
        expect(await page.evaluate(() => window.__chromeRuntimeMessages
            .filter((message) => message.action === 'GPT_PROMPTED_VIDEO_NATIVE_CLICK')))
            .toHaveLength(2);
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
        await expect(page.locator(
            `#selected-generation-bar-${secondMediaUuid} button[aria-label="Send"]`
        )).toBeDisabled();
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

    test('Prompted Batch processes a generated-results grid without selecting Precise Edit', async ({ page }) => {
        const accountUuid = '91919191-9191-4919-8919-919191919191';
        const mediaUuids = [
            '92929292-9292-4929-8929-929292929292',
            '93939393-9393-4939-8939-939393939393',
            '94949494-9494-4949-8949-949494949494',
            '95959595-9595-4959-8959-959595959595'
        ];
        const processedMediaUuids = mediaUuids.slice(0, 2);

        await evaluateExtensionContent(page);
        await page.evaluate(bridgeJs);
        await setupMockPromptedResultsBatch(page, { accountUuid, mediaUuids });

        await expect(page.evaluate(() => window.__gptE2e.retry.startBatch(
            'prompted',
            'slow orbit through warm afternoon light',
            { galleryLimit: 2, videoGoal: 7 }
        ))).resolves.toBe(true);

        const result = await page.evaluate(() => ({
            context: window.__gptE2e.retry.batchContext,
            goalCount: window.__gptE2e.retry.goalCount,
            goalTotal: window.__gptE2e.retry.goalTotal,
            batchRunning: window.__gptE2e.retry.batchRunning,
            pathname: window.location.pathname,
            status: window.__gptE2e.overlay.el.querySelector('#gptStatusBadge')?.textContent,
            resultPostIds: Array.from(document.querySelectorAll('a[href*="/imagine/post/"]'))
                .map((link) => link.href.split('/imagine/post/')[1]),
            events: window.__promptedResultsEvents
        }));
        expect(result).toEqual({
            context: 'results_gallery',
            goalCount: 2,
            goalTotal: 2,
            batchRunning: false,
            pathname: '/imagine',
            status: 'Prompted Batch [results]: Complete (2/2)',
            resultPostIds: mediaUuids.map((mediaUuid, index) => (
                index < processedMediaUuids.length ? `a${mediaUuid.slice(1)}` : mediaUuid
            )),
            events: {
                opened: processedMediaUuids,
                menuChoices: processedMediaUuids,
                submitted: processedMediaUuids.map((mediaUuid) => ({
                    mediaUuid,
                    prompt: 'slow orbit through warm afternoon light'
                })),
                returned: processedMediaUuids,
                preciseEditClicks: 0,
                promptWrites: [
                    'slow orbit through warm afternoon light',
                    'slow orbit through warm afternoon light'
                ]
            }
        });
        expect(await page.evaluate(() => window.__chromeRuntimeMessages
            .filter((message) => message.action === 'GPT_PROMPTED_VIDEO_NATIVE_CLICK')))
            .toHaveLength(4);
    });

    test('Prompted Batch completes five generated results with trusted controls and returns', async ({ page }) => {
        const accountUuid = '71717171-7171-4717-8717-717171717171';
        const mediaUuids = [
            '72727272-7272-4727-8727-727272727272',
            '73737373-7373-4737-8737-737373737373',
            '74747474-7474-4747-8747-747474747474',
            '75757575-7575-4757-8757-757575757575',
            '76767676-7676-4767-8767-767676767676'
        ];

        await evaluateExtensionContent(page);
        await page.evaluate(bridgeJs);
        await setupMockPromptedResultsBatch(page, {
            accountUuid,
            mediaUuids,
            insertVideoBeforeSource: true
        });

        await expect(page.evaluate(() => window.__gptE2e.retry.startBatch(
            'prompted',
            'Subtle natural movement with a slow steady camera push.',
            { galleryLimit: 5, videoGoal: 5 }
        ))).resolves.toBe(true);

        const evidence = await page.evaluate(() => ({
            events: {
                ...window.__promptedResultsEvents,
                items: window.__promptedResultsItemEvents
            },
            mountEvidence: window.__promptedResultsMountEvidence,
            status: window.__gptE2e.overlay.el.querySelector('#gptStatusBadge')?.textContent
        }));
        expect(evidence.events.opened).toEqual(mediaUuids);
        expect(evidence.events.submitted.map(({ mediaUuid }) => mediaUuid)).toEqual(mediaUuids);
        expect(evidence.events.returned).toEqual(mediaUuids);
        expect(evidence.events.preciseEditClicks).toBe(0);
        expect(evidence.events.items).toEqual(mediaUuids.map((sourceIdentity, index) => ({
            sourceIdentity,
            openIdentity: sourceIdentity,
            makeVideoClicks: 1,
            addPromptClicks: 1,
            preciseEditClicks: 0,
            promptWrites: ['Subtle natural movement with a slow steady camera push.'],
            submitClicks: 1,
            submitIdentity: sourceIdentity,
            acceptedConversationId: 'prompted-batch-conversation',
            returnStatus: 'returned',
            returnIdentity: sourceIdentity,
            nextIdentity: mediaUuids[index + 1] || null
        })));
        expect(evidence.mountEvidence.openedGenerations.map(({ identity }) => identity)).toEqual(mediaUuids);
        expect(evidence.mountEvidence.openedGenerations.every(({ generation }, index, entries) => (
            index === 0 || generation > entries[index - 1].generation
        ))).toBe(true);
        expect(evidence.mountEvidence.rejectedActivations).toEqual([]);
        expect(evidence.status).toBe('Prompted Batch [results]: Complete (5/5)');
    });

    test('Stop during prompt write causes no late next-item action or processed-ID mutation', async ({ page }) => {
        const accountUuid = 'cececece-cece-4ece-8ece-cececececece';
        const mediaUuids = [
            '50000000-0000-4000-8000-000000000001',
            '50000000-0000-4000-8000-000000000002'
        ];

        await evaluateExtensionContent(page);
        await page.evaluate(bridgeJs);
        await setupMockPromptedResultsBatch(page, { accountUuid, mediaUuids });
        await page.evaluate(() => {
            document.addEventListener('__gpt_set_prompted_video_content', () => {
                window.__gptE2e.retry.stopBatch();
            }, { once: true });
        });

        await page.evaluate(async () => {
            window.__task8PromptedWorkflow = window.__gptE2e.retry.startBatch(
                'prompted',
                'this write revokes the active prompted batch',
                { galleryLimit: 2, videoGoal: 2 }
            );
            return window.__task8PromptedWorkflow;
        });
        expectTask8ControllerIdle(await settleTask8Controller(page));
        const before = await page.evaluate(() => ({
            events: window.__promptedResultsEvents,
            processedWrites: window.__chromeEvents.filter((event) => (
                event.type === 'storage_set'
                && Object.prototype.hasOwnProperty.call(event.values || {}, 'processedIds')
            ))
        }));
        expectTask8ControllerIdle(await settleTask8Controller(page));
        const after = await page.evaluate(() => ({
            events: window.__promptedResultsEvents,
            processedWrites: window.__chromeEvents.filter((event) => (
                event.type === 'storage_set'
                && Object.prototype.hasOwnProperty.call(event.values || {}, 'processedIds')
            ))
        }));

        expect(after).toEqual(before);
        expect(after.events.opened).toEqual([mediaUuids[0]]);
        expect(after.events.promptWrites).toEqual(['this write revokes the active prompted batch']);
        expect(after.events.submitted).toEqual([]);
        expect(after.events.returned).toEqual([]);
        expect(after.events.preciseEditClicks).toBe(0);
        expect(after.processedWrites).toEqual([]);
    });

    test('Prompted Batch returns and advances while accepted videos generate in the background', async ({ page }) => {
        const accountUuid = '94949494-9494-4949-8949-949494949494';
        const mediaUuids = [
            '95959595-9595-4959-8959-959595959595',
            '96969696-9696-4969-8969-969696969696'
        ];

        await evaluateExtensionContent(page);
        await page.evaluate(bridgeJs);
        await setupMockPromptedResultsBatch(page, {
            accountUuid,
            mediaUuids,
            deferGeneratedResult: true
        });

        await expect(page.evaluate(() => window.__gptE2e.retry.startBatch(
            'prompted',
            'slow orbit through warm afternoon light',
            { galleryLimit: 2, videoGoal: 7 }
        ))).resolves.toBe(true);

        await expect(page.evaluate(() => ({
            goalCount: window.__gptE2e.retry.goalCount,
            batchRunning: window.__gptE2e.retry.batchRunning,
            pathname: window.location.pathname,
            status: window.__gptE2e.overlay.el.querySelector('#gptStatusBadge')?.textContent,
            events: window.__promptedResultsEvents,
            generatedVideos: document.querySelectorAll('video').length
        }))).resolves.toEqual({
            goalCount: 2,
            batchRunning: false,
            pathname: '/imagine',
            status: 'Prompted Batch [results]: Complete (2/2)',
            events: {
                opened: mediaUuids,
                menuChoices: mediaUuids,
                submitted: mediaUuids.map((mediaUuid) => ({
                    mediaUuid,
                    prompt: 'slow orbit through warm afternoon light'
                })),
                returned: mediaUuids,
                preciseEditClicks: 0,
                promptWrites: [
                    'slow orbit through warm afternoon light',
                    'slow orbit through warm afternoon light'
                ]
            },
            generatedVideos: 0
        });
        expect(await page.evaluate(() => window.__chromeRuntimeMessages
            .filter((message) => message.action === 'GPT_PROMPTED_VIDEO_NATIVE_CLICK')))
            .toHaveLength(4);
    });

    test('Prompted Batch continues after Grok inserts each generated video before its source image', async ({ page }) => {
        const accountUuid = 'a1919191-9191-4919-8919-919191919191';
        const mediaUuids = [
            'b2929292-9292-4929-8929-929292929292',
            'b3939393-9393-4939-8939-939393939393',
            'b4949494-9494-4949-8949-949494949494'
        ];

        await evaluateExtensionContent(page);
        await page.evaluate(bridgeJs);
        await setupMockPromptedResultsBatch(page, {
            accountUuid,
            mediaUuids,
            insertGeneratedBeforeSource: true
        });

        await expect(page.evaluate(() => window.__gptE2e.retry.startBatch(
            'prompted',
            'slow orbit through warm afternoon light',
            { galleryLimit: 3, videoGoal: 7 }
        ))).resolves.toBe(true);

        await expect(page.evaluate(() => ({
            goalCount: window.__gptE2e.retry.goalCount,
            goalTotal: window.__gptE2e.retry.goalTotal,
            batchRunning: window.__gptE2e.retry.batchRunning,
            status: window.__gptE2e.overlay.el.querySelector('#gptStatusBadge')?.textContent,
            events: window.__promptedResultsEvents
        }))).resolves.toEqual({
            goalCount: 3,
            goalTotal: 3,
            batchRunning: false,
            status: 'Prompted Batch [results]: Complete (3/3)',
            events: {
                opened: mediaUuids,
                menuChoices: mediaUuids,
                submitted: mediaUuids.map((mediaUuid) => ({
                    mediaUuid,
                    prompt: 'slow orbit through warm afternoon light'
                })),
                returned: mediaUuids,
                preciseEditClicks: 0,
                promptWrites: [
                    'slow orbit through warm afternoon light',
                    'slow orbit through warm afternoon light',
                    'slow orbit through warm afternoon light'
                ]
            }
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

        await expect(await page.evaluate(() => window.__gptE2e.scraper.start(window.__gptE2eRunLease))).toEqual({
            status: 'started',
            surface: 'saved_gallery',
            runToken: 'e2e-stop-agent-wait',
            runEpoch: 1
        });
        await expect.poll(async () => page.evaluate(() => window.__chromeStorageLocalState.scraperState)).toBe('idle');

        const runtimeMessages = await page.evaluate(() => window.__chromeRuntimeMessages);
        expect(runtimeMessages).not.toContainEqual(expect.objectContaining({ action: 'DOWNLOAD_MEDIA' }));
        expect(await page.evaluate(() => window.__chromeStorageLocalState.processedIds || [])).toEqual([]);
        expect(await page.evaluate(() => window.__agentScrollCalls)).toEqual([]);
        await expect.poll(async () => page.evaluate(() => window.location.pathname)).toBe('/imagine/saved');
        expect(await page.evaluate(() => window.__historyBackCalls)).toBe(1);
        expect(await page.evaluate(() => window.__savedScrollWrites)).toEqual([
            { phase: 'returned', value: 360 }
        ]);
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

test('unpacked extension keeps the real service-worker response port open during startup', async () => {
    const extensionRoot = path.join(__dirname, '../..');
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-powertools-e2e-'));
    let context;
    try {
        context = await chromium.launchPersistentContext(userDataDir, {
            channel: 'chromium',
            headless: true,
            args: [
                `--disable-extensions-except=${extensionRoot}`,
                `--load-extension=${extensionRoot}`
            ]
        });
        let [serviceWorker] = context.serviceWorkers();
        if (!serviceWorker) serviceWorker = await context.waitForEvent('serviceworker');
        const extensionId = new URL(serviceWorker.url()).host;
        const extensionPage = await context.newPage();
        await extensionPage.goto(`chrome-extension://${extensionId}/popup.html`);

        const response = await extensionPage.evaluate(() => new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({
                action: 'PROCESSED_IDS_ADD',
                ids: ['service-worker-port-proof']
            }, (value) => {
                const error = chrome.runtime.lastError;
                if (error) reject(new Error(error.message));
                else resolve(value);
            });
        }));
        const stored = await extensionPage.evaluate(() => chrome.storage.local.get(['processedIds']));

        expect(response).toEqual({
            status: 'ok',
            processedIds: ['service-worker-port-proof']
        });
        expect(stored.processedIds).toEqual(['service-worker-port-proof']);
    } finally {
        if (context) await context.close();
        fs.rmSync(userDataDir, { recursive: true, force: true });
    }
});
