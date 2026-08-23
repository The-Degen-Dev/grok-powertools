const fs = require('fs');
const vm = require('vm');
const {
    captureGeneratedResultBaseline,
    captureSubmissionReceipt,
    describeCurrentSource,
    detectGrokSurface,
    evaluateSubmissionReceipt,
    findGeneratedResult,
    inspectGeneratedResult,
    listGalleryItems,
    resolveGalleryItem,
    resolveMediaAction
} = require('../../grokImagineAdapter.js');

const adapterPath = require.resolve('../../grokImagineAdapter.js');

const CONVERSATION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SECOND_CONVERSATION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const FIRST_ASSET_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_ASSET_ID = '22222222-2222-4222-8222-222222222222';
const THIRD_ASSET_ID = '33333333-3333-4333-8333-333333333333';
const FOURTH_ASSET_ID = '77777777-7777-4777-8777-777777777777';
const FIFTH_ASSET_ID = '88888888-8888-4888-8888-888888888888';
const FIRST_POST_ID = '44444444-4444-4444-8444-444444444444';
const SECOND_POST_ID = '55555555-5555-4555-8555-555555555555';
const THIRD_POST_ID = '66666666-6666-4666-8666-666666666666';

function generatedMediaUrl(assetId, fileName = 'image.jpg') {
    return `https://assets.grok.com/users/example/generated/${assetId}/${fileName}?token=must-not-persist&expires=9999999999`;
}

function galleryCard({
    assetId,
    postId,
    conversationId,
    mediaKind = 'image',
    extraPostHref = '',
    includeQuickAction = true
}) {
    return `
        <article role="listitem" class="media-post-masonry-card" data-media-type="${mediaKind}">
            <a href="/imagine/post/${postId}?conversation=${conversationId}">
                <img alt="Generated image" src="${generatedMediaUrl(assetId, mediaKind === 'video' ? 'preview_image.jpg' : 'image.jpg')}">
            </a>
            ${extraPostHref ? `<a href="${extraPostHref}">Alternate post</a>` : ''}
            ${mediaKind === 'video' ? `<video src="${generatedMediaUrl(assetId, 'generated_video.mp4')}"></video>` : ''}
            ${includeQuickAction ? '<button type="button" aria-label="Make video">Make video</button>' : ''}
        </article>
    `;
}

function mountGallery(items) {
    document.body.innerHTML = `<main><section role="list">${items.map(galleryCard).join('')}</section></main>`;
}

function currentGalleryCard({
    assetId,
    postId,
    conversationId,
    mediaKind = 'image',
    includeQuickAction = true
}) {
    const media = mediaKind === 'video'
        ? `
            <img alt="" src="${generatedMediaUrl(assetId, 'preview_image.jpg')}">
            <video src="${generatedMediaUrl(assetId, 'generated_video.mp4')}"></video>
        `
        : `<img alt="" src="${generatedMediaUrl(assetId)}">`;
    return `
        <div role="listitem" data-masonry-key="${conversationId}">
            <div class="relative group/media-post-masonry-card" data-media-type="${mediaKind}">
                <div>${media}</div>
                <a class="absolute inset-0"
                    href="/imagine/post/${postId}?conversation=${conversationId}"></a>
                <div>
                    ${includeQuickAction ? '<button type="button" aria-label="Make video">Make video</button>' : ''}
                </div>
            </div>
        </div>
    `;
}

function mountCurrentGallery(items) {
    document.body.innerHTML = `
        <main><section role="list" data-imagine-masonry-grid>
            ${items.map(currentGalleryCard).join('')}
        </section></main>
    `;
}

function expectedDescriptor({
    surface,
    assetId,
    postId,
    conversationId,
    mediaKind,
    initialOrder,
    beforeAssetId = '',
    afterAssetId = ''
}) {
    return {
        version: 1,
        surface,
        sourceAssetId: assetId,
        sourcePostId: postId,
        conversationId,
        mediaKind,
        hrefPath: `/imagine/post/${postId}`,
        initialOrder,
        beforeAssetId,
        afterAssetId
    };
}

function currentResultsItems() {
    return [
        {
            assetId: FIRST_ASSET_ID,
            postId: FIRST_POST_ID,
            conversationId: CONVERSATION_ID
        },
        {
            assetId: SECOND_ASSET_ID,
            postId: SECOND_POST_ID,
            conversationId: CONVERSATION_ID
        }
    ];
}

function listCurrentResults() {
    return listGalleryItems({
        root: document,
        surface: detectGrokSurface({
            root: document,
            location: new URL(`https://grok.com/imagine?conversation=${CONVERSATION_ID}`)
        })
    });
}

function setActiveGrokRoute(path) {
    window.history.replaceState({}, '', path);
}

function persistedSourceDescriptor(overrides = {}) {
    return {
        ...expectedDescriptor({
            surface: 'results_gallery',
            assetId: FIRST_ASSET_ID,
            postId: FIRST_POST_ID,
            conversationId: CONVERSATION_ID,
            mediaKind: 'image',
            initialOrder: 0
        }),
        ...overrides
    };
}

