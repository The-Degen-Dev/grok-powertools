(function (root, factory) {
    const api = factory();

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }

    if (root) {
        root.GrokPowerToolsGrokImagineAdapter = api;
    }
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
    const UUID_EXACT_RE = new RegExp(`^${UUID_PATTERN}$`, 'i');
    const UUID_ANY_RE = new RegExp(UUID_PATTERN, 'i');
    const GENERATED_ASSET_RE = new RegExp(`/generated/(${UUID_PATTERN})(?:/|$)`, 'i');
    const POST_RE = new RegExp(`/imagine/post/(${UUID_PATTERN})(?:/|$)`, 'i');
    const CARD_SELECTOR = '[role="listitem"], [class*="media-post-masonry-card"]';
    const SOURCE_MEDIA_SELECTOR = 'img, video';

    function toUrl(value) {
        try {
            if (value && typeof value.href === 'string') return new URL(value.href);
            if (value && typeof value.pathname === 'string') {
                return new URL(`${value.pathname}${value.search || ''}`, 'https://grok.com');
            }
            return new URL(String(value || ''), 'https://grok.com');
        } catch {
            return null;
        }
    }

    function normalizeUuid(value) {
        const text = String(value || '').trim();
        return UUID_EXACT_RE.test(text) ? text.toLowerCase() : '';
    }

    function getEmbeddedUuid(value) {
        return normalizeUuid(String(value || '').match(UUID_ANY_RE)?.[0]);
    }

    function isGrokHost(hostname) {
        const normalized = String(hostname || '').toLowerCase();
        return normalized === 'grok.com'
            || normalized.endsWith('.grok.com')
            || normalized === 'grok.x.ai'
            || normalized.endsWith('.grok.x.ai');
    }

    function getMediaSource(media) {
        return String(media?.currentSrc || media?.src || media?.getAttribute?.('src') || '');
    }

    function getAssetId(value) {
        const url = toUrl(value);
        return normalizeUuid(url?.pathname.match(GENERATED_ASSET_RE)?.[1]);
    }

    function getPostId(value) {
        const url = toUrl(value);
        return normalizeUuid(url?.pathname.match(POST_RE)?.[1]);
    }

    function getConversationId(value) {
        const url = toUrl(value);
        return normalizeUuid(
            url?.searchParams.get('conversation') || url?.searchParams.get('conversationId')
        );
    }

    function closestGalleryCard(element) {
        return element?.closest?.(CARD_SELECTOR) || null;
    }

    function getOwnedPostLinks(card) {
        return Array.from(card?.querySelectorAll?.('a[href*="/imagine/post/"]') || [])
            .filter((link) => closestGalleryCard(link) === card);
    }

    function getGalleryCards(root) {
        if (!root?.querySelectorAll) return [];
        const cards = new Set();
        for (const link of root.querySelectorAll('a[href*="/imagine/post/"]')) {
            const card = closestGalleryCard(link);
            if (card) cards.add(card);
        }
        return Array.from(cards).filter((card) => (
            getGallerySourceMedia(card, getOwnedPostLinks(card)).length > 0
        ));
    }

    function getPostSourceMedia(postLinks) {
        const media = [];
        for (const link of postLinks) {
            media.push(...Array.from(link.querySelectorAll(SOURCE_MEDIA_SELECTOR))
                .filter((candidate) => candidate.closest('a[href*="/imagine/post/"]') === link
                    && !!getAssetId(getMediaSource(candidate))));
        }
        return media;
    }

    function getGallerySourceMedia(card, postLinks) {
        const linkedMedia = getPostSourceMedia(postLinks);
        if (linkedMedia.length > 0) return linkedMedia;

        const mediaByBranch = new Map();
        for (const media of card.querySelectorAll(SOURCE_MEDIA_SELECTOR)) {
            if (closestGalleryCard(media) !== card || !getAssetId(getMediaSource(media))) continue;
            let branch = media;
            while (branch.parentElement && branch.parentElement !== card) {
                branch = branch.parentElement;
            }
            if (branch.parentElement !== card) continue;
            if (!mediaByBranch.has(branch)) mediaByBranch.set(branch, []);
            mediaByBranch.get(branch).push(media);
        }
        return mediaByBranch.size === 1 ? Array.from(mediaByBranch.values())[0] : [];
    }

    function parseGalleryCard(card) {
        const postLinks = getOwnedPostLinks(card);
        const mediaElements = getGallerySourceMedia(card, postLinks);
        const postIds = new Set(postLinks.map((link) => getPostId(link.href)).filter(Boolean));
        const conversationIds = new Set(
            postLinks.map((link) => getConversationId(link.href)).filter(Boolean)
        );
        const assetIds = new Set(
            mediaElements.map((media) => getAssetId(getMediaSource(media))).filter(Boolean)
        );

        if (postIds.size !== 1 || assetIds.size !== 1 || conversationIds.size > 1) {
            return { status: 'ambiguous', reason: 'card_identity_ambiguous' };
        }

        const sourcePostId = Array.from(postIds)[0];
        const postLink = postLinks.find((link) => getPostId(link.href) === sourcePostId);
        const explicitMediaKind = String(
            card.getAttribute('data-media-type')
            || card.querySelector('[data-media-type]')?.getAttribute('data-media-type')
            || ''
        ).trim().toLowerCase();
        const mediaKind = explicitMediaKind === 'image' || explicitMediaKind === 'video'
            ? explicitMediaKind
            : mediaElements.some((media) => media.tagName?.toLowerCase() === 'video')
                ? 'video'
                : 'image';

        return {
            status: 'ok',
            identity: {
                sourceAssetId: Array.from(assetIds)[0],
                sourcePostId,
                conversationId: Array.from(conversationIds)[0] || '',
                mediaKind,
                hrefPath: toUrl(postLink?.href)?.pathname || `/imagine/post/${sourcePostId}`
            }
        };
    }

    function detectGrokSurface({ location, root } = {}) {
        const url = toUrl(location);
        if (!url || !isGrokHost(url.hostname)) return 'unsupported';
        const pathname = String(url?.pathname || '').replace(/\/+$/, '') || '/';

        if (pathname === '/imagine/saved') return 'saved_gallery';
        if (pathname === '/imagine' && getGalleryCards(root).length > 0) return 'results_gallery';
        if (pathname.startsWith('/imagine/agent/')) return 'agent_media';
        if (pathname.startsWith('/imagine/post/')) return 'legacy_detail';
        return 'unsupported';
    }

    function listGalleryItems({ root, surface } = {}) {
        if (surface !== 'results_gallery' && surface !== 'saved_gallery') {
            return { status: 'unsupported', reason: 'gallery_surface_unsupported', items: [] };
        }

        const parsed = [];
        for (const card of getGalleryCards(root)) {
            const result = parseGalleryCard(card);
            if (result.status !== 'ok') {
                return { status: 'ambiguous', reason: result.reason, items: [] };
            }
            parsed.push(result.identity);
        }

        const identityKeys = parsed.map((item) => `${item.sourceAssetId}:${item.sourcePostId}`);
        const assetIds = parsed.map((item) => item.sourceAssetId);
        const postIds = parsed.map((item) => item.sourcePostId);
        if (new Set(identityKeys).size !== identityKeys.length) {
            return { status: 'ambiguous', reason: 'duplicate_gallery_identity', items: [] };
        }
        if (new Set(assetIds).size !== assetIds.length) {
            return { status: 'ambiguous', reason: 'duplicate_asset_identity', items: [] };
        }
        if (new Set(postIds).size !== postIds.length) {
            return { status: 'ambiguous', reason: 'duplicate_post_identity', items: [] };
        }

        const items = parsed.map((item, index) => ({
            version: 1,
            surface,
            sourceAssetId: item.sourceAssetId,
            sourcePostId: item.sourcePostId,
            conversationId: item.conversationId,
            mediaKind: item.mediaKind,
            hrefPath: item.hrefPath,
            initialOrder: index,
            beforeAssetId: parsed[index - 1]?.sourceAssetId || '',
            afterAssetId: parsed[index + 1]?.sourceAssetId || ''
        }));

        return { status: 'ok', items };
    }

    function findDescriptorCards(root, descriptor) {
        const sourceAssetId = normalizeUuid(descriptor?.sourceAssetId);
        const sourcePostId = normalizeUuid(descriptor?.sourcePostId);
        if (!sourceAssetId || !sourcePostId) return { matches: [], ambiguous: false };

        const matches = [];
        let ambiguous = false;
        for (const card of getGalleryCards(root)) {
            const result = parseGalleryCard(card);
            if (result.status !== 'ok') {
                const postLinks = getOwnedPostLinks(card);
                const rawAssetMatch = getGallerySourceMedia(card, postLinks)
                    .some((media) => getAssetId(getMediaSource(media)) === sourceAssetId);
                const rawPostMatch = postLinks
                    .some((link) => getPostId(link.href) === sourcePostId);
                if (rawAssetMatch || rawPostMatch) ambiguous = true;
                continue;
            }
            if (result.identity.sourceAssetId === sourceAssetId
                && result.identity.sourcePostId === sourcePostId) {
                matches.push(card);
            }
        }
        return { matches, ambiguous };
    }

    function isSelectedAgentNode(node) {
        return node?.classList?.contains('selected')
            || node?.getAttribute?.('aria-selected') === 'true'
            || node?.getAttribute?.('data-state') === 'selected';
    }

    function getAgentNodes(root) {
        if (!root?.querySelectorAll) return [];
        return Array.from(root.querySelectorAll('.react-flow__node-asset'));
    }

    function findAgentSource(root, descriptor) {
        const sourceAssetId = normalizeUuid(descriptor?.sourceAssetId);
        const nodes = getAgentNodes(root);
        const selectedNodes = nodes.filter(isSelectedAgentNode);
        const matches = [];
        let ambiguous = false;

        for (const node of nodes) {
            const sourceNodeId = String(node.getAttribute('data-id') || '').trim();
            const dataAssetId = getEmbeddedUuid(sourceNodeId);
            const mediaIds = new Set(Array.from(node.querySelectorAll('img, video'))
                .filter((media) => media.closest('.react-flow__node-asset') === node)
                .map((media) => getAssetId(getMediaSource(media)))
                .filter(Boolean));
            const relevant = dataAssetId === sourceAssetId || mediaIds.has(sourceAssetId);
            if (!relevant) continue;

            if (!sourceNodeId
                || !mediaIds.has(sourceAssetId)
                || (dataAssetId && dataAssetId !== sourceAssetId)) {
                ambiguous = true;
                continue;
            }

            matches.push({
                element: node,
                kind: 'agent_media',
                sourceNodeId,
                selected: isSelectedAgentNode(node)
            });
        }

        if (matches.length > 1 || (matches.length === 1 && selectedNodes.length > 1)) {
            ambiguous = true;
        }
        return { matches, ambiguous };
    }

    function getLegacyDetailContainers(root) {
        if (!root?.querySelectorAll) return [];
        const containers = new Set();
        for (const link of root.querySelectorAll('a[href*="/imagine/post/"]')) {
            if (closestGalleryCard(link)) continue;
            const container = link.closest('[data-testid="media-detail"], [data-grok-media-detail], article')
                || link.parentElement
                || link;
            containers.add(container);
        }
        for (const frame of root.querySelectorAll('[data-media-frame]')) {
            if (closestGalleryCard(frame)) continue;
            containers.add(frame.closest('article') || frame.parentElement || frame);
        }
        return Array.from(containers);
    }

    function getLegacyDetailSourceMedia(container, postLinks) {
        const linkedMedia = getPostSourceMedia(postLinks);
        if (linkedMedia.length > 0) return linkedMedia;

        const frames = Array.from(container.querySelectorAll('[data-media-frame]'));
        if (container.matches?.('[data-media-frame]')) frames.unshift(container);
        const uniqueFrames = Array.from(new Set(frames));
        if (uniqueFrames.length !== 1) return [];
        return Array.from(uniqueFrames[0].querySelectorAll('img, video'))
            .filter((media) => media.closest('[data-media-frame]') === uniqueFrames[0]
                && !!getAssetId(getMediaSource(media)));
    }

    function parseLegacyDetailSource(container, fallbackPostId = '') {
        const postLinks = Array.from(container.querySelectorAll('a[href*="/imagine/post/"]'))
            .filter((link) => !closestGalleryCard(link));
        const postIds = new Set(postLinks.map((link) => getPostId(link.href)).filter(Boolean));
        const sourcePostId = postIds.size === 1
            ? Array.from(postIds)[0]
            : normalizeUuid(fallbackPostId);
        const mediaElements = getLegacyDetailSourceMedia(container, postLinks);
        const assetIds = new Set(
            mediaElements.map((media) => getAssetId(getMediaSource(media))).filter(Boolean)
        );
        if (postIds.size > 1 || !sourcePostId || assetIds.size !== 1) {
            return { status: 'ambiguous' };
        }
        return {
            status: 'ok',
            sourceAssetId: Array.from(assetIds)[0],
            sourcePostId,
            mediaKind: getDescriptorMediaKind(container, mediaElements)
        };
    }

    function getDescriptorMediaKind(container, mediaElements) {
        const explicitMediaKind = String(
            container.getAttribute?.('data-media-type')
            || container.querySelector?.('[data-media-type]')?.getAttribute('data-media-type')
            || ''
        ).trim().toLowerCase();
        if (explicitMediaKind === 'image' || explicitMediaKind === 'video') {
            return explicitMediaKind;
        }
        return mediaElements.some((media) => media.tagName?.toLowerCase() === 'video')
            ? 'video'
            : 'image';
    }

    function getSafeCurrentRoute(url, conversationId) {
        const route = new URL(url.pathname, url.origin);
        if (conversationId) route.searchParams.set('conversation', conversationId);
        return route.href;
    }

    function createCurrentSourceDescriptor({
        surface,
        sourceAssetId,
        sourcePostId,
        conversationId,
        mediaKind,
        hrefPath,
        route
    }) {
        return {
            version: 1,
            surface,
            sourceAssetId,
            sourcePostId,
            conversationId,
            mediaKind,
            hrefPath,
            route,
            initialOrder: 0,
            beforeAssetId: '',
            afterAssetId: ''
        };
    }

    function describeLegacyDetailSource(root, url) {
        const routePostId = getPostId(url);
        if (!routePostId) {
            return { status: 'missing', reason: 'legacy_detail_route_post_missing' };
        }

        const candidates = [];
        let sourceAmbiguous = false;
        let routeMismatch = false;
        for (const container of getLegacyDetailContainers(root)) {
            const postLinks = Array.from(container.querySelectorAll('a[href*="/imagine/post/"]'))
                .filter((link) => !closestGalleryCard(link));
            const parsed = parseLegacyDetailSource(container, routePostId);
            const conversationIds = new Set(
                postLinks.map((link) => getConversationId(link.href)).filter(Boolean)
            );

            if (parsed.status !== 'ok' || conversationIds.size > 1) {
                const hasDetailEvidence = postLinks.length > 0
                    || container.matches?.('[data-media-frame]')
                    || !!container.querySelector('[data-media-frame]');
                if (!hasDetailEvidence) continue;
                sourceAmbiguous = true;
                continue;
            }

            const sourcePostId = parsed.sourcePostId;
            if (sourcePostId !== routePostId) {
                routeMismatch = true;
                continue;
            }
            candidates.push({
                sourceAssetId: parsed.sourceAssetId,
                sourcePostId,
                conversationId: Array.from(conversationIds)[0] || '',
                mediaKind: parsed.mediaKind
            });
        }

        if (sourceAmbiguous || candidates.length > 1) {
            return { status: 'ambiguous', reason: 'legacy_detail_source_ambiguous' };
        }
        if (routeMismatch) {
            return { status: 'ambiguous', reason: 'legacy_detail_route_mismatch' };
        }
        if (candidates.length === 0) {
            return { status: 'missing', reason: 'legacy_detail_source_missing' };
        }

        const candidate = candidates[0];
        const routeConversationId = getConversationId(url);
        if (routeConversationId
            && candidate.conversationId
            && routeConversationId !== candidate.conversationId) {
            return { status: 'ambiguous', reason: 'legacy_detail_source_ambiguous' };
        }
        const conversationId = candidate.conversationId || routeConversationId;
        return {
            status: 'matched',
            descriptor: createCurrentSourceDescriptor({
                surface: 'legacy_detail',
                ...candidate,
                conversationId,
                hrefPath: `/imagine/post/${routePostId}`,
                route: getSafeCurrentRoute(url, conversationId)
            })
        };
    }

    function describeAgentSource(root, url, sourcePostIdHint) {
        const selectedNodes = getAgentNodes(root).filter(isSelectedAgentNode);
        if (selectedNodes.length === 0) {
            return { status: 'missing', reason: 'agent_selected_source_missing' };
        }
        if (selectedNodes.length > 1) {
            return { status: 'ambiguous', reason: 'agent_selected_source_ambiguous' };
        }

        const selectedNode = selectedNodes[0];
        const sourceNodeId = String(selectedNode.getAttribute('data-id') || '').trim();
        if (!sourceNodeId) {
            return { status: 'missing', reason: 'agent_source_node_id_missing' };
        }
        const nodesWithSourceId = getAgentNodes(root).filter((node) => (
            String(node.getAttribute('data-id') || '').trim() === sourceNodeId
        ));
        if (nodesWithSourceId.length !== 1) {
            return { status: 'ambiguous', reason: 'agent_source_node_id_ambiguous' };
        }

        const mediaElements = Array.from(selectedNode.querySelectorAll('img, video'))
            .filter((media) => media.closest('.react-flow__node-asset') === selectedNode);
        const assetIds = new Set(
            mediaElements.map((media) => getAssetId(getMediaSource(media))).filter(Boolean)
        );
        if (assetIds.size === 0) {
            return { status: 'missing', reason: 'agent_source_asset_missing' };
        }
        if (assetIds.size > 1) {
            return { status: 'ambiguous', reason: 'agent_source_asset_ambiguous' };
        }

        const sourceAssetId = Array.from(assetIds)[0];
        const nodeIdentityIds = new Set(
            (sourceNodeId.match(new RegExp(UUID_PATTERN, 'ig')) || []).map(normalizeUuid)
        );
        if (nodeIdentityIds.size > 1
            || (nodeIdentityIds.size === 1 && !nodeIdentityIds.has(sourceAssetId))) {
            return { status: 'ambiguous', reason: 'agent_source_identity_ambiguous' };
        }

        const conversationId = getConversationId(url);
        const hintSupplied = String(sourcePostIdHint || '').trim().length > 0;
        const normalizedSourcePostIdHint = normalizeUuid(sourcePostIdHint);
        if (hintSupplied && !normalizedSourcePostIdHint) {
            return { status: 'missing', reason: 'agent_source_post_hint_invalid' };
        }
        const agentDomHasNoPostIdContext = normalizedSourcePostIdHint || conversationId;
        if (!agentDomHasNoPostIdContext) {
            return { status: 'missing', reason: 'agent_source_post_context_missing' };
        }

        const sourceMedia = mediaElements.filter((media) => (
            getAssetId(getMediaSource(media)) === sourceAssetId
        ));
        return {
            status: 'matched',
            descriptor: createCurrentSourceDescriptor({
                surface: 'agent_media',
                sourceAssetId,
                sourcePostId: agentDomHasNoPostIdContext,
                conversationId,
                mediaKind: getDescriptorMediaKind(selectedNode, sourceMedia),
                hrefPath: url.pathname,
                route: getSafeCurrentRoute(url, conversationId)
            })
        };
    }

    function describeCurrentSource({ root, surface, location, sourcePostIdHint } = {}) {
        if (surface !== 'legacy_detail' && surface !== 'agent_media') {
            return { status: 'unsupported', reason: 'current_source_surface_unsupported' };
        }

        const url = toUrl(location);
        if (!url
            || !isGrokHost(url.hostname)
            || detectGrokSurface({ root, location: url }) !== surface) {
            return { status: 'unsupported', reason: 'current_source_location_unsupported' };
        }

        return surface === 'legacy_detail'
            ? describeLegacyDetailSource(root, url)
            : describeAgentSource(root, url, sourcePostIdHint);
    }

    function resolveCurrentSourceMedia({ root, surface, location, sourcePostIdHint } = {}) {
        const described = describeCurrentSource({ root, surface, location, sourcePostIdHint });
        if (described.status !== 'matched') return described;

        const descriptor = described.descriptor;
        const resolved = resolvePersistedSource(root, descriptor);
        if (resolved.status !== 'matched') return resolved;

        const matchingMedia = Array.from(resolved.element.querySelectorAll('img, video'))
            .filter((media) => getAssetId(getMediaSource(media)) === descriptor.sourceAssetId);
        const preferredTag = descriptor.mediaKind === 'video' ? 'video' : 'img';
        const preferredMedia = matchingMedia.filter(
            (media) => media.tagName?.toLowerCase() === preferredTag
        );
        if (preferredMedia.length !== 1) {
            return {
                status: preferredMedia.length > 1 ? 'ambiguous' : 'missing',
                reason: preferredMedia.length > 1
                    ? 'current_source_media_ambiguous'
                    : 'current_source_media_missing'
            };
        }

        return {
            status: 'matched',
            descriptor,
            media: preferredMedia[0],
            sourceUrl: getMediaSource(preferredMedia[0])
        };
    }

    function findLegacyDetailSource(root, descriptor) {
        const sourceAssetId = normalizeUuid(descriptor?.sourceAssetId);
        const sourcePostId = normalizeUuid(descriptor?.sourcePostId);
        const matches = [];
        let ambiguous = false;

        for (const container of getLegacyDetailContainers(root)) {
            const parsed = parseLegacyDetailSource(container, sourcePostId);
            if (parsed.status !== 'ok') {
                const rawText = Array.from(container.querySelectorAll('a[href], img, video'))
                    .map((element) => element.href || getMediaSource(element))
                    .join(' ');
                if (rawText.includes(sourceAssetId) || rawText.includes(sourcePostId)) ambiguous = true;
                continue;
            }
            const relevant = parsed.sourceAssetId === sourceAssetId
                || parsed.sourcePostId === sourcePostId;
            if (!relevant) continue;
            if (parsed.sourceAssetId !== sourceAssetId || parsed.sourcePostId !== sourcePostId) {
                ambiguous = true;
                continue;
            }
            matches.push({
                element: container,
                kind: 'legacy_detail',
                sourceNodeId: '',
                selected: true
            });
        }
        if (matches.length > 1) ambiguous = true;
        return { matches, ambiguous };
    }

    function resolvePersistedSource(root, descriptor) {
        const gallery = findDescriptorCards(root, descriptor);
        if (gallery.ambiguous || gallery.matches.length > 1) {
            return { status: 'ambiguous', reason: 'gallery_item_ambiguous' };
        }

        const agent = findAgentSource(root, descriptor);
        const detail = findLegacyDetailSource(root, descriptor);
        if (agent.ambiguous || detail.ambiguous) {
            return { status: 'ambiguous', reason: 'source_identity_ambiguous' };
        }

        const matches = [
            ...gallery.matches.map((element) => ({
                element,
                kind: 'gallery_item',
                sourceNodeId: '',
                selected: true
            })),
            ...agent.matches,
            ...detail.matches
        ];
        if (matches.length > 1) {
            return { status: 'ambiguous', reason: 'source_identity_ambiguous' };
        }
        if (matches.length === 0) {
            return { status: 'missing', reason: 'gallery_item_missing' };
        }
        return { status: 'matched', ...matches[0] };
    }

    function resolveGalleryItem({ root, descriptor } = {}) {
        const resolved = resolvePersistedSource(root, descriptor);
        if (resolved.status !== 'matched') return resolved;
        return { status: 'matched', card: resolved.element, descriptor };
    }

    function ownedButtons(card, ariaLabel) {
        return Array.from(card.querySelectorAll('button[aria-label]'))
            .filter((button) => closestGalleryCard(button) === card
                && button.getAttribute('aria-label') === ariaLabel);
    }

    function getPromptedTriggers(root) {
        if (!root?.querySelectorAll) return [];
        return Array.from(root.querySelectorAll('button[aria-label][aria-haspopup="menu"]'))
            .filter((button) => button.getAttribute('aria-label') === 'Make Video'
                && !closestGalleryCard(button)
                && !button.closest('.react-flow, .react-flow__node-asset, .react-flow__node-toolbar'));
    }

    function getBoundAgentGoalControls(root, resolved) {
        if (resolved.kind !== 'agent_media' || !resolved.sourceNodeId) return [];
        return Array.from(root.querySelectorAll('.react-flow__node-toolbar[data-id]'))
            .filter((toolbar) => toolbar.getAttribute('data-id') === resolved.sourceNodeId)
            .flatMap((toolbar) => Array.from(toolbar.querySelectorAll('button[aria-label="Make Video"]'))
                .filter((button) => button.closest('.react-flow__node-toolbar') === toolbar));
    }

    function getLinkedOpenMenus(root, trigger) {
        const menuId = trigger.getAttribute('aria-controls');
        if (!menuId
            || trigger.getAttribute('aria-expanded') !== 'true'
            || trigger.getAttribute('data-state') !== 'open') {
            return [];
        }
        return Array.from(root.querySelectorAll('[role="menu"]')).filter((menu) => (
            menu.id === menuId
            && menu.getAttribute('aria-labelledby') === trigger.id
            && menu.getAttribute('data-state') === 'open'
        ));
    }

    function getExactAddPromptItems(menu) {
        return Array.from(menu.querySelectorAll('[role="menuitem"]')).filter((item) => (
            item.closest('[role="menu"]') === menu && item.textContent.trim() === 'Add Prompt'
        ));
    }

    function getExactQuickAnimateItems(menu) {
        return Array.from(menu.querySelectorAll('[role="menuitem"]')).filter((item) => (
            item.closest('[role="menu"]') === menu && item.textContent.trim() === 'Quick Animate'
        ));
    }

    function resolveMediaAction({ root, descriptor, action } = {}) {
        const resolved = resolvePersistedSource(root, descriptor);
        if (resolved.status === 'ambiguous') return resolved;
        if (resolved.status !== 'matched') {
            return { status: 'missing', reason: 'gallery_item_missing' };
        }
        if (resolved.kind === 'agent_media' && !resolved.selected) {
            return { status: 'missing', reason: 'source_not_selected' };
        }

        if (action === 'quick_video') {
            if (resolved.kind !== 'gallery_item') {
                return { status: 'missing', reason: 'media_action_missing' };
            }
            const controls = ownedButtons(resolved.element, 'Make video');
            if (controls.length > 1) {
                return { status: 'ambiguous', reason: 'media_action_ambiguous' };
            }
            if (controls.length === 0) {
                return { status: 'missing', reason: 'media_action_missing' };
            }
            return { status: 'matched', stage: 'submit_direct', control: controls[0] };
        }

        if (action === 'goal_video' && resolved.kind === 'agent_media') {
            const controls = getBoundAgentGoalControls(root, resolved);
            if (controls.length > 1) {
                return { status: 'ambiguous', reason: 'media_action_ambiguous' };
            }
            if (controls.length === 0) {
                return { status: 'missing', reason: 'media_action_missing' };
            }
            return { status: 'matched', stage: 'submit_direct', control: controls[0] };
        }

        if (action === 'prompted_video' || action === 'goal_video') {
            const triggers = getPromptedTriggers(root);
            if (triggers.length > 1) {
                return { status: 'ambiguous', reason: 'media_action_ambiguous' };
            }
            if (triggers.length === 0) {
                return { status: 'missing', reason: 'media_action_missing' };
            }

            const trigger = triggers[0];
            const menus = getLinkedOpenMenus(root, trigger);
            if (menus.length > 1) {
                return { status: 'ambiguous', reason: 'media_action_ambiguous' };
            }
            if (menus.length === 1) {
                const items = action === 'goal_video'
                    ? getExactQuickAnimateItems(menus[0])
                    : getExactAddPromptItems(menus[0]);
                if (items.length > 1) {
                    return {
                        status: 'ambiguous',
                        reason: action === 'goal_video'
                            ? 'quick_animate_ambiguous'
                            : 'add_prompt_ambiguous'
                    };
                }
                if (items.length === 0) {
                    return {
                        status: 'missing',
                        reason: action === 'goal_video'
                            ? 'quick_animate_missing'
                            : 'add_prompt_missing'
                    };
                }
                return {
                    status: 'matched',
                    stage: action === 'goal_video'
                        ? 'select_quick_animate'
                        : 'select_add_prompt',
                    control: items[0]
                };
            }

            return {
                status: 'matched',
                stage: action === 'goal_video' ? 'open_goal_menu' : 'open_prompt_menu',
                control: trigger
            };
        }

        return { status: 'unsupported', reason: 'media_action_unsupported' };
    }

    function getSourceScopedRoots(root, resolved, sourceAssetId, sourcePostId) {
        const roots = new Set([resolved.element]);
        if (!root?.querySelectorAll) return Array.from(roots);

        for (const candidate of root.querySelectorAll('[data-source-asset-id]')) {
            const candidateAssetId = normalizeUuid(candidate.getAttribute('data-source-asset-id'));
            const candidatePostId = normalizeUuid(candidate.getAttribute('data-source-post-id'));
            if (candidateAssetId !== sourceAssetId) continue;
            if (candidatePostId && candidatePostId !== sourcePostId) continue;
            roots.add(candidate);
        }
        return Array.from(roots);
    }

    function collectScopedElements(roots, selector) {
        const elements = new Set();
        for (const root of roots) {
            if (root.matches?.(selector)) elements.add(root);
            for (const element of root.querySelectorAll?.(selector) || []) elements.add(element);
        }
        return Array.from(elements);
    }

    function countAcceptedSignals(roots) {
        return collectScopedElements(roots, 'button[aria-label], [role="status"], [role="progressbar"]')
            .filter((element) => {
                if (element.getAttribute('aria-label') === 'Video Options') return true;
                const text = [
                    element.getAttribute('aria-label'),
                    element.getAttribute('data-generation-state'),
                    element.textContent
                ].filter(Boolean).join(' ');
                return /video generation queued|video generation started|generating video|video generation in progress/i
                    .test(text);
            }).length;
    }

    function countRejectedSignals(roots) {
        return collectScopedElements(roots, '[role="alert"]').filter((alert) => {
            const text = `${alert.getAttribute('aria-label') || ''} ${alert.textContent || ''}`;
            return /video generation failed|generation failed|rejected|blocked/i.test(text);
        }).length;
    }

    function captureSubmissionReceipt({ root, descriptor, action } = {}) {
        const resolved = resolvePersistedSource(root, descriptor);
        if (resolved.status !== 'matched') return null;
        const sourceAssetId = normalizeUuid(descriptor.sourceAssetId);
        const sourcePostId = normalizeUuid(descriptor.sourcePostId);
        const scopedRoots = getSourceScopedRoots(root, resolved, sourceAssetId, sourcePostId);

        return {
            version: 1,
            action: String(action || ''),
            sourceKind: resolved.kind,
            sourceNodeId: resolved.sourceNodeId,
            sourceAssetId,
            sourcePostId,
            baseline: {
                acceptedCount: countAcceptedSignals(scopedRoots),
                rejectedCount: countRejectedSignals(scopedRoots)
            }
        };
    }

    function evaluateSubmissionReceipt({ root, receipt } = {}) {
        if (receipt?.version !== 1
            || !normalizeUuid(receipt.sourceAssetId)
            || !normalizeUuid(receipt.sourcePostId)
            || !receipt.baseline) {
            return 'ambiguous';
        }

        const resolved = resolvePersistedSource(root, receipt);
        if (resolved.status === 'ambiguous') return 'ambiguous';
        if (resolved.status !== 'matched') return 'pending';
        if (receipt.sourceKind === 'agent_media'
            && resolved.kind === 'agent_media'
            && receipt.sourceNodeId
            && resolved.sourceNodeId !== receipt.sourceNodeId) {
            return 'ambiguous';
        }

        const scopedRoots = getSourceScopedRoots(
            root,
            resolved,
            normalizeUuid(receipt.sourceAssetId),
            normalizeUuid(receipt.sourcePostId)
        );
        const acceptedCount = countAcceptedSignals(scopedRoots);
        const rejectedCount = countRejectedSignals(scopedRoots);
        const baselineAccepted = Number(receipt.baseline.acceptedCount);
        const baselineRejected = Number(receipt.baseline.rejectedCount);
        if (!Number.isInteger(baselineAccepted)
            || !Number.isInteger(baselineRejected)
            || acceptedCount < baselineAccepted
            || rejectedCount < baselineRejected) {
            return 'ambiguous';
        }

        const accepted = acceptedCount > baselineAccepted;
        const rejected = rejectedCount > baselineRejected;
        if (accepted && rejected) return 'ambiguous';
        if (accepted) return 'accepted';
        if (rejected) return 'rejected';
        return 'pending';
    }

    function isPlayableResult(media, mediaKind) {
        if (mediaKind === 'video') {
            return Number(media.readyState) >= 2
                && Number.isFinite(Number(media.duration))
                && Number(media.duration) > 0
                && Number(media.videoWidth) > 0
                && Number(media.videoHeight) > 0;
        }
        return media.complete === true
            && Number(media.naturalWidth) > 0
            && Number(media.naturalHeight) > 0;
    }

    function getGeneratedResultSelector(mediaKind) {
        return mediaKind === 'video'
            ? 'video'
            : 'img[data-generation-result], [data-generation-result="image"] img';
    }

    function captureGeneratedResultBaseline({ root, descriptor, mediaKind } = {}) {
        if (mediaKind !== 'image' && mediaKind !== 'video') return null;

        const sourceAssetId = normalizeUuid(descriptor?.sourceAssetId);
        const sourcePostId = normalizeUuid(descriptor?.sourcePostId);
        if (!sourceAssetId || !sourcePostId) return null;

        const resolved = resolvePersistedSource(root, { sourceAssetId, sourcePostId });
        if (resolved.status !== 'matched') return null;

        const scopedRoots = getSourceScopedRoots(
            root,
            resolved,
            sourceAssetId,
            sourcePostId
        );
        const mediaAssetIds = Array.from(new Set(
            collectScopedElements(scopedRoots, getGeneratedResultSelector(mediaKind))
                .map((media) => getAssetId(getMediaSource(media)))
                .filter((assetId) => assetId && assetId !== sourceAssetId)
        )).sort();

        return {
            version: 1,
            mediaAssetIds,
            failureCount: countRejectedSignals(scopedRoots)
        };
    }

    function inspectGeneratedResult({ root, before, expected } = {}) {
        const result = (status, resultAssetId = '') => ({ status, resultAssetId });
        const sourceAssetId = normalizeUuid(expected?.sourceAssetId);
        const sourcePostId = normalizeUuid(expected?.sourcePostId);
        const mediaKind = expected?.mediaKind === 'image' || expected?.mediaKind === 'video'
            ? expected.mediaKind
            : '';
        if (before?.version !== 1
            || !Array.isArray(before.mediaAssetIds)
            || !Number.isInteger(before.failureCount)
            || before.failureCount < 0
            || !sourceAssetId
            || !sourcePostId
            || !mediaKind) {
            return result('ambiguous');
        }

        const beforeAssetIds = before.mediaAssetIds.map(normalizeUuid);
        if (beforeAssetIds.some((assetId) => !assetId)
            || new Set(beforeAssetIds).size !== beforeAssetIds.length) {
            return result('ambiguous');
        }

        const resolved = resolvePersistedSource(root, { sourceAssetId, sourcePostId });
        if (resolved.status === 'ambiguous') return result('ambiguous');
        if (resolved.status !== 'matched') return result('pending');

        const scopedRoots = getSourceScopedRoots(
            root,
            resolved,
            sourceAssetId,
            sourcePostId
        );
        const currentFailureCount = countRejectedSignals(scopedRoots);
        if (currentFailureCount < before.failureCount) return result('ambiguous');
        const newFailureCount = currentFailureCount - before.failureCount;

        const beforeSet = new Set(beforeAssetIds);
        const newCandidates = [];
        let unidentifiedResult = false;
        for (const media of collectScopedElements(
            scopedRoots,
            getGeneratedResultSelector(mediaKind)
        )) {
            const assetId = getAssetId(getMediaSource(media));
            if (!assetId) {
                if (media.hasAttribute('data-generation-result')) unidentifiedResult = true;
                continue;
            }
            if (assetId === sourceAssetId || beforeSet.has(assetId)) continue;
            newCandidates.push({ assetId, media });
        }

        if (unidentifiedResult || newFailureCount > 1 || newCandidates.length > 1) {
            return result('ambiguous');
        }
        if (newFailureCount === 1 && newCandidates.length === 1) return result('ambiguous');
        if (newFailureCount === 1) return result('failed');
        if (newCandidates.length === 0) return result('pending');
        return isPlayableResult(newCandidates[0].media, mediaKind)
            ? result('ready', newCandidates[0].assetId)
            : result('pending');
    }

    function findGeneratedResult(options) {
        return inspectGeneratedResult(options).status;
    }

    return {
        captureGeneratedResultBaseline,
        captureSubmissionReceipt,
        describeCurrentSource,
        detectGrokSurface,
        evaluateSubmissionReceipt,
        findGeneratedResult,
        inspectGeneratedResult,
        listGalleryItems,
        resolveCurrentSourceMedia,
        resolveGalleryItem,
        resolveMediaAction
    };
});
