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
                link.href = `/imagine/post/${mediaUuid}?conversation=11111111-1111-4111-8111-111111111111`;
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

module.exports = {
    setupRemountingQuickBatch
};