function mountAgentSource({
    assetId = FIRST_ASSET_ID,
    dataAssetId = assetId,
    selected = true,
    includeToolbarDecoy = true,
    includeSidePanelAction = true
} = {}) {
    document.body.innerHTML = `
        <div class="react-flow">
            <div class="react-flow__node-asset${selected ? ' selected' : ''}"
                data-id="asset-${dataAssetId}">
                <img src="${generatedMediaUrl(assetId, 'preview.jpg')}">
            </div>
            ${includeToolbarDecoy ? `
                <div class="react-flow__node-toolbar" data-id="asset-${dataAssetId}">
                    <button aria-label="Make Video">Toolbar Make Video</button>
                </div>
            ` : ''}
        </div>
        ${includeSidePanelAction ? `
            <aside aria-label="Media actions">
                <button id="agent-make-video" aria-label="Make Video" aria-haspopup="menu"
                    aria-controls="agent-video-menu" aria-expanded="false" data-state="closed">
                    Make Video
                </button>
            </aside>
        ` : ''}
    `;
    return {
        source: document.querySelector('.react-flow__node-asset'),
        toolbarAction: document.querySelector('.react-flow__node-toolbar button'),
        sidePanelAction: document.querySelector('aside button[aria-label="Make Video"]')
    };
}

function mountLegacyDetail({ assetId = FIRST_ASSET_ID, postId = FIRST_POST_ID } = {}) {
    document.body.innerHTML = `
        <main>
            <article data-testid="media-detail">
                <a href="/imagine/post/${postId}?conversation=${CONVERSATION_ID}">
                    <img alt="Generated image" src="${generatedMediaUrl(assetId)}">
                </a>
            </article>
            <aside aria-label="Media actions">
                <button id="detail-make-video" aria-label="Make Video" aria-haspopup="menu"
                    aria-controls="detail-video-menu" aria-expanded="false" data-state="closed">
                    Make Video
                </button>
            </aside>
        </main>
    `;
    return {
        source: document.querySelector('[data-testid="media-detail"]'),
        sidePanelAction: document.querySelector('#detail-make-video')
    };
}

function mountCurrentDetailModal({ assetId = FIRST_ASSET_ID, mediaKind = 'image' } = {}) {
    const media = mediaKind === 'video'
        ? `<video src="${generatedMediaUrl(assetId, 'generated_video.mp4')}"></video>`
        : `<img alt="Generated image" src="${generatedMediaUrl(assetId)}">`;
    document.body.innerHTML = `
        <main>
            <article>
                <div data-media-frame>${media}</div>
            </article>
            <aside aria-label="Media actions">
                <button id="detail-make-video" aria-label="Make Video" aria-haspopup="menu">
                    Make Video
                </button>
            </aside>
        </main>
    `;
    return {
        source: document.querySelector('article'),
        sidePanelAction: document.querySelector('#detail-make-video')
    };
}

function openLinkedAddPromptMenu(trigger, menuId) {
    trigger.setAttribute('aria-expanded', 'true');
    trigger.setAttribute('data-state', 'open');
    const menu = document.createElement('div');
    menu.id = menuId;
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-labelledby', trigger.id);
    menu.setAttribute('data-state', 'open');
    menu.innerHTML = `
        <button role="menuitem">Precise Edit</button>
        <button role="menuitem">Add Prompt</button>
    `;
    document.body.appendChild(menu);
    return menu.querySelectorAll('[role="menuitem"]')[1];
}

function openLinkedQuickAnimateMenu(trigger, menuId) {
    trigger.setAttribute('aria-controls', menuId);
    trigger.setAttribute('aria-expanded', 'true');
    trigger.setAttribute('data-state', 'open');
    const menu = document.createElement('div');
    menu.id = menuId;
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-labelledby', trigger.id);
    menu.setAttribute('data-state', 'open');
    menu.innerHTML = `
        <button role="menuitem">Add Prompt</button>
        <button role="menuitem">Spicy</button>
        <button role="menuitem">Quick Animate</button>
    `;
    document.body.appendChild(menu);
    return menu.querySelectorAll('[role="menuitem"]')[2];
}

function appendResultVideo(parent, assetId, { ready = true } = {}) {
    const video = document.createElement('video');
    video.setAttribute('data-generation-result', 'video');
    video.src = generatedMediaUrl(assetId, 'generated_video.mp4');
    Object.defineProperty(video, 'readyState', { configurable: true, value: ready ? 4 : 1 });
    Object.defineProperty(video, 'duration', { configurable: true, value: ready ? 6 : 0 });
    Object.defineProperty(video, 'videoWidth', { configurable: true, value: ready ? 400 : 0 });
    Object.defineProperty(video, 'videoHeight', { configurable: true, value: ready ? 736 : 0 });
    parent.appendChild(video);
    return video;
}

function generatedResultBaseline(mediaAssetIds = [], failureCount = 0) {
    return { version: 1, mediaAssetIds, failureCount };
}

