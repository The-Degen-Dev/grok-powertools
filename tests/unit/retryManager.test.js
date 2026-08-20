const { VideoRetryManager } = require('../../content.js');

const originalPointerEvent = global.PointerEvent;

function createSettingsManager(overrides = {}) {
    const settings = {
        maxRetries: 3,
        retryCooldown: 0,
        autoRetryEnabled: true,
        videoGoal: 3,
        galleryBatchLimit: 2,
        ...overrides
    };
    return {
        settings,
        get: jest.fn((key) => settings[key]),
        subscribe: jest.fn()
    };
}

function makeVisible(element, rect = {}) {
    jest.spyOn(element, 'getBoundingClientRect').mockReturnValue({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 40,
        bottom: 40,
        width: 40,
        height: 40,
        ...rect
    });
    return element;
}

let promptedVideoFixtureId = 0;

function appendReadyVideoResult(sourceUrl, root = document.body) {
    const resultId = ++promptedVideoFixtureId;
    const target = root.querySelector?.('.react-flow__node-asset.selected') || root;
    const video = document.createElement('video');
    video.src = sourceUrl.replace(/\/[^/]*(?:\?.*)?$/, `/generated_video_${resultId}.mp4`);
    Object.defineProperty(video, 'readyState', { configurable: true, value: 2 });
    target.appendChild(video);
    const complete = document.createElement('button');
    complete.setAttribute('aria-label', 'Video Generation Complete');
    document.body.appendChild(complete);
    return video;
}

function openLinkedMenu(trigger, menu) {
    const fixtureId = ++promptedVideoFixtureId;
    if (!trigger.id) trigger.id = `make-video-trigger-${fixtureId}`;
    if (!menu.id) menu.id = `make-video-menu-${fixtureId}`;
    trigger.setAttribute('aria-controls', menu.id);
    trigger.setAttribute('aria-expanded', 'true');
    trigger.setAttribute('data-state', 'open');
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-labelledby', trigger.id);
    menu.setAttribute('data-state', 'open');
    if (!menu.isConnected) document.body.appendChild(menu);
    return menu;
}

function createMenuItem(label, onClick = null) {
    const item = makeVisible(document.createElement('div'));
    item.setAttribute('role', 'menuitem');
    item.textContent = label;
    if (onClick) item.addEventListener('click', onClick);
    return item;
}

function mountFocusedPromptedVideoComposer({ root = null, onSubmit = null } = {}) {
    const composer = root || document.createElement('div');
    composer.className = 'query-bar';
    composer.style.display = '';
    const input = document.createElement('div');
    input.setAttribute('contenteditable', 'true');
    input.setAttribute('role', 'textbox');
    input.setAttribute('aria-label', 'Ask Grok anything');
    input.tabIndex = -1;
    const submit = makeVisible(document.createElement('button'));
    submit.setAttribute('aria-label', 'Make video');
    if (onSubmit) submit.addEventListener('click', onSubmit);
    composer.append(input, submit);
    if (!composer.isConnected) document.body.appendChild(composer);
    input.focus();
    return { composer, input, submit };
}

function mountFocusedGrok2VideoComposer({
    selectedMode = 'Video',
    includeResolution = true,
    includeDuration = true,
    submitDisabled = false,
    onSubmit = null
} = {}) {
    const composer = document.createElement('div');
    const input = document.createElement('div');
    input.setAttribute('contenteditable', 'true');
    input.setAttribute('role', 'textbox');
    input.setAttribute('aria-label', 'Ask Grok anything');
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

    const mode = createRadioGroup('Generation mode', ['Image', 'Video', 'Agent'], selectedMode);
    const resolution = createRadioGroup('Video resolution', ['480p', '720p', '1080p'], '480p');
    const duration = createRadioGroup('Video duration', ['6s', '10s', '15s'], '6s');
    const submit = makeVisible(document.createElement('button'));
    submit.setAttribute('aria-label', 'Send');
    submit.disabled = submitDisabled;
    if (onSubmit) submit.addEventListener('click', onSubmit);

    composer.append(input, mode);
    if (includeResolution) composer.appendChild(resolution);
    if (includeDuration) composer.appendChild(duration);
    composer.appendChild(submit);
    document.body.appendChild(composer);
    input.focus();
    return { composer, input, submit };
}

function createSavedBatchCard(sourceUrl, onImageClick = null) {
    if (window.location.pathname === '/imagine/saved'
        && !document.querySelector('[data-test-saved-scope]')) {
        mountSavedScope('all');
    }
    const card = document.createElement('div');
    card.setAttribute('role', 'listitem');
    const image = document.createElement('img');
    image.alt = 'Generated image';
    image.src = sourceUrl;
    image.scrollIntoView = jest.fn();
    if (onImageClick) image.addEventListener('click', onImageClick);
    const makeVideo = document.createElement('button');
    makeVideo.setAttribute('aria-label', 'Make video');
    card.append(image, makeVideo);
    document.body.appendChild(card);
    return { card, image, makeVideo };
}

function createCurrentSavedBatchCard(sourceId) {
    const listItem = document.createElement('div');
    listItem.setAttribute('role', 'listitem');
    listItem.setAttribute('data-masonry-key', sourceId);
    const card = document.createElement('div');
    card.className = 'relative group/media-post-masonry-card';
    const mediaBranch = document.createElement('div');
    const image = document.createElement('img');
    image.alt = '';
    image.src = `https://assets.grok.com/users/example/generated/${sourceId}/image.jpg`;
    mediaBranch.appendChild(image);
    const postLink = document.createElement('a');
    postLink.className = 'absolute inset-0';
    postLink.href = `/imagine/post/${sourceId}?conversation=${sourceId}`;
    const actionBranch = document.createElement('div');
    const makeVideo = document.createElement('button');
    makeVideo.setAttribute('aria-label', 'Make video');
    actionBranch.appendChild(makeVideo);
    card.append(mediaBranch, postLink, actionBranch);
    listItem.appendChild(card);
    document.body.appendChild(listItem);
    return { listItem, card, image, postLink, makeVideo };
}

function mountQuickBatchGallery(sourceIds, onAction) {
    document.querySelectorAll('[data-test-quick-batch-card]').forEach((card) => card.remove());
    return sourceIds.map((sourceId) => {
        const { card, image, makeVideo } = createSavedBatchCard(
            `https://assets.grok.com/users/example/generated/${sourceId}/image.jpg`
        );
        const postLink = document.createElement('a');
        postLink.href = `/imagine/post/${sourceId}?conversation=${sourceId}`;
        card.insertBefore(postLink, image);
        postLink.appendChild(image);
        card.setAttribute('data-test-quick-batch-card', sourceId);
        makeVideo.scrollIntoView = jest.fn();
        makeVideo.addEventListener('click', () => onAction({ sourceId, card }));
        return { sourceId, card, makeVideo };
    });
}

function markQuickBatchActionAccepted(card) {
    const progress = document.createElement('button');
    progress.setAttribute('aria-label', 'Video Options');
    card.appendChild(progress);
}

function mountDurablePromptedGallery(sourceIds, onOpen) {
    document.body.innerHTML = '';
    mountSavedScope('all');
    return sourceIds.map((sourceId) => {
        const sourceUrl = `https://assets.grok.com/users/example/generated/${sourceId}/image.jpg`;
        const { card, image } = createSavedBatchCard(sourceUrl);
        const postLink = document.createElement('a');
        postLink.href = `/imagine/post/${sourceId}?conversation=${sourceId}`;
        postLink.addEventListener('click', (event) => {
            event.preventDefault();
            onOpen({ sourceId, sourceUrl });
        });
        card.insertBefore(postLink, image);
        postLink.appendChild(image);
        return { sourceId, sourceUrl, card, postLink };
    });
}

function mountSavedScope(selected = 'all') {
    document.querySelectorAll('[data-test-saved-scope]').forEach((control) => control.remove());
    const all = makeVisible(document.createElement('button'));
    const liked = makeVisible(document.createElement('button'));
    all.setAttribute('data-test-saved-scope', 'all');
    liked.setAttribute('data-test-saved-scope', 'liked');
    all.textContent = 'All';
    liked.textContent = 'Liked';
    if (selected === 'all') all.className = 'bg-primary text-background';
    if (selected === 'liked') liked.className = 'bg-primary text-background';
    document.body.append(all, liked);
    return { all, liked };
}

function addNextCardClickProbe() {
    const { image } = createSavedBatchCard(
        'https://assets.grok.com/users/example/generated/deadbeef-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg'
    );
    const nextClick = jest.fn();
    image.addEventListener('click', nextClick);
    return nextClick;
}

function primePromptedGalleryBatch(retryManager, item, prompt = 'slow camera push in') {
    retryManager.batchRunning = true;
    retryManager.batchAborted = false;
    retryManager.batchRunToken = 'batch-test-token';
    retryManager.batchMode = 'prompted';
    retryManager.batchContext = 'gallery';
    retryManager.batchPrompt = prompt;
    retryManager.batchGalleryUrl = window.location.href;
    retryManager.batchProcessedSrcs = new Set();
    retryManager.batchQueue = [item];
    retryManager.batchIndex = 0;
    retryManager.goalCount = 0;
    retryManager.goalTotal = 2;
}

function renderAgentEditor({
    sourceUrl,
    onBack = null,
    makeVideo = true,
    addPrompt = true,
    composer = true,
    includeAgentAsset = true,
    onSubmit = null,
    produceResult = true,
    settleSubmit = true
} = {}) {
    document.body.innerHTML = `${includeAgentAsset ? `
        <div class="react-flow__node-asset selected" data-id="asset-source">
            <img src="${sourceUrl}">
        </div>` : ''}
        <div class="query-bar"></div>`;
    const back = makeVisible(document.createElement('button'));
    back.setAttribute('aria-label', 'Back');
    if (onBack) back.addEventListener('click', onBack);

    const makeVideoButton = makeVisible(document.createElement('button'));
    if (makeVideo) {
        makeVideoButton.setAttribute('aria-label', 'Make Video');
        makeVideoButton.setAttribute('aria-haspopup', 'menu');
        makeVideoButton.addEventListener('click', () => {
            if (!addPrompt) return;
            const menu = makeVisible(document.createElement('div'));
            const menuItem = createMenuItem('Add Prompt', () => {
                if (!composer) return;
                mountFocusedPromptedVideoComposer({
                    onSubmit: (event) => {
                        if (settleSubmit) event.currentTarget.disabled = true;
                        if (onSubmit) onSubmit();
                        if (produceResult) appendReadyVideoResult(sourceUrl);
                    }
                });
                menuItem.remove();
            });
            menu.appendChild(menuItem);
            openLinkedMenu(makeVideoButton, menu);
        });
    }
    document.body.appendChild(back);
    if (makeVideo) document.body.appendChild(makeVideoButton);
    return { back, makeVideo: makeVideo ? makeVideoButton : null };
}

function appendPlayableGoalVideo(root, resultAssetId) {
    const video = document.createElement('video');
    video.src = `https://assets.grok.com/users/example/generated/${resultAssetId}/video.mp4`;
    Object.defineProperties(video, {
        readyState: { configurable: true, value: 2 },
        duration: { configurable: true, value: 6 },
        videoWidth: { configurable: true, value: 400 },
        videoHeight: { configurable: true, value: 736 }
    });
    root.appendChild(video);
    return video;
}

function mountVideoGoalSource({ sourceAssetId, sourcePostId, onAction }) {
    const sourceUrl = `https://assets.grok.com/users/example/generated/${sourceAssetId}/image.jpg`;
    const sourceNodeId = 'goal-source-node';
    window.history.pushState(
        {},
        '',
        `/imagine/agent/${sourceAssetId}?conversation=${sourcePostId}`
    );
    document.body.innerHTML = `
        <div class="react-flow">
            <div class="react-flow__node-asset selected" data-id="${sourceNodeId}">
                <img src="${sourceUrl}">
            </div>
            <div class="react-flow__node-toolbar" data-id="${sourceNodeId}"></div>
        </div>
    `;
    const action = makeVisible(document.createElement('button'));
    action.setAttribute('aria-label', 'Make Video');
    action.addEventListener('click', () => onAction?.({
        source: document.querySelector('.react-flow__node-asset.selected'),
        action
    }));
    document.querySelector('.react-flow__node-toolbar').appendChild(action);
    return {
        source: document.querySelector('.react-flow__node-asset.selected'),
        action,
        sourceUrl
    };
}

function mountVideoGoalDetailSource({ sourceAssetId, sourcePostId, onAction }) {
    window.history.pushState(
        {},
        '',
        `/imagine/post/${sourcePostId}?conversation=${sourcePostId}`
    );
    document.body.innerHTML = `
        <main>
            <article>
                <div data-media-frame>
                    <img src="https://assets.grok.com/users/example/generated/${sourceAssetId}/image.jpg">
                </div>
            </article>
        </main>
    `;
    const trigger = makeVisible(document.createElement('button'));
    trigger.id = 'detail-goal-trigger';
    trigger.setAttribute('aria-label', 'Make Video');
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('data-state', 'closed');
    trigger.addEventListener('click', () => {
        const menu = makeVisible(document.createElement('div'));
        const quickAnimate = createMenuItem('Quick Animate', () => onAction?.({
            source: document.querySelector('article'),
            trigger,
            quickAnimate
        }));
        menu.append(
            createMenuItem('Add Prompt'),
            createMenuItem('Spicy'),
            quickAnimate
        );
        openLinkedMenu(trigger, menu);
    });
    document.body.appendChild(trigger);
    return { source: document.querySelector('article'), trigger };
}

