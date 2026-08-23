async function setupRemountingQuickBatch(page, {
    accountUuid,
    mediaUuids,
    restoreActionsAtMs = 5000
}) {
    await page.evaluate(({
        accountUuid,
        mediaUuids,
        restoreActionsAtMs
    }) => {
        window.history.replaceState({}, '', '/imagine');
        window.__quickBatchEvents = {
            accepted: [],
            clicks: [],
            duplicateClicks: [],
            logicalMs: 0,
            mounts: 0
        };

        const accepted = new Set();
        let actionsAvailable = true;
        const galleryId = 'gpt-quick-batch-fixture';
        const conversationId = '11111111-1111-4111-8111-111111111111';
        window.__gptConversationInventoryResponse = () => ({
            ...window.__buildConversationInventory({
                conversationId,
                accountUuid,
                assets: mediaUuids.map((assetId) => ({ assetId }))
            }),
            videoGenerationResponses: Array.from(accepted).map((assetId) => ({
                responseId: assetId.replace(/^62/, '63'),
                parentResponseId: assetId
            }))
        });
        window.__resolvePromptedBatchNativeClickTarget = (x, y) => Array.from(
            document.querySelectorAll(`${galleryId.startsWith('#') ? galleryId : `#${galleryId}`} button[aria-label="Make video"]`)
        ).find((candidate) => {
            const rect = candidate.getBoundingClientRect();
            return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
        }) || null;
        document.elementFromPoint = window.__resolvePromptedBatchNativeClickTarget;

        const render = () => {
            document.getElementById(galleryId)?.remove();
            const gallery = document.createElement('div');
            gallery.id = galleryId;
            gallery.setAttribute('role', 'list');
            window.__quickBatchEvents.mounts++;

            mediaUuids.forEach((mediaUuid, index) => {
                const card = document.createElement('div');
                card.setAttribute('role', 'listitem');
                card.dataset.sourceAssetId = mediaUuid;

                const link = document.createElement('a');
                link.href = `/imagine/post/${mediaUuid}?conversation=${conversationId}`;
                const image = document.createElement('img');
                image.alt = 'Generated image';
                image.src = `https://assets.grok.com/users/${accountUuid}/generated/${mediaUuid}/image.jpg`;
                link.appendChild(image);
                card.appendChild(link);

                if (accepted.has(mediaUuid)) {
                    const progress = document.createElement('button');
                    progress.setAttribute('aria-label', 'Video Options');
                    card.appendChild(progress);
                } else if (actionsAvailable) {
                    const makeVideo = document.createElement('button');
                    makeVideo.setAttribute('aria-label', 'Make video');
                    makeVideo.dataset.sourceAssetId = mediaUuid;
                    makeVideo.getBoundingClientRect = () => ({
                        x: (index % 4) * 220 + 20,
                        y: Math.floor(index / 4) * 260 + 180,
                        top: Math.floor(index / 4) * 260 + 180,
                        left: (index % 4) * 220 + 20,
                        right: (index % 4) * 220 + 180,
                        bottom: Math.floor(index / 4) * 260 + 220,
                        width: 160,
                        height: 40
                    });
                    makeVideo.addEventListener('click', () => {
                        window.__quickBatchEvents.clicks.push(mediaUuid);
                        if (accepted.has(mediaUuid)) {
                            window.__quickBatchEvents.duplicateClicks.push(mediaUuid);
                            return;
                        }
                        accepted.add(mediaUuid);
                        window.__quickBatchEvents.accepted.push(mediaUuid);
                        actionsAvailable = false;
                        render();
                        queueMicrotask(() => {
                            actionsAvailable = true;
                            render();
                        });
                    });
                    card.appendChild(makeVideo);
                }

                Object.defineProperty(card, 'getBoundingClientRect', {
                    configurable: true,
                    value: () => ({
                        x: (index % 4) * 220,
                        y: Math.floor(index / 4) * 260,
                        top: Math.floor(index / 4) * 260,
                        left: (index % 4) * 220,
                        right: ((index % 4) * 220) + 200,
                        bottom: (Math.floor(index / 4) * 260) + 240,
                        width: 200,
                        height: 240
                    })
                });
                gallery.appendChild(card);
            });

            document.body.appendChild(gallery);
        };

        const advanceProviderClock = (milliseconds) => {
            window.__quickBatchEvents.logicalMs += Math.max(0, Number(milliseconds) || 0);
            if (!actionsAvailable
                && window.__quickBatchEvents.logicalMs >= restoreActionsAtMs
                && accepted.size < mediaUuids.length) {
                actionsAvailable = true;
                render();
            }
        };

        window.__advanceQuickBatchProviderClock = advanceProviderClock;
        window.__gptE2e.retry.sleep = async (milliseconds) => {
            advanceProviderClock(milliseconds);
            await Promise.resolve();
        };
        render();
    }, { accountUuid, mediaUuids, restoreActionsAtMs });
}

async function setupVideoGoalFixture(page, {
    sourceAssetId,
    sourcePostId,
    resultAssetIds,
    mode = 'success'
}) {
    await page.evaluate(({
        sourceAssetId,
        sourcePostId,
        resultAssetIds,
        mode
    }) => {
        const sourceUrl = `https://assets.grok.com/users/example/generated/${sourceAssetId}/image.jpg`;
        const decoyAssetId = 'deca0000-0000-4000-8000-000000000001';
        const acceptedSignals = [];
        const failedSignals = [];
        const mountedResults = [];
        let attempt = 0;
        let successIndex = 0;

        window.history.replaceState(
            {},
            '',
            `/imagine/agent/${sourceAssetId}?conversation=${sourcePostId}`
        );
        window.sessionStorage.setItem('gptCurrentGrokSourceHint', JSON.stringify({
            sourceAssetId,
            sourcePostId,
            conversationId: sourcePostId,
            capturedAt: Date.now()
        }));
        window.__videoGoalEvents = {
            clicks: [],
            remounts: 0,
            acceptedSignals,
            failedSignals,
            mountedResults,
            stopRequested: false
        };
        window.__gptConversationInventoryResponse = () => ({
            ...window.__buildConversationInventory({
                conversationId: sourcePostId,
                accountUuid: 'example',
                assets: [
                    { assetId: sourceAssetId },
                    ...mountedResults.map((assetId) => ({ assetId, mediaKind: 'video' }))
                ]
            }),
            failureCount: failedSignals.length,
            failedResponses: failedSignals.map((failureAttempt) => ({
                responseId: `cf000000-0000-4000-8000-${String(failureAttempt).padStart(12, '0')}`,
                parentResponseId: sourceAssetId
            })),
            assets: [
                {
                    assetId: sourceAssetId,
                    responseId: sourceAssetId,
                    parentResponseId: '',
                    mediaKind: 'image',
                    sourceUrl,
                    promptText: 'candid friends at the beach',
                    assetMetadata: { assetId: sourceAssetId, mimeType: 'image/jpeg' },
                    mediaGenInput: { prompt: 'candid friends at the beach' }
                },
                ...mountedResults.map((assetId) => ({
                    assetId,
                    responseId: assetId,
                    parentResponseId: sourceAssetId,
                    mediaKind: 'video',
                    sourceUrl: `https://assets.grok.com/users/example/generated/${assetId}/video.mp4`,
                    promptText: 'candid friends at the beach',
                    assetMetadata: { assetId, mimeType: 'video/mp4' },
                    mediaGenInput: { prompt: 'candid friends at the beach' }
                }))
            ]
        });

        const makeVisible = (element, top = 80, left = 80, width = 180, height = 42) => {
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

        const appendPlayableVideo = (root, resultAssetId) => {
            const video = document.createElement('video');
            video.src = `https://assets.grok.com/users/example/generated/${resultAssetId}/video.mp4`;
            Object.defineProperties(video, {
                readyState: { configurable: true, value: 2 },
                duration: { configurable: true, value: 6 },
                videoWidth: { configurable: true, value: 400 },
                videoHeight: { configurable: true, value: 736 }
            });
            root.appendChild(video);
        };

        const render = () => {
            document.body.innerHTML = '';
            window.__videoGoalEvents.remounts++;

            const decoy = document.createElement('div');
            decoy.className = 'react-flow__node-asset';
            decoy.setAttribute('data-id', `asset-${decoyAssetId}`);
            const decoyImage = document.createElement('img');
            decoyImage.src = `https://assets.grok.com/users/example/generated/${decoyAssetId}/image.jpg`;
            decoy.appendChild(decoyImage);

            const source = document.createElement('div');
            source.className = 'react-flow__node-asset selected';
            source.setAttribute('data-id', `asset-${sourceAssetId}`);
            source.setAttribute('data-source-asset-id', sourceAssetId);
            source.setAttribute('data-source-post-id', sourcePostId);
            const image = document.createElement('img');
            image.src = sourceUrl;
            source.appendChild(image);
            acceptedSignals.forEach(() => {
                const accepted = document.createElement('button');
                accepted.setAttribute('aria-label', 'Video Options');
                source.appendChild(accepted);
            });
            failedSignals.forEach(() => {
                const failed = document.createElement('div');
                failed.setAttribute('role', 'alert');
                failed.textContent = 'Video generation failed';
                source.appendChild(failed);
            });
            mountedResults.forEach((resultAssetId) => appendPlayableVideo(source, resultAssetId));

            const action = makeVisible(document.createElement('button'));
            action.setAttribute('aria-label', 'Make Video');
            action.setAttribute('data-state', 'closed');
            action.addEventListener('click', () => {
                attempt++;
                window.__videoGoalEvents.clicks.push({
                    attempt,
                    sourceAssetId,
                    sourcePostId
                });
                queueMicrotask(() => {
                    if (mode === 'retry_once' && attempt === 1) {
                        failedSignals.push(attempt);
                    } else {
                        acceptedSignals.push(attempt);
                        if (mode === 'ambiguous') {
                            mountedResults.push(...resultAssetIds.slice(0, 2));
                        } else if (mode !== 'pending') {
                            const resultAssetId = resultAssetIds[successIndex++];
                            if (resultAssetId) mountedResults.push(resultAssetId);
                        }
                    }
                    render();
                });
            });

            const toolbar = document.createElement('div');
            toolbar.className = 'react-flow__node-toolbar';
            toolbar.setAttribute('data-id', `asset-${sourceAssetId}`);
            toolbar.appendChild(action);

            document.body.append(decoy, source, toolbar);
        };

        window.__resolvePromptedBatchNativeClickTarget = (x, y) => {
            const action = document.querySelector('button[aria-label="Make Video"]');
            if (!action) return null;
            const rect = action.getBoundingClientRect();
            return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
                ? action
                : null;
        };
        document.elementFromPoint = window.__resolvePromptedBatchNativeClickTarget;
        window.__mountVideoGoalResult = (resultAssetId) => {
            if (!mountedResults.includes(resultAssetId)) mountedResults.push(resultAssetId);
            render();
        };
        render();
    }, { sourceAssetId, sourcePostId, resultAssetIds, mode });
}

module.exports = {
    setupRemountingQuickBatch,
    setupVideoGoalFixture
};