describe('Grok Imagine adapter module contract', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        setActiveGrokRoute('/');
    });

    test('exposes the CommonJS API through the UMD browser global', () => {
        const context = { globalThis: {} };
        vm.runInNewContext(fs.readFileSync(adapterPath, 'utf8'), context);

        const browserApi = context.globalThis.GrokPowerToolsGrokImagineAdapter;
        expect(browserApi).toBeDefined();
        expect(browserApi.detectGrokSurface).toBeDefined();
        expect(browserApi.listGalleryItems).toBeDefined();
        expect(browserApi.resolveGalleryItem).toBeDefined();
        expect(browserApi.resolveMediaAction).toBeDefined();
        expect(browserApi.captureGeneratedResultBaseline).toBeDefined();
        expect(browserApi.captureSubmissionReceipt).toBeDefined();
        expect(browserApi.describeCurrentSource).toBeDefined();
        expect(browserApi.evaluateSubmissionReceipt).toBeDefined();
        expect(browserApi.findGeneratedResult).toBeDefined();
        expect(browserApi.inspectGeneratedResult).toBeDefined();
    });

    test('detects Agent, legacy detail, and unsupported routes without trusting a foreign host', () => {
        expect(detectGrokSurface({
            root: document,
            location: new URL(`https://grok.com/imagine/agent/agent-1?conversation=${CONVERSATION_ID}`)
        })).toBe('agent_media');
        expect(detectGrokSurface({
            root: document,
            location: new URL(`https://grok.com/imagine/post/${FIRST_POST_ID}`)
        })).toBe('legacy_detail');
        expect(detectGrokSurface({
            root: document,
            location: new URL('https://grok.com/chat')
        })).toBe('unsupported');

        mountGallery(currentResultsItems());
        expect(detectGrokSurface({
            root: document,
            location: new URL(`https://example.com/imagine?conversation=${CONVERSATION_ID}`)
        })).toBe('unsupported');
    });

    test('describes exactly one legacy detail source from its route post and media asset UUIDs', () => {
        mountLegacyDetail();

        const result = describeCurrentSource({
            root: document,
            surface: 'legacy_detail',
            location: new URL(
                `https://grok.com/imagine/post/${FIRST_POST_ID}?conversation=${CONVERSATION_ID}`
            )
        });

        expect(result).toEqual({
            status: 'matched',
            descriptor: {
                version: 1,
                surface: 'legacy_detail',
                sourceAssetId: FIRST_ASSET_ID,
                sourcePostId: FIRST_POST_ID,
                conversationId: CONVERSATION_ID,
                mediaKind: 'image',
                hrefPath: `/imagine/post/${FIRST_POST_ID}`,
                route: `https://grok.com/imagine/post/${FIRST_POST_ID}?conversation=${CONVERSATION_ID}`,
                initialOrder: 0,
                beforeAssetId: '',
                afterAssetId: ''
            }
        });
        expect(JSON.parse(JSON.stringify(result))).toEqual(result);
        expect(Object.values(result.descriptor).some((value) => value instanceof Element)).toBe(false);
    });

    test('describes the current Grok detail modal without requiring a nested post link', () => {
        mountCurrentDetailModal({ mediaKind: 'video' });

        expect(describeCurrentSource({
            root: document,
            surface: 'legacy_detail',
            location: new URL(
                `https://grok.com/imagine/post/${FIRST_POST_ID}?conversation=${CONVERSATION_ID}`
            )
        })).toEqual({
            status: 'matched',
            descriptor: {
                version: 1,
                surface: 'legacy_detail',
                sourceAssetId: FIRST_ASSET_ID,
                sourcePostId: FIRST_POST_ID,
                conversationId: CONVERSATION_ID,
                mediaKind: 'video',
                hrefPath: `/imagine/post/${FIRST_POST_ID}`,
                route: `https://grok.com/imagine/post/${FIRST_POST_ID}?conversation=${CONVERSATION_ID}`,
                initialOrder: 0,
                beforeAssetId: '',
                afterAssetId: ''
            }
        });
    });

    test('fails closed when legacy detail identity is missing or disagrees with the route post UUID', () => {
        mountLegacyDetail({ postId: SECOND_POST_ID });

        expect(describeCurrentSource({
            root: document,
            surface: 'legacy_detail',
            location: new URL(`https://grok.com/imagine/post/${FIRST_POST_ID}`)
        })).toEqual({
            status: 'ambiguous',
            reason: 'legacy_detail_route_mismatch'
        });

        document.body.innerHTML = '<main></main>';
        expect(describeCurrentSource({
            root: document,
            surface: 'legacy_detail',
            location: new URL(`https://grok.com/imagine/post/${FIRST_POST_ID}`)
        })).toEqual({
            status: 'missing',
            reason: 'legacy_detail_source_missing'
        });
    });

    test('describes one selected Agent source using an explicit contextual post hint', () => {
        mountAgentSource();

        expect(describeCurrentSource({
            root: document,
            surface: 'agent_media',
            location: new URL(
                `https://grok.com/imagine/agent/agent-1?conversation=${CONVERSATION_ID}`
            ),
            sourcePostIdHint: FIRST_POST_ID
        })).toEqual({
            status: 'matched',
            descriptor: {
                version: 1,
                surface: 'agent_media',
                sourceAssetId: FIRST_ASSET_ID,
                sourcePostId: FIRST_POST_ID,
                conversationId: CONVERSATION_ID,
                mediaKind: 'image',
                hrefPath: '/imagine/agent/agent-1',
                route: `https://grok.com/imagine/agent/agent-1?conversation=${CONVERSATION_ID}`,
                initialOrder: 0,
                beforeAssetId: '',
                afterAssetId: ''
            }
        });
    });

    test('requires explicit Agent post context instead of treating conversation scope as a post', () => {
        mountAgentSource({ assetId: THIRD_ASSET_ID });

        const result = describeCurrentSource({
            root: document,
            surface: 'agent_media',
            location: new URL(
                `https://grok.com/imagine/agent/agent-2?conversation=${SECOND_CONVERSATION_ID}`
            )
        });

        expect(result).toEqual({
            status: 'missing',
            reason: 'agent_source_post_context_missing'
        });
    });

    test('fails closed for missing or ambiguous selected Agent source identity', () => {
        mountAgentSource({ selected: false });
        const options = {
            root: document,
            surface: 'agent_media',
            location: new URL(
                `https://grok.com/imagine/agent/agent-1?conversation=${CONVERSATION_ID}`
            )
        };

        expect(describeCurrentSource(options)).toEqual({
            status: 'missing',
            reason: 'agent_selected_source_missing'
        });

        const { source } = mountAgentSource();
        source.parentElement.appendChild(source.cloneNode(true));
        expect(describeCurrentSource(options)).toEqual({
            status: 'ambiguous',
            reason: 'agent_selected_source_ambiguous'
        });

        mountAgentSource().source.removeAttribute('data-id');
        expect(describeCurrentSource(options)).toEqual({
            status: 'missing',
            reason: 'agent_source_node_id_missing'
        });

        const multiAssetSource = mountAgentSource().source;
        multiAssetSource.insertAdjacentHTML(
            'beforeend',
            `<img src="${generatedMediaUrl(SECOND_ASSET_ID)}">`
        );
        expect(describeCurrentSource(options)).toEqual({
            status: 'ambiguous',
            reason: 'agent_source_asset_ambiguous'
        });
    });

    test('returns unsupported for current-source surfaces outside detail and Agent media', () => {
        mountGallery(currentResultsItems());

        expect(describeCurrentSource({
            root: document,
            surface: 'results_gallery',
            location: new URL(`https://grok.com/imagine?conversation=${CONVERSATION_ID}`)
        })).toEqual({
            status: 'unsupported',
            reason: 'current_source_surface_unsupported'
        });
    });

    test('returns serializable descriptors for current results with shared conversation scope', () => {
        mountGallery(currentResultsItems());

        const result = listCurrentResults();

        expect(result).toEqual({
            status: 'ok',
            items: [
                expectedDescriptor({
                    surface: 'results_gallery',
                    assetId: FIRST_ASSET_ID,
                    postId: FIRST_POST_ID,
                    conversationId: CONVERSATION_ID,
                    mediaKind: 'image',
                    initialOrder: 0,
                    afterAssetId: SECOND_ASSET_ID
                }),
                expectedDescriptor({
                    surface: 'results_gallery',
                    assetId: SECOND_ASSET_ID,
                    postId: SECOND_POST_ID,
                    conversationId: CONVERSATION_ID,
                    mediaKind: 'image',
                    initialOrder: 1,
                    beforeAssetId: FIRST_ASSET_ID
                })
            ]
        });

        expect(result.items[0].sourcePostId).not.toBe(result.items[1].sourcePostId);
        expect(result.items[0].sourceAssetId).not.toBe(result.items[1].sourceAssetId);
        expect(result.items[0].conversationId).toBe(result.items[1].conversationId);
        expect(JSON.stringify(result)).not.toContain('token=');
        expect(JSON.stringify(result)).not.toContain('https://');
        expect(result.items.every((item) => !Object.values(item).some((value) => value instanceof Element))).toBe(true);
    });

    test('returns ordered Saved image and video descriptors without signed media URLs', () => {
        mountGallery([
            {
                assetId: FIRST_ASSET_ID,
                postId: FIRST_POST_ID,
                conversationId: CONVERSATION_ID,
                mediaKind: 'image'
            },
            {
                assetId: THIRD_ASSET_ID,
                postId: THIRD_POST_ID,
                conversationId: SECOND_CONVERSATION_ID,
                mediaKind: 'video',
                includeQuickAction: false
            }
        ]);

        const surface = detectGrokSurface({
            root: document,
            location: new URL('https://grok.com/imagine/saved')
        });
        const result = listGalleryItems({ root: document, surface });

        expect(surface).toBe('saved_gallery');
        expect(result).toEqual({
            status: 'ok',
            items: [
                expectedDescriptor({
                    surface: 'saved_gallery',
                    assetId: FIRST_ASSET_ID,
                    postId: FIRST_POST_ID,
                    conversationId: CONVERSATION_ID,
                    mediaKind: 'image',
                    initialOrder: 0,
                    afterAssetId: THIRD_ASSET_ID
                }),
                expectedDescriptor({
                    surface: 'saved_gallery',
                    assetId: THIRD_ASSET_ID,
                    postId: THIRD_POST_ID,
                    conversationId: SECOND_CONVERSATION_ID,
                    mediaKind: 'video',
                    initialOrder: 1,
                    beforeAssetId: FIRST_ASSET_ID
                })
            ]
        });
        expect(JSON.stringify(result)).not.toContain('must-not-persist');
    });

    test('binds current Saved overlay links to sibling media inside the same card', () => {
        mountCurrentGallery([
            {
                assetId: FIRST_ASSET_ID,
                postId: FIRST_POST_ID,
                conversationId: CONVERSATION_ID,
                mediaKind: 'image'
            },
            {
                assetId: THIRD_ASSET_ID,
                postId: THIRD_POST_ID,
                conversationId: SECOND_CONVERSATION_ID,
                mediaKind: 'video',
                includeQuickAction: false
            }
        ]);

        const surface = detectGrokSurface({
            root: document,
            location: new URL('https://grok.com/imagine/saved')
        });
        const result = listGalleryItems({ root: document, surface });

        expect(result).toEqual({
            status: 'ok',
            items: [
                expectedDescriptor({
                    surface: 'saved_gallery',
                    assetId: FIRST_ASSET_ID,
                    postId: FIRST_POST_ID,
                    conversationId: CONVERSATION_ID,
                    mediaKind: 'image',
                    initialOrder: 0,
                    afterAssetId: THIRD_ASSET_ID
                }),
                expectedDescriptor({
                    surface: 'saved_gallery',
                    assetId: THIRD_ASSET_ID,
                    postId: THIRD_POST_ID,
                    conversationId: SECOND_CONVERSATION_ID,
                    mediaKind: 'video',
                    initialOrder: 1,
                    beforeAssetId: FIRST_ASSET_ID
                })
            ]
        });

        const resolved = resolveGalleryItem({ root: document, descriptor: result.items[0] });
        expect(resolved.status).toBe('matched');
        expect(resolved.card.classList.contains('group/media-post-masonry-card')).toBe(true);
        expect(resolveMediaAction({
            root: document,
            descriptor: result.items[0],
            action: 'quick_video'
        })).toEqual({
            status: 'matched',
            stage: 'submit_direct',
            control: resolved.card.querySelector('button[aria-label="Make video"]')
        });
    });

    test('reacquires one descriptor after every gallery node is remounted and reordered', () => {
        mountGallery(currentResultsItems());
        const descriptor = listCurrentResults().items[1];
        const originalCard = document.querySelectorAll('[role="listitem"]')[1];

        mountGallery([...currentResultsItems()].reverse());
        const remountedCard = document.querySelectorAll('[role="listitem"]')[0];
        const result = resolveGalleryItem({ root: document, descriptor });

        expect(result).toEqual({
            status: 'matched',
            card: remountedCard,
            descriptor
        });
        expect(result.card).not.toBe(originalCard);
        expect(result.card.querySelector('a').pathname).toBe(`/imagine/post/${SECOND_POST_ID}`);
        expect(result.card.querySelector('img').src).toContain(`/generated/${SECOND_ASSET_ID}/`);
    });

    test('reacquires the exact selected Agent source and ignores its toolbar action decoy', () => {
        const descriptor = persistedSourceDescriptor();
        const { source, toolbarAction, sidePanelAction } = mountAgentSource();
        setActiveGrokRoute(`/imagine/agent/agent-1?conversation=${CONVERSATION_ID}`);

        expect(resolveGalleryItem({ root: document, descriptor })).toEqual({
            status: 'matched',
            card: source,
            descriptor
        });
        expect(resolveMediaAction({
            root: document,
            descriptor,
            action: 'prompted_video'
        })).toEqual({
            status: 'matched',
            stage: 'open_prompt_menu',
            control: sidePanelAction
        });
        expect(resolveMediaAction({
            root: document,
            descriptor,
            action: 'prompted_video'
        }).control).not.toBe(toolbarAction);
        expect(resolveMediaAction({
            root: document,
            descriptor,
            action: 'goal_video'
        })).toEqual({
            status: 'matched',
            stage: 'submit_direct',
            control: toolbarAction
        });

        appendResultVideo(source, THIRD_ASSET_ID);
        expect(resolveGalleryItem({ root: document, descriptor })).toEqual({
            status: 'matched',
            card: source,
            descriptor
        });

        const addPrompt = openLinkedAddPromptMenu(sidePanelAction, 'agent-video-menu');
        expect(resolveMediaAction({
            root: document,
            descriptor,
            action: 'prompted_video'
        })).toEqual({
            status: 'matched',
            stage: 'select_add_prompt',
            control: addPrompt
        });
    });

    test('fails closed when Agent stable data identity disagrees or the source is duplicated', () => {
        const descriptor = persistedSourceDescriptor();
        mountAgentSource({ dataAssetId: SECOND_ASSET_ID });

        expect(resolveGalleryItem({ root: document, descriptor })).toEqual({
            status: 'ambiguous',
            reason: 'source_identity_ambiguous'
        });

        const first = mountAgentSource().source;
        const duplicate = first.cloneNode(true);
        first.parentElement.appendChild(duplicate);
        expect(resolveGalleryItem({ root: document, descriptor })).toEqual({
            status: 'ambiguous',
            reason: 'source_identity_ambiguous'
        });
    });

    test('resolves a legacy detail source and its linked Add Prompt action', () => {
        const descriptor = persistedSourceDescriptor();
        const { source, sidePanelAction } = mountLegacyDetail();
        setActiveGrokRoute(`/imagine/post/${FIRST_POST_ID}?conversation=${CONVERSATION_ID}`);

        expect(resolveGalleryItem({ root: document, descriptor })).toEqual({
            status: 'matched',
            card: source,
            descriptor
        });
        expect(resolveMediaAction({
            root: document,
            descriptor,
            action: 'prompted_video'
        })).toEqual({
            status: 'matched',
            stage: 'open_prompt_menu',
            control: sidePanelAction
        });

        const addPrompt = openLinkedAddPromptMenu(sidePanelAction, 'detail-video-menu');
        expect(resolveMediaAction({
            root: document,
            descriptor,
            action: 'prompted_video'
        })).toEqual({
            status: 'matched',
            stage: 'select_add_prompt',
            control: addPrompt
        });

        sidePanelAction.setAttribute('aria-expanded', 'false');
        sidePanelAction.setAttribute('data-state', 'closed');
        document.querySelector('#detail-video-menu').remove();
        expect(resolveMediaAction({
            root: document,
            descriptor,
            action: 'goal_video'
        })).toEqual({
            status: 'matched',
            stage: 'open_goal_menu',
            control: sidePanelAction
        });

        const quickAnimate = openLinkedQuickAnimateMenu(sidePanelAction, 'detail-goal-menu');
        expect(resolveMediaAction({
            root: document,
            descriptor,
            action: 'goal_video'
        })).toEqual({
            status: 'matched',
            stage: 'select_quick_animate',
            control: quickAnimate
        });
    });

    test('fails closed for duplicate cards and an internally ambiguous card identity', () => {
        const duplicate = currentResultsItems()[0];
        mountGallery([duplicate, duplicate]);

        expect(listCurrentResults()).toEqual({
            status: 'ambiguous',
            reason: 'duplicate_gallery_identity',
            items: []
        });

        mountGallery([{
            ...duplicate,
            extraPostHref: `/imagine/post/${SECOND_POST_ID}?conversation=${CONVERSATION_ID}`
        }]);

        expect(listCurrentResults()).toEqual({
            status: 'ambiguous',
            reason: 'card_identity_ambiguous',
            items: []
        });
    });

    test('fails closed when separate cards disagree by reusing either asset or post identity', () => {
        mountGallery([
            currentResultsItems()[0],
            {
                assetId: FIRST_ASSET_ID,
                postId: SECOND_POST_ID,
                conversationId: CONVERSATION_ID
            }
        ]);
        expect(listCurrentResults()).toEqual({
            status: 'ambiguous',
            reason: 'duplicate_asset_identity',
            items: []
        });

        mountGallery([
            currentResultsItems()[0],
            {
                assetId: SECOND_ASSET_ID,
                postId: FIRST_POST_ID,
                conversationId: CONVERSATION_ID
            }
        ]);
        expect(listCurrentResults()).toEqual({
            status: 'ambiguous',
            reason: 'duplicate_post_identity',
            items: []
        });
    });

    test('keeps source descriptors stable when generated media is inserted inside or beside a card', () => {
        mountGallery(currentResultsItems());
        const firstCard = document.querySelectorAll('[role="listitem"]')[0];
        appendResultVideo(firstCard, FOURTH_ASSET_ID);
        const adjacentResult = document.createElement('section');
        adjacentResult.setAttribute('aria-label', 'Generated video result');
        appendResultVideo(adjacentResult, FIFTH_ASSET_ID);
        firstCard.after(adjacentResult);

        expect(listCurrentResults()).toEqual({
            status: 'ok',
            items: [
                persistedSourceDescriptor({ afterAssetId: SECOND_ASSET_ID }),
                expectedDescriptor({
                    surface: 'results_gallery',
                    assetId: SECOND_ASSET_ID,
                    postId: SECOND_POST_ID,
                    conversationId: CONVERSATION_ID,
                    mediaKind: 'image',
                    initialOrder: 1,
                    beforeAssetId: FIRST_ASSET_ID
                })
            ]
        });
    });

    test('returns ambiguous instead of first-match reacquisition for a duplicated identity', () => {
        mountGallery(currentResultsItems());
        const descriptor = listCurrentResults().items[0];
        mountGallery([currentResultsItems()[0], currentResultsItems()[0]]);

        expect(resolveGalleryItem({ root: document, descriptor })).toEqual({
            status: 'ambiguous',
            reason: 'gallery_item_ambiguous'
        });
    });

    test('distinguishes direct Quick Make video from Prompted Make Video and exact Add Prompt', () => {
        mountGallery(currentResultsItems());
        const descriptor = listCurrentResults().items[0];
        const card = document.querySelector('[role="listitem"]');
        const quickControl = card.querySelector('button[aria-label="Make video"]');

        expect(resolveMediaAction({
            root: document,
            descriptor,
            action: 'quick_video'
        })).toEqual({
            status: 'matched',
            stage: 'submit_direct',
            control: quickControl
        });

        const { sidePanelAction: promptedTrigger } = mountLegacyDetail();
        promptedTrigger.id = 'make-video-menu-trigger';
        promptedTrigger.setAttribute('aria-controls', 'make-video-menu');
        setActiveGrokRoute(`/imagine/post/${FIRST_POST_ID}?conversation=${CONVERSATION_ID}`);
        expect(resolveMediaAction({
            root: document,
            descriptor,
            action: 'prompted_video'
        })).toEqual({
            status: 'matched',
            stage: 'open_prompt_menu',
            control: promptedTrigger
        });

        promptedTrigger.setAttribute('aria-expanded', 'true');
        promptedTrigger.setAttribute('data-state', 'open');
        const menu = document.createElement('div');
        menu.id = 'make-video-menu';
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-labelledby', promptedTrigger.id);
        menu.setAttribute('data-state', 'open');
        menu.innerHTML = `
            <button role="menuitem">Precise Edit</button>
            <button role="menuitem">Add Prompt</button>
        `;
        document.body.appendChild(menu);
        const addPrompt = menu.querySelectorAll('[role="menuitem"]')[1];

        expect(resolveMediaAction({
            root: document,
            descriptor,
            action: 'prompted_video'
        })).toEqual({
            status: 'matched',
            stage: 'select_add_prompt',
            control: addPrompt
        });
    });

    test('rejects duplicate direct actions and duplicate Add Prompt choices as ambiguous', () => {
        mountGallery(currentResultsItems());
        const descriptor = listCurrentResults().items[0];
        const card = document.querySelector('[role="listitem"]');
        const duplicateQuick = document.createElement('button');
        duplicateQuick.setAttribute('aria-label', 'Make video');
        card.appendChild(duplicateQuick);

        expect(resolveMediaAction({
            root: document,
            descriptor,
            action: 'quick_video'
        })).toEqual({
            status: 'ambiguous',
            reason: 'media_action_ambiguous'
        });

        duplicateQuick.remove();
        const { sidePanelAction: trigger } = mountLegacyDetail();
        trigger.id = 'ambiguous-prompt-trigger';
        trigger.setAttribute('aria-controls', 'ambiguous-prompt-menu');
        trigger.setAttribute('aria-expanded', 'true');
        trigger.setAttribute('data-state', 'open');
        const menu = document.createElement('div');
        menu.id = 'ambiguous-prompt-menu';
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-labelledby', trigger.id);
        menu.setAttribute('data-state', 'open');
        menu.innerHTML = `
            <button role="menuitem">Add Prompt</button>
            <button role="menuitem">Add Prompt</button>
        `;
        document.body.append(menu);
        setActiveGrokRoute(`/imagine/post/${FIRST_POST_ID}?conversation=${CONVERSATION_ID}`);

        expect(resolveMediaAction({
            root: document,
            descriptor,
            action: 'prompted_video'
        })).toEqual({
            status: 'ambiguous',
            reason: 'add_prompt_ambiguous'
        });
    });

    test('evaluates source-scoped submission receipts as pending, accepted, rejected, or ambiguous', () => {
        mountGallery(currentResultsItems());
        const descriptor = listCurrentResults().items[0];
        const card = resolveGalleryItem({ root: document, descriptor }).card;
        const staleProgress = document.createElement('button');
        staleProgress.setAttribute('aria-label', 'Video Options');
        card.appendChild(staleProgress);
        const receipt = captureSubmissionReceipt({
            root: document,
            descriptor,
            action: 'quick_video'
        });

        expect(receipt).toMatchObject({
            version: 1,
            action: 'quick_video',
            sourceAssetId: FIRST_ASSET_ID,
            sourcePostId: FIRST_POST_ID
        });
        expect(JSON.parse(JSON.stringify(receipt))).toEqual(receipt);
        expect(evaluateSubmissionReceipt({ root: document, receipt })).toBe('pending');

        const acceptedProgress = document.createElement('button');
        acceptedProgress.setAttribute('aria-label', 'Video Options');
        card.appendChild(acceptedProgress);
        expect(evaluateSubmissionReceipt({ root: document, receipt })).toBe('accepted');

        acceptedProgress.remove();
        const rejection = document.createElement('div');
        rejection.setAttribute('role', 'alert');
        rejection.setAttribute('aria-label', 'Video generation failed');
        rejection.textContent = 'Video generation failed';
        card.appendChild(rejection);
        expect(evaluateSubmissionReceipt({ root: document, receipt })).toBe('rejected');

        card.appendChild(acceptedProgress);
        expect(evaluateSubmissionReceipt({ root: document, receipt })).toBe('ambiguous');
    });

    test('uses source-scoped Agent evidence and does not accept action disappearance or return alone', () => {
        const descriptor = persistedSourceDescriptor();
        const { source, sidePanelAction } = mountAgentSource();
        const receipt = captureSubmissionReceipt({
            root: document,
            descriptor,
            action: 'prompted_video'
        });

        expect(receipt).toMatchObject({
            version: 1,
            sourceKind: 'agent_media',
            sourceNodeId: `asset-${FIRST_ASSET_ID}`,
            sourceAssetId: FIRST_ASSET_ID,
            sourcePostId: FIRST_POST_ID
        });
        sidePanelAction.remove();
        expect(evaluateSubmissionReceipt({ root: document, receipt })).toBe('pending');

        const unrelated = document.createElement('div');
        unrelated.className = 'react-flow__node-asset';
        unrelated.setAttribute('data-id', `asset-${SECOND_ASSET_ID}`);
        unrelated.innerHTML = `
            <img src="${generatedMediaUrl(SECOND_ASSET_ID)}">
            <div role="status" aria-label="Video generation queued">Queued</div>
        `;
        source.parentElement.appendChild(unrelated);
        expect(evaluateSubmissionReceipt({ root: document, receipt })).toBe('pending');

        const accepted = document.createElement('div');
        accepted.setAttribute('role', 'status');
        accepted.setAttribute('aria-label', 'Video generation queued');
        accepted.textContent = 'Video generation queued';
        source.appendChild(accepted);
        expect(evaluateSubmissionReceipt({ root: document, receipt })).toBe('accepted');

        mountGallery(currentResultsItems());
        expect(evaluateSubmissionReceipt({ root: document, receipt })).toBe('pending');
    });

    test('uses source-scoped legacy detail evidence rather than global control changes', () => {
        const descriptor = persistedSourceDescriptor();
        const { source, sidePanelAction } = mountLegacyDetail();
        const receipt = captureSubmissionReceipt({
            root: document,
            descriptor,
            action: 'prompted_video'
        });
        const unrelatedProgress = document.createElement('button');
        unrelatedProgress.setAttribute('aria-label', 'Video Options');
        document.body.appendChild(unrelatedProgress);
        sidePanelAction.remove();

        expect(receipt).toMatchObject({ sourceKind: 'legacy_detail' });
        expect(evaluateSubmissionReceipt({ root: document, receipt })).toBe('pending');

        const rejection = document.createElement('div');
        rejection.setAttribute('role', 'alert');
        rejection.setAttribute('aria-label', 'Video generation failed');
        source.appendChild(rejection);
        expect(evaluateSubmissionReceipt({ root: document, receipt })).toBe('rejected');
    });

    test('captures a serializable Agent video baseline scoped to the exact persisted source', () => {
        const descriptor = persistedSourceDescriptor();
        const { source } = mountAgentSource();
        const scopedResults = document.createElement('section');
        scopedResults.setAttribute('data-source-asset-id', FIRST_ASSET_ID);
        scopedResults.setAttribute('data-source-post-id', FIRST_POST_ID);
        appendResultVideo(scopedResults, THIRD_ASSET_ID);
        appendResultVideo(scopedResults, THIRD_ASSET_ID);

        const rejection = document.createElement('div');
        rejection.setAttribute('role', 'alert');
        rejection.textContent = 'Video generation failed';
        scopedResults.appendChild(rejection);
        source.parentElement.appendChild(scopedResults);

        const unrelated = document.createElement('section');
        unrelated.setAttribute('data-source-asset-id', SECOND_ASSET_ID);
        unrelated.setAttribute('data-source-post-id', SECOND_POST_ID);
        appendResultVideo(unrelated, FOURTH_ASSET_ID);
        source.parentElement.appendChild(unrelated);

        const baseline = captureGeneratedResultBaseline({
            root: document,
            descriptor,
            mediaKind: 'video'
        });

        expect(baseline).toEqual({
            version: 1,
            mediaAssetIds: [THIRD_ASSET_ID],
            failureCount: 1
        });
        expect(JSON.parse(JSON.stringify(baseline))).toEqual(baseline);
        expect(Object.keys(baseline)).toEqual(['version', 'mediaAssetIds', 'failureCount']);
    });

    test('captures existing legacy-detail videos without including unrelated media', () => {
        const descriptor = persistedSourceDescriptor();
        const { source } = mountLegacyDetail();
        appendResultVideo(source, FIFTH_ASSET_ID);
        appendResultVideo(document.body, FOURTH_ASSET_ID);

        expect(captureGeneratedResultBaseline({
            root: document,
            descriptor,
            mediaKind: 'video'
        })).toEqual({
            version: 1,
            mediaAssetIds: [FIFTH_ASSET_ID],
            failureCount: 0
        });
    });

    test('returns null when the persisted source is missing or ambiguous or media kind is invalid', () => {
        const descriptor = persistedSourceDescriptor();
        expect(captureGeneratedResultBaseline({
            root: document,
            descriptor,
            mediaKind: 'video'
        })).toBeNull();

        const { source } = mountAgentSource();
        source.parentElement.appendChild(source.cloneNode(true));
        expect(captureGeneratedResultBaseline({
            root: document,
            descriptor,
            mediaKind: 'video'
        })).toBeNull();

        expect(captureGeneratedResultBaseline({
            root: document,
            descriptor,
            mediaKind: 'audio'
        })).toBeNull();
    });

    test('finds exactly one new playable matching video and ignores stale, unrelated, or unready media', () => {
        mountGallery(currentResultsItems());
        const descriptor = persistedSourceDescriptor();
        const cards = document.querySelectorAll('[role="listitem"]');
        appendResultVideo(cards[0], THIRD_ASSET_ID);
        const before = generatedResultBaseline([THIRD_ASSET_ID]);
        const expected = {
            sourceAssetId: descriptor.sourceAssetId,
            sourcePostId: descriptor.sourcePostId,
            mediaKind: 'video'
        };

        expect(inspectGeneratedResult({ root: document, before, expected })).toEqual({
            status: 'pending',
            resultAssetId: ''
        });
        expect(findGeneratedResult({ root: document, before, expected })).toBe('pending');
        appendResultVideo(cards[1], FOURTH_ASSET_ID);
        expect(findGeneratedResult({ root: document, before, expected })).toBe('pending');

        const matching = appendResultVideo(cards[0], FIFTH_ASSET_ID, { ready: false });
        expect(findGeneratedResult({ root: document, before, expected })).toBe('pending');
        Object.defineProperties(matching, {
            readyState: { configurable: true, value: 4 },
            duration: { configurable: true, value: 6 },
            videoWidth: { configurable: true, value: 400 },
            videoHeight: { configurable: true, value: 736 }
        });
        expect(inspectGeneratedResult({ root: document, before, expected })).toEqual({
            status: 'ready',
            resultAssetId: FIFTH_ASSET_ID
        });
        expect(findGeneratedResult({ root: document, before, expected })).toBe('ready');

        appendResultVideo(cards[0], FOURTH_ASSET_ID);
        expect(inspectGeneratedResult({ root: document, before, expected })).toEqual({
            status: 'ambiguous',
            resultAssetId: ''
        });
        expect(findGeneratedResult({ root: document, before, expected })).toBe('ambiguous');
    });

    test('returns failed only for new source-scoped failure evidence', () => {
        mountGallery(currentResultsItems());
        const descriptor = persistedSourceDescriptor();
        const cards = document.querySelectorAll('[role="listitem"]');
        const expected = {
            sourceAssetId: descriptor.sourceAssetId,
            sourcePostId: descriptor.sourcePostId,
            mediaKind: 'video'
        };
        const before = generatedResultBaseline([], 0);
        const unrelatedFailure = document.createElement('div');
        unrelatedFailure.setAttribute('role', 'alert');
        unrelatedFailure.setAttribute('aria-label', 'Video generation failed');
        cards[1].appendChild(unrelatedFailure);

        expect(findGeneratedResult({ root: document, before, expected })).toBe('pending');

        const matchingFailure = unrelatedFailure.cloneNode(true);
        cards[0].appendChild(matchingFailure);
        expect(inspectGeneratedResult({ root: document, before, expected })).toEqual({
            status: 'failed',
            resultAssetId: ''
        });
        expect(findGeneratedResult({ root: document, before, expected })).toBe('failed');

        appendResultVideo(cards[0], FIFTH_ASSET_ID);
        expect(findGeneratedResult({ root: document, before, expected })).toBe('ambiguous');
    });
});