describe('VideoRetryManager', () => {
    let retryManager;
    let mockOverlay;
    let settingsManager;
    let historyManager;
    let setIntervalSpy;
    let promptedVideoBridgeHandler;
    let nativeControlClickSpy;
    let generationLease;

    beforeEach(() => {
        if (!global.PointerEvent) global.PointerEvent = MouseEvent;
        mockOverlay = {
            setStatus: jest.fn(),
            el: document.createElement('div')
        };
        mockOverlay.el.innerHTML = `
            <span id="gptRetryCounter"></span>
            <span id="gptVideoCounter"></span>
            <span id="gptProgressLabel"></span>
            <div id="gptQuickBatchBtn"></div>
            <div id="gptPromptedBatchBtn"></div>
            <div id="gptBatchStopBtn"></div>
            <div id="gptBatchStatus"></div>
            <div id="gptGalleryLimitRow"></div>
            <div id="gptBatchRecoveryRow"></div>
            <div id="gptBatchResumeBtn"></div>
            <div id="gptBatchRetryFailedBtn"></div>
            <div id="gptBatchCancelRunBtn"></div>
        `;

        settingsManager = createSettingsManager();
        historyManager = { history: [], add: jest.fn() };

        document.body.innerHTML = '';
        window.history.pushState({}, '', '/');

        promptedVideoBridgeHandler = (event) => {
            const target = document.querySelector(`[data-gpt-prompt-target="${event.detail.marker}"]`);
            if (target) target.textContent = event.detail.text;
            document.dispatchEvent(new CustomEvent('__gpt_set_prompted_video_content_result', {
                detail: { marker: event.detail.marker, ok: !!target }
            }));
        };
        document.addEventListener('__gpt_set_prompted_video_content', promptedVideoBridgeHandler);

        setIntervalSpy = jest.spyOn(global, 'setInterval').mockImplementation(() => 1);
        generationLease = null;
        retryManager = new VideoRetryManager(mockOverlay, settingsManager, historyManager);
        nativeControlClickSpy = jest.spyOn(retryManager, '_clickPromptedBatchNativeControl')
            .mockImplementation(async (target, runToken, _operation, validateTarget) => {
                if (!retryManager.isPromptedBatchTokenActive(runToken) || !target) return false;
                if (validateTarget && !validateTarget()) return false;
                target.click();
                return retryManager.isPromptedBatchTokenActive(runToken);
            });
        chrome.runtime.sendMessage.mockImplementation(async (message) => {
            if (message?.action === 'GPT_PROMPTED_VIDEO_NATIVE_CLICK') {
                return { ok: false, error: 'native_click_not_stubbed' };
            }
            if (message?.action === 'GENERATION_RUN_START') {
                const items = message.items.map((entry, index) => ({
                    itemId: `item-${index + 1}`,
                    descriptor: entry,
                    status: 'queued',
                    attemptCount: 0,
                    attemptsThisRound: 0,
                    failureCode: ''
                }));
                generationLease = {
                    runId: 'generation-run-test',
                    epoch: 1,
                    kind: message.kind,
                    status: 'running',
                    origin: message.origin,
                    items,
                    counts: { accepted: 0, failed: 0, skipped: 0, pending: items.length },
                    options: message.options,
                    prompt: message.prompt,
                    goalProgress: 0,
                    completedResultIds: []
                };
                return { status: 'started', run: generationLease };
            }
            if (message?.action === 'GENERATION_RUN_CLAIM') {
                const resumedItem = message.resume
                    ? generationLease?.items.find((candidate) => (
                        candidate.status === 'targeting'
                        || candidate.status === 'composer_ready'
                        || candidate.status === 'submitted'
                    ))
                    : null;
                const item = resumedItem
                    || generationLease?.items.find((candidate) => candidate.status === 'queued');
                if (!item) return { status: 'waiting', claim: null, run: generationLease };
                if (!resumedItem) item.status = 'targeting';
                return {
                    status: resumedItem ? 'resumed' : 'claimed',
                    claim: {
                        runId: generationLease.runId,
                        epoch: generationLease.epoch,
                        claimId: `claim-${item.itemId}-${item.attemptCount}`,
                        itemId: item.itemId,
                        descriptor: item.descriptor,
                        prompt: generationLease.prompt,
                        options: generationLease.options
                    },
                    run: generationLease
                };
            }
            if (message?.action === 'GENERATION_RUN_REPORT') {
                const item = generationLease.items.find((candidate) => candidate.itemId === message.itemId);
                if (message.outcome === 'composer_ready' || message.outcome === 'submitted') {
                    item.status = message.outcome;
                    item.receipt = message.receipt;
                } else if (message.outcome === 'accepted') {
                    item.attemptCount += 1;
                    item.attemptsThisRound += 1;
                    item.status = generationLease.kind === 'video_goal' ? 'submitted' : 'accepted';
                    item.receipt = message.receipt;
                } else if (message.outcome === 'completed' && generationLease.kind === 'video_goal') {
                    generationLease.goalProgress += 1;
                    generationLease.completedResultIds.push(message.receipt.resultAssetId);
                    item.status = generationLease.goalProgress >= generationLease.options.goalCount
                        ? 'accepted'
                        : 'queued';
                    item.attemptsThisRound = item.status === 'queued' ? 0 : item.attemptsThisRound;
                    item.receipt = message.receipt;
                } else if (message.outcome === 'capacity') {
                    item.status = 'queued';
                    item.failureCode = 'provider_capacity';
                    generationLease.status = 'waiting_capacity';
                } else if (message.outcome === 'permanent_failed') {
                    item.status = 'permanent_failed';
                    item.failureCode = message.failureCode;
                } else if (message.outcome === 'retryable_failed') {
                    if (!(generationLease.kind === 'video_goal'
                        && item.status === 'submitted'
                        && item.lastOutcome === 'accepted')) {
                        item.attemptCount += 1;
                        item.attemptsThisRound += 1;
                    }
                    item.failureCode = message.failureCode;
                    item.status = item.attemptsThisRound > generationLease.options.maxRetries
                        ? 'retryable_failed'
                        : 'queued';
                }
                item.lastOutcome = message.outcome;
                generationLease.counts = generationLease.items.reduce((counts, candidate) => {
                    if (candidate.status === 'accepted') counts.accepted += 1;
                    else if (candidate.status === 'retryable_failed' || candidate.status === 'permanent_failed') counts.failed += 1;
                    else counts.pending += 1;
                    return counts;
                }, { accepted: 0, failed: 0, skipped: 0, pending: 0 });
                if (generationLease.counts.pending === 0) {
                    const hasRetryableFailure = generationLease.items.some((candidate) => (
                        candidate.status === 'retryable_failed'
                    ));
                    if (hasRetryableFailure) generationLease.status = 'retryable_failed';
                    else if (generationLease.kind === 'video_goal'
                        && generationLease.goalProgress < generationLease.options.goalCount) {
                        generationLease.status = 'failed';
                    } else generationLease.status = 'completed';
                } else if (generationLease.status !== 'waiting_capacity') {
                    generationLease.status = 'running';
                }
                return { status: 'updated', run: generationLease };
            }
            if (message?.action === 'GENERATION_RUN_RETRY_FAILED') {
                generationLease.epoch += 1;
                generationLease.status = 'running';
                generationLease.items.forEach((item) => {
                    if (item.status === 'retryable_failed') {
                        item.status = 'queued';
                        item.failureCode = '';
                        item.attemptsThisRound = 0;
                    }
                });
                return { status: 'updated', run: generationLease };
            }
            if (message?.action === 'GENERATION_RUN_STATUS') {
                return generationLease
                    ? { status: 'active', isOwner: true, run: generationLease }
                    : { status: 'idle', isOwner: false, run: null };
            }
            if (message?.action === 'GENERATION_RUN_CANCEL') {
                generationLease.status = 'cancelled';
                return { status: 'cancelled', acknowledged: true, run: generationLease };
            }
            return undefined;
        });
    });

    afterEach(() => {
        document.removeEventListener('__gpt_set_prompted_video_content', promptedVideoBridgeHandler);
        retryManager.stopObserver();
        retryManager.generateMoreObserver.disconnect();
        jest.restoreAllMocks();
    });

    afterAll(() => {
        if (originalPointerEvent) global.PointerEvent = originalPointerEvent;
        else delete global.PointerEvent;
    });

    test('subscribes to settings updates and starts observer', () => {
        expect(settingsManager.subscribe).toHaveBeenCalledTimes(1);
        expect(setIntervalSpy).toHaveBeenCalledTimes(1);
        expect(retryManager.goalRunning).toBe(false);
    });

    test('clickMakeVideo clicks button and enters verifying state', () => {
        const makeVideoButton = document.createElement('button');
        makeVideoButton.setAttribute('aria-label', 'Make video');
        makeVideoButton.click = jest.fn();

        document.body.appendChild(makeVideoButton);

        retryManager.clickMakeVideo();

        expect(makeVideoButton.click).toHaveBeenCalledTimes(1);
        expect(retryManager.isVerifying).toBe(true);
        expect(retryManager.lastClickTime).toBeGreaterThan(0);
    });

    test('attemptRetry increments retry and invokes click', () => {
        retryManager.lastClickTime = 0;
        retryManager.clickMakeVideo = jest.fn();

        retryManager.attemptRetry();

        expect(retryManager.currentRetry).toBe(1);
        expect(retryManager.clickMakeVideo).toHaveBeenCalledTimes(1);
        expect(mockOverlay.setStatus).toHaveBeenCalledWith('Retrying... (1)', 'warning');
    });

    test('attemptRetry stops when max retries are hit', () => {
        settingsManager.settings.maxRetries = 1;
        retryManager.currentRetry = 1;
        retryManager.goalRunning = true;
        retryManager.lastClickTime = 0;
        retryManager.clickMakeVideo = jest.fn();

        retryManager.attemptRetry();

        expect(mockOverlay.setStatus).toHaveBeenCalledWith('Max Retries Hit', 'error');
        expect(retryManager.goalRunning).toBe(false);
        expect(retryManager.clickMakeVideo).not.toHaveBeenCalled();
    });

    test('checkAndAct returns early when auto retry disabled and goal not running', () => {
        settingsManager.settings.autoRetryEnabled = false;
        retryManager.goalRunning = false;
        retryManager.clickMakeVideo = jest.fn();

        retryManager.checkAndAct();

        expect(retryManager.clickMakeVideo).not.toHaveBeenCalled();
    });

    test('checkAndAct marks goal complete after verified success', () => {
        const makeVideoButton = document.createElement('button');
        makeVideoButton.setAttribute('aria-label', 'Make video');
        document.body.appendChild(makeVideoButton);

        const progressButton = document.createElement('button');
        progressButton.setAttribute('aria-label', 'Video Options');
        document.body.appendChild(progressButton);

        retryManager.goalRunning = true;
        retryManager.goalTotal = 1;
        retryManager.goalCount = 0;
        retryManager.isVerifying = true;
        retryManager.preClickButtonCount = 0;

        retryManager.checkAndAct();

        expect(retryManager.goalCount).toBe(1);
        expect(retryManager.goalRunning).toBe(false);
        expect(mockOverlay.setStatus).toHaveBeenCalledWith('Goal Complete', 'success');
    });

    test('detectBatchContext resolves detail on imagine post URL', () => {
        window.history.pushState({}, '', '/imagine/post/abc123');
        expect(retryManager.detectBatchContext()).toBe('detail');
    });

    test('detectBatchContext resolves gallery when card selectors exist', () => {
        window.history.pushState({}, '', '/imagine/saved');
        createSavedBatchCard('https://assets.grok.com/users/example/generated/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg');
        expect(retryManager.detectBatchContext()).toBe('gallery');
    });

    test('current Saved sibling media is eligible and opens through its exact overlay link', () => {
        const sourceId = 'abababab-aaaa-4bbb-8ccc-abababababab';
        window.history.pushState({}, '', '/imagine/saved');
        const { card, image, postLink } = createCurrentSavedBatchCard(sourceId);
        const descriptor = {
            sourceAssetId: sourceId,
            sourcePostId: sourceId
        };

        expect(retryManager._getCardGeneratedImage(card)).toBe(image);
        expect(retryManager.isCensoredCard(card)).toBe(false);
        expect(retryManager._getPromptedOpenTarget(descriptor)).toEqual({
            status: 'matched',
            control: postLink,
            card
        });
    });

    test('Video Goal refuses gallery-wide implicit targeting', async () => {
        const menuItem = document.createElement('div');
        menuItem.setAttribute('role', 'listitem');
        const menuImage = document.createElement('img');
        menuImage.alt = 'Menu preview';
        menuImage.src = 'https://assets.grok.com/menu-preview.jpg';
        const menuMakeVideo = makeVisible(document.createElement('button'), { top: 364 });
        menuMakeVideo.setAttribute('aria-label', 'Make video');
        menuMakeVideo.click = jest.fn();
        menuItem.append(menuImage, menuMakeVideo);

        const card = document.createElement('div');
        card.setAttribute('role', 'listitem');
        const image = document.createElement('img');
        image.alt = 'Generated image';
        image.src = 'https://assets.grok.com/users/example/generated/media-1/image.jpg';
        const makeVideo = makeVisible(document.createElement('button'), { top: 40 });
        makeVideo.setAttribute('aria-label', 'Make video');
        makeVideo.click = jest.fn();
        const progress = document.createElement('button');
        progress.setAttribute('aria-label', 'Video Options');
        card.append(image, makeVideo, progress);
        document.body.append(menuItem, card);

        await expect(retryManager.startGoal(1)).resolves.toBe(false);

        expect(retryManager.targetContext).toBeNull();
        expect(makeVideo.click).not.toHaveBeenCalled();
        expect(menuMakeVideo.click).not.toHaveBeenCalled();
        expect(mockOverlay.setStatus).toHaveBeenCalledWith(
            'Video Goal: select one generated source in Agent or detail view',
            'warning'
        );
    });

    test('Video Goal does not start or click when no selected source exists', async () => {
        const menuItem = document.createElement('div');
        menuItem.setAttribute('role', 'listitem');
        const menuImage = document.createElement('img');
        menuImage.alt = 'Menu preview';
        const menuMakeVideo = document.createElement('button');
        menuMakeVideo.setAttribute('aria-label', 'Make video');
        menuMakeVideo.click = jest.fn();
        menuItem.append(menuImage, menuMakeVideo);
        document.body.appendChild(menuItem);

        window.history.pushState({}, '', '/imagine/agent/agent-empty?conversation=aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
        await expect(retryManager.startGoal(1)).resolves.toBe(false);

        expect(retryManager.goalRunning).toBe(false);
        expect(retryManager.targetContext).toBeNull();
        expect(menuMakeVideo.click).not.toHaveBeenCalled();
        expect(mockOverlay.setStatus).toHaveBeenCalledWith(
            'Video Goal: agent_selected_source_missing',
            'warning'
        );
    });

    test('startBatch(prompted) routes through the durable Prompted runner', async () => {
        const durableSpy = jest.spyOn(retryManager, '_startPromptedBatchDurable').mockResolvedValue(true);

        await retryManager.startBatch('prompted', 'test prompt', { galleryLimit: 4, videoGoal: 7 });

        expect(durableSpy).toHaveBeenCalledWith('test prompt', { galleryLimit: 4, videoGoal: 7 });
    });

    test('Quick Batch reacquires all three stable source identities after the gallery remounts', async () => {
        settingsManager.settings.galleryBatchLimit = 3;
        const sourceIds = [
            '10101010-aaaa-4bbb-8ccc-111111111111',
            '20202020-aaaa-4bbb-8ccc-222222222222',
            '30303030-aaaa-4bbb-8ccc-333333333333'
        ];
        const acceptedSourceIds = [];
        const accepted = new Set();
        let remounted = false;
        window.history.pushState({}, '', '/imagine/saved');

        const mountGallery = () => mountQuickBatchGallery(sourceIds, ({ sourceId, card }) => {
            acceptedSourceIds.push(sourceId);
            accepted.add(sourceId);
            if (!remounted) {
                remounted = true;
                mountGallery();
            } else {
                markQuickBatchActionAccepted(card);
            }
        }).forEach(({ sourceId, card }) => {
            if (accepted.has(sourceId)) markQuickBatchActionAccepted(card);
        });
        mountGallery();
        retryManager.sleep = jest.fn().mockResolvedValue();
        retryManager.scrollForMore = jest.fn().mockResolvedValue(false);

        await retryManager.startBatch('quick');

        expect(acceptedSourceIds).toEqual(sourceIds);
        expect(retryManager.goalCount).toBe(3);
    });

    test('Quick Batch does not count a dispatched click without provider acceptance evidence', async () => {
        const sourceId = '40404040-aaaa-4bbb-8ccc-444444444444';
        const dispatchedSourceIds = [];
        window.history.pushState({}, '', '/imagine/saved');
        mountQuickBatchGallery([sourceId], ({ sourceId: dispatchedSourceId }) => {
            dispatchedSourceIds.push(dispatchedSourceId);
        });
        retryManager.sleep = jest.fn().mockResolvedValue();
        retryManager.scrollForMore = jest.fn().mockResolvedValue(false);

        await retryManager.startBatch('quick');

        expect(dispatchedSourceIds).toHaveLength(settingsManager.settings.maxRetries + 1);
        expect(new Set(dispatchedSourceIds)).toEqual(new Set([sourceId]));
        expect(retryManager.goalCount).toBe(0);
    });

    test('Quick Batch never dispatches the same stable source twice after a gallery remount', async () => {
        settingsManager.settings.galleryBatchLimit = 3;
        const sourceIds = [
            '50505050-aaaa-4bbb-8ccc-555555555555',
            '60606060-aaaa-4bbb-8ccc-666666666666',
            '70707070-aaaa-4bbb-8ccc-777777777777'
        ];
        const dispatchedSourceIds = [];
        const accepted = new Set();
        let remounted = false;
        window.history.pushState({}, '', '/imagine/saved');
        window.scrollBy = jest.fn();

        const mountGallery = () => mountQuickBatchGallery(sourceIds, ({ sourceId, card }) => {
            dispatchedSourceIds.push(sourceId);
            accepted.add(sourceId);
            if (!remounted) {
                remounted = true;
                mountGallery();
            } else {
                markQuickBatchActionAccepted(card);
            }
        }).forEach(({ sourceId, card }) => {
            if (accepted.has(sourceId)) markQuickBatchActionAccepted(card);
        });
        mountGallery();
        retryManager.sleep = jest.fn().mockResolvedValue();

        await retryManager.startBatch('quick');

        expect(dispatchedSourceIds).toEqual(sourceIds);
        expect(new Set(dispatchedSourceIds).size).toBe(dispatchedSourceIds.length);
    });

    test('durable Prompted Batch advances on accepted submissions across gallery remounts', async () => {
        settingsManager.settings.maxRetries = 0;
        settingsManager.settings.galleryBatchLimit = 3;
        const sourceIds = [
            '81818181-aaaa-4bbb-8ccc-111111111111',
            '82828282-aaaa-4bbb-8ccc-222222222222',
            '83838383-aaaa-4bbb-8ccc-333333333333'
        ];
        const submitted = [];
        window.history.pushState({}, '', '/imagine/saved');

        const mountGallery = () => mountDurablePromptedGallery(sourceIds, ({ sourceId, sourceUrl }) => {
            window.history.pushState({}, '', `/imagine/agent/${sourceId}?conversation=${sourceId}`);
            renderAgentEditor({
                sourceUrl,
                produceResult: false,
                onSubmit: () => {
                    submitted.push(sourceId);
                    const progress = document.createElement('button');
                    progress.setAttribute('aria-label', 'Video Options');
                    document.querySelector('.react-flow__node-asset.selected').appendChild(progress);
                }
            });
        });
        mountGallery();
        retryManager.sleep = jest.fn().mockResolvedValue();
        retryManager._returnToGenerationOrigin = jest.fn(async () => {
            window.history.pushState({}, '', '/imagine/saved');
            mountGallery();
            return 'returned';
        });

        await retryManager.startBatch('prompted', 'slow camera push in', { galleryLimit: 3 });

        expect(submitted).toEqual(sourceIds);
        expect(generationLease.status).toBe('completed');
        expect(generationLease.counts.accepted).toBe(3);
    });

    test('durable Prompted Batch continues after an unproven source and Retry Failed preserves accepted work', async () => {
        settingsManager.settings.maxRetries = 0;
        settingsManager.settings.galleryBatchLimit = 2;
        const sourceIds = [
            '91919191-aaaa-4bbb-8ccc-111111111111',
            '92929292-aaaa-4bbb-8ccc-222222222222'
        ];
        const submissions = [];
        let firstSourceAccepts = false;
        window.history.pushState({}, '', '/imagine/saved');

        const mountGallery = () => mountDurablePromptedGallery(sourceIds, ({ sourceId, sourceUrl }) => {
            window.history.pushState({}, '', `/imagine/agent/${sourceId}?conversation=${sourceId}`);
            renderAgentEditor({
                sourceUrl,
                produceResult: false,
                onSubmit: () => {
                    submissions.push(sourceId);
                    if (sourceId !== sourceIds[0] || firstSourceAccepts) {
                        const progress = document.createElement('button');
                        progress.setAttribute('aria-label', 'Video Options');
                        document.querySelector('.react-flow__node-asset.selected').appendChild(progress);
                    }
                }
            });
        });
        mountGallery();
        retryManager.sleep = jest.fn().mockResolvedValue();
        retryManager._returnToGenerationOrigin = jest.fn(async () => {
            window.history.pushState({}, '', '/imagine/saved');
            mountGallery();
            return 'returned';
        });

        await retryManager.startBatch('prompted', 'slow camera push in', { galleryLimit: 2 });

        expect(generationLease.status).toBe('retryable_failed');
        expect(generationLease.counts).toEqual({ accepted: 1, failed: 1, skipped: 0, pending: 0 });
        firstSourceAccepts = true;
        await retryManager.retryFailedGenerationRun();

        expect(generationLease.status).toBe('completed');
        expect(generationLease.counts.accepted).toBe(2);
        expect(submissions.filter((sourceId) => sourceId === sourceIds[0])).toHaveLength(2);
        expect(submissions.filter((sourceId) => sourceId === sourceIds[1])).toHaveLength(1);
    });

    test('durable Prompted detail submits its goal without waiting for completed videos', async () => {
        settingsManager.settings.maxRetries = 0;
        const sourceId = '93939393-aaaa-4bbb-8ccc-333333333333';
        const sourceUrl = `https://assets.grok.com/users/example/generated/${sourceId}/image.jpg`;
        let submitted = 0;
        window.history.pushState({}, '', `/imagine/agent/${sourceId}?conversation=${sourceId}`);
        renderAgentEditor({
            sourceUrl,
            produceResult: false,
            settleSubmit: false,
            onSubmit: () => {
                submitted += 1;
                const progress = document.createElement('button');
                progress.setAttribute('aria-label', 'Video Options');
                document.querySelector('.react-flow__node-asset.selected').appendChild(progress);
                document.querySelectorAll('.query-bar, [role="menu"]').forEach((element) => element.remove());
                const trigger = document.querySelector('button[aria-label="Make Video"]');
                trigger?.setAttribute('aria-expanded', 'false');
                trigger?.setAttribute('data-state', 'closed');
                trigger?.removeAttribute('aria-controls');
            }
        });
        retryManager.sleep = jest.fn().mockResolvedValue();

        await retryManager.startBatch('prompted', 'slow camera push in', { videoGoal: 3 });

        expect(submitted).toBe(3);
        expect(document.querySelectorAll('video')).toHaveLength(0);
        expect(generationLease.status).toBe('completed');
        expect(generationLease.counts.accepted).toBe(3);
    });

    test('durable Prompted resume accepts a persisted submitted checkpoint without clicking again', async () => {
        const sourceAssetId = '94949494-aaaa-4bbb-8ccc-444444444444';
        const sourcePostId = '95959595-aaaa-4bbb-8ccc-555555555555';
        const sourceUrl = `https://assets.grok.com/users/example/generated/${sourceAssetId}/image.jpg`;
        window.history.pushState({}, '', `/imagine/agent/${sourceAssetId}?conversation=${sourcePostId}`);
        renderAgentEditor({ sourceUrl, produceResult: false });
        const sourceNode = document.querySelector('.react-flow__node-asset.selected');
        const acceptedSignal = document.createElement('button');
        acceptedSignal.setAttribute('aria-label', 'Video Options');
        sourceNode.appendChild(acceptedSignal);

        const descriptor = {
            version: 1,
            surface: 'agent_media',
            sourceAssetId,
            sourcePostId,
            conversationId: sourcePostId,
            mediaKind: 'image',
            hrefPath: `/imagine/agent/${sourceAssetId}`,
            route: window.location.href,
            initialOrder: 0,
            beforeAssetId: '',
            afterAssetId: ''
        };
        generationLease = {
            runId: 'generation-run-resume',
            epoch: 2,
            kind: 'prompted_batch',
            status: 'running',
            origin: {
                surface: 'agent_media',
                url: window.location.href,
                pathname: window.location.pathname,
                scrollY: 0,
                hrefPath: descriptor.hrefPath,
                sourceAssetId,
                sourcePostId,
                conversationId: sourcePostId
            },
            items: [{
                itemId: 'item-resume',
                descriptor,
                status: 'submitted',
                attemptCount: 0,
                failureCode: '',
                receipt: {
                    sourceAssetId,
                    sourcePostId,
                    observedState: 'submit_dispatched',
                    observedAt: Date.now(),
                    checkpointVersion: 1,
                    checkpointAction: 'prompted_video',
                    checkpointSourceKind: 'agent_media',
                    checkpointSourceNodeId: 'asset-source',
                    baselineAcceptedCount: 0,
                    baselineRejectedCount: 0
                }
            }],
            counts: { accepted: 0, failed: 0, skipped: 0, pending: 1 },
            options: {
                maxRetries: 0,
                action: 'prompted_video',
                videoGoal: 1,
                acceptanceTimeoutMs: 1000,
                capacityTimeoutMs: 1000
            },
            prompt: 'slow camera push in'
        };
        retryManager.generationRun = null;
        retryManager.sleep = jest.fn().mockResolvedValue();
        nativeControlClickSpy.mockClear();

        await retryManager.resumeGenerationRunIfNeeded();

        expect(nativeControlClickSpy).not.toHaveBeenCalled();
        expect(generationLease.status).toBe('completed');
        expect(generationLease.counts.accepted).toBe(1);
    });

    test('durable Prompted return restores the deep gallery viewport before reacquiring the next source', async () => {
        const sourceId = '96969696-aaaa-4bbb-8ccc-666666666666';
        window.history.pushState({}, '', '/imagine/saved');
        document.body.innerHTML = '';
        const descriptor = {
            version: 1,
            surface: 'saved_gallery',
            sourceAssetId: sourceId,
            sourcePostId: sourceId,
            conversationId: sourceId,
            mediaKind: 'image',
            hrefPath: `/imagine/post/${sourceId}`,
            initialOrder: 0,
            beforeAssetId: '',
            afterAssetId: ''
        };
        const token = retryManager.createBatchRunToken();
        retryManager.batchRunning = true;
        retryManager.batchAborted = false;
        retryManager.batchRunToken = token;
        retryManager.generationRun = {
            origin: {
                surface: 'saved_gallery',
                url: window.location.href,
                scrollY: 4200
            },
            items: [{ itemId: 'item-deep', status: 'queued', descriptor }]
        };
        window.scrollTo = jest.fn(() => {
            mountDurablePromptedGallery([sourceId], () => {});
        });
        retryManager.sleep = jest.fn().mockResolvedValue();

        await expect(retryManager._waitForGenerationOrigin(token, 1000)).resolves.toBe(true);

        expect(window.scrollTo).toHaveBeenCalledWith({ top: 4200, behavior: 'instant' });
    });

    test('Video Goal completes three new playable videos across source remounts', async () => {
        settingsManager.settings.maxRetries = 0;
        const sourceAssetId = 'a1a1a1a1-aaaa-4bbb-8ccc-111111111111';
        const sourcePostId = 'a2a2a2a2-aaaa-4bbb-8ccc-222222222222';
        const resultIds = [
            'a3a3a3a3-aaaa-4bbb-8ccc-333333333333',
            'a4a4a4a4-aaaa-4bbb-8ccc-444444444444',
            'a5a5a5a5-aaaa-4bbb-8ccc-555555555555'
        ];
        let attempts = 0;

        const render = ({ acceptedCount = 0, resultId = '' } = {}) => {
            const mounted = mountVideoGoalSource({
                sourceAssetId,
                sourcePostId,
                onAction: () => {
                    attempts += 1;
                    render({ acceptedCount: attempts, resultId: resultIds[attempts - 1] });
                }
            });
            for (let index = 0; index < acceptedCount; index++) {
                const accepted = document.createElement('button');
                accepted.setAttribute('aria-label', 'Video Options');
                mounted.source.appendChild(accepted);
            }
            if (resultId) appendPlayableGoalVideo(mounted.source, resultId);
            return mounted;
        };
        render();
        retryManager.sleep = jest.fn().mockResolvedValue();

        await expect(retryManager.startGoal(3)).resolves.toBe(true);

        expect(attempts).toBe(3);
        expect(generationLease.status).toBe('completed');
        expect(generationLease.goalProgress).toBe(3);
        expect(generationLease.completedResultIds).toEqual(resultIds);
    });

    test('Video Goal opens current detail Make Video and submits exact Quick Animate', async () => {
        settingsManager.settings.maxRetries = 0;
        const sourceAssetId = 'a6a6a6a6-aaaa-4bbb-8ccc-666666666666';
        const sourcePostId = 'a7a7a7a7-aaaa-4bbb-8ccc-777777777777';
        const resultAssetId = 'a8a8a8a8-aaaa-4bbb-8ccc-888888888888';
        let attempts = 0;
        mountVideoGoalDetailSource({
            sourceAssetId,
            sourcePostId,
            onAction: ({ source }) => {
                attempts += 1;
                const accepted = document.createElement('div');
                accepted.setAttribute('role', 'status');
                accepted.textContent = 'Video generation queued';
                source.appendChild(accepted);
                appendPlayableGoalVideo(source, resultAssetId);
            }
        });
        retryManager.sleep = jest.fn().mockResolvedValue();

        await expect(retryManager.startGoal(1)).resolves.toBe(true);

        expect(attempts).toBe(1);
        expect(generationLease.status).toBe('completed');
        expect(generationLease.completedResultIds).toEqual([resultAssetId]);
    });

    test('Video Goal retries one source-scoped failure without counting it as output', async () => {
        settingsManager.settings.maxRetries = 1;
        const sourceAssetId = 'b1b1b1b1-aaaa-4bbb-8ccc-111111111111';
        const sourcePostId = 'b2b2b2b2-aaaa-4bbb-8ccc-222222222222';
        const resultId = 'b3b3b3b3-aaaa-4bbb-8ccc-333333333333';
        let attempts = 0;

        let firstFailurePending = false;
        const mounted = mountVideoGoalSource({
            sourceAssetId,
            sourcePostId,
            onAction: ({ source }) => {
                attempts += 1;
                const accepted = document.createElement('button');
                accepted.setAttribute('aria-label', 'Video Options');
                source.appendChild(accepted);
                if (attempts === 1) firstFailurePending = true;
                else appendPlayableGoalVideo(source, resultId);
            }
        });
        retryManager.sleep = jest.fn(async () => {
            if (!firstFailurePending) return;
            firstFailurePending = false;
            const failed = document.createElement('div');
            failed.setAttribute('role', 'alert');
            failed.textContent = 'Video generation failed';
            mounted.source.appendChild(failed);
        });

        await retryManager.startGoal(1);

        expect(attempts).toBe(2);
        expect(generationLease.goalProgress).toBe(1);
        expect(generationLease.completedResultIds).toEqual([resultId]);
        expect(generationLease.status).toBe('completed');
    });

    test('Video Goal fails closed when one attempt produces two new result identities', async () => {
        settingsManager.settings.maxRetries = 0;
        const sourceAssetId = 'c1c1c1c1-aaaa-4bbb-8ccc-111111111111';
        const sourcePostId = 'c2c2c2c2-aaaa-4bbb-8ccc-222222222222';
        const resultIds = [
            'c3c3c3c3-aaaa-4bbb-8ccc-333333333333',
            'c4c4c4c4-aaaa-4bbb-8ccc-444444444444'
        ];
        mountVideoGoalSource({
            sourceAssetId,
            sourcePostId,
            onAction: ({ source }) => {
                const accepted = document.createElement('button');
                accepted.setAttribute('aria-label', 'Video Options');
                source.appendChild(accepted);
                resultIds.forEach((resultId) => appendPlayableGoalVideo(source, resultId));
            }
        });
        retryManager.sleep = jest.fn().mockResolvedValue();

        await retryManager.startGoal(1);

        expect(generationLease.goalProgress).toBe(0);
        expect(generationLease.completedResultIds).toEqual([]);
        expect(generationLease.status).toBe('failed');
        expect(generationLease.items[0]).toEqual(expect.objectContaining({
            status: 'permanent_failed',
            failureCode: 'result_ambiguous'
        }));
    });

    test('Video Goal Stop revokes the run while a provider-accepted result is pending', async () => {
        settingsManager.settings.maxRetries = 3;
        const sourceAssetId = 'd1d1d1d1-aaaa-4bbb-8ccc-111111111111';
        const sourcePostId = 'd2d2d2d2-aaaa-4bbb-8ccc-222222222222';
        let attempts = 0;
        let stopped = false;
        mountVideoGoalSource({
            sourceAssetId,
            sourcePostId,
            onAction: ({ source }) => {
                attempts += 1;
                const accepted = document.createElement('button');
                accepted.setAttribute('aria-label', 'Video Options');
                source.appendChild(accepted);
            }
        });
        retryManager.sleep = jest.fn(async () => {
            if (!stopped) {
                stopped = true;
                await retryManager.stopBatch();
            }
        });

        await retryManager.startGoal(2);

        expect(attempts).toBe(1);
        expect(generationLease.status).toBe('cancelled');
        expect(generationLease.goalProgress).toBe(0);
    });

    test.each([
        { lastOutcome: 'submitted', observedState: 'submit_dispatched', attemptCount: 0 },
        { lastOutcome: 'accepted', observedState: 'provider_accepted', attemptCount: 1 }
    ])(
        'Video Goal resumes a $lastOutcome checkpoint without dispatching Make Video again',
        async ({ lastOutcome, observedState, attemptCount }) => {
        const sourceAssetId = 'e1e1e1e1-aaaa-4bbb-8ccc-111111111111';
        const sourcePostId = 'e2e2e2e2-aaaa-4bbb-8ccc-222222222222';
        const resultAssetId = 'e3e3e3e3-aaaa-4bbb-8ccc-333333333333';
        let attempts = 0;
        const mounted = mountVideoGoalSource({
            sourceAssetId,
            sourcePostId,
            onAction: () => {
                attempts += 1;
            }
        });
        const accepted = document.createElement('button');
        accepted.setAttribute('aria-label', 'Video Options');
        mounted.source.appendChild(accepted);
        appendPlayableGoalVideo(mounted.source, resultAssetId);

        const descriptor = {
            version: 1,
            surface: 'agent_media',
            sourceAssetId,
            sourcePostId,
            conversationId: sourcePostId,
            mediaKind: 'image',
            hrefPath: `/imagine/agent/${sourceAssetId}`,
            route: `https://grok.com/imagine/agent/${sourceAssetId}?conversation=${sourcePostId}`,
            initialOrder: 0,
            beforeAssetId: '',
            afterAssetId: ''
        };
        generationLease = {
            runId: 'generation-run-test',
            epoch: 1,
            kind: 'video_goal',
            status: 'running',
            origin: {
                surface: 'agent_media',
                url: descriptor.route,
                pathname: descriptor.hrefPath,
                scrollY: 0,
                sourceAssetId,
                sourcePostId,
                conversationId: sourcePostId
            },
            items: [{
                itemId: 'item-1',
                descriptor,
                status: 'submitted',
                attemptCount,
                attemptsThisRound: attemptCount,
                failureCode: '',
                lastOutcome,
                receipt: {
                    sourceAssetId,
                    sourcePostId,
                    observedState,
                    observedAt: Date.now(),
                    checkpointVersion: 1,
                    checkpointAction: 'goal_video',
                    checkpointSourceKind: 'agent_media',
                    checkpointSourceNodeId: 'goal-source-node',
                    baselineAcceptedCount: 0,
                    baselineRejectedCount: 0,
                    resultBaselineVersion: 1,
                    baselineResultAssetIds: [],
                    baselineFailureCount: 0
                }
            }],
            counts: { accepted: 0, failed: 0, skipped: 0, pending: 1 },
            options: {
                maxRetries: 0,
                goalCount: 1,
                acceptanceTimeoutMs: 15000,
                resultTimeoutMs: 180000,
                capacityTimeoutMs: 60000
            },
            prompt: '',
            goalProgress: 0,
            completedResultIds: []
        };
        retryManager.generationRun = generationLease;
        retryManager.sleep = jest.fn().mockResolvedValue();

        await expect(retryManager.resumeGenerationRun()).resolves.toBe(true);

        expect(attempts).toBe(0);
        expect(generationLease.status).toBe('completed');
        expect(generationLease.completedResultIds).toEqual([resultAssetId]);
        }
    );

    test('detectBatchContext resolves a qualified current results grid separately from Saved', () => {
        window.history.pushState({}, '', '/imagine');
        createSavedBatchCard(
            'https://assets.grok.com/users/example/generated/abababab-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg'
        );

        expect(retryManager.detectBatchContext()).toBe('results_gallery');
    });

    test('results gallery detection rejects a card with ambiguous Make video actions', () => {
        window.history.pushState({}, '', '/imagine');
        const { card } = createSavedBatchCard(
            'https://assets.grok.com/users/example/generated/abababab-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg'
        );
        const duplicate = document.createElement('button');
        duplicate.setAttribute('aria-label', 'Make video');
        card.appendChild(duplicate);

        expect(retryManager.detectBatchContext()).toBe('unsupported');
        expect(retryManager._getQualifiedResultsGalleryItems()).toEqual([]);
    });

    test('results receipt follows visual qualified order across masonry DOM order', () => {
        window.history.pushState({}, '', '/imagine');
        const first = createSavedBatchCard(
            'https://assets.grok.com/users/example/generated/11111111-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg'
        );
        const last = createSavedBatchCard(
            'https://assets.grok.com/users/example/generated/33333333-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg'
        );
        const ineligibleMiddle = createSavedBatchCard(
            'https://assets.grok.com/users/example/generated/22222222-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg'
        );
        makeVisible(first.card, { top: 0, left: 0 });
        makeVisible(ineligibleMiddle.card, { top: 100, left: 0 });
        makeVisible(last.card, { top: 200, left: 0 });
        ineligibleMiddle.makeVideo.remove();

        const firstItem = retryManager._getQualifiedResultsGalleryItems()[0];
        const receipt = retryManager._captureResultsGalleryReceipt(firstItem);

        expect(receipt).toEqual(expect.objectContaining({
            version: 3,
            sourceIdentity: '11111111-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            expectedNextIdentity: '33333333-bbbb-4ccc-8ddd-eeeeeeeeeeee'
        }));
    });

    test('results card open target accepts duplicate links only when they share one post', () => {
        window.history.pushState({}, '', '/imagine');
        const { card, image } = createSavedBatchCard(
            'https://assets.grok.com/users/example/generated/abababab-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg'
        );
        const imageLink = document.createElement('a');
        imageLink.href = '/imagine/post/same-post';
        card.insertBefore(imageLink, image);
        imageLink.appendChild(image);
        const overlayLink = document.createElement('a');
        overlayLink.href = '/imagine/post/same-post';
        card.appendChild(overlayLink);
        const item = retryManager._getQualifiedResultsGalleryItems()[0];

        expect(retryManager._getResultsGalleryOpenTarget(item)).toBe(imageLink);

        overlayLink.href = '/imagine/post/different-post';
        expect(retryManager._getResultsGalleryOpenTarget(item)).toBeNull();
    });

    test('startBatch(prompted) keeps results settings on the durable Prompted runner', async () => {
        const durableSpy = jest.spyOn(retryManager, '_startPromptedBatchDurable').mockResolvedValue(true);

        await retryManager.startBatch('prompted', 'results prompt', { galleryLimit: 5, videoGoal: 7 });

        expect(durableSpy).toHaveBeenCalledWith('results prompt', { galleryLimit: 5, videoGoal: 7 });
    });

    test('results card opening fails closed when the trusted native click is unavailable', async () => {
        const sourceUrl = 'https://assets.grok.com/users/example/generated/acdcacdc-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg';
        window.history.pushState({}, '', '/imagine');
        const { image } = createSavedBatchCard(sourceUrl);
        const item = retryManager._getQualifiedResultsGalleryItems()[0];
        const token = 'results-native-open-failed';
        retryManager.batchRunning = true;
        retryManager.batchAborted = false;
        retryManager.batchRunToken = token;
        retryManager.batchContext = 'results_gallery';
        retryManager.batchPrompt = 'slow camera move';
        const directClickSpy = jest.spyOn(image, 'click');
        nativeControlClickSpy.mockResolvedValue(false);
        const editorSpy = jest.spyOn(retryManager, 'waitForPromptedBatchEditorReady');
        const stopSpy = jest.spyOn(retryManager, '_stopPromptedResultsItem').mockResolvedValue(false);

        await retryManager._processPromptedResultsItem(item, token);

        expect(nativeControlClickSpy).toHaveBeenCalledWith(
            image,
            token,
            'open prompted batch result',
            expect.any(Function)
        );
        expect(directClickSpy).not.toHaveBeenCalled();
        expect(editorSpy).not.toHaveBeenCalled();
        expect(stopSpy).toHaveBeenCalledWith(
            'Prompted Batch [results]: Could not open result card',
            expect.any(Object),
            token
        );
    });

    test('results failure preserves its cause when returning to the gallery also fails', async () => {
        window.history.pushState({}, '', '/imagine/post/result-card');
        const token = 'results-preserve-original-failure';
        retryManager.batchRunning = true;
        retryManager.batchAborted = false;
        retryManager.batchRunToken = token;
        retryManager.batchContext = 'results_gallery';
        retryManager._returnToPromptedBatchResults = jest.fn().mockResolvedValue('failed');

        await retryManager._stopPromptedResultsItem(
            'Prompted Batch [results]: Video submit button not ready',
            { sourceIdentity: 'source-id' },
            token
        );

        const expected = 'Prompted Batch [results]: Video submit button not ready. '
            + 'Also could not return to the original results. Use Back to recover the gallery.';
        expect(retryManager.batchFailureMessage).toBe(expected);
        expect(mockOverlay.setStatus).toHaveBeenLastCalledWith(expected, 'warning');
    });

    test('prompted results gallery submits through detail and restores the same results grid', async () => {
        const sourceUrl = 'https://assets.grok.com/users/example/generated/adadadad-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg';
        let submittedPrompt = null;
        window.history.pushState({}, '', '/imagine');
        window.scrollTo = jest.fn();

        const renderResults = () => {
            document.body.innerHTML = '';
            const { image } = createSavedBatchCard(sourceUrl);
            image.addEventListener('click', () => {
                window.history.pushState({}, '', '/imagine/post/result-card');
                document.body.innerHTML = '';

                const back = makeVisible(document.createElement('button'));
                back.setAttribute('aria-label', 'Back');
                back.addEventListener('click', () => {
                    window.history.pushState({}, '', '/imagine');
                    renderResults();
                });

                const makeVideo = makeVisible(document.createElement('button'));
                makeVideo.setAttribute('aria-label', 'Make Video');
                makeVideo.setAttribute('aria-haspopup', 'menu');
                makeVideo.addEventListener('click', () => {
                    const menu = makeVisible(document.createElement('div'));
                    const addPrompt = createMenuItem('Add Prompt', () => {
                        const { input } = mountFocusedPromptedVideoComposer({
                            onSubmit: (event) => {
                                event.currentTarget.disabled = true;
                                submittedPrompt = input.textContent;
                                appendReadyVideoResult(sourceUrl);
                            }
                        });
                    });
                    menu.appendChild(addPrompt);
                    openLinkedMenu(makeVideo, menu);
                });

                document.body.append(back, makeVideo);
            });
            return image;
        };

        renderResults();
        retryManager.sleep = jest.fn().mockResolvedValue();

        await retryManager.startPromptedBatchFromResultsGallery('slow camera push in', 1);

        expect(submittedPrompt).toBe('slow camera push in');
        expect(window.location.pathname).toBe('/imagine');
        expect(retryManager.goalCount).toBe(1);
        expect(mockOverlay.setStatus).toHaveBeenCalledWith(
            'Prompted Batch [results]: Complete (1/1)',
            'success'
        );
    });

    test('results transition waits for delayed post navigation instead of rejecting the grid', async () => {
        const sourceUrl = 'https://assets.grok.com/users/example/generated/aeaeaeae-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg';
        window.history.pushState({}, '', '/imagine');
        createSavedBatchCard(sourceUrl);
        const token = 'results-delayed-navigation';
        retryManager.batchRunning = true;
        retryManager.batchAborted = false;
        retryManager.batchRunToken = token;
        let sleepCount = 0;
        retryManager.sleep = jest.fn(async () => {
            sleepCount++;
            if (sleepCount === 1) {
                window.history.pushState({}, '', '/imagine/post/delayed-result');
                document.body.innerHTML = '';
            }
        });

        const result = await retryManager.waitForPromptedBatchEditorReady(sourceUrl, token, 1000);

        expect(result).toEqual(expect.objectContaining({
            status: 'ready',
            surface: 'legacy_detail'
        }));
        expect(retryManager.sleep).toHaveBeenCalled();
    });

    test('results transition waits after the selected card action changes to progress', async () => {
        const sourceUrl = 'https://assets.grok.com/users/example/generated/a0a0a0a0-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg';
        window.history.pushState({}, '', '/imagine');
        const { card, makeVideo } = createSavedBatchCard(sourceUrl);
        makeVideo.remove();
        const progress = document.createElement('button');
        progress.setAttribute('aria-label', 'Video Options');
        card.appendChild(progress);
        const token = 'results-delayed-progress-navigation';
        retryManager.batchRunning = true;
        retryManager.batchAborted = false;
        retryManager.batchRunToken = token;
        let sleepCount = 0;
        retryManager.sleep = jest.fn(async () => {
            sleepCount++;
            if (sleepCount === 1) {
                window.history.pushState({}, '', '/imagine/post/delayed-progress-result');
                document.body.innerHTML = '';
            }
        });

        const result = await retryManager.waitForPromptedBatchEditorReady(sourceUrl, token, 1000);

        expect(result).toEqual(expect.objectContaining({
            status: 'ready',
            surface: 'legacy_detail'
        }));
        expect(retryManager.sleep).toHaveBeenCalled();
    });

    test('results return recognizes the original grid after the source action becomes progress', async () => {
        const sourceUrl = 'https://assets.grok.com/users/example/generated/a1a1a1a1-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg';
        window.history.pushState({}, '', '/imagine');
        const { card, makeVideo } = createSavedBatchCard(sourceUrl);
        const receipt = retryManager._captureResultsGalleryReceipt(
            retryManager._getQualifiedResultsGalleryItems()[0]
        );
        makeVideo.remove();
        const progress = document.createElement('button');
        progress.setAttribute('aria-label', 'Video Options');
        card.appendChild(progress);
        window.scrollTo = jest.fn();
        const token = 'results-return-progress';
        retryManager.batchRunning = true;
        retryManager.batchAborted = false;
        retryManager.batchRunToken = token;
        retryManager.batchContext = 'results_gallery';
        retryManager.sleep = jest.fn().mockResolvedValue();

        await expect(retryManager._waitForPromptedBatchResultsSurface(receipt, token, 200))
            .resolves.toBe(true);
    });

    test('results return accepts one in-place source replacement while preserving the anchored grid', async () => {
        const sourcePostId = 'b253dd6b-aa00-4e93-a84d-89954d826d78';
        const nextPostId = '495f114a-bb00-4e93-a84d-89954d826d78';
        const afterPostId = '6a70115b-cc00-4e93-a84d-89954d826d78';
        window.history.pushState({}, '', '/imagine');
        window.scrollTo = jest.fn();
        const source = createSavedBatchCard('data:image/jpeg;base64,source-before');
        const next = createSavedBatchCard('data:image/jpeg;base64,next-before');
        const after = createSavedBatchCard('data:image/jpeg;base64,after-before');
        const sourceLink = document.createElement('a');
        sourceLink.href = `/imagine/post/${sourcePostId}`;
        source.card.insertBefore(sourceLink, source.image);
        sourceLink.appendChild(source.image);
        const nextLink = document.createElement('a');
        nextLink.href = `/imagine/post/${nextPostId}`;
        next.card.insertBefore(nextLink, next.image);
        nextLink.appendChild(next.image);
        const afterLink = document.createElement('a');
        afterLink.href = `/imagine/post/${afterPostId}`;
        after.card.insertBefore(afterLink, after.image);
        afterLink.appendChild(after.image);
        makeVisible(source.card, { top: 0, left: 0 });
        makeVisible(next.card, { top: 100, left: 0 });
        makeVisible(after.card, { top: 200, left: 0 });

        const sourceItem = retryManager._getQualifiedResultsGalleryItems()[0];
        const receipt = retryManager._captureResultsGalleryReceipt(sourceItem);

        expect(receipt).toEqual(expect.objectContaining({
            sourceIdentity: sourcePostId,
            expectedNextIdentity: nextPostId,
            afterIdentities: [nextPostId, afterPostId]
        }));

        source.image.src = `https://assets.grok.com/users/example/generated/${sourcePostId}/preview_image.jpg?cache=1`;
        sourceLink.href = '/imagine/post/a9f0db00-cf12-402f-b0fe-eb3d6e364a2c?conversation=replacement';
        source.makeVideo.remove();
        const progress = document.createElement('button');
        progress.setAttribute('aria-label', 'Video Options');
        source.card.appendChild(progress);
        const token = 'results-return-replaced-source';
        retryManager.batchRunning = true;
        retryManager.batchAborted = false;
        retryManager.batchRunToken = token;
        retryManager.batchContext = 'results_gallery';
        retryManager.sleep = jest.fn().mockResolvedValue();

        await expect(retryManager._waitForPromptedBatchResultsSurface(receipt, token, 200))
            .resolves.toBe(true);
    });

    test('results return accepts a generated video inserted before the original source and resumes at the next image', async () => {
        const sourcePostId = 'b253dd6b-aa00-4e93-a84d-89954d826d78';
        const nextPostId = '495f114a-bb00-4e93-a84d-89954d826d78';
        window.history.pushState({}, '', '/imagine');
        window.scrollTo = jest.fn();
        const source = createSavedBatchCard('data:image/jpeg;base64,source-before');
        const next = createSavedBatchCard('data:image/jpeg;base64,next-before');
        const sourceLink = document.createElement('a');
        sourceLink.href = `/imagine/post/${sourcePostId}`;
        source.card.insertBefore(sourceLink, source.image);
        sourceLink.appendChild(source.image);
        const nextLink = document.createElement('a');
        nextLink.href = `/imagine/post/${nextPostId}`;
        next.card.insertBefore(nextLink, next.image);
        makeVisible(source.card, { top: 0, left: 0 });
        makeVisible(next.card, { top: 100, left: 0 });

        const receipt = retryManager._captureResultsGalleryReceipt(
            retryManager._getQualifiedResultsGalleryItems()[0]
        );
        expect(receipt).toEqual(expect.objectContaining({
            sourceIdentity: sourcePostId,
            expectedNextIdentity: nextPostId
        }));

        source.card.getBoundingClientRect.mockReturnValue({
            x: 0, y: 100, top: 100, left: 0, right: 40, bottom: 140, width: 40, height: 40
        });
        next.card.getBoundingClientRect.mockReturnValue({
            x: 0, y: 200, top: 200, left: 0, right: 40, bottom: 240, width: 40, height: 40
        });
        const inserted = createSavedBatchCard('data:image/jpeg;base64,generated-video');
        const insertedLink = document.createElement('a');
        insertedLink.href = '/imagine/post/a9f0db00-cf12-402f-b0fe-eb3d6e364a2c';
        inserted.card.insertBefore(insertedLink, inserted.image);
        insertedLink.appendChild(inserted.image);
        inserted.makeVideo.remove();
        const progress = document.createElement('button');
        progress.setAttribute('aria-label', 'Video Options');
        inserted.card.appendChild(progress);
        makeVisible(inserted.card, { top: 0, left: 0 });

        const token = 'results-return-inserted-video';
        retryManager.batchRunning = true;
        retryManager.batchAborted = false;
        retryManager.batchRunToken = token;
        retryManager.batchContext = 'results_gallery';
        retryManager.batchProcessedSrcs = new Set([sourcePostId]);
        retryManager.sleep = jest.fn().mockResolvedValue();

        await expect(retryManager._waitForPromptedBatchResultsSurface(receipt, token, 200))
            .resolves.toBe(true);
        expect(retryManager._restorePromptedBatchResultsState(receipt, token)).toBe(true);
        expect(retryManager.batchQueue.map((item) => item.sourceId)).toEqual([nextPostId]);
    });

    test('results return rejects a different grid when a non-source anchor disappears', async () => {
        const sourcePostId = 'b253dd6b-aa00-4e93-a84d-89954d826d78';
        const nextPostId = '495f114a-bb00-4e93-a84d-89954d826d78';
        window.history.pushState({}, '', '/imagine');
        window.scrollTo = jest.fn();
        const source = createSavedBatchCard('data:image/jpeg;base64,source-before');
        const next = createSavedBatchCard('data:image/jpeg;base64,next-before');
        const sourceLink = document.createElement('a');
        sourceLink.href = `/imagine/post/${sourcePostId}`;
        source.card.insertBefore(sourceLink, source.image);
        sourceLink.appendChild(source.image);
        const nextLink = document.createElement('a');
        nextLink.href = `/imagine/post/${nextPostId}`;
        next.card.insertBefore(nextLink, next.image);
        nextLink.appendChild(next.image);
        makeVisible(source.card, { top: 0, left: 0 });
        makeVisible(next.card, { top: 100, left: 0 });
        const receipt = retryManager._captureResultsGalleryReceipt(
            retryManager._getQualifiedResultsGalleryItems()[0]
        );

        sourceLink.href = '/imagine/post/a9f0db00-cf12-402f-b0fe-eb3d6e364a2c';
        next.card.remove();
        const token = 'results-return-different-grid';
        retryManager.batchRunning = true;
        retryManager.batchAborted = false;
        retryManager.batchRunToken = token;
        retryManager.batchContext = 'results_gallery';
        retryManager.sleep = jest.fn().mockResolvedValue();

        await expect(retryManager._waitForPromptedBatchResultsSurface(receipt, token, 200))
            .resolves.toBe(false);
    });

    test('results batch stops with the active run token when video submission fails', async () => {
        window.history.pushState({}, '', '/imagine');
        createSavedBatchCard(
            'https://assets.grok.com/users/example/generated/c1c1c1c1-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg'
        );
        createSavedBatchCard(
            'https://assets.grok.com/users/example/generated/c2c2c2c2-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg'
        );
        const item = retryManager._getQualifiedResultsGalleryItems()[0];
        const token = 'results-submit-failed';
        retryManager.batchRunning = true;
        retryManager.batchAborted = false;
        retryManager.batchRunToken = token;
        retryManager.batchContext = 'results_gallery';
        retryManager.batchPrompt = 'slow camera move';
        retryManager.waitForPromptedBatchEditorReady = jest.fn().mockResolvedValue({
            status: 'ready',
            makeVideoTrigger: document.createElement('button'),
            agentBinding: null
        });
        retryManager.selectMakeVideoMode = jest.fn().mockResolvedValue(true);
        retryManager.injectPromptedVideoText = jest.fn().mockReturnValue(true);
        retryManager._waitForPromptedVideoSubmitButton = jest.fn().mockResolvedValue(true);
        retryManager._capturePromptedVideoSubmissionReceipt = jest.fn().mockReturnValue({
            composerRoot: document.createElement('div')
        });
        retryManager.clickPromptedVideoSubmitButton = jest.fn().mockReturnValue(false);
        const stopSpy = jest.spyOn(retryManager, '_stopPromptedResultsItem').mockResolvedValue(false);

        await retryManager._processPromptedResultsItem(item, token);

        expect(stopSpy).toHaveBeenCalledWith(
            'Prompted Batch [results]: Video submit button not ready',
            expect.any(Object),
            token
        );
    });

    test('results batch returns after an accepted submit without waiting for video generation', async () => {
        window.history.pushState({}, '', '/imagine');
        createSavedBatchCard(
            'https://assets.grok.com/users/example/generated/d1d1d1d1-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg'
        );
        createSavedBatchCard(
            'https://assets.grok.com/users/example/generated/d2d2d2d2-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg'
        );
        const item = retryManager._getQualifiedResultsGalleryItems()[0];
        const token = 'results-submit-accepted';
        retryManager.batchRunning = true;
        retryManager.batchAborted = false;
        retryManager.batchRunToken = token;
        retryManager.batchContext = 'results_gallery';
        retryManager.batchPrompt = 'slow camera move';
        retryManager.batchProcessedSrcs = new Set();
        retryManager.waitForPromptedBatchEditorReady = jest.fn().mockResolvedValue({
            status: 'ready',
            makeVideoTrigger: document.createElement('button'),
            agentBinding: null
        });
        retryManager.selectMakeVideoMode = jest.fn().mockResolvedValue(true);
        retryManager.injectPromptedVideoText = jest.fn().mockReturnValue(true);
        retryManager._waitForPromptedVideoSubmitButton = jest.fn().mockResolvedValue(true);
        retryManager._capturePromptedVideoSubmissionReceipt = jest.fn().mockReturnValue({
            composerRoot: document.createElement('div')
        });
        retryManager.clickPromptedVideoSubmitButton = jest.fn().mockReturnValue(true);
        retryManager._waitForPromptedVideoSubmissionAccepted = jest.fn().mockResolvedValue(true);
        retryManager.awaitBatchItemCompletion = jest.fn(() => {
            throw new Error('results batches must not wait for generated video output');
        });
        retryManager._returnToPromptedBatchResults = jest.fn().mockResolvedValue('returned');

        await expect(retryManager._processPromptedResultsItem(item, token)).resolves.toBe(true);

        expect(retryManager.awaitBatchItemCompletion).not.toHaveBeenCalled();
        expect(retryManager._returnToPromptedBatchResults).toHaveBeenCalledWith(
            expect.objectContaining({
                sourceIdentity: 'd1d1d1d1-bbbb-4ccc-8ddd-eeeeeeeeeeee',
                expectedNextIdentity: 'd2d2d2d2-bbbb-4ccc-8ddd-eeeeeeeeeeee'
            }),
            token
        );
        expect(retryManager.goalCount).toBe(1);
    });

    test('results batch advances after a verified submit click when Grok leaves the detail UI unsettled', async () => {
        window.history.pushState({}, '', '/imagine');
        createSavedBatchCard(
            'https://assets.grok.com/users/example/generated/d3d3d3d3-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg'
        );
        createSavedBatchCard(
            'https://assets.grok.com/users/example/generated/d4d4d4d4-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg'
        );
        const item = retryManager._getQualifiedResultsGalleryItems()[0];
        const token = 'results-submit-unsettled';
        retryManager.batchRunning = true;
        retryManager.batchAborted = false;
        retryManager.batchRunToken = token;
        retryManager.batchContext = 'results_gallery';
        retryManager.batchPrompt = 'slow camera move';
        retryManager.batchProcessedSrcs = new Set();
        retryManager.waitForPromptedBatchEditorReady = jest.fn().mockResolvedValue({
            status: 'ready',
            makeVideoTrigger: document.createElement('button'),
            agentBinding: null
        });
        retryManager.selectMakeVideoMode = jest.fn().mockResolvedValue(true);
        retryManager.injectPromptedVideoText = jest.fn().mockReturnValue(true);
        retryManager._waitForPromptedVideoSubmitButton = jest.fn().mockResolvedValue(true);
        retryManager._capturePromptedVideoSubmissionReceipt = jest.fn().mockReturnValue({
            composerRoot: document.createElement('div')
        });
        retryManager.clickPromptedVideoSubmitButton = jest.fn().mockReturnValue(true);
        retryManager._waitForPromptedVideoSubmissionAccepted = jest.fn().mockResolvedValue(false);
        retryManager._returnToPromptedBatchResults = jest.fn().mockResolvedValue('returned');

        await expect(retryManager._processPromptedResultsItem(item, token)).resolves.toBe(true);

        expect(retryManager.batchProcessedSrcs).toContain(
            'd3d3d3d3-bbbb-4ccc-8ddd-eeeeeeeeeeee'
        );
        expect(retryManager.goalCount).toBe(1);
    });

    test('results batch waits for Grok capacity and resumes when the scoped submit re-enables', async () => {
        const token = 'results-capacity-resumes';
        retryManager.batchRunning = true;
        retryManager.batchAborted = false;
        retryManager.batchRunToken = token;
        retryManager.batchContext = 'results_gallery';
        retryManager.batchPrompt = 'slow camera move';
        const { composer, input, submit } = mountFocusedGrok2VideoComposer({
            submitDisabled: true
        });
        input.textContent = retryManager.batchPrompt;
        retryManager.promptedVideoComposerRoot = composer;
        retryManager._waitForPromptedVideoSubmitButton = jest.fn().mockResolvedValue(null);
        retryManager.sleep = jest.fn().mockImplementation(async () => {
            submit.disabled = false;
        });

        await expect(retryManager._waitForPromptedResultsSubmitButton(token)).resolves.toBe(submit);

        expect(mockOverlay.setStatus).toHaveBeenCalledWith(
            'Prompted Batch [results]: Waiting for Grok capacity...',
            'neutral'
        );
        expect(retryManager.sleep).toHaveBeenCalledTimes(1);
    });

    test('results capacity wait fails closed if the scoped prompt changes', async () => {
        const token = 'results-capacity-prompt-changed';
        retryManager.batchRunning = true;
        retryManager.batchAborted = false;
        retryManager.batchRunToken = token;
        retryManager.batchContext = 'results_gallery';
        retryManager.batchPrompt = 'slow camera move';
        const { composer, input } = mountFocusedGrok2VideoComposer({
            submitDisabled: true
        });
        input.textContent = retryManager.batchPrompt;
        retryManager.promptedVideoComposerRoot = composer;
        retryManager._waitForPromptedVideoSubmitButton = jest.fn().mockResolvedValue(null);
        retryManager.sleep = jest.fn().mockImplementation(async () => {
            input.textContent = 'different prompt';
        });

        await expect(retryManager._waitForPromptedResultsSubmitButton(token)).resolves.toBeNull();

        expect(retryManager.sleep).toHaveBeenCalledTimes(1);
    });

    test('results batch advances without waiting for a source replacement after submit', async () => {
        window.history.pushState({}, '', '/imagine');
        const sourcePostId = 'e1e1e1e1-bbbb-4ccc-8ddd-eeeeeeeeeeee';
        const nextPostId = 'e2e2e2e2-bbbb-4ccc-8ddd-eeeeeeeeeeee';
        const afterPostId = 'e3e3e3e3-bbbb-4ccc-8ddd-eeeeeeeeeeee';
        const generatedPostId = 'e4e4e4e4-bbbb-4ccc-8ddd-eeeeeeeeeeee';
        const source = createSavedBatchCard(
            'https://assets.grok.com/users/example/generated/e1e1e1e1-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg'
        );
        const next = createSavedBatchCard(
            'https://assets.grok.com/users/example/generated/e2e2e2e2-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg'
        );
        const after = createSavedBatchCard(
            'https://assets.grok.com/users/example/generated/e3e3e3e3-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg'
        );
        const sourceLink = document.createElement('a');
        sourceLink.href = `/imagine/post/${sourcePostId}`;
        sourceLink.scrollIntoView = jest.fn();
        source.card.insertBefore(sourceLink, source.image);
        sourceLink.appendChild(source.image);
        const nextLink = document.createElement('a');
        nextLink.href = `/imagine/post/${nextPostId}`;
        next.card.insertBefore(nextLink, next.image);
        nextLink.appendChild(next.image);
        const afterLink = document.createElement('a');
        afterLink.href = `/imagine/post/${afterPostId}`;
        after.card.insertBefore(afterLink, after.image);
        afterLink.appendChild(after.image);
        makeVisible(source.card, { top: 0, bottom: 40 });
        makeVisible(next.card, { top: 100, bottom: 140 });
        makeVisible(after.card, { top: 200, bottom: 240 });
        const item = retryManager._getQualifiedResultsGalleryItems()[0];
        const token = 'results-submit-source-replaced';
        retryManager.batchRunning = true;
        retryManager.batchAborted = false;
        retryManager.batchRunToken = token;
        retryManager.batchContext = 'results_gallery';
        retryManager.batchPrompt = 'slow camera move';
        retryManager.batchProcessedSrcs = new Set();
        retryManager.waitForPromptedBatchEditorReady = jest.fn().mockResolvedValue({
            status: 'ready',
            makeVideoTrigger: document.createElement('button'),
            agentBinding: null
        });
        retryManager.selectMakeVideoMode = jest.fn().mockResolvedValue(true);
        retryManager.injectPromptedVideoText = jest.fn().mockReturnValue(true);
        retryManager._waitForPromptedVideoSubmitButton = jest.fn().mockResolvedValue(true);
        retryManager._capturePromptedVideoSubmissionReceipt = jest.fn().mockReturnValue({
            composerRoot: document.createElement('div')
        });
        retryManager.clickPromptedVideoSubmitButton = jest.fn().mockReturnValue(true);
        retryManager._waitForPromptedVideoSubmissionAccepted = jest.fn().mockResolvedValue(false);
        retryManager._returnToPromptedBatchResults = jest.fn().mockResolvedValue('returned');
        let replacementPolls = 0;
        retryManager.sleep = jest.fn().mockImplementation(async () => {
            replacementPolls++;
            if (replacementPolls === 400) {
                sourceLink.href = `/imagine/post/${generatedPostId}?conversation=conversation-1`;
                source.makeVideo.remove();
                next.card.getBoundingClientRect.mockReturnValue({
                    x: 0, y: 200, top: 200, left: 0, right: 40, bottom: 240, width: 40, height: 40
                });
                after.card.getBoundingClientRect.mockReturnValue({
                    x: 0, y: 100, top: 100, left: 0, right: 40, bottom: 140, width: 40, height: 40
                });
            }
        });

        await expect(retryManager._processPromptedResultsItem(item, token)).resolves.toBe(true);

        expect(retryManager.batchProcessedSrcs).toContain(
            sourcePostId
        );
        expect(retryManager.goalCount).toBe(1);
        expect(replacementPolls).toBe(0);
        expect(mockOverlay.setStatus).not.toHaveBeenCalledWith(
            'Prompted Batch [results]: Video submission was not accepted',
            'warning'
        );
    });

    test('results batch advances without waiting for a generated source video after submit', async () => {
        window.history.pushState({}, '', '/imagine');
        const sourcePostId = 'a1a1a1a1-bbbb-4ccc-8ddd-eeeeeeeeeeee';
        const nextPostId = 'a2a2a2a2-bbbb-4ccc-8ddd-eeeeeeeeeeee';
        const afterPostId = 'a3a3a3a3-bbbb-4ccc-8ddd-eeeeeeeeeeee';
        const generatedVideoId = 'a4a4a4a4-bbbb-4ccc-8ddd-eeeeeeeeeeee';
        const source = createSavedBatchCard(
            `https://assets.grok.com/users/example/generated/${sourcePostId}/image.jpg`
        );
        const next = createSavedBatchCard(
            `https://assets.grok.com/users/example/generated/${nextPostId}/image.jpg`
        );
        const after = createSavedBatchCard(
            `https://assets.grok.com/users/example/generated/${afterPostId}/image.jpg`
        );
        const sourceLink = document.createElement('a');
        sourceLink.href = `/imagine/post/${sourcePostId}`;
        sourceLink.scrollIntoView = jest.fn();
        source.card.insertBefore(sourceLink, source.image);
        sourceLink.appendChild(source.image);
        const nextLink = document.createElement('a');
        nextLink.href = `/imagine/post/${nextPostId}`;
        next.card.insertBefore(nextLink, next.image);
        nextLink.appendChild(next.image);
        const afterLink = document.createElement('a');
        afterLink.href = `/imagine/post/${afterPostId}`;
        after.card.insertBefore(afterLink, after.image);
        afterLink.appendChild(after.image);
        makeVisible(source.card, { top: 0, bottom: 40 });
        makeVisible(next.card, { top: 100, bottom: 140 });
        makeVisible(after.card, { top: 200, bottom: 240 });
        const item = retryManager._getQualifiedResultsGalleryItems()[0];
        const token = 'results-submit-in-place-video';
        retryManager.batchRunning = true;
        retryManager.batchAborted = false;
        retryManager.batchRunToken = token;
        retryManager.batchContext = 'results_gallery';
        retryManager.batchPrompt = 'slow camera move';
        retryManager.batchProcessedSrcs = new Set();
        retryManager.waitForPromptedBatchEditorReady = jest.fn().mockResolvedValue({
            status: 'ready',
            makeVideoTrigger: document.createElement('button'),
            agentBinding: null
        });
        retryManager.selectMakeVideoMode = jest.fn().mockResolvedValue(true);
        retryManager.injectPromptedVideoText = jest.fn().mockReturnValue(true);
        retryManager._waitForPromptedVideoSubmitButton = jest.fn().mockResolvedValue(true);
        retryManager._capturePromptedVideoSubmissionReceipt = jest.fn().mockReturnValue({
            composerRoot: document.createElement('div')
        });
        retryManager.clickPromptedVideoSubmitButton = jest.fn().mockReturnValue(true);
        retryManager._waitForPromptedVideoSubmissionAccepted = jest.fn().mockResolvedValue(false);
        retryManager._returnToPromptedBatchResults = jest.fn().mockResolvedValue('returned');
        let videoPolls = 0;
        retryManager.sleep = jest.fn().mockImplementation(async () => {
            videoPolls++;
            if (videoPolls === 80) {
                source.makeVideo.remove();
                const video = document.createElement('video');
                video.src = `https://assets.grok.com/users/example/generated/${generatedVideoId}/generated_video.mp4`;
                Object.defineProperty(video, 'readyState', { configurable: true, value: 4 });
                Object.defineProperty(video, 'duration', { configurable: true, value: 6 });
                Object.defineProperty(video, 'videoWidth', { configurable: true, value: 400 });
                Object.defineProperty(video, 'videoHeight', { configurable: true, value: 736 });
                source.card.appendChild(video);
                next.card.getBoundingClientRect.mockReturnValue({
                    x: 0, y: 200, top: 200, left: 0, right: 40, bottom: 240, width: 40, height: 40
                });
                after.card.getBoundingClientRect.mockReturnValue({
                    x: 0, y: 100, top: 100, left: 0, right: 40, bottom: 140, width: 40, height: 40
                });
            }
        });

        await expect(retryManager._processPromptedResultsItem(item, token)).resolves.toBe(true);

        expect(sourceLink.href).toBe(`http://localhost/imagine/post/${sourcePostId}`);
        expect(retryManager.batchProcessedSrcs).toContain(sourcePostId);
        expect(retryManager.goalCount).toBe(1);
        expect(videoPolls).toBe(0);
    });

    test('results receipt keeps its source identity when neighboring cards change', () => {
        window.history.pushState({}, '', '/imagine');
        const source = createSavedBatchCard(
            'https://assets.grok.com/users/example/generated/c1c1c1c1-1111-4ccc-8ddd-eeeeeeeeeeee/image.jpg'
        );
        const next = createSavedBatchCard(
            'https://assets.grok.com/users/example/generated/c2c2c2c2-2222-4ccc-8ddd-eeeeeeeeeeee/image.jpg'
        );
        const after = createSavedBatchCard(
            'https://assets.grok.com/users/example/generated/c3c3c3c3-3333-4ccc-8ddd-eeeeeeeeeeee/image.jpg'
        );
        const links = [source, next, after].map(({ card, image }, index) => {
            const link = document.createElement('a');
            link.href = `/imagine/post/c${index + 1}c${index + 1}c${index + 1}c${index + 1}-${index + 1}${index + 1}${index + 1}${index + 1}-4ccc-8ddd-eeeeeeeeeeee`;
            card.insertBefore(link, image);
            link.appendChild(image);
            makeVisible(card, { top: index * 100, bottom: (index * 100) + 40 });
            return link;
        });
        const item = retryManager._getQualifiedResultsGalleryItems()[0];
        const receipt = retryManager._captureResultsGalleryReceipt(item);

        links[0].href = '/imagine/post/d1d1d1d1-1111-4ccc-8ddd-eeeeeeeeeeee';
        source.makeVideo.remove();
        const generatedVideo = document.createElement('video');
        generatedVideo.src = 'https://assets.grok.com/users/example/generated/d1d1d1d1-1111-4ccc-8ddd-eeeeeeeeeeee/generated_video.mp4';
        source.card.appendChild(generatedVideo);
        links[1].href = '/imagine/post/d2d2d2d2-2222-4ccc-8ddd-eeeeeeeeeeee';

        expect(receipt.sourceIdentity).toBe(
            'c1c1c1c1-1111-4ccc-8ddd-eeeeeeeeeeee'
        );
    });

    test('results batch does not wait for a pre-existing source-card video to become ready', async () => {
        window.history.pushState({}, '', '/imagine');
        const sourcePostId = 'b1b1b1b1-bbbb-4ccc-8ddd-eeeeeeeeeeee';
        const source = createSavedBatchCard(
            `https://assets.grok.com/users/example/generated/${sourcePostId}/image.jpg`
        );
        const next = createSavedBatchCard(
            'https://assets.grok.com/users/example/generated/b2b2b2b2-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg'
        );
        const after = createSavedBatchCard(
            'https://assets.grok.com/users/example/generated/b3b3b3b3-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg'
        );
        for (const { card, image } of [source, next, after]) {
            const sourceId = retryManager._getCardSourceId(card);
            const link = document.createElement('a');
            link.href = `/imagine/post/${sourceId}`;
            link.scrollIntoView = jest.fn();
            card.insertBefore(link, image);
            link.appendChild(image);
        }
        const existingVideo = document.createElement('video');
        existingVideo.src = 'https://assets.grok.com/users/example/generated/b4b4b4b4-bbbb-4ccc-8ddd-eeeeeeeeeeee/generated_video.mp4';
        Object.defineProperty(existingVideo, 'readyState', { configurable: true, value: 0 });
        Object.defineProperty(existingVideo, 'duration', { configurable: true, value: 0 });
        Object.defineProperty(existingVideo, 'videoWidth', { configurable: true, value: 0 });
        Object.defineProperty(existingVideo, 'videoHeight', { configurable: true, value: 0 });
        source.card.appendChild(existingVideo);
        const item = retryManager._getQualifiedResultsGalleryItems()[0];
        const token = 'results-submit-existing-video';
        retryManager.batchRunning = true;
        retryManager.batchAborted = false;
        retryManager.batchRunToken = token;
        retryManager.batchContext = 'results_gallery';
        retryManager.batchPrompt = 'slow camera move';
        retryManager.batchProcessedSrcs = new Set();
        retryManager.waitForPromptedBatchEditorReady = jest.fn().mockResolvedValue({
            status: 'ready',
            makeVideoTrigger: document.createElement('button'),
            agentBinding: null
        });
        retryManager.selectMakeVideoMode = jest.fn().mockResolvedValue(true);
        retryManager.injectPromptedVideoText = jest.fn().mockReturnValue(true);
        retryManager._waitForPromptedVideoSubmitButton = jest.fn().mockResolvedValue(true);
        retryManager._capturePromptedVideoSubmissionReceipt = jest.fn().mockReturnValue({
            composerRoot: document.createElement('div')
        });
        retryManager.clickPromptedVideoSubmitButton = jest.fn().mockReturnValue(true);
        retryManager._waitForPromptedVideoSubmissionAccepted = jest.fn().mockResolvedValue(false);
        retryManager._returnToPromptedBatchResults = jest.fn().mockResolvedValue('returned');
        retryManager.sleep = jest.fn().mockImplementation(async () => {
            source.makeVideo.remove();
            Object.defineProperty(existingVideo, 'readyState', { configurable: true, value: 4 });
            Object.defineProperty(existingVideo, 'duration', { configurable: true, value: 6 });
            Object.defineProperty(existingVideo, 'videoWidth', { configurable: true, value: 400 });
            Object.defineProperty(existingVideo, 'videoHeight', { configurable: true, value: 736 });
        });

        await expect(retryManager._processPromptedResultsItem(item, token)).resolves.toBe(true);

        expect(retryManager.batchProcessedSrcs).toContain(sourcePostId);
        expect(retryManager.goalCount).toBe(1);
    });

    test('results batch advances after a verified quiet submit without waiting for replacement', async () => {
        window.history.pushState({}, '', '/imagine');
        createSavedBatchCard(
            'https://assets.grok.com/users/example/generated/f1f1f1f1-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg'
        );
        createSavedBatchCard(
            'https://assets.grok.com/users/example/generated/f2f2f2f2-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg'
        );
        createSavedBatchCard(
            'https://assets.grok.com/users/example/generated/f3f3f3f3-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg'
        );
        const item = retryManager._getQualifiedResultsGalleryItems()[0];
        const token = 'results-submit-source-unchanged';
        retryManager.batchRunning = true;
        retryManager.batchAborted = false;
        retryManager.batchRunToken = token;
        retryManager.batchContext = 'results_gallery';
        retryManager.batchPrompt = 'slow camera move';
        retryManager.batchProcessedSrcs = new Set();
        retryManager.waitForPromptedBatchEditorReady = jest.fn().mockResolvedValue({
            status: 'ready',
            makeVideoTrigger: document.createElement('button'),
            agentBinding: null
        });
        retryManager.selectMakeVideoMode = jest.fn().mockResolvedValue(true);
        retryManager.injectPromptedVideoText = jest.fn().mockReturnValue(true);
        retryManager._waitForPromptedVideoSubmitButton = jest.fn().mockResolvedValue(true);
        retryManager._capturePromptedVideoSubmissionReceipt = jest.fn().mockReturnValue({
            composerRoot: document.createElement('div')
        });
        retryManager.clickPromptedVideoSubmitButton = jest.fn().mockReturnValue(true);
        retryManager._waitForPromptedVideoSubmissionAccepted = jest.fn().mockResolvedValue(false);
        retryManager._returnToPromptedBatchResults = jest.fn().mockResolvedValue('returned');
        retryManager.sleep = jest.fn().mockResolvedValue();

        await expect(retryManager._processPromptedResultsItem(item, token)).resolves.toBe(true);

        expect(retryManager.batchProcessedSrcs).toContain(
            'f1f1f1f1-bbbb-4ccc-8ddd-eeeeeeeeeeee'
        );
        expect(retryManager.goalCount).toBe(1);
        expect(mockOverlay.setStatus).not.toHaveBeenCalledWith(
            'Prompted Batch [results]: Video submission was not accepted',
            'warning'
        );
    });

    test('Stop during results-card targeting prevents navigation and submission', async () => {
        const sourceUrl = 'https://assets.grok.com/users/example/generated/afafafaf-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg';
        window.history.pushState({}, '', '/imagine');
        const { image } = createSavedBatchCard(sourceUrl);
        const imageClick = jest.fn();
        image.addEventListener('click', imageClick);
        image.scrollIntoView = () => retryManager.stopBatch();
        const item = retryManager._getQualifiedResultsGalleryItems()[0];
        const token = 'results-stop-before-open';
        retryManager.batchRunning = true;
        retryManager.batchAborted = false;
        retryManager.batchRunToken = token;
        retryManager.batchContext = 'results_gallery';
        retryManager.batchPrompt = 'do not submit';
        retryManager.batchProcessedSrcs = new Set();

        await retryManager._processPromptedResultsItem(item, token);

        expect(imageClick).not.toHaveBeenCalled();
        expect(retryManager.goalCount).toBe(0);
        expect(retryManager.batchRunning).toBe(false);
    });

    test('results batch can scroll after every visible card changes to progress', async () => {
        const processedUrl = 'https://assets.grok.com/users/example/generated/a2a2a2a2-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg';
        const nextUrl = 'https://assets.grok.com/users/example/generated/a3a3a3a3-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg';
        window.history.pushState({}, '', '/imagine');
        const { card, makeVideo } = createSavedBatchCard(processedUrl);
        makeVideo.remove();
        const progress = document.createElement('button');
        progress.setAttribute('aria-label', 'Video Options');
        card.appendChild(progress);
        window.scrollBy = jest.fn();
        const token = 'results-scroll-after-progress';
        retryManager.batchRunning = true;
        retryManager.batchAborted = false;
        retryManager.batchRunToken = token;
        retryManager.batchMode = 'prompted';
        retryManager.batchContext = 'results_gallery';
        retryManager.batchQueue = [];
        retryManager.batchProcessedSrcs = new Set([
            'a2a2a2a2-bbbb-4ccc-8ddd-eeeeeeeeeeee'
        ]);
        let appended = false;
        retryManager.sleep = jest.fn(async () => {
            if (!appended) {
                appended = true;
                createSavedBatchCard(nextUrl);
            }
        });

        await expect(retryManager.scrollForMore(token)).resolves.toBe(true);
        expect(window.scrollBy).toHaveBeenCalled();
        expect(retryManager.batchQueue).toEqual([
            expect.objectContaining({
                sourceId: 'a3a3a3a3-bbbb-4ccc-8ddd-eeeeeeeeeeee'
            })
        ]);
    });

    test('detectBatchContext keeps an empty Imagine home unsupported', () => {
        window.history.pushState({}, '', '/imagine');

        expect(retryManager.detectBatchContext()).toBe('unsupported');
    });

    test('startBatch(prompted) keeps detail settings on the durable Prompted runner', async () => {
        const durableSpy = jest.spyOn(retryManager, '_startPromptedBatchDurable').mockResolvedValue(true);

        await retryManager.startBatch('prompted', 'detail prompt', { galleryLimit: 4, videoGoal: 6 });

        expect(durableSpy).toHaveBeenCalledWith('detail prompt', { galleryLimit: 4, videoGoal: 6 });
    });

    test('rejects an overlapping batch start without replacing the active run state', async () => {
        let releaseFirst;
        const durableSpy = jest.spyOn(retryManager, '_startPromptedBatchDurable')
            .mockImplementation(() => new Promise((resolve) => { releaseFirst = resolve; }));

        const firstRun = retryManager.startBatch('prompted', 'first prompt', { galleryLimit: 1 });
        await Promise.resolve();
        const secondRun = retryManager.startBatch('prompted', 'second prompt', { galleryLimit: 9 });
        releaseFirst(true);
        const [, secondResult] = await Promise.all([firstRun, secondRun]);

        expect(secondResult).toBe(false);
        expect(durableSpy).toHaveBeenCalledTimes(1);
        expect(durableSpy).toHaveBeenCalledWith('first prompt', { galleryLimit: 1 });
        expect(mockOverlay.setStatus).toHaveBeenCalledWith(
            'A generation run is already active',
            'warning'
        );
    });

    test('prompted Saved batch submits through Agent Mode and restores the Saved scroll position', async () => {
        const sourceUrl = 'https://assets.grok.com/users/example/generated/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg';
        const originalScrollY = 240;
        let submitted = 0;

        Object.defineProperty(window, 'scrollY', { value: originalScrollY, configurable: true });
        window.scrollTo = jest.fn();
        window.history.pushState({}, '', '/imagine/saved');

        const renderSavedCard = () => {
            document.body.innerHTML = '';
            mountSavedScope('all');
            const card = document.createElement('div');
            card.setAttribute('role', 'listitem');
            const image = document.createElement('img');
            image.alt = 'Generated image';
            image.src = sourceUrl;
            image.scrollIntoView = jest.fn();
            const makeVideo = document.createElement('button');
            makeVideo.setAttribute('aria-label', 'Make video');
            card.append(image, makeVideo);
            document.body.appendChild(card);
            return { card, image };
        };

        const { image } = renderSavedCard();
        image.addEventListener('click', () => {
            window.history.pushState({}, '', '/imagine/agent/agent-1?conversation=conversation-1');
            document.body.innerHTML = `
                <div class="react-flow__node-asset selected" data-id="asset-source">
                    <img src="${sourceUrl}">
                </div>
                <div class="query-bar"></div>
            `;

            const back = makeVisible(document.createElement('button'));
            back.setAttribute('aria-label', 'Back');
            back.addEventListener('click', () => {
                window.history.pushState({}, '', '/imagine/saved');
                renderSavedCard();
            });

            const makeVideo = makeVisible(document.createElement('button'));
            makeVideo.setAttribute('aria-label', 'Make Video');
            makeVideo.setAttribute('aria-haspopup', 'menu');
            makeVideo.addEventListener('click', () => {
                const menu = makeVisible(document.createElement('div'));
                const addPrompt = createMenuItem('Add Prompt', () => {
                    mountFocusedPromptedVideoComposer({
                        onSubmit: (event) => {
                            event.currentTarget.disabled = true;
                            submitted++;
                            appendReadyVideoResult(sourceUrl);
                        }
                    });
                    addPrompt.remove();
                });
                menu.appendChild(addPrompt);
                openLinkedMenu(makeVideo, menu);
            });
            document.body.append(back, makeVideo);
        });

        retryManager.sleep = jest.fn().mockResolvedValue();

        await retryManager.startPromptedBatchFromGallery('slow camera push in', 1);

        expect(submitted).toBe(1);
        expect(window.location.pathname).toBe('/imagine/saved');
        expect(window.scrollTo).toHaveBeenCalledWith(0, originalScrollY);
        expect(retryManager.goalCount).toBe(1);
    });

    test('waits for delayed exact Agent media and Make Video readiness before acting', async () => {
        const sourceUrl = 'https://assets.grok.com/users/example/generated/02020202-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg';
        let submitted = 0;
        let readinessPolls = 0;
        window.history.pushState({}, '', '/imagine/saved');

        const renderSaved = () => {
            document.body.innerHTML = '';
            return createSavedBatchCard(sourceUrl);
        };
        const { image } = renderSaved();
        image.addEventListener('click', () => {
            window.history.pushState({}, '', '/imagine/agent/agent-2?conversation=conversation-2');
            document.body.innerHTML = '';
            const decoyNode = document.createElement('div');
            decoyNode.className = 'react-flow__node-asset';
            decoyNode.setAttribute('data-id', 'asset-decoy');
            const decoyMedia = document.createElement('img');
            decoyMedia.src = 'https://assets.grok.com/users/example/generated/12121212-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg';
            decoyNode.appendChild(decoyMedia);
            const back = makeVisible(document.createElement('button'));
            back.setAttribute('aria-label', 'Back');
            back.addEventListener('click', () => {
                window.history.pushState({}, '', '/imagine/saved');
                renderSaved();
            });
            document.body.append(decoyNode, back);
        });
        retryManager.sleep = jest.fn().mockImplementation(async () => {
            readinessPolls++;
            if (readinessPolls === 1) {
                const node = document.createElement('div');
                node.className = 'react-flow__node-asset selected';
                node.setAttribute('data-id', 'asset-source');
                const media = document.createElement('img');
                media.src = sourceUrl;
                node.appendChild(media);
                document.body.appendChild(node);
            }
            if (readinessPolls === 2) {
                const makeVideo = makeVisible(document.createElement('button'));
                makeVideo.setAttribute('aria-label', 'Make Video');
                makeVideo.setAttribute('aria-haspopup', 'menu');
                makeVideo.addEventListener('click', () => {
                    const menu = makeVisible(document.createElement('div'));
                    const addPrompt = createMenuItem('Add Prompt', () => {
                        mountFocusedPromptedVideoComposer({
                            onSubmit: (event) => {
                                event.currentTarget.disabled = true;
                                submitted++;
                                appendReadyVideoResult(sourceUrl);
                            }
                        });
                    });
                    menu.appendChild(addPrompt);
                    openLinkedMenu(makeVideo, menu);
                });
                document.body.appendChild(makeVideo);
            }
        });

        await retryManager.startPromptedBatchFromGallery('slow camera push in', 1);

        expect(readinessPolls).toBeGreaterThanOrEqual(2);
        expect(submitted).toBe(1);
        expect(retryManager.goalCount).toBe(1);
    });

    test('binds the exact Agent asset before choosing the side-panel Make Video action', async () => {
        const token = 'exact-agent-binding';
        const sourceUrl = 'https://assets.grok.com/users/example/generated/12121212-aaaa-4bbb-8ccc-343434343434/image.jpg';
        window.history.pushState({}, '', '/imagine/agent/exact-binding?conversation=exact-binding');

        const asset = document.createElement('div');
        asset.className = 'react-flow__node-asset';
        asset.setAttribute('data-id', 'asset-source');
        const image = document.createElement('img');
        image.src = sourceUrl;
        asset.appendChild(image);
        const assetClick = jest.fn(() => asset.classList.add('selected'));
        asset.addEventListener('click', assetClick);

        const toolbar = document.createElement('div');
        toolbar.className = 'react-flow__node-toolbar';
        toolbar.setAttribute('data-id', 'asset-source');
        const dangerousToolbarAction = makeVisible(document.createElement('button'));
        dangerousToolbarAction.setAttribute('aria-label', 'Make Video');
        dangerousToolbarAction.setAttribute('aria-haspopup', 'menu');
        dangerousToolbarAction.click = jest.fn();
        toolbar.appendChild(dangerousToolbarAction);

        const sidePanelAction = makeVisible(document.createElement('button'));
        sidePanelAction.setAttribute('aria-label', 'Make Video');
        sidePanelAction.setAttribute('aria-haspopup', 'menu');
        document.body.append(asset, toolbar, sidePanelAction);
        retryManager.batchRunning = true;
        retryManager.batchAborted = false;
        retryManager.batchRunToken = token;
        retryManager.sleep = jest.fn().mockResolvedValue();
        await Promise.resolve();

        const result = await retryManager.waitForPromptedBatchEditorReady(sourceUrl, token, 1000);

        expect(result).toMatchObject({
            status: 'ready',
            surface: 'agent_media',
            makeVideoTrigger: sidePanelAction,
            agentBinding: {
                assetNodeId: 'asset-source',
                sourceIdentity: '12121212-aaaa-4bbb-8ccc-343434343434'
            }
        });
        expect(assetClick).toHaveBeenCalledTimes(1);
        expect(dangerousToolbarAction.click).not.toHaveBeenCalled();
    });

    test('reselects the exact Agent asset when React remounts its node during selection', async () => {
        const token = 'remounted-agent-asset';
        const sourceUrl = 'https://assets.grok.com/users/example/generated/13131313-aaaa-4bbb-8ccc-353535353535/image.jpg';
        window.history.pushState({}, '', '/imagine/agent/remounted-asset?conversation=remounted-asset');

        const createAsset = () => {
            const asset = document.createElement('div');
            asset.className = 'react-flow__node-asset';
            asset.setAttribute('data-id', 'asset-source');
            const image = document.createElement('img');
            image.src = sourceUrl;
            asset.appendChild(image);
            return asset;
        };
        const originalAsset = createAsset();
        const replacementAsset = createAsset();
        const replacementClick = jest.fn(() => replacementAsset.classList.add('selected'));
        replacementAsset.addEventListener('click', replacementClick);
        originalAsset.addEventListener('click', () => originalAsset.replaceWith(replacementAsset));

        const sidePanelAction = makeVisible(document.createElement('button'));
        sidePanelAction.setAttribute('aria-label', 'Make Video');
        sidePanelAction.setAttribute('aria-haspopup', 'menu');
        document.body.append(originalAsset, sidePanelAction);
        retryManager.batchRunning = true;
        retryManager.batchAborted = false;
        retryManager.batchRunToken = token;
        retryManager.sleep = jest.fn().mockResolvedValue();

        const result = await retryManager.waitForPromptedBatchEditorReady(sourceUrl, token, 1000);

        expect(result).toMatchObject({
            status: 'ready',
            surface: 'agent_media',
            makeVideoTrigger: sidePanelAction
        });
        expect(replacementClick).toHaveBeenCalledTimes(1);
    });

    test('returns the stable selected-asset action after the side panel remounts', async () => {
        const token = 'remounted-agent-action';
        const sourceUrl = 'https://assets.grok.com/users/example/generated/14141414-aaaa-4bbb-8ccc-363636363636/image.jpg';
        window.history.pushState({}, '', '/imagine/agent/remounted-action?conversation=remounted-action');
        document.body.innerHTML = `
            <div class="react-flow__node-asset selected" data-id="asset-source">
                <img src="${sourceUrl}">
            </div>
        `;
        const originalAction = makeVisible(document.createElement('button'));
        originalAction.setAttribute('aria-label', 'Make Video');
        originalAction.setAttribute('aria-haspopup', 'menu');
        const replacementAction = makeVisible(document.createElement('button'));
        replacementAction.setAttribute('aria-label', 'Make Video');
        replacementAction.setAttribute('aria-haspopup', 'menu');
        document.body.appendChild(originalAction);
        let replaced = false;
        retryManager.sleep = jest.fn().mockImplementation(async () => {
            if (!replaced) {
                replaced = true;
                originalAction.replaceWith(replacementAction);
            }
        });
        retryManager.batchRunning = true;
        retryManager.batchAborted = false;
        retryManager.batchRunToken = token;

        const result = await retryManager.waitForPromptedBatchEditorReady(sourceUrl, token, 1000);

        expect(result).toMatchObject({
            status: 'ready',
            surface: 'agent_media',
            makeVideoTrigger: replacementAction
        });
        expect(retryManager.sleep).toHaveBeenCalled();
    });

    test('fails closed when Agent Mode exposes two side-panel Make Video actions', async () => {
        const token = 'ambiguous-agent-action';
        const sourceUrl = 'https://assets.grok.com/users/example/generated/23232323-aaaa-4bbb-8ccc-454545454545/image.jpg';
        window.history.pushState({}, '', '/imagine/agent/ambiguous-action?conversation=ambiguous-action');
        document.body.innerHTML = `
            <div class="react-flow__node-asset selected" data-id="asset-source">
                <img src="${sourceUrl}">
            </div>
        `;
        for (let index = 0; index < 2; index++) {
            const trigger = makeVisible(document.createElement('button'));
            trigger.setAttribute('aria-label', 'Make Video');
            trigger.setAttribute('aria-haspopup', 'menu');
            document.body.appendChild(trigger);
        }
        retryManager.batchRunning = true;
        retryManager.batchAborted = false;
        retryManager.batchRunToken = token;
        retryManager.sleep = jest.fn().mockResolvedValue();
        await Promise.resolve();

        await expect(retryManager.waitForPromptedBatchEditorReady(sourceUrl, token, 1000))
            .resolves.toMatchObject({ status: 'ambiguous_action', surface: 'agent_media' });
    });

    test('fails closed when the exact Agent asset has no stable data id', async () => {
        const token = 'unbound-agent-asset';
        const sourceUrl = 'https://assets.grok.com/users/example/generated/34343434-aaaa-4bbb-8ccc-565656565656/image.jpg';
        window.history.pushState({}, '', '/imagine/agent/unbound?conversation=unbound');
        document.body.innerHTML = `
            <div class="react-flow__node-asset selected"><img src="${sourceUrl}"></div>
        `;
        const trigger = makeVisible(document.createElement('button'));
        trigger.setAttribute('aria-label', 'Make Video');
        trigger.setAttribute('aria-haspopup', 'menu');
        document.body.appendChild(trigger);
        retryManager.batchRunning = true;
        retryManager.batchAborted = false;
        retryManager.batchRunToken = token;
        retryManager.sleep = jest.fn().mockResolvedValue();
        await Promise.resolve();

        await expect(retryManager.waitForPromptedBatchEditorReady(sourceUrl, token, 1000))
            .resolves.toMatchObject({ status: 'unbound', surface: 'agent_media' });
    });

    test('selection drift after opening Make Video prevents Add Prompt and composer writes', async () => {
        const sourceUrl = 'https://assets.grok.com/users/example/generated/45454545-aaaa-4bbb-8ccc-676767676767/image.jpg';
        window.history.pushState({}, '', '/imagine/agent/selection-drift?conversation=selection-drift');
        const sourceAsset = document.createElement('div');
        sourceAsset.className = 'react-flow__node-asset selected';
        sourceAsset.setAttribute('data-id', 'asset-source');
        const sourceImage = document.createElement('img');
        sourceImage.src = sourceUrl;
        sourceAsset.appendChild(sourceImage);
        const otherAsset = document.createElement('div');
        otherAsset.className = 'react-flow__node-asset';
        otherAsset.setAttribute('data-id', 'asset-other');
        const otherImage = document.createElement('img');
        otherImage.src = 'https://assets.grok.com/users/example/generated/56565656-aaaa-4bbb-8ccc-787878787878/image.jpg';
        otherAsset.appendChild(otherImage);
        const trigger = makeVisible(document.createElement('button'));
        trigger.setAttribute('aria-label', 'Make Video');
        trigger.setAttribute('aria-haspopup', 'menu');
        let addPromptClicks = 0;
        trigger.addEventListener('click', () => {
            sourceAsset.classList.remove('selected');
            otherAsset.classList.add('selected');
            const menu = makeVisible(document.createElement('div'));
            menu.appendChild(createMenuItem('Add Prompt', () => {
                addPromptClicks++;
                mountFocusedPromptedVideoComposer();
            }));
            openLinkedMenu(trigger, menu);
        });
        document.body.append(sourceAsset, otherAsset, trigger);
        retryManager.sleep = jest.fn().mockResolvedValue();
        retryManager.simulateClick = jest.fn((element) => element.click());
        await Promise.resolve();
        const binding = {
            assetNodeId: 'asset-source',
            sourceIdentity: '45454545-aaaa-4bbb-8ccc-676767676767',
            sourceUrl
        };

        await expect(retryManager.selectMakeVideoMode(undefined, trigger, binding)).resolves.toBe(false);
        expect(addPromptClicks).toBe(0);
        expect(document.querySelector('.query-bar')).toBeNull();
    });

    test('uses the semantic generated image when a decoy image appears first in the Saved card', async () => {
        const sourceUrl = 'https://assets.grok.com/users/example/generated/03030303-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg';
        const decoyUrl = 'https://assets.grok.com/users/example/generated/04040404-bbbb-4ccc-8ddd-eeeeeeeeeeee/avatar.jpg';
        let submitted = 0;
        window.history.pushState({}, '', '/imagine/saved');

        const renderSaved = (onClick = null) => {
            document.body.innerHTML = '';
            const saved = createSavedBatchCard(sourceUrl, onClick);
            const decoy = document.createElement('img');
            decoy.alt = 'Account avatar';
            decoy.src = decoyUrl;
            saved.card.prepend(decoy);
            return saved;
        };
        renderSaved(() => {
            window.history.pushState({}, '', '/imagine/agent/agent-3?conversation=conversation-3');
            renderAgentEditor({
                sourceUrl,
                onSubmit: () => { submitted++; },
                onBack: () => {
                    window.history.pushState({}, '', '/imagine/saved');
                    renderSaved();
                }
            });
        });
        retryManager.sleep = jest.fn().mockResolvedValue();

        await retryManager.startPromptedBatchFromGallery('slow camera push in', 1);

        expect(submitted).toBe(1);
        expect(retryManager.batchProcessedSrcs.has('03030303-bbbb-4ccc-8ddd-eeeeeeeeeeee')).toBe(true);
        expect(retryManager.batchProcessedSrcs.has('04040404-bbbb-4ccc-8ddd-eeeeeeeeeeee')).toBe(false);
    });

    test('prompted Saved batch accepts a legacy detail editor route', async () => {
        const sourceUrl = 'https://assets.grok.com/users/example/generated/abababab-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg';
        let submitted = 0;
        window.history.pushState({}, '', '/imagine/saved');
        createSavedBatchCard(sourceUrl, () => {
            window.history.pushState({}, '', '/imagine/post/post-1');
            renderAgentEditor({
                sourceUrl,
                includeAgentAsset: false,
                onSubmit: () => { submitted++; },
                onBack: () => {
                    window.history.pushState({}, '', '/imagine/saved');
                    document.body.innerHTML = '';
                    createSavedBatchCard(sourceUrl);
                }
            });
        });
        retryManager.sleep = jest.fn().mockResolvedValue();

        await retryManager.startPromptedBatchFromGallery('slow camera push in', 1);

        expect(submitted).toBe(1);
        expect(window.location.pathname).toBe('/imagine/saved');
        expect(retryManager.goalCount).toBe(1);
    });

    test('a dispatched Prompted Batch click without an acceptance signal stays eligible and does not advance', async () => {
        const sourceUrl = 'https://assets.grok.com/users/example/generated/acacacac-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg';
        window.history.pushState({}, '', '/imagine/saved');
        const first = createSavedBatchCard(sourceUrl, () => {
            window.history.pushState({}, '', '/imagine/agent/no-result?conversation=no-result');
            renderAgentEditor({
                sourceUrl,
                produceResult: false,
                settleSubmit: false,
                onBack: () => {
                    window.history.pushState({}, '', '/imagine/saved');
                    document.body.innerHTML = '';
                    createSavedBatchCard(sourceUrl);
                }
            });
        });
        primePromptedGalleryBatch(retryManager, { button: first.makeVideo, container: first.card });
        retryManager.awaitBatchItemCompletion = jest.fn();
        const acceptanceSpy = jest.spyOn(retryManager, '_waitForPromptedVideoSubmissionAccepted');
        retryManager.sleep = jest.fn().mockResolvedValue();
        const runToken = retryManager.batchRunToken;
        const processedSrcs = retryManager.batchProcessedSrcs;

        await retryManager.processBatchItemPrompted(
            { button: first.makeVideo, container: first.card },
            runToken
        );

        expect(acceptanceSpy).toHaveBeenCalledWith(
            expect.any(Object),
            runToken
        );
        expect(acceptanceSpy.mock.calls[0][0]).not.toHaveProperty('progressCount');
        expect(acceptanceSpy.mock.calls[0][0]).not.toHaveProperty('videoResultBaseline');
        expect(retryManager.awaitBatchItemCompletion).not.toHaveBeenCalled();
        expect(processedSrcs.has('acacacac-bbbb-4ccc-8ddd-eeeeeeeeeeee')).toBe(false);
        expect(retryManager.goalCount).toBe(0);
        expect(retryManager.batchRunning).toBe(false);
        expect(window.location.pathname).toBe('/imagine/saved');
    });

    test('prompted Saved batch stops without injection or submit when its click never leaves Saved', async () => {
        const sourceUrl = 'https://assets.grok.com/users/example/generated/bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg';
        window.history.pushState({}, '', '/imagine/saved');
        const first = createSavedBatchCard(sourceUrl);
        const next = createSavedBatchCard('https://assets.grok.com/users/example/generated/cccccccc-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg');
        const nextClick = jest.fn();
        next.image.addEventListener('click', nextClick);
        primePromptedGalleryBatch(retryManager, { button: first.makeVideo, container: first.card });
        retryManager.waitForPromptedBatchEditorReady = jest.fn().mockResolvedValue({
            status: 'timeout',
            surface: 'saved_gallery'
        });
        retryManager.injectPromptedVideoText = jest.fn().mockReturnValue(true);
        retryManager.clickPromptedVideoSubmitButton = jest.fn().mockReturnValue(true);

        await retryManager.processBatchItemPrompted({ button: first.makeVideo, container: first.card }, retryManager.batchRunToken);

        expect(retryManager.injectPromptedVideoText).not.toHaveBeenCalled();
        expect(retryManager.clickPromptedVideoSubmitButton).not.toHaveBeenCalled();
        expect(retryManager.goalCount).toBe(0);
        expect(nextClick).not.toHaveBeenCalled();
    });

    test('prompted Saved batch stops without injection or submit on an unsupported destination', async () => {
        const sourceUrl = 'https://assets.grok.com/users/example/generated/dddddddd-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg';
        window.history.pushState({}, '', '/imagine/saved');
        const first = createSavedBatchCard(sourceUrl, () => {
            window.history.pushState({}, '', '/imagine');
            document.body.innerHTML = '';
            const back = makeVisible(document.createElement('button'));
            back.setAttribute('aria-label', 'Back');
            back.addEventListener('click', () => {
                window.history.pushState({}, '', '/imagine/saved');
                document.body.innerHTML = '';
                createSavedBatchCard(sourceUrl);
            });
            document.body.appendChild(back);
        });
        const nextClick = addNextCardClickProbe();
        primePromptedGalleryBatch(retryManager, { button: first.makeVideo, container: first.card });
        retryManager.sleep = jest.fn().mockResolvedValue();
        retryManager.injectPromptedVideoText = jest.fn().mockReturnValue(true);
        retryManager.clickPromptedVideoSubmitButton = jest.fn().mockReturnValue(true);

        await retryManager.processBatchItemPrompted({ button: first.makeVideo, container: first.card }, retryManager.batchRunToken);

        expect(retryManager.injectPromptedVideoText).not.toHaveBeenCalled();
        expect(retryManager.clickPromptedVideoSubmitButton).not.toHaveBeenCalled();
        expect(retryManager.goalCount).toBe(0);
        expect(retryManager.batchRunning).toBe(false);
        expect(nextClick).not.toHaveBeenCalled();
    });

    test('prompted Agent batch stops without injection or submit when Make Video is unavailable', async () => {
        const sourceUrl = 'https://assets.grok.com/users/example/generated/eeeeeeee-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg';
        window.history.pushState({}, '', '/imagine/saved');
        const first = createSavedBatchCard(sourceUrl, () => {
            window.history.pushState({}, '', '/imagine/agent/agent-1?conversation=conversation-1');
            renderAgentEditor({
                sourceUrl,
                makeVideo: false,
                onBack: () => {
                    window.history.pushState({}, '', '/imagine/saved');
                    document.body.innerHTML = '';
                    createSavedBatchCard(sourceUrl);
                }
            });
        });
        const nextClick = addNextCardClickProbe();
        primePromptedGalleryBatch(retryManager, { button: first.makeVideo, container: first.card });
        retryManager.sleep = jest.fn().mockResolvedValue();
        retryManager.injectPromptedVideoText = jest.fn().mockReturnValue(true);
        retryManager.clickPromptedVideoSubmitButton = jest.fn().mockReturnValue(true);

        await retryManager.processBatchItemPrompted({ button: first.makeVideo, container: first.card }, retryManager.batchRunToken);

        expect(retryManager.injectPromptedVideoText).not.toHaveBeenCalled();
        expect(retryManager.clickPromptedVideoSubmitButton).not.toHaveBeenCalled();
        expect(retryManager.goalCount).toBe(0);
        expect(retryManager.batchRunning).toBe(false);
        expect(nextClick).not.toHaveBeenCalled();
    });

    test('prompted Agent batch stops without injection or submit when Add Prompt never appears', async () => {
        const sourceUrl = 'https://assets.grok.com/users/example/generated/ffffffff-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg';
        window.history.pushState({}, '', '/imagine/saved');
        const first = createSavedBatchCard(sourceUrl, () => {
            window.history.pushState({}, '', '/imagine/agent/agent-1?conversation=conversation-1');
            renderAgentEditor({
                sourceUrl,
                addPrompt: false,
                onBack: () => {
                    window.history.pushState({}, '', '/imagine/saved');
                    document.body.innerHTML = '';
                    createSavedBatchCard(sourceUrl);
                }
            });
        });
        const nextClick = addNextCardClickProbe();
        primePromptedGalleryBatch(retryManager, { button: first.makeVideo, container: first.card });
        retryManager.sleep = jest.fn().mockResolvedValue();
        retryManager.injectPromptedVideoText = jest.fn().mockReturnValue(true);
        retryManager.clickPromptedVideoSubmitButton = jest.fn().mockReturnValue(true);

        await retryManager.processBatchItemPrompted({ button: first.makeVideo, container: first.card }, retryManager.batchRunToken);

        expect(retryManager.injectPromptedVideoText).not.toHaveBeenCalled();
        expect(retryManager.clickPromptedVideoSubmitButton).not.toHaveBeenCalled();
        expect(retryManager.goalCount).toBe(0);
        expect(retryManager.batchRunning).toBe(false);
        expect(nextClick).not.toHaveBeenCalled();
    });

    test('prompted Agent batch stops without injection or submit when the video composer never appears', async () => {
        const sourceUrl = 'https://assets.grok.com/users/example/generated/11111111-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg';
        window.history.pushState({}, '', '/imagine/saved');
        const first = createSavedBatchCard(sourceUrl, () => {
            window.history.pushState({}, '', '/imagine/agent/agent-1?conversation=conversation-1');
            renderAgentEditor({
                sourceUrl,
                composer: false,
                onBack: () => {
                    window.history.pushState({}, '', '/imagine/saved');
                    document.body.innerHTML = '';
                    createSavedBatchCard(sourceUrl);
                }
            });
        });
        primePromptedGalleryBatch(retryManager, { button: first.makeVideo, container: first.card });
        retryManager.sleep = jest.fn().mockResolvedValue();
        retryManager.injectPromptedVideoText = jest.fn().mockReturnValue(true);
        retryManager.clickPromptedVideoSubmitButton = jest.fn().mockReturnValue(true);

        await retryManager.processBatchItemPrompted({ button: first.makeVideo, container: first.card }, retryManager.batchRunToken);

        expect(retryManager.injectPromptedVideoText).not.toHaveBeenCalled();
        expect(retryManager.clickPromptedVideoSubmitButton).not.toHaveBeenCalled();
        expect(retryManager.goalCount).toBe(0);
        expect(retryManager.batchRunning).toBe(false);
    });

    test('Stop before a Saved card click blocks prompt injection, submit, counter changes, and later cards', async () => {
        const sourceUrl = 'https://assets.grok.com/users/example/generated/22222222-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg';
        window.history.pushState({}, '', '/imagine/saved');
        const first = createSavedBatchCard(sourceUrl);
        const next = createSavedBatchCard('https://assets.grok.com/users/example/generated/33333333-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg');
        const firstClick = jest.fn();
        const nextClick = jest.fn();
        first.image.addEventListener('click', firstClick);
        next.image.addEventListener('click', nextClick);
        primePromptedGalleryBatch(retryManager, { button: first.makeVideo, container: first.card });
        retryManager.stopBatch();
        retryManager.injectPromptedVideoText = jest.fn().mockReturnValue(true);
        retryManager.clickPromptedVideoSubmitButton = jest.fn().mockReturnValue(true);

        await retryManager.processBatchItemPrompted({ button: first.makeVideo, container: first.card }, 'batch-test-token');

        expect(firstClick).not.toHaveBeenCalled();
        expect(retryManager.injectPromptedVideoText).not.toHaveBeenCalled();
        expect(retryManager.clickPromptedVideoSubmitButton).not.toHaveBeenCalled();
        expect(retryManager.goalCount).toBe(0);
        expect(nextClick).not.toHaveBeenCalled();
    });

    test('Stop during the editor-surface wait blocks prompt injection, submit, counter changes, and later cards', async () => {
        const sourceUrl = 'https://assets.grok.com/users/example/generated/44444444-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg';
        window.history.pushState({}, '', '/imagine/saved');
        const first = createSavedBatchCard(sourceUrl);
        const next = createSavedBatchCard('https://assets.grok.com/users/example/generated/55555555-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg');
        const nextClick = jest.fn();
        next.image.addEventListener('click', nextClick);
        primePromptedGalleryBatch(retryManager, { button: first.makeVideo, container: first.card });
        retryManager.sleep = jest.fn().mockImplementation(async () => retryManager.stopBatch());
        retryManager.injectPromptedVideoText = jest.fn().mockReturnValue(true);
        retryManager.clickPromptedVideoSubmitButton = jest.fn().mockReturnValue(true);

        await retryManager.processBatchItemPrompted({ button: first.makeVideo, container: first.card }, retryManager.batchRunToken);

        expect(retryManager.injectPromptedVideoText).not.toHaveBeenCalled();
        expect(retryManager.clickPromptedVideoSubmitButton).not.toHaveBeenCalled();
        expect(retryManager.goalCount).toBe(0);
        expect(nextClick).not.toHaveBeenCalled();
    });

    test('Stop after Add Prompt blocks prompt injection, submit, counter changes, and later cards', async () => {
        const sourceUrl = 'https://assets.grok.com/users/example/generated/66666666-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg';
        window.history.pushState({}, '', '/imagine/saved');
        const first = createSavedBatchCard(sourceUrl, () => {
            window.history.pushState({}, '', '/imagine/agent/agent-1?conversation=conversation-1');
            document.body.innerHTML = `<div class="react-flow__node-asset selected" data-id="asset-source"><img src="${sourceUrl}"></div>`;
            const makeVideo = makeVisible(document.createElement('button'));
            makeVideo.setAttribute('aria-label', 'Make Video');
            makeVideo.setAttribute('aria-haspopup', 'menu');
            makeVideo.addEventListener('click', () => {
                const menu = makeVisible(document.createElement('div'));
                menu.appendChild(createMenuItem('Add Prompt', () => retryManager.stopBatch()));
                openLinkedMenu(makeVideo, menu);
            });
            document.body.appendChild(makeVideo);
        });
        const nextClick = addNextCardClickProbe();
        primePromptedGalleryBatch(retryManager, { button: first.makeVideo, container: first.card });
        retryManager.sleep = jest.fn().mockResolvedValue();
        retryManager.injectPromptedVideoText = jest.fn().mockReturnValue(true);
        retryManager.clickPromptedVideoSubmitButton = jest.fn().mockReturnValue(true);

        await retryManager.processBatchItemPrompted({ button: first.makeVideo, container: first.card }, retryManager.batchRunToken);

        expect(retryManager.injectPromptedVideoText).not.toHaveBeenCalled();
        expect(retryManager.clickPromptedVideoSubmitButton).not.toHaveBeenCalled();
        expect(retryManager.goalCount).toBe(0);
        expect(nextClick).not.toHaveBeenCalled();
    });

    test('Stop before submit blocks submit, counter changes, and later cards after writing the prompt', async () => {
        const sourceUrl = 'https://assets.grok.com/users/example/generated/77777777-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg';
        window.history.pushState({}, '', '/imagine/saved');
        const first = createSavedBatchCard(sourceUrl, () => {
            window.history.pushState({}, '', '/imagine/agent/agent-1?conversation=conversation-1');
            renderAgentEditor({ sourceUrl });
        });
        const nextClick = addNextCardClickProbe();
        primePromptedGalleryBatch(retryManager, { button: first.makeVideo, container: first.card });
        retryManager.injectPromptedVideoText = jest.fn(() => {
            retryManager.stopBatch();
            return true;
        });
        retryManager.clickPromptedVideoSubmitButton = jest.fn().mockReturnValue(true);

        await retryManager.processBatchItemPrompted({ button: first.makeVideo, container: first.card }, retryManager.batchRunToken);

        expect(retryManager.injectPromptedVideoText).toHaveBeenCalledWith('slow camera push in');
        expect(retryManager.clickPromptedVideoSubmitButton).not.toHaveBeenCalled();
        expect(retryManager.goalCount).toBe(0);
        expect(nextClick).not.toHaveBeenCalled();
    });

    test('Stop during return does not resubmit or advance after an accepted submission', async () => {
        const sourceUrl = 'https://assets.grok.com/users/example/generated/88888888-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg';
        window.history.pushState({}, '', '/imagine/saved');
        const first = createSavedBatchCard(sourceUrl, () => {
            window.history.pushState({}, '', '/imagine/agent/agent-1?conversation=conversation-1');
            renderAgentEditor({
                sourceUrl,
                onBack: () => retryManager.stopBatch()
            });
        });
        const nextClick = addNextCardClickProbe();
        primePromptedGalleryBatch(retryManager, { button: first.makeVideo, container: first.card });
        const submitSpy = jest.spyOn(retryManager, 'clickPromptedVideoSubmitButton').mockImplementation(() => {
            const submit = document.querySelector('button[aria-label="Make video"]');
            retryManager.simulateClick(submit);
            return true;
        });
        const recoverSpy = jest.spyOn(retryManager, 'navigateToPromptedBatchGallery').mockImplementation(() => {});

        await retryManager.processBatchItemPrompted({ button: first.makeVideo, container: first.card }, retryManager.batchRunToken);

        expect(submitSpy).toHaveBeenCalledTimes(1);
        expect(retryManager.goalCount).toBe(0);
        expect(recoverSpy).not.toHaveBeenCalled();
        expect(nextClick).not.toHaveBeenCalled();
    });

    test('a return timeout recovers the captured Saved URL, stops the batch, and does not advance', async () => {
        const sourceUrl = 'https://assets.grok.com/users/example/generated/99999999-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg';
        window.history.pushState({}, '', '/imagine/saved');
        const first = createSavedBatchCard(sourceUrl, () => {
            window.history.pushState({}, '', '/imagine/agent/agent-1?conversation=conversation-1');
            renderAgentEditor({ sourceUrl });
        });
        const nextClick = addNextCardClickProbe();
        primePromptedGalleryBatch(retryManager, { button: first.makeVideo, container: first.card });
        retryManager.waitForPromptedBatchSavedSurface = jest.fn().mockResolvedValue(false);
        jest.spyOn(window.history, 'back').mockImplementation(() => {});
        retryManager.injectPromptedVideoText = jest.fn().mockReturnValue(true);
        retryManager.clickPromptedVideoSubmitButton = jest.fn().mockReturnValue(true);
        retryManager.awaitBatchItemCompletion = jest.fn().mockResolvedValue('success');
        const recoverSpy = jest.spyOn(retryManager, 'navigateToPromptedBatchGallery').mockImplementation(() => {});

        await retryManager.processBatchItemPrompted({ button: first.makeVideo, container: first.card }, retryManager.batchRunToken);

        expect(recoverSpy).toHaveBeenCalledWith('http://localhost/imagine/saved');
        expect(retryManager.batchRunning).toBe(false);
        expect(retryManager.goalCount).toBe(0);
        expect(mockOverlay.setStatus).toHaveBeenCalledWith(expect.stringContaining('could not return to Saved'), 'warning');
        expect(nextClick).not.toHaveBeenCalled();
    });

    test('ignores a hidden Back control and waits for delayed Saved DOM before restoring state', async () => {
        const sourceUrl = 'https://assets.grok.com/users/example/generated/05050505-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg';
        const token = 'batch-return-token';
        const snapshot = {
            galleryUrl: 'http://localhost/imagine/saved',
            sourceId: '05050505-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            savedViewportReceipt: {
                version: 3,
                sourceIdentity: '05050505-bbbb-4ccc-8ddd-eeeeeeeeeeee',
                expectedNextIdentity: null,
                beforeIdentities: [],
                afterIdentities: [],
                visibleIdentities: ['05050505-bbbb-4ccc-8ddd-eeeeeeeeeeee'],
                origin: { pathname: '/imagine/saved', conversationId: '', scope: 'all' },
                scrollTop: 420
            },
            scrollY: 420
        };
        let now = 0;
        let historyReturned = false;
        let savedPolls = 0;
        const sequence = [];
        window.history.pushState({}, '', '/imagine/agent/agent-return?conversation=conversation-return');
        document.body.innerHTML = '';
        const hiddenBack = document.createElement('button');
        hiddenBack.setAttribute('aria-label', 'Back');
        hiddenBack.style.display = 'none';
        hiddenBack.click = jest.fn();
        document.body.appendChild(hiddenBack);
        retryManager.batchRunning = true;
        retryManager.batchAborted = false;
        retryManager.batchRunToken = token;
        retryManager.batchMode = 'prompted';
        retryManager.batchContext = 'gallery';
        retryManager.batchProcessedSrcs = new Set();
        window.scrollTo = jest.fn(() => sequence.push('scroll'));
        jest.spyOn(Date, 'now').mockImplementation(() => now);
        const historyBack = jest.spyOn(window.history, 'back').mockImplementation(() => {
            historyReturned = true;
            window.history.pushState({}, '', '/imagine/saved');
        });
        retryManager.sleep = jest.fn().mockImplementation(async () => {
            now += 200;
            if (!historyReturned) return;
            savedPolls++;
            if (savedPolls === 2) {
                document.body.innerHTML = '';
                createSavedBatchCard(sourceUrl);
                sequence.push('saved-dom');
            }
        });

        await expect(retryManager.batchGoBack(snapshot, token)).resolves.toBe('returned');

        expect(hiddenBack.click).not.toHaveBeenCalled();
        expect(historyBack).toHaveBeenCalledTimes(1);
        expect(savedPolls).toBe(2);
        expect(sequence).toEqual(['saved-dom', 'scroll']);
        expect(retryManager.batchQueue).toHaveLength(0);
    });

    test('Prompted Batch return polling rejects Saved scope drift', async () => {
        const sourceId = '16161616-bbbb-4ccc-8ddd-eeeeeeeeeeee';
        window.history.pushState({}, '', '/imagine/saved');
        createSavedBatchCard(
            `https://assets.grok.com/users/example/generated/${sourceId}/image.jpg`
        );
        mountSavedScope('liked');
        const token = 'prompted-saved-scope-drift-poll';
        retryManager.batchRunning = true;
        retryManager.batchAborted = false;
        retryManager.batchRunToken = token;
        retryManager.sleep = jest.fn().mockResolvedValue();
        const snapshot = {
            savedViewportReceipt: {
                version: 3,
                sourceIdentity: sourceId,
                expectedNextIdentity: null,
                beforeIdentities: [],
                afterIdentities: [],
                visibleIdentities: [sourceId],
                origin: { pathname: '/imagine/saved', conversationId: '', scope: 'all' },
                scrollTop: 420
            }
        };

        await expect(retryManager.waitForPromptedBatchSavedSurface(snapshot, token, 200))
            .resolves.toBe(false);
    });

    test('Prompted Batch state restoration rejects Saved scope drift', () => {
        const sourceId = '17171717-bbbb-4ccc-8ddd-eeeeeeeeeeee';
        window.history.pushState({}, '', '/imagine/saved');
        createSavedBatchCard(
            `https://assets.grok.com/users/example/generated/${sourceId}/image.jpg`
        );
        mountSavedScope('liked');
        const token = 'prompted-saved-scope-drift-restore';
        retryManager.batchRunning = true;
        retryManager.batchAborted = false;
        retryManager.batchRunToken = token;
        const snapshot = {
            savedViewportReceipt: {
                version: 3,
                sourceIdentity: sourceId,
                expectedNextIdentity: null,
                beforeIdentities: [],
                afterIdentities: [],
                visibleIdentities: [sourceId],
                origin: { pathname: '/imagine/saved', conversationId: '', scope: 'all' },
                scrollTop: 420
            }
        };

        expect(retryManager.restorePromptedBatchSavedState(snapshot, token)).toBe(false);
    });

    test('restores the semantic Saved neighborhood before resuming the expected next card', async () => {
        const sourceId = 'b8b8b8b8-cccc-4ddd-8eee-a7a7a7a7a7a7';
        const nextId = 'c9c9c9c9-dddd-4eee-8fff-b8b8b8b8b8b8';
        const token = 'semantic-return-token';
        const snapshot = {
            galleryUrl: 'http://localhost/imagine/saved',
            sourceId,
            savedViewportReceipt: {
                version: 3,
                sourceIdentity: sourceId,
                expectedNextIdentity: nextId,
                beforeIdentities: [],
                afterIdentities: [nextId],
                visibleIdentities: [sourceId, nextId],
                origin: { pathname: '/imagine/saved', conversationId: '', scope: 'all' },
                scrollTop: 420
            }
        };
        window.history.pushState({}, '', '/imagine/agent/semantic-return?conversation=semantic-return');
        retryManager.batchRunning = true;
        retryManager.batchAborted = false;
        retryManager.batchRunToken = token;
        retryManager.batchMode = 'prompted';
        retryManager.batchContext = 'gallery';
        retryManager.batchProcessedSrcs = new Set([sourceId]);
        retryManager.batchQueue = [];

        const unrelatedScroller = document.createElement('div');
        unrelatedScroller.className = 'overflow-scroll';
        unrelatedScroller.scrollTop = 999;
        document.body.appendChild(unrelatedScroller);
        let galleryScroller = null;
        let list = null;
        const renderReturnedSaved = () => {
            mountSavedScope('all');
            galleryScroller = document.createElement('div');
            galleryScroller.className = 'h-dvh overflow-scroll items-center';
            galleryScroller.style.overflowY = 'scroll';
            galleryScroller.scrollTop = 0;
            Object.defineProperties(galleryScroller, {
                scrollHeight: { configurable: true, value: 2200 },
                clientHeight: { configurable: true, value: 800 }
            });
            list = document.createElement('div');
            list.setAttribute('role', 'list');
            galleryScroller.appendChild(list);
            document.body.appendChild(galleryScroller);
        };
        const appendCard = (mediaId) => {
            const card = document.createElement('article');
            card.setAttribute('role', 'listitem');
            const image = document.createElement('img');
            image.alt = 'Generated image';
            image.src = `https://assets.grok.com/users/example/generated/${mediaId}/image.jpg`;
            const makeVideo = document.createElement('button');
            makeVideo.setAttribute('aria-label', 'Make video');
            card.append(image, makeVideo);
            list.appendChild(card);
        };
        const back = makeVisible(document.createElement('button'));
        back.setAttribute('aria-label', 'Back');
        back.addEventListener('click', () => {
            window.history.pushState({}, '', '/imagine/saved');
            back.remove();
            renderReturnedSaved();
            appendCard('dadadada-eeee-4fff-8aaa-c9c9c9c9c9c9');
        });
        document.body.appendChild(back);
        let sleepCount = 0;
        retryManager.sleep = jest.fn(async () => {
            sleepCount++;
            if (sleepCount === 1) appendCard(sourceId);
            if (sleepCount === 2) appendCard(nextId);
        });
        window.scrollTo = jest.fn();

        await expect(retryManager.batchGoBack(snapshot, token)).resolves.toBe('returned');

        expect(sleepCount).toBeGreaterThanOrEqual(2);
        expect(galleryScroller.scrollTop).toBe(420);
        expect(unrelatedScroller.scrollTop).toBe(999);
        expect(window.scrollTo).not.toHaveBeenCalled();
        expect(retryManager.batchQueue).toHaveLength(1);
        expect(retryManager._getCardSourceId(retryManager.batchQueue[0].container)).toBe(nextId);
        expect(retryManager.batchIndex).toBe(0);
    });

    test('selectMakeVideoMode opens the current Make Video menu and chooses Add Prompt', async () => {
        const queryBar = document.createElement('div');
        queryBar.className = 'query-bar';

        const editSubmit = makeVisible(document.createElement('button'));
        editSubmit.setAttribute('aria-label', 'Edit');
        editSubmit.click = jest.fn();
        queryBar.appendChild(editSubmit);

        const makeVideoTrigger = makeVisible(document.createElement('button'), { width: 160, right: 160 });
        makeVideoTrigger.setAttribute('aria-label', 'Make Video');
        makeVideoTrigger.setAttribute('aria-haspopup', 'menu');
        makeVideoTrigger.addEventListener('click', () => {
            const menu = makeVisible(document.createElement('div'));
            const addPromptItem = createMenuItem('Add Prompt', () => {
                editSubmit.remove();
                mountFocusedPromptedVideoComposer({ root: queryBar });
                addPromptItem.remove();
            });
            menu.appendChild(addPromptItem);
            openLinkedMenu(makeVideoTrigger, menu);
        });

        document.body.append(makeVideoTrigger, queryBar);
        retryManager.sleep = jest.fn().mockResolvedValue();
        retryManager.simulateClick = jest.fn((element) => element.click());

        await expect(retryManager.selectMakeVideoMode()).resolves.toBe(true);

        expect(retryManager.simulateClick).toHaveBeenCalledWith(makeVideoTrigger);
        expect(retryManager.simulateClick).toHaveBeenCalledWith(expect.objectContaining({ textContent: 'Add Prompt' }));
        expect(editSubmit.click).not.toHaveBeenCalled();
    });

    test('accepts the Grok 2.0 video generation bar and submits only its scoped Send button', async () => {
        const makeVideoTrigger = makeVisible(document.createElement('button'), { width: 160, right: 160 });
        makeVideoTrigger.setAttribute('aria-label', 'Make Video');
        makeVideoTrigger.setAttribute('aria-haspopup', 'menu');
        let mountedComposer = null;
        let videoSubmitClicks = 0;
        makeVideoTrigger.addEventListener('click', () => {
            const menu = makeVisible(document.createElement('div'));
            const addPromptItem = createMenuItem('Add Prompt', () => {
                mountedComposer = mountFocusedGrok2VideoComposer({
                    submitDisabled: true,
                    onSubmit: () => { videoSubmitClicks++; }
                });
                addPromptItem.remove();
            });
            menu.appendChild(addPromptItem);
            openLinkedMenu(makeVideoTrigger, menu);
        });

        const chatSubmit = makeVisible(document.createElement('button'));
        chatSubmit.setAttribute('aria-label', 'Send');
        chatSubmit.click = jest.fn();
        document.body.append(chatSubmit, makeVideoTrigger);
        retryManager.sleep = jest.fn().mockResolvedValue();
        retryManager.simulateClick = jest.fn((element) => element.click());

        await expect(retryManager.selectMakeVideoMode(undefined, makeVideoTrigger)).resolves.toBe(true);

        expect(retryManager.promptedVideoComposerRoot).toBe(mountedComposer.composer);
        await expect(retryManager.clickPromptedVideoSubmitButton()).resolves.toBe(false);
        retryManager.sleep.mockImplementation(async () => {
            mountedComposer.submit.disabled = false;
        });
        await expect(retryManager._waitForPromptedVideoSubmitButton()).resolves.toBe(
            mountedComposer.submit
        );
        await expect(retryManager.clickPromptedVideoSubmitButton()).resolves.toBe(true);
        expect(videoSubmitClicks).toBe(1);
        expect(chatSubmit.click).not.toHaveBeenCalled();

        const modeRadios = mountedComposer.composer.querySelectorAll(
            '[role="radiogroup"][aria-label="Generation mode"] [role="radio"]'
        );
        modeRadios.forEach((radio) => {
            radio.setAttribute('aria-checked', radio.textContent === 'Image' ? 'true' : 'false');
        });

        await expect(retryManager.clickPromptedVideoSubmitButton()).resolves.toBe(false);
        expect(videoSubmitClicks).toBe(1);
        expect(chatSubmit.click).not.toHaveBeenCalled();
    });

    test.each([
        ['Image mode', { selectedMode: 'Image' }],
        ['missing resolution', { includeResolution: false }],
        ['missing duration', { includeDuration: false }]
    ])('rejects a Grok 2.0 Send composer with %s', async (_label, options) => {
        const mounted = mountFocusedGrok2VideoComposer(options);
        retryManager.sleep = jest.fn().mockResolvedValue();
        retryManager.simulateClick = jest.fn();

        await expect(retryManager._waitForLegacyPromptedVideoSubmitButton()).resolves.toBeNull();

        expect(retryManager.promptedVideoComposerRoot).toBeNull();
        await expect(retryManager.clickPromptedVideoSubmitButton()).resolves.toBe(false);
        expect(retryManager.simulateClick).not.toHaveBeenCalled();
        expect(mounted.submit.disabled).toBe(false);
    });

    test('writes a Grok 2.0 video prompt before waiting for its scoped Send button', async () => {
        window.history.pushState({}, '', '/imagine/post/grok2-video');
        const makeVideoTrigger = makeVisible(document.createElement('button'), { width: 160, right: 160 });
        makeVideoTrigger.setAttribute('aria-label', 'Make Video');
        makeVideoTrigger.setAttribute('aria-haspopup', 'menu');
        let mountedComposer = null;
        let enableSubmitAfterWrite = false;
        let videoSubmitClicks = 0;
        makeVideoTrigger.addEventListener('click', () => {
            const menu = makeVisible(document.createElement('div'));
            const addPromptItem = createMenuItem('Add Prompt', () => {
                mountedComposer = mountFocusedGrok2VideoComposer({
                    submitDisabled: true,
                    onSubmit: () => { videoSubmitClicks++; }
                });
                addPromptItem.remove();
            });
            menu.appendChild(addPromptItem);
            openLinkedMenu(makeVideoTrigger, menu);
        });
        const enableSubmit = () => {
            enableSubmitAfterWrite = true;
        };
        document.addEventListener('__gpt_set_prompted_video_content', enableSubmit);
        document.body.appendChild(makeVideoTrigger);
        retryManager.sleep = jest.fn().mockImplementation(async () => {
            if (enableSubmitAfterWrite && mountedComposer) {
                mountedComposer.submit.disabled = false;
                enableSubmitAfterWrite = false;
            }
        });
        retryManager.simulateClick = jest.fn((element) => element.click());
        retryManager.awaitBatchItemCompletion = jest.fn().mockResolvedValue('success');

        try {
            await retryManager.startPromptedBatchFromDetail('slow camera push in', 1);
        } finally {
            document.removeEventListener('__gpt_set_prompted_video_content', enableSubmit);
        }

        expect(mountedComposer.input.textContent).toBe('slow camera push in');
        expect(videoSubmitClicks).toBe(1);
        expect(retryManager.goalCount).toBe(1);
    });

    test('selected linked menu and focused composer ignore remounted retained decoys', async () => {
        let decoyMenuClicks = 0;
        let decoySubmitClicks = 0;
        const decoyInputs = [];
        let decoyMenu = null;
        let decoyComposer = null;
        const mountDecoyMenu = () => {
            decoyMenu?.remove();
            decoyMenu = makeVisible(document.createElement('div'));
            decoyMenu.setAttribute('role', 'menu');
            decoyMenu.appendChild(createMenuItem('Add Prompt', () => { decoyMenuClicks++; }));
            document.body.appendChild(decoyMenu);
        };
        const mountDecoyComposer = () => {
            decoyComposer?.remove();
            decoyComposer = document.createElement('div');
            decoyComposer.className = 'query-bar';
            const input = document.createElement('div');
            input.setAttribute('contenteditable', 'true');
            input.setAttribute('role', 'textbox');
            input.setAttribute('aria-label', 'Ask Grok anything');
            const submit = makeVisible(document.createElement('button'));
            submit.setAttribute('aria-label', 'Make video');
            submit.addEventListener('click', () => { decoySubmitClicks++; });
            decoyComposer.append(input, submit);
            decoyInputs.push(input);
            document.body.appendChild(decoyComposer);
        };
        mountDecoyMenu();
        mountDecoyComposer();

        const selectedTrigger = makeVisible(document.createElement('button'), { width: 160, right: 160 });
        selectedTrigger.setAttribute('aria-label', 'Make Video');
        selectedTrigger.setAttribute('aria-haspopup', 'menu');
        const selectedMenu = makeVisible(document.createElement('div'));
        let selectedTriggerClicks = 0;
        let selectedMenuClicks = 0;
        let selectedSubmitClicks = 0;
        let selectedInput = null;
        selectedTrigger.addEventListener('click', () => {
            selectedTriggerClicks++;
            mountDecoyMenu();
            openLinkedMenu(selectedTrigger, selectedMenu);
        });

        document.body.appendChild(selectedTrigger);
        retryManager.sleep = jest.fn().mockImplementation(async () => {
            if (selectedMenu.querySelector('[role="menuitem"]')) return;
            const selectedAddPrompt = createMenuItem('Add Prompt', () => {
                selectedMenuClicks++;
                mountDecoyComposer();
                const selected = mountFocusedPromptedVideoComposer({
                    onSubmit: () => { selectedSubmitClicks++; }
                });
                selectedInput = selected.input;
            });
            selectedMenu.appendChild(selectedAddPrompt);
        });
        retryManager.simulateClick = jest.fn((element) => element.click());

        await expect(retryManager.selectMakeVideoMode(undefined, selectedTrigger)).resolves.toBe(true);
        expect(retryManager.injectPromptedVideoText('selected prompt')).toBe(true);
        await expect(retryManager.clickPromptedVideoSubmitButton()).resolves.toBe(true);

        expect(decoyMenuClicks).toBe(0);
        expect(decoyInputs.map((input) => input.textContent)).toEqual(['', '']);
        expect(decoySubmitClicks).toBe(0);
        expect(selectedTriggerClicks).toBe(1);
        expect(selectedMenuClicks).toBe(1);
        expect(selectedInput.textContent).toBe('selected prompt');
        expect(selectedSubmitClicks).toBe(1);
    });

    test('delayed selected focus wins over a verified decoy focused before Add Prompt', async () => {
        let decoySubmitClicks = 0;
        const decoy = mountFocusedPromptedVideoComposer({
            onSubmit: () => { decoySubmitClicks++; }
        });
        const selectedTrigger = makeVisible(document.createElement('button'), { width: 160, right: 160 });
        selectedTrigger.setAttribute('aria-label', 'Make Video');
        selectedTrigger.setAttribute('aria-haspopup', 'menu');
        const menu = makeVisible(document.createElement('div'));
        let addPromptClicked = false;
        let selectedInput = null;
        let selectedSubmitClicks = 0;
        menu.appendChild(createMenuItem('Add Prompt', () => {
            addPromptClicked = true;
            const composer = document.createElement('div');
            composer.className = 'query-bar';
            selectedInput = document.createElement('div');
            selectedInput.setAttribute('contenteditable', 'true');
            selectedInput.setAttribute('role', 'textbox');
            selectedInput.setAttribute('aria-label', 'Ask Grok anything');
            selectedInput.tabIndex = -1;
            const submit = makeVisible(document.createElement('button'));
            submit.setAttribute('aria-label', 'Make video');
            submit.addEventListener('click', () => { selectedSubmitClicks++; });
            composer.append(selectedInput, submit);
            document.body.appendChild(composer);
        }));
        selectedTrigger.addEventListener('click', () => openLinkedMenu(selectedTrigger, menu));
        document.body.appendChild(selectedTrigger);
        retryManager.sleep = jest.fn().mockImplementation(async () => {
            if (addPromptClicked && document.activeElement !== selectedInput) selectedInput.focus();
        });
        retryManager.simulateClick = jest.fn((element) => element.click());

        await expect(retryManager.selectMakeVideoMode(undefined, selectedTrigger)).resolves.toBe(true);
        expect(retryManager.injectPromptedVideoText('selected after delayed focus')).toBe(true);
        await expect(retryManager.clickPromptedVideoSubmitButton()).resolves.toBe(true);

        expect(decoy.input.textContent).toBe('');
        expect(decoySubmitClicks).toBe(0);
        expect(selectedInput.textContent).toBe('selected after delayed focus');
        expect(selectedSubmitClicks).toBe(1);
    });

    test('multiple distinct post-click focused composers fail closed without write or submit', async () => {
        const originalDecoy = mountFocusedPromptedVideoComposer();
        const selectedTrigger = makeVisible(document.createElement('button'), { width: 160, right: 160 });
        selectedTrigger.setAttribute('aria-label', 'Make Video');
        selectedTrigger.setAttribute('aria-haspopup', 'menu');
        const menu = makeVisible(document.createElement('div'));
        let addPromptClicked = false;
        let remountedDecoy = null;
        let decoySubmitClicks = 0;
        let selectedInput = null;
        let selectedSubmitClicks = 0;
        menu.appendChild(createMenuItem('Add Prompt', () => {
            addPromptClicked = true;
            originalDecoy.composer.remove();
            remountedDecoy = mountFocusedPromptedVideoComposer({
                onSubmit: () => { decoySubmitClicks++; }
            });
            const selectedComposer = document.createElement('div');
            selectedComposer.className = 'query-bar';
            selectedInput = document.createElement('div');
            selectedInput.setAttribute('contenteditable', 'true');
            selectedInput.setAttribute('role', 'textbox');
            selectedInput.setAttribute('aria-label', 'Ask Grok anything');
            selectedInput.tabIndex = -1;
            const selectedSubmit = makeVisible(document.createElement('button'));
            selectedSubmit.setAttribute('aria-label', 'Make video');
            selectedSubmit.addEventListener('click', () => { selectedSubmitClicks++; });
            selectedComposer.append(selectedInput, selectedSubmit);
            document.body.appendChild(selectedComposer);
        }));
        selectedTrigger.addEventListener('click', () => openLinkedMenu(selectedTrigger, menu));
        document.body.appendChild(selectedTrigger);
        retryManager.sleep = jest.fn().mockImplementation(async () => {
            if (addPromptClicked && document.activeElement !== selectedInput) selectedInput.focus();
        });
        retryManager.simulateClick = jest.fn((element) => element.click());

        const selected = await retryManager.selectMakeVideoMode(undefined, selectedTrigger);
        if (selected) {
            retryManager.injectPromptedVideoText('must not be written');
            await retryManager.clickPromptedVideoSubmitButton();
        }

        expect(selected).toBe(false);
        expect(remountedDecoy.input.textContent).toBe('');
        expect(decoySubmitClicks).toBe(0);
        expect(selectedInput.textContent).toBe('');
        expect(selectedSubmitClicks).toBe(0);
        expect(retryManager.promptedVideoComposerRoot).toBeNull();
    });

    test('late competing focus during bounded quiescence fails closed without write or submit', async () => {
        const lateDecoyComposer = document.createElement('div');
        lateDecoyComposer.className = 'query-bar';
        const lateDecoyInput = document.createElement('div');
        lateDecoyInput.setAttribute('contenteditable', 'true');
        lateDecoyInput.setAttribute('role', 'textbox');
        lateDecoyInput.setAttribute('aria-label', 'Ask Grok anything');
        lateDecoyInput.tabIndex = -1;
        const lateDecoySubmit = makeVisible(document.createElement('button'));
        lateDecoySubmit.setAttribute('aria-label', 'Make video');
        let lateDecoySubmitClicks = 0;
        lateDecoySubmit.addEventListener('click', () => { lateDecoySubmitClicks++; });
        lateDecoyComposer.append(lateDecoyInput, lateDecoySubmit);

        const selectedTrigger = makeVisible(document.createElement('button'), { width: 160, right: 160 });
        selectedTrigger.setAttribute('aria-label', 'Make Video');
        selectedTrigger.setAttribute('aria-haspopup', 'menu');
        const menu = makeVisible(document.createElement('div'));
        let addPromptClicked = false;
        let focusConfirmationSleeps = 0;
        let selectedInput = null;
        let selectedSubmitClicks = 0;
        menu.appendChild(createMenuItem('Add Prompt', () => {
            addPromptClicked = true;
            const selectedComposer = document.createElement('div');
            selectedComposer.className = 'query-bar';
            selectedInput = document.createElement('div');
            selectedInput.setAttribute('contenteditable', 'true');
            selectedInput.setAttribute('role', 'textbox');
            selectedInput.setAttribute('aria-label', 'Ask Grok anything');
            selectedInput.tabIndex = -1;
            const selectedSubmit = makeVisible(document.createElement('button'));
            selectedSubmit.setAttribute('aria-label', 'Make video');
            selectedSubmit.addEventListener('click', () => { selectedSubmitClicks++; });
            selectedComposer.append(selectedInput, selectedSubmit);
            document.body.appendChild(selectedComposer);
            selectedInput.focus();
        }));
        selectedTrigger.addEventListener('click', () => openLinkedMenu(selectedTrigger, menu));
        document.body.append(lateDecoyComposer, selectedTrigger);
        retryManager.sleep = jest.fn().mockImplementation(async () => {
            if (!addPromptClicked) return;
            focusConfirmationSleeps++;
            if (focusConfirmationSleeps === 2) lateDecoyInput.focus();
        });
        retryManager.simulateClick = jest.fn((element) => element.click());

        const selected = await retryManager.selectMakeVideoMode(undefined, selectedTrigger);
        if (selected) {
            retryManager.injectPromptedVideoText('must not survive late focus');
            await retryManager.clickPromptedVideoSubmitButton();
        }

        expect(selected).toBe(false);
        expect(focusConfirmationSleeps).toBeGreaterThanOrEqual(2);
        expect(retryManager.promptedVideoComposerRoot).toBeNull();
        expect(selectedInput.textContent).toBe('');
        expect(selectedSubmitClicks).toBe(0);
        expect(lateDecoyInput.textContent).toBe('');
        expect(lateDecoySubmitClicks).toBe(0);
    });

    test('transient duplicate prompted-video input during quiescence fails closed without write or submit', async () => {
        retryManager.generateMoreObserver.disconnect();
        const selectedTrigger = makeVisible(document.createElement('button'), { width: 160, right: 160 });
        selectedTrigger.setAttribute('aria-label', 'Make Video');
        selectedTrigger.setAttribute('aria-haspopup', 'menu');
        const menu = makeVisible(document.createElement('div'));
        let addPromptClicked = false;
        let transientDuplicateMounted = false;
        let selectedComposer = null;
        let selectedSubmitClicks = 0;
        menu.appendChild(createMenuItem('Add Prompt', () => {
            addPromptClicked = true;
            selectedComposer = mountFocusedPromptedVideoComposer({
                onSubmit: () => { selectedSubmitClicks++; }
            });
        }));
        selectedTrigger.addEventListener('click', () => openLinkedMenu(selectedTrigger, menu));
        document.body.appendChild(selectedTrigger);
        retryManager.sleep = jest.fn().mockImplementation(async () => {
            if (!addPromptClicked || transientDuplicateMounted) return;
            transientDuplicateMounted = true;
            await new Promise((resolve) => {
                const deliveryObserver = new MutationObserver(() => {
                    deliveryObserver.disconnect();
                    resolve();
                });
                deliveryObserver.observe(selectedComposer.composer, { childList: true });
                const duplicateInput = document.createElement('div');
                duplicateInput.setAttribute('contenteditable', 'true');
                duplicateInput.setAttribute('role', 'textbox');
                duplicateInput.setAttribute('aria-label', 'Ask Grok anything');
                selectedComposer.composer.appendChild(duplicateInput);
                duplicateInput.remove();
            });
        });
        retryManager.simulateClick = jest.fn((element) => element.click());

        const selected = await retryManager.selectMakeVideoMode(undefined, selectedTrigger);
        if (selected) {
            retryManager.injectPromptedVideoText('must not survive transient duplicate input');
            await retryManager.clickPromptedVideoSubmitButton();
            await new Promise((resolve) => setTimeout(resolve, 0));
        }

        expect(transientDuplicateMounted).toBe(true);
        expect(selected).toBe(false);
        expect(retryManager.promptedVideoComposerRoot).toBeNull();
        expect(selectedComposer.input.textContent).toBe('');
        expect(selectedSubmitClicks).toBe(0);
    });

    test('transient duplicate actionable Make video submit during quiescence fails closed without write or submit', async () => {
        retryManager.generateMoreObserver.disconnect();
        const selectedTrigger = makeVisible(document.createElement('button'), { width: 160, right: 160 });
        selectedTrigger.setAttribute('aria-label', 'Make Video');
        selectedTrigger.setAttribute('aria-haspopup', 'menu');
        const menu = makeVisible(document.createElement('div'));
        let addPromptClicked = false;
        let transientDuplicateMounted = false;
        let selectedComposer = null;
        let selectedSubmitClicks = 0;
        menu.appendChild(createMenuItem('Add Prompt', () => {
            addPromptClicked = true;
            selectedComposer = mountFocusedPromptedVideoComposer({
                onSubmit: () => { selectedSubmitClicks++; }
            });
        }));
        selectedTrigger.addEventListener('click', () => openLinkedMenu(selectedTrigger, menu));
        document.body.appendChild(selectedTrigger);
        retryManager.sleep = jest.fn().mockImplementation(async () => {
            if (!addPromptClicked || transientDuplicateMounted) return;
            transientDuplicateMounted = true;
            await new Promise((resolve) => {
                const deliveryObserver = new MutationObserver(() => {
                    deliveryObserver.disconnect();
                    resolve();
                });
                deliveryObserver.observe(selectedComposer.composer, { childList: true });
                const duplicateSubmit = makeVisible(document.createElement('button'));
                duplicateSubmit.setAttribute('aria-label', 'Make video');
                selectedComposer.composer.appendChild(duplicateSubmit);
                duplicateSubmit.remove();
            });
        });
        retryManager.simulateClick = jest.fn((element) => element.click());

        const selected = await retryManager.selectMakeVideoMode(undefined, selectedTrigger);
        if (selected) {
            retryManager.injectPromptedVideoText('must not survive transient duplicate submit');
            await retryManager.clickPromptedVideoSubmitButton();
            await new Promise((resolve) => setTimeout(resolve, 0));
        }

        expect(transientDuplicateMounted).toBe(true);
        expect(selected).toBe(false);
        expect(retryManager.promptedVideoComposerRoot).toBeNull();
        expect(selectedComposer.input.textContent).toBe('');
        expect(selectedSubmitClicks).toBe(0);
    });

    test('irrelevant mutations and text writes do not poison prompted-video quiescence', async () => {
        retryManager.generateMoreObserver.disconnect();
        const selectedTrigger = makeVisible(document.createElement('button'), { width: 160, right: 160 });
        selectedTrigger.setAttribute('aria-label', 'Make Video');
        selectedTrigger.setAttribute('aria-haspopup', 'menu');
        const menu = makeVisible(document.createElement('div'));
        let addPromptClicked = false;
        let mutationsDelivered = false;
        let quiescenceSleeps = 0;
        let selectedComposer = null;
        let selectedSubmitClicks = 0;
        menu.appendChild(createMenuItem('Add Prompt', () => {
            addPromptClicked = true;
            selectedComposer = mountFocusedPromptedVideoComposer({
                onSubmit: () => { selectedSubmitClicks++; }
            });
        }));
        selectedTrigger.addEventListener('click', () => openLinkedMenu(selectedTrigger, menu));
        document.body.appendChild(selectedTrigger);
        retryManager.sleep = jest.fn().mockImplementation(async () => {
            if (!addPromptClicked) return;
            quiescenceSleeps++;
            if (mutationsDelivered) return;
            mutationsDelivered = true;
            await new Promise((resolve) => {
                const deliveryObserver = new MutationObserver(() => {
                    deliveryObserver.disconnect();
                    resolve();
                });
                deliveryObserver.observe(selectedComposer.composer, {
                    childList: true,
                    subtree: true
                });
                const irrelevant = document.createElement('span');
                irrelevant.textContent = 'loading';
                const disabledSubmit = document.createElement('button');
                disabledSubmit.setAttribute('aria-label', 'Make video');
                disabledSubmit.disabled = true;
                selectedComposer.composer.append(irrelevant, disabledSubmit);
                irrelevant.remove();
                disabledSubmit.remove();
                selectedComposer.input.textContent = 'draft';
                selectedComposer.input.textContent = '';
            });
        });
        retryManager.simulateClick = jest.fn((element) => element.click());

        await expect(retryManager.selectMakeVideoMode(undefined, selectedTrigger)).resolves.toBe(true);
        expect(retryManager.injectPromptedVideoText('accepted after irrelevant mutations')).toBe(true);
        await expect(retryManager.clickPromptedVideoSubmitButton()).resolves.toBe(true);

        expect(mutationsDelivered).toBe(true);
        expect(quiescenceSleeps).toBe(5);
        expect(retryManager.promptedVideoComposerRoot).toBe(selectedComposer.composer);
        expect(selectedComposer.input.textContent).toBe('accepted after irrelevant mutations');
        expect(selectedSubmitClicks).toBe(1);
    });

    test('Stop during focus confirmation prevents retention, prompt write, and submit', async () => {
        window.history.pushState({}, '', '/imagine/agent/focus-stop?conversation=focus-stop');
        const sourceAsset = document.createElement('div');
        sourceAsset.className = 'react-flow__node-asset selected';
        sourceAsset.setAttribute('data-id', 'asset-source');
        const sourceImage = document.createElement('img');
        sourceImage.src = 'https://assets.grok.com/users/example/generated/90909090-aaaa-4bbb-8ccc-b2b2b2b2b2b2/image.jpg';
        sourceAsset.appendChild(sourceImage);
        const selectedTrigger = makeVisible(document.createElement('button'), { width: 160, right: 160 });
        selectedTrigger.setAttribute('aria-label', 'Make Video');
        selectedTrigger.setAttribute('aria-haspopup', 'menu');
        const menu = makeVisible(document.createElement('div'));
        let addPromptClicked = false;
        let focusConfirmationSleeps = 0;
        menu.appendChild(createMenuItem('Add Prompt', () => {
            addPromptClicked = true;
            mountFocusedPromptedVideoComposer();
        }));
        selectedTrigger.addEventListener('click', () => openLinkedMenu(selectedTrigger, menu));
        document.body.append(sourceAsset, selectedTrigger);
        retryManager.sleep = jest.fn().mockImplementation(async () => {
            if (!addPromptClicked) return;
            focusConfirmationSleeps++;
            retryManager.stopBatch();
        });
        const injectSpy = jest.spyOn(retryManager, 'injectPromptedVideoText');
        const submitSpy = jest.spyOn(retryManager, 'clickPromptedVideoSubmitButton');
        const recordFocusSpy = jest.spyOn(retryManager, '_recordPromptedVideoFocus');

        await retryManager.startPromptedBatchFromDetail('cancel during focus confirmation', 1);

        expect(focusConfirmationSleeps).toBe(1);
        expect(injectSpy).not.toHaveBeenCalled();
        expect(submitSpy).not.toHaveBeenCalled();
        expect(retryManager.promptedVideoComposerRoot).toBeNull();
        expect(retryManager.goalCount).toBe(0);

        recordFocusSpy.mockClear();
        let lateSubmitClicks = 0;
        const lateComposer = mountFocusedPromptedVideoComposer({
            onSubmit: () => { lateSubmitClicks++; }
        });

        expect(recordFocusSpy).not.toHaveBeenCalled();
        expect(retryManager.injectPromptedVideoText('must remain blocked after Stop')).toBe(false);
        await expect(retryManager.clickPromptedVideoSubmitButton()).resolves.toBe(false);
        expect(lateComposer.input.textContent).toBe('');
        expect(lateSubmitClicks).toBe(0);
    });

    test('current menu mode fails closed when the selected trigger opens multiple new Add Prompt items', async () => {
        const selectedTrigger = makeVisible(document.createElement('button'), { width: 160, right: 160 });
        selectedTrigger.setAttribute('aria-label', 'Make Video');
        selectedTrigger.setAttribute('aria-haspopup', 'menu');
        const menuClicks = [0, 0];
        selectedTrigger.addEventListener('click', () => {
            const menu = makeVisible(document.createElement('div'));
            const items = menuClicks.map((_, index) => {
                return createMenuItem('Add Prompt', () => { menuClicks[index]++; });
            });
            menu.append(...items);
            openLinkedMenu(selectedTrigger, menu);
        });
        document.body.appendChild(selectedTrigger);
        retryManager.sleep = jest.fn().mockResolvedValue();
        retryManager.simulateClick = jest.fn((element) => element.click());

        await expect(retryManager.selectMakeVideoMode(undefined, selectedTrigger)).resolves.toBe(false);

        expect(menuClicks).toEqual([0, 0]);
        expect(retryManager.promptedVideoComposerRoot).toBeNull();
    });

    test('linked menu fails closed when a second exact Add Prompt arrives during confirmation', async () => {
        const selectedTrigger = makeVisible(document.createElement('button'), { width: 160, right: 160 });
        selectedTrigger.setAttribute('aria-label', 'Make Video');
        selectedTrigger.setAttribute('aria-haspopup', 'menu');
        const menu = makeVisible(document.createElement('div'));
        const menuClicks = [0, 0];
        selectedTrigger.addEventListener('click', () => {
            const first = createMenuItem('Add Prompt', () => {
                menuClicks[0]++;
                mountFocusedPromptedVideoComposer();
            });
            menu.appendChild(first);
            openLinkedMenu(selectedTrigger, menu);
        });
        document.body.appendChild(selectedTrigger);
        retryManager.sleep = jest.fn().mockImplementation(async () => {
            if (menu.querySelectorAll('[role="menuitem"]').length > 1) return;
            menu.appendChild(createMenuItem('Add Prompt', () => { menuClicks[1]++; }));
        });
        retryManager.simulateClick = jest.fn((element) => element.click());

        await expect(retryManager.selectMakeVideoMode(undefined, selectedTrigger)).resolves.toBe(false);

        expect(retryManager.sleep).toHaveBeenCalled();
        expect(menuClicks).toEqual([0, 0]);
        expect(retryManager.promptedVideoComposerRoot).toBeNull();
    });

    test('linked menu accepts a pre-existing Add Prompt that becomes visible when opened', async () => {
        const selectedTrigger = makeVisible(document.createElement('button'), { width: 160, right: 160 });
        selectedTrigger.setAttribute('aria-label', 'Make Video');
        selectedTrigger.setAttribute('aria-haspopup', 'menu');
        const menu = makeVisible(document.createElement('div'));
        menu.style.display = 'none';
        let menuClicks = 0;
        const addPrompt = createMenuItem('Add Prompt', () => {
            menuClicks++;
            mountFocusedPromptedVideoComposer();
        });
        addPrompt.style.display = 'none';
        menu.appendChild(addPrompt);
        document.body.append(menu, selectedTrigger);
        selectedTrigger.addEventListener('click', () => {
            menu.style.display = '';
            addPrompt.style.display = '';
            openLinkedMenu(selectedTrigger, menu);
        });
        retryManager.sleep = jest.fn().mockResolvedValue();
        retryManager.simulateClick = jest.fn((element) => element.click());

        await expect(retryManager.selectMakeVideoMode(undefined, selectedTrigger)).resolves.toBe(true);

        expect(menuClicks).toBe(1);
        expect(retryManager.promptedVideoComposerRoot).not.toBeNull();
    });

    test.each([
        ['missing aria-controls', (trigger) => trigger.removeAttribute('aria-controls')],
        ['broken aria-controls', (trigger) => trigger.setAttribute('aria-controls', 'missing-menu')],
        ['missing aria-labelledby', (_trigger, menu) => menu.removeAttribute('aria-labelledby')],
        ['broken aria-labelledby', (_trigger, menu) => menu.setAttribute('aria-labelledby', 'other-trigger')]
    ])('current menu mode fails closed for %s', async (_label, breakLink) => {
        const selectedTrigger = makeVisible(document.createElement('button'), { width: 160, right: 160 });
        selectedTrigger.setAttribute('aria-label', 'Make Video');
        selectedTrigger.setAttribute('aria-haspopup', 'menu');
        const menu = makeVisible(document.createElement('div'));
        let menuClicks = 0;
        menu.appendChild(createMenuItem('Add Prompt', () => {
            menuClicks++;
            mountFocusedPromptedVideoComposer();
        }));
        selectedTrigger.addEventListener('click', () => {
            openLinkedMenu(selectedTrigger, menu);
            breakLink(selectedTrigger, menu);
        });
        document.body.appendChild(selectedTrigger);
        retryManager.sleep = jest.fn().mockResolvedValue();
        retryManager.simulateClick = jest.fn((element) => element.click());

        await expect(retryManager.selectMakeVideoMode(undefined, selectedTrigger)).resolves.toBe(false);

        expect(menuClicks).toBe(0);
        expect(retryManager.promptedVideoComposerRoot).toBeNull();
    });

    test('focused readiness accepts a pre-existing hidden unverified composer after it becomes ready', async () => {
        const selectedComposer = document.createElement('div');
        selectedComposer.className = 'query-bar';
        selectedComposer.style.display = 'none';
        const selectedTrigger = makeVisible(document.createElement('button'), { width: 160, right: 160 });
        selectedTrigger.setAttribute('aria-label', 'Make Video');
        selectedTrigger.setAttribute('aria-haspopup', 'menu');
        const menu = makeVisible(document.createElement('div'));
        let menuClicks = 0;
        let selectedInput = null;
        let selectedSubmitClicks = 0;
        menu.appendChild(createMenuItem('Add Prompt', () => {
            menuClicks++;
            const selected = mountFocusedPromptedVideoComposer({
                root: selectedComposer,
                onSubmit: () => { selectedSubmitClicks++; }
            });
            selectedInput = selected.input;
        }));
        selectedTrigger.addEventListener('click', () => openLinkedMenu(selectedTrigger, menu));
        document.body.append(selectedComposer, selectedTrigger);
        retryManager.sleep = jest.fn().mockResolvedValue();
        retryManager.simulateClick = jest.fn((element) => element.click());

        await expect(retryManager.selectMakeVideoMode(undefined, selectedTrigger)).resolves.toBe(true);
        expect(retryManager.injectPromptedVideoText('pre-existing composer prompt')).toBe(true);
        await expect(retryManager.clickPromptedVideoSubmitButton()).resolves.toBe(true);

        expect(menuClicks).toBe(1);
        expect(retryManager.promptedVideoComposerRoot).toBe(selectedComposer);
        expect(selectedInput.textContent).toBe('pre-existing composer prompt');
        expect(selectedSubmitClicks).toBe(1);
    });

    test('focused composer fails closed with multiple exact prompted-video inputs', async () => {
        const selectedTrigger = makeVisible(document.createElement('button'), { width: 160, right: 160 });
        selectedTrigger.setAttribute('aria-label', 'Make Video');
        selectedTrigger.setAttribute('aria-haspopup', 'menu');
        const menu = makeVisible(document.createElement('div'));
        let menuClicks = 0;
        let submitClicks = 0;
        menu.appendChild(createMenuItem('Add Prompt', () => {
            menuClicks++;
            const composer = document.createElement('div');
            composer.className = 'query-bar';
            const inputs = [0, 1].map(() => {
                const input = document.createElement('div');
                input.setAttribute('contenteditable', 'true');
                input.setAttribute('role', 'textbox');
                input.setAttribute('aria-label', 'Ask Grok anything');
                input.tabIndex = -1;
                return input;
            });
            const submit = makeVisible(document.createElement('button'));
            submit.setAttribute('aria-label', 'Make video');
            submit.addEventListener('click', () => { submitClicks++; });
            composer.append(...inputs, submit);
            document.body.appendChild(composer);
            inputs[0].focus();
        }));
        selectedTrigger.addEventListener('click', () => openLinkedMenu(selectedTrigger, menu));
        document.body.appendChild(selectedTrigger);
        retryManager.sleep = jest.fn().mockResolvedValue();
        retryManager.simulateClick = jest.fn((element) => element.click());

        await expect(retryManager.selectMakeVideoMode(undefined, selectedTrigger)).resolves.toBe(false);

        expect(menuClicks).toBe(1);
        expect(submitClicks).toBe(0);
        expect(retryManager.promptedVideoComposerRoot).toBeNull();
    });

    test('focused composer fails closed with multiple actionable Make video submits', async () => {
        const selectedTrigger = makeVisible(document.createElement('button'), { width: 160, right: 160 });
        selectedTrigger.setAttribute('aria-label', 'Make Video');
        selectedTrigger.setAttribute('aria-haspopup', 'menu');
        const menu = makeVisible(document.createElement('div'));
        let menuClicks = 0;
        let submitClicks = 0;
        menu.appendChild(createMenuItem('Add Prompt', () => {
            menuClicks++;
            const composer = document.createElement('div');
            composer.className = 'query-bar';
            const input = document.createElement('div');
            input.setAttribute('contenteditable', 'true');
            input.setAttribute('role', 'textbox');
            input.setAttribute('aria-label', 'Ask Grok anything');
            input.tabIndex = -1;
            const submits = [0, 1].map(() => {
                const submit = makeVisible(document.createElement('button'));
                submit.setAttribute('aria-label', 'Make video');
                submit.addEventListener('click', () => { submitClicks++; });
                return submit;
            });
            composer.append(input, ...submits);
            document.body.appendChild(composer);
            input.focus();
        }));
        selectedTrigger.addEventListener('click', () => openLinkedMenu(selectedTrigger, menu));
        document.body.appendChild(selectedTrigger);
        retryManager.sleep = jest.fn().mockResolvedValue();
        retryManager.simulateClick = jest.fn((element) => element.click());

        await expect(retryManager.selectMakeVideoMode(undefined, selectedTrigger)).resolves.toBe(false);

        expect(menuClicks).toBe(1);
        expect(submitClicks).toBe(0);
        expect(retryManager.promptedVideoComposerRoot).toBeNull();
    });

    test('prompted detail batch writes and submits only the Add Prompt video composer', async () => {
        window.history.pushState({}, '', '/imagine/agent/agent-1?conversation=conversation-1');
        const sourceAsset = document.createElement('div');
        sourceAsset.className = 'react-flow__node-asset selected';
        sourceAsset.setAttribute('data-id', 'asset-source');
        const sourceImage = document.createElement('img');
        sourceImage.src = 'https://assets.grok.com/users/example/generated/a1a1a1a1-bbbb-4ccc-8ddd-c3c3c3c3c3c3/image.jpg';
        sourceAsset.appendChild(sourceImage);
        const preciseEditComposer = document.createElement('div');
        const preciseEditor = document.createElement('div');
        preciseEditor.setAttribute('contenteditable', 'true');
        preciseEditor.setAttribute('role', 'textbox');
        preciseEditor.setAttribute('aria-label', 'Ask Grok anything');
        const preciseEditSubmit = makeVisible(document.createElement('button'));
        preciseEditSubmit.setAttribute('aria-label', 'Edit');
        let preciseEditClicks = 0;
        preciseEditSubmit.addEventListener('click', () => { preciseEditClicks++; });
        preciseEditComposer.append(preciseEditor, preciseEditSubmit);

        const makeVideoTrigger = makeVisible(document.createElement('button'), { width: 160, right: 160 });
        makeVideoTrigger.setAttribute('aria-label', 'Make Video');
        makeVideoTrigger.setAttribute('aria-haspopup', 'menu');
        const menuClicks = { addPrompt: 0, spicy: 0, quickAnimate: 0 };
        let videoEditor;
        let videoSubmitClicks = 0;
        let settingClicks = 0;
        makeVideoTrigger.addEventListener('click', () => {
            const menu = makeVisible(document.createElement('div'));
            const addPrompt = createMenuItem('Add Prompt', () => {
                menuClicks.addPrompt++;
                const videoComposer = document.createElement('div');
                const settings = ['480p', '720p', '1080p', '6s', '10s', '15s', 'Audio']
                    .map((label) => {
                        const setting = makeVisible(document.createElement('button'));
                        setting.textContent = label;
                        setting.addEventListener('click', () => { settingClicks++; });
                        return setting;
                    });
                const mounted = mountFocusedPromptedVideoComposer({
                    root: videoComposer,
                    onSubmit: () => { videoSubmitClicks++; }
                });
                videoEditor = mounted.input;
                mounted.submit.before(...settings);
                addPrompt.remove();
            });

            const spicy = createMenuItem('Spicy', () => { menuClicks.spicy++; });
            const quickAnimate = createMenuItem('Quick Animate', () => { menuClicks.quickAnimate++; });
            menu.append(addPrompt, spicy, quickAnimate);
            openLinkedMenu(makeVideoTrigger, menu);
        });
        document.body.append(sourceAsset, preciseEditComposer, makeVideoTrigger);

        const bridgeHandler = (event) => {
            const target = event.type === '__gpt_set_prompted_video_content'
                ? document.querySelector(`[data-gpt-prompt-target="${event.detail.marker}"]`)
                : document.querySelector('[contenteditable="true"]');
            if (target) target.textContent = event.detail.text;
            if (event.type === '__gpt_set_prompted_video_content') {
                document.dispatchEvent(new CustomEvent('__gpt_set_prompted_video_content_result', {
                    detail: { marker: event.detail.marker, ok: !!target }
                }));
            }
        };
        document.addEventListener('__gpt_set_editor_content', bridgeHandler);
        document.addEventListener('__gpt_set_prompted_video_content', bridgeHandler);
        retryManager.awaitBatchItemCompletion = jest.fn().mockResolvedValue('success');

        try {
            await retryManager.startPromptedBatchFromDetail('scoped video prompt', 1);
        } finally {
            document.removeEventListener('__gpt_set_editor_content', bridgeHandler);
            document.removeEventListener('__gpt_set_prompted_video_content', bridgeHandler);
        }

        expect(menuClicks).toEqual({ addPrompt: 1, spicy: 0, quickAnimate: 0 });
        expect(preciseEditor.textContent).toBe('');
        expect(videoEditor.textContent).toBe('scoped video prompt');
        expect(preciseEditClicks).toBe(0);
        expect(videoSubmitClicks).toBe(1);
        expect(settingClicks).toBe(0);
        expect(videoEditor.hasAttribute('data-gpt-prompt-target')).toBe(false);
        expect(retryManager.promptedVideoComposerRoot).toBeNull();
    });

    test.each(['Video'])('waits for a delayed legacy %s composer before injecting and submitting', async (modeLabel) => {
        let promptedText = null;
        let submitted = 0;
        window.history.pushState({}, '', '/imagine/post/legacy-delayed-composer');
        const videoMode = makeVisible(document.createElement('button'));
        videoMode.setAttribute('aria-label', modeLabel);
        const videoModeClick = jest.fn();
        videoMode.addEventListener('click', videoModeClick);
        document.body.appendChild(videoMode);
        const promptListener = (event) => {
            promptedText = event.detail.text;
            const input = document.querySelector(`[data-gpt-prompt-target="${event.detail.marker}"]`);
            if (input) input.textContent = event.detail.text;
            document.dispatchEvent(new CustomEvent('__gpt_set_prompted_video_content_result', {
                detail: { marker: event.detail.marker, ok: !!input }
            }));
        };
        document.addEventListener('__gpt_set_prompted_video_content', promptListener);
        retryManager.sleep = jest.fn().mockImplementation(async () => {
            if (document.querySelector('[contenteditable="true"]')) return;
            const queryBar = document.createElement('div');
            queryBar.className = 'query-bar';
            const input = document.createElement('div');
            input.setAttribute('contenteditable', 'true');
            input.setAttribute('role', 'textbox');
            input.setAttribute('aria-label', 'Ask Grok anything');
            const submit = makeVisible(document.createElement('button'));
            submit.setAttribute('aria-label', 'Make video');
            submit.addEventListener('click', () => { submitted++; });
            queryBar.append(input, submit);
            document.body.appendChild(queryBar);
        });
        retryManager.awaitBatchItemCompletion = jest.fn().mockResolvedValue('success');

        await retryManager.startPromptedBatchFromDetail('legacy prompt', 1);
        document.removeEventListener('__gpt_set_prompted_video_content', promptListener);

        expect(videoModeClick).toHaveBeenCalledTimes(1);
        expect(retryManager.sleep).toHaveBeenCalled();
        expect(promptedText).toBe('legacy prompt');
        expect(submitted).toBe(1);
        expect(retryManager.goalCount).toBe(1);
    });

    test('does not treat an unrelated legacy Settings button as video mode', async () => {
        window.history.pushState({}, '', '/imagine/post/legacy-settings-decoy');
        const settings = makeVisible(document.createElement('button'));
        settings.setAttribute('aria-label', 'Settings');
        const settingsClick = jest.fn(() => mountFocusedPromptedVideoComposer());
        settings.addEventListener('click', settingsClick);
        document.body.appendChild(settings);
        retryManager.sleep = jest.fn().mockResolvedValue();
        retryManager.simulateClick = jest.fn((element) => element.click());

        await expect(retryManager.selectMakeVideoMode(undefined)).resolves.toBe(false);

        expect(settingsClick).not.toHaveBeenCalled();
        expect(retryManager.promptedVideoComposerRoot).toBeNull();
    });

    test('submits only the retained visible enabled Make video button in a verified composer', async () => {
        const disabledComposer = document.createElement('div');
        disabledComposer.className = 'query-bar';
        const disabledInput = document.createElement('div');
        disabledInput.setAttribute('contenteditable', 'true');
        disabledInput.setAttribute('role', 'textbox');
        disabledInput.setAttribute('aria-label', 'Ask Grok anything');
        const disabledSubmit = makeVisible(document.createElement('button'));
        disabledSubmit.setAttribute('aria-label', 'Make video');
        disabledSubmit.disabled = true;
        disabledComposer.append(disabledInput, disabledSubmit);

        const verifiedComposer = document.createElement('div');
        verifiedComposer.className = 'query-bar';
        const verifiedInput = document.createElement('div');
        verifiedInput.setAttribute('contenteditable', 'true');
        verifiedInput.setAttribute('role', 'textbox');
        verifiedInput.setAttribute('aria-label', 'Ask Grok anything');
        const verifiedSubmit = makeVisible(document.createElement('button'));
        verifiedSubmit.setAttribute('aria-label', 'Make video');
        let verifiedSubmitClicks = 0;
        verifiedSubmit.addEventListener('click', () => { verifiedSubmitClicks++; });
        verifiedComposer.append(verifiedInput, verifiedSubmit);

        const unrelatedSubmit = makeVisible(document.createElement('button'));
        unrelatedSubmit.setAttribute('aria-label', 'Make video');
        document.body.append(disabledComposer, unrelatedSubmit, verifiedComposer);
        retryManager.sleep = jest.fn().mockResolvedValue();

        await expect(retryManager._waitForLegacyPromptedVideoSubmitButton()).resolves.toBe(verifiedSubmit);
        expect(retryManager.promptedVideoComposerRoot).toBe(verifiedComposer);
        await expect(retryManager.clickPromptedVideoSubmitButton()).resolves.toBe(true);
        expect(verifiedSubmitClicks).toBe(1);
    });

    test('submits a verified prompted video through the native sender-tab click channel', async () => {
        const { composer, submit } = mountFocusedPromptedVideoComposer();
        let submitClicks = 0;
        submit.addEventListener('click', () => { submitClicks++; });
        retryManager.promptedVideoComposerRoot = composer;
        retryManager.simulateClick = jest.fn();
        nativeControlClickSpy.mockRestore();
        chrome.runtime.sendMessage.mockImplementationOnce(async (message) => {
            if (message.action === 'GPT_PROMPTED_VIDEO_NATIVE_CLICK') submit.click();
            return { ok: true };
        });

        await expect(retryManager.clickPromptedVideoSubmitButton()).resolves.toBe(true);

        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
            action: 'GPT_PROMPTED_VIDEO_NATIVE_CLICK',
            click: { x: 20, y: 20 }
        });
        expect(retryManager.simulateClick).not.toHaveBeenCalled();
        expect(submitClicks).toBe(1);
    });

    test('prompted video submission is accepted when the verified submit settles', async () => {
        const { composer, input, submit } = mountFocusedPromptedVideoComposer();
        input.textContent = 'slow camera push in';
        retryManager.promptedVideoComposerRoot = composer;
        const token = 'submission-disabled';
        retryManager.batchRunning = true;
        retryManager.batchAborted = false;
        retryManager.batchRunToken = token;
        const receipt = retryManager._capturePromptedVideoSubmissionReceipt();
        retryManager.sleep = jest.fn().mockImplementation(async () => {
            submit.disabled = true;
        });

        await expect(retryManager._waitForPromptedVideoSubmissionAccepted(receipt, token, 200))
            .resolves.toBe(true);
    });

    test('prompted video submission is accepted when the verified composer closes', async () => {
        const { composer, input } = mountFocusedPromptedVideoComposer();
        input.textContent = 'slow camera push in';
        retryManager.promptedVideoComposerRoot = composer;
        const token = 'submission-composer-closed';
        retryManager.batchRunning = true;
        retryManager.batchAborted = false;
        retryManager.batchRunToken = token;
        const receipt = retryManager._capturePromptedVideoSubmissionReceipt();
        retryManager.sleep = jest.fn().mockImplementation(async () => {
            composer.remove();
        });

        await expect(retryManager._waitForPromptedVideoSubmissionAccepted(receipt, token, 200))
            .resolves.toBe(true);
    });

    test('prompted video submission is accepted when Grok opens a new post in the same conversation', async () => {
        window.history.pushState({}, '', '/imagine/post/source-post?conversation=conversation-1');
        const { composer, input } = mountFocusedPromptedVideoComposer();
        input.textContent = 'slow camera push in';
        retryManager.promptedVideoComposerRoot = composer;
        const token = 'submission-same-conversation-post';
        retryManager.batchRunning = true;
        retryManager.batchAborted = false;
        retryManager.batchRunToken = token;
        const receipt = retryManager._capturePromptedVideoSubmissionReceipt();
        retryManager.sleep = jest.fn().mockImplementation(async () => {
            window.history.pushState({}, '', '/imagine/post/generated-post?conversation=conversation-1');
        });

        await expect(retryManager._waitForPromptedVideoSubmissionAccepted(receipt, token, 200))
            .resolves.toBe(true);
    });

    test('prompted video submission rejects a new post from a different conversation', async () => {
        window.history.pushState({}, '', '/imagine/post/source-post?conversation=conversation-1');
        const { composer, input } = mountFocusedPromptedVideoComposer();
        input.textContent = 'slow camera push in';
        retryManager.promptedVideoComposerRoot = composer;
        const token = 'submission-different-conversation-post';
        retryManager.batchRunning = true;
        retryManager.batchAborted = false;
        retryManager.batchRunToken = token;
        const receipt = retryManager._capturePromptedVideoSubmissionReceipt();
        retryManager.sleep = jest.fn().mockImplementation(async () => {
            window.history.pushState({}, '', '/imagine/post/generated-post?conversation=conversation-2');
        });

        await expect(retryManager._waitForPromptedVideoSubmissionAccepted(receipt, token, 200))
            .resolves.toBe(false);
    });

    test('prompted video submission rejects a changed post when no conversation was captured', async () => {
        window.history.pushState({}, '', '/imagine/post/source-post');
        const { composer, input } = mountFocusedPromptedVideoComposer();
        input.textContent = 'slow camera push in';
        retryManager.promptedVideoComposerRoot = composer;
        const token = 'submission-post-without-conversation';
        retryManager.batchRunning = true;
        retryManager.batchAborted = false;
        retryManager.batchRunToken = token;
        const receipt = retryManager._capturePromptedVideoSubmissionReceipt();
        retryManager.sleep = jest.fn().mockImplementation(async () => {
            window.history.pushState({}, '', '/imagine/post/generated-post?conversation=conversation-2');
        });

        expect(receipt.conversationId).toBeNull();
        await expect(retryManager._waitForPromptedVideoSubmissionAccepted(receipt, token, 200))
            .resolves.toBe(false);
    });

    test('prompted video submission ignores unrelated document progress', async () => {
        window.history.pushState({}, '', '/imagine/post/source-post?conversation=conversation-1');
        const { composer, input } = mountFocusedPromptedVideoComposer();
        input.textContent = 'slow camera push in';
        retryManager.promptedVideoComposerRoot = composer;
        const token = 'submission-unrelated-progress';
        retryManager.batchRunning = true;
        retryManager.batchAborted = false;
        retryManager.batchRunToken = token;
        const receipt = retryManager._capturePromptedVideoSubmissionReceipt();
        retryManager.sleep = jest.fn().mockImplementation(async () => {
            const unrelatedProgress = document.createElement('button');
            unrelatedProgress.setAttribute('aria-label', 'Video Options');
            const unrelatedResult = document.createElement('video');
            unrelatedResult.src = 'https://assets.grok.com/unrelated/generated_video.mp4';
            Object.defineProperty(unrelatedResult, 'readyState', { configurable: true, value: 4 });
            document.body.append(unrelatedProgress, unrelatedResult);
        });

        await expect(retryManager._waitForPromptedVideoSubmissionAccepted(receipt, token, 200))
            .resolves.toBe(false);
    });

    test('prompted video submission ignores unrelated navigation and DOM mutations', async () => {
        const { composer, input } = mountFocusedPromptedVideoComposer();
        input.textContent = 'slow camera push in';
        retryManager.promptedVideoComposerRoot = composer;
        const token = 'submission-unrelated-change';
        retryManager.batchRunning = true;
        retryManager.batchAborted = false;
        retryManager.batchRunToken = token;
        const receipt = retryManager._capturePromptedVideoSubmissionReceipt();
        retryManager.sleep = jest.fn().mockImplementation(async () => {
            window.history.pushState({}, '', '/imagine/post/unrelated-route-change');
            document.body.appendChild(document.createElement('aside'));
        });

        await expect(retryManager._waitForPromptedVideoSubmissionAccepted(receipt, token, 200))
            .resolves.toBe(false);
    });

    test('prompted video submission wait stops when its batch token is cancelled', async () => {
        const { composer, input } = mountFocusedPromptedVideoComposer();
        input.textContent = 'slow camera push in';
        retryManager.promptedVideoComposerRoot = composer;
        const token = 'submission-cancelled';
        retryManager.batchRunning = true;
        retryManager.batchAborted = false;
        retryManager.batchRunToken = token;
        const receipt = retryManager._capturePromptedVideoSubmissionReceipt();
        retryManager.sleep = jest.fn().mockImplementation(async () => {
            retryManager.batchAborted = true;
        });

        await expect(retryManager._waitForPromptedVideoSubmissionAccepted(receipt, token, 200))
            .resolves.toBe(false);
    });

    test('prompted video submit never falls back to the Precise Edit submit', async () => {
        const queryBar = document.createElement('div');
        queryBar.className = 'query-bar';
        const editSubmit = makeVisible(document.createElement('button'));
        editSubmit.setAttribute('aria-label', 'Edit');
        editSubmit.click = jest.fn();
        queryBar.appendChild(editSubmit);
        document.body.appendChild(queryBar);
        retryManager.simulateClick = jest.fn();

        await expect(retryManager.clickPromptedVideoSubmitButton()).resolves.toBe(false);
        expect(retryManager.simulateClick).not.toHaveBeenCalled();
        expect(editSubmit.click).not.toHaveBeenCalled();
    });

    test('prompted detail batch stops before prompt injection when Add Prompt mode does not open', async () => {
        window.history.pushState({}, '', '/imagine/post/current-ui');
        retryManager.selectMakeVideoMode = jest.fn().mockResolvedValue(false);
        retryManager.injectPromptedVideoText = jest.fn().mockReturnValue(true);
        retryManager.clickPromptedVideoSubmitButton = jest.fn().mockReturnValue(true);

        await retryManager.startPromptedBatchFromDetail('slow camera push in', 1);

        expect(retryManager.injectPromptedVideoText).not.toHaveBeenCalled();
        expect(retryManager.clickPromptedVideoSubmitButton).not.toHaveBeenCalled();
        expect(mockOverlay.setStatus).toHaveBeenCalledWith(expect.stringContaining('Add Prompt'), 'warning');
        expect(retryManager.goalCount).toBe(0);
    });

    test('current prompted video completion detects a new ready generated video without retrying', async () => {
        window.history.pushState({}, '', '/imagine/post/source-image');
        const queryBar = document.createElement('div');
        queryBar.className = 'query-bar';
        const persistentSubmit = makeVisible(document.createElement('button'));
        persistentSubmit.setAttribute('aria-label', 'Make video');
        persistentSubmit.click = jest.fn();
        queryBar.appendChild(persistentSubmit);
        document.body.appendChild(queryBar);

        const baseline = retryManager.capturePromptedVideoResultBaseline(document);
        retryManager.batchRunning = true;
        retryManager.batchAborted = false;
        retryManager.currentRetry = 0;
        retryManager.preClickButtonCount = 0;
        retryManager.sleep = jest.fn().mockImplementation(async () => {
            if (document.querySelector('video')) return;
            window.history.pushState({}, '', '/imagine/post/generated-video');
            const video = document.createElement('video');
            video.src = 'https://assets.grok.com/users/example/generated/generated-video/generated_video.mp4';
            Object.defineProperty(video, 'readyState', { value: 4, configurable: true });
            Object.defineProperty(video, 'duration', { value: 10, configurable: true });
            document.body.appendChild(video);
        });

        await expect(retryManager.awaitBatchItemCompletion(document, {
            labelPrefix: 'Prompted Batch [detail]',
            videoResultBaseline: baseline
        })).resolves.toBe('success');

        expect(retryManager.currentRetry).toBe(0);
        expect(persistentSubmit.click).not.toHaveBeenCalled();
    });

    test('current prompted video completion never retries from the persistent Make video submit', async () => {
        window.history.pushState({}, '', '/imagine/post/source-image');
        const queryBar = document.createElement('div');
        queryBar.className = 'query-bar';
        const persistentSubmit = makeVisible(document.createElement('button'));
        persistentSubmit.setAttribute('aria-label', 'Make video');
        persistentSubmit.click = jest.fn();
        queryBar.appendChild(persistentSubmit);
        document.body.appendChild(queryBar);

        retryManager.batchRunning = true;
        retryManager.batchAborted = false;
        retryManager.currentRetry = 0;
        retryManager.preClickButtonCount = 0;
        retryManager.sleep = jest.fn().mockResolvedValue();
        jest.spyOn(Date, 'now')
            .mockReturnValueOnce(0)
            .mockReturnValue(121000);

        await expect(retryManager.awaitBatchItemCompletion(document, {
            labelPrefix: 'Prompted Batch [detail]',
            videoResultBaseline: {
                pageUrl: window.location.href,
                postId: 'source-image',
                completeCount: 0,
                videoSources: []
            }
        })).resolves.toBe('failed');

        expect(retryManager.currentRetry).toBe(0);
        expect(persistentSubmit.click).not.toHaveBeenCalled();
    });

    test('current-page completion does not accept a pre-existing unready source that becomes ready', () => {
        window.history.pushState({}, '', '/imagine/post/source-image');
        const video = document.createElement('video');
        video.src = 'https://assets.grok.com/users/example/generated/66666666-7777-4888-8999-aaaaaaaaaaaa/generated_video.mp4?token=before';
        Object.defineProperty(video, 'readyState', { value: 0, configurable: true });
        document.body.appendChild(video);

        const baseline = retryManager.capturePromptedVideoResultBaseline(document);
        window.history.pushState({}, '', '/imagine/post/generated-video');
        video.src = 'https://assets.grok.com/users/example/generated/66666666-7777-4888-8999-aaaaaaaaaaaa/generated_video.mp4?token=after';
        Object.defineProperty(video, 'readyState', { value: 4, configurable: true });

        expect(retryManager._hasNewPromptedVideoResult(document, baseline)).toBe(false);
    });

    test('Agent completion accepts only a new ready video source in an asset node without a URL change', () => {
        window.history.pushState({}, '', '/imagine/agent/agent-1?conversation=conversation-1');
        const asset = document.createElement('div');
        asset.className = 'react-flow__node-asset selected';
        asset.setAttribute('data-id', 'asset-source');
        const image = document.createElement('img');
        image.src = 'https://assets.grok.com/users/example/generated/source/image.jpg';
        asset.appendChild(image);
        document.body.appendChild(asset);

        const baseline = retryManager.capturePromptedVideoResultBaseline(document);
        expect(baseline.surface).toBe('agent_media');
        expect(baseline.agentAssetSources).toEqual([image.src]);
        expect(retryManager._hasNewPromptedVideoResult(document, baseline)).toBe(false);

        const video = document.createElement('video');
        video.src = 'https://assets.grok.com/users/example/generated/new-video/generated_video.mp4';
        Object.defineProperty(video, 'readyState', { value: 4, configurable: true });
        asset.appendChild(video);

        expect(retryManager._hasNewPromptedVideoResult(document, baseline)).toBe(true);
    });

    test('Agent completion accepts a new video only inside the bound source asset', () => {
        const sourceUrl = 'https://assets.grok.com/users/example/generated/67676767-aaaa-4bbb-8ccc-898989898989/image.jpg';
        window.history.pushState({}, '', '/imagine/agent/bound-result?conversation=bound-result');
        const sourceAsset = document.createElement('div');
        sourceAsset.className = 'react-flow__node-asset selected';
        sourceAsset.setAttribute('data-id', 'asset-source');
        const sourceImage = document.createElement('img');
        sourceImage.src = sourceUrl;
        sourceAsset.appendChild(sourceImage);
        const competingAsset = document.createElement('div');
        competingAsset.className = 'react-flow__node-asset';
        competingAsset.setAttribute('data-id', 'asset-output');
        document.body.append(sourceAsset, competingAsset);
        const binding = {
            assetNodeId: 'asset-source',
            sourceIdentity: '67676767-aaaa-4bbb-8ccc-898989898989',
            sourceUrl
        };

        const baseline = retryManager.capturePromptedVideoResultBaseline(document, binding);
        const competingVideo = document.createElement('video');
        competingVideo.src = 'https://assets.grok.com/users/example/generated/78787878-aaaa-4bbb-8ccc-909090909090/generated_video.mp4';
        Object.defineProperty(competingVideo, 'readyState', { value: 4, configurable: true });
        competingAsset.appendChild(competingVideo);

        expect(retryManager._hasNewPromptedVideoResult(document, baseline)).toBe(false);

        const boundVideo = document.createElement('video');
        boundVideo.src = 'https://assets.grok.com/users/example/generated/89898989-aaaa-4bbb-8ccc-a1a1a1a1a1a1/generated_video.mp4';
        Object.defineProperty(boundVideo, 'readyState', { value: 4, configurable: true });
        sourceAsset.appendChild(boundVideo);

        expect(retryManager._hasNewPromptedVideoResult(document, baseline)).toBe(true);
    });

    test('Agent completion does not accept a pre-existing unready source that becomes ready', () => {
        window.history.pushState({}, '', '/imagine/agent/agent-1?conversation=conversation-1');
        const asset = document.createElement('div');
        asset.className = 'react-flow__node-asset selected';
        asset.setAttribute('data-id', 'asset-source');
        const video = document.createElement('video');
        video.src = 'https://assets.grok.com/users/example/generated/11111111-2222-4333-8444-555555555555/generated_video.mp4?token=before';
        Object.defineProperty(video, 'readyState', { value: 0, configurable: true });
        asset.appendChild(video);
        document.body.appendChild(asset);

        const baseline = retryManager.capturePromptedVideoResultBaseline(document);
        video.src = 'https://assets.grok.com/users/example/generated/11111111-2222-4333-8444-555555555555/generated_video.mp4?token=after';
        Object.defineProperty(video, 'readyState', { value: 4, configurable: true });

        expect(retryManager._hasNewPromptedVideoResult(document, baseline)).toBe(false);
    });

    test('Agent completion ignores unchanged sources and persistent video or Precise Edit controls', () => {
        window.history.pushState({}, '', '/imagine/agent/agent-1?conversation=conversation-1');
        const asset = document.createElement('div');
        asset.className = 'react-flow__node-asset selected';
        asset.setAttribute('data-id', 'asset-source');
        const video = document.createElement('video');
        video.src = 'https://assets.grok.com/users/example/generated/existing-video/generated_video.mp4';
        Object.defineProperty(video, 'readyState', { value: 4, configurable: true });
        asset.appendChild(video);
        const controls = document.createElement('div');
        controls.className = 'query-bar';
        const makeVideo = makeVisible(document.createElement('button'));
        makeVideo.setAttribute('aria-label', 'Make video');
        const edit = makeVisible(document.createElement('button'));
        edit.setAttribute('aria-label', 'Edit');
        controls.append(makeVideo, edit);
        document.body.append(asset, controls);

        const baseline = retryManager.capturePromptedVideoResultBaseline(document);

        expect(retryManager._hasNewPromptedVideoResult(document, baseline)).toBe(false);
    });

    test('prompted detail batch passes the current video result baseline to completion monitoring', async () => {
        window.history.pushState({}, '', '/imagine/post/source-image');
        const baseline = {
            pageUrl: window.location.href,
            postId: 'source-image',
            completeCount: 0,
            videoSources: []
        };
        retryManager.selectMakeVideoMode = jest.fn().mockImplementation(async () => {
            retryManager.promptedVideoModeContract = 'current_menu';
            return true;
        });
        retryManager.injectPromptedVideoText = jest.fn().mockReturnValue(true);
        retryManager._waitForPromptedVideoSubmitButton = jest.fn().mockResolvedValue(
            document.createElement('button')
        );
        retryManager.capturePromptedVideoResultBaseline = jest.fn().mockReturnValue(baseline);
        retryManager.clickPromptedVideoSubmitButton = jest.fn().mockReturnValue(true);
        retryManager.awaitBatchItemCompletion = jest.fn().mockResolvedValue('success');
        retryManager.sleep = jest.fn().mockResolvedValue();

        await retryManager.startPromptedBatchFromDetail('slow camera push in', 1);

        expect(retryManager.capturePromptedVideoResultBaseline).toHaveBeenCalledWith(document);
        expect(retryManager.awaitBatchItemCompletion).toHaveBeenCalledWith(document, {
            allowRetry: true,
            labelPrefix: 'Prompted Batch [detail]',
            runToken: expect.any(String),
            videoResultBaseline: baseline
        });
        expect(retryManager.goalCount).toBe(1);
    });

    test('updateCounters shows gallery label during prompted gallery batch', () => {
        retryManager.batchRunning = true;
        retryManager.batchMode = 'prompted';
        retryManager.batchContext = 'gallery';
        retryManager.goalCount = 2;
        retryManager.goalTotal = 5;

        retryManager.updateCounters();

        expect(mockOverlay.el.querySelector('#gptProgressLabel').textContent).toBe('Images Processed');
        expect(mockOverlay.el.querySelector('#gptVideoCounter').textContent).toBe('2/5');
    });

    test('updateBatchButtons works without prompted selector row', () => {
        expect(() => retryManager.updateBatchButtons(true)).not.toThrow();
        expect(() => retryManager.updateBatchButtons(false)).not.toThrow();
    });
});
