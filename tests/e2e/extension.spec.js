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
    insertGeneratedBeforeSource = false,
    deferGeneratedResult = false
}) {
    await page.evaluate(({
        accountUuid,
        mediaUuids,
        insertGeneratedBeforeSource,
        deferGeneratedResult
    }) => {
        const { retry } = window.__gptE2e;
        const resultsUrl = 'https://grok.com/imagine';
        const promptText = 'slow orbit through warm afternoon light';
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
        retry.sleep = () => Promise.resolve();
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
        window.__promptedResultsReplacements = {};
        window.__promptedResultsCompleted = {};
        document.addEventListener('__gpt_set_prompted_video_content', (event) => {
            window.__promptedResultsEvents.promptWrites.push(event.detail.text);
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
            window.history.pushState({}, '', `/imagine/post/${mediaUuid}`);
            document.body.innerHTML = '';

            const preciseEdit = makeVisible(document.createElement('button'));
            preciseEdit.setAttribute('aria-label', 'Edit');
            preciseEdit.textContent = 'Precise Edit';
            preciseEdit.addEventListener('click', () => {
                window.__promptedResultsEvents.preciseEditClicks++;
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
                        window.__promptedResultsEvents.submitted.push({
                            mediaUuid,
                            prompt: input.textContent
                        });
                        submit.disabled = true;
                        if (!deferGeneratedResult) {
                            if (insertGeneratedBeforeSource) {
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
                    window.history.replaceState({}, '', resultsUrl);
                    renderResults();
                });
            });
            document.body.append(preciseEdit, makeVideo, back);
        };

        const renderResults = () => {
            document.body.innerHTML = '';
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
                const cardTop = insertGeneratedBeforeSource
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
    }, { accountUuid, mediaUuids, insertGeneratedBeforeSource, deferGeneratedResult });
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
            action: 'R2_BACKUP_UPLOAD',
            runToken: 'e2e-r2-backup',
            runEpoch: 1,
            kind: 'r2_backup',
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
