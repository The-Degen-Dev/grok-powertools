(function expose(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.GrokSavedEvidenceObserver = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
    const REQUIRED_STABLE_BOTTOM_ROUNDS = 8;
    const MINIMUM_STABLE_BOTTOM_MS = 6000;
    const MAX_PROBES = 1000;
    const PROBE_DELAY_MS = 750;
    const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
    const GENERATED_IMAGE_HOSTS = new Set(['assets.grok.com', 'imagine-public.x.ai']);
    const GENERATED_IMAGE_EXTENSION_RE = /\.(?:gif|jpe?g|png|webp)$/i;
    const SELECTED_SCOPE_SELECTOR = '[role="tab"][aria-selected="true"], [role="button"][aria-pressed="true"]';
    const GALLERY_SELECTOR = '[role="list"], [role="grid"]';
    const LOADER_SELECTOR = '[aria-busy="true"], [role="progressbar"], [data-loading="true"]';

    function normalizeIdentity(value) {
        const match = String(value || '').match(UUID_RE);
        return match ? match[0].toLowerCase() : null;
    }

    function normalizeGeneratedImageIdentity(value) {
        try {
            const mediaUrl = new URL(String(value || ''));
            if (mediaUrl.protocol !== 'https:' || !GENERATED_IMAGE_HOSTS.has(mediaUrl.hostname)) return null;
            if (!GENERATED_IMAGE_EXTENSION_RE.test(mediaUrl.pathname)) return null;
            return normalizeIdentity(mediaUrl.pathname);
        } catch {
            return null;
        }
    }

    function createSavedGalleryObserver({ now = Date.now } = {}) {
        const state = {
            identities: new Set(),
            events: [],
            stableBottomRounds: 0,
            lastNewIdentityAt: now(),
            exhausted: false
        };

        return {
            capture(observation) {
                if (observation.pathname !== '/imagine/saved') throw new Error('observer_route_mismatch');
                if (observation.scope !== 'all') throw new Error('observer_scope_mismatch');

                const before = state.identities.size;
                for (const identity of (observation.identities || []).map(normalizeIdentity).filter(Boolean)) {
                    state.identities.add(identity);
                }
                const added = state.identities.size - before;
                const capturedAt = now();
                if (added || observation.loading || !observation.atBottom) {
                    state.stableBottomRounds = 0;
                    if (added) state.lastNewIdentityAt = capturedAt;
                } else {
                    state.stableBottomRounds += 1;
                }
                state.exhausted = state.stableBottomRounds >= REQUIRED_STABLE_BOTTOM_ROUNDS
                    && capturedAt - state.lastNewIdentityAt >= MINIMUM_STABLE_BOTTOM_MS;
                state.events.push({
                    at: capturedAt,
                    added,
                    total: state.identities.size,
                    atBottom: Boolean(observation.atBottom),
                    loading: Boolean(observation.loading)
                });
                return this.snapshot();
            },
            snapshot() {
                return {
                    schemaVersion: 1,
                    identities: Array.from(state.identities),
                    events: [...state.events],
                    stableBottomRounds: state.stableBottomRounds,
                    exhausted: state.exhausted
                };
            }
        };
    }

    function isVisible(element) {
        return Boolean(element) && !element.hidden && (!element.getAttribute || element.getAttribute('aria-hidden') !== 'true');
    }

    function findSemanticGallery(document) {
        const galleries = Array.from(document.querySelectorAll(GALLERY_SELECTOR))
            .filter((gallery) => gallery.querySelector('img[alt="Generated image"]'));
        if (galleries.length !== 1) throw new Error('observer_gallery_missing');
        return galleries[0];
    }

    function findGalleryOwner(gallery) {
        let current = gallery;
        while (current) {
            if (Array.from(current.querySelectorAll(SELECTED_SCOPE_SELECTOR)).some(isVisible)) return current;
            current = current.parentElement;
        }
        throw new Error('observer_scope_owner_missing');
    }

    function resolveSavedScope(gallery) {
        const owner = findGalleryOwner(gallery);
        const selected = Array.from(owner.querySelectorAll(SELECTED_SCOPE_SELECTOR)).filter(isVisible);
        if (selected.length !== 1) throw new Error('observer_scope_ambiguous');
        if (selected[0].textContent.trim().toLowerCase() !== 'all') throw new Error('observer_scope_mismatch');
        return owner;
    }

    function findGalleryScroller(gallery, owner) {
        const candidates = [];
        let current = gallery;
        while (current) {
            if (current.scrollHeight > current.clientHeight) candidates.push(current);
            if (current === owner) break;
            current = current.parentElement;
        }
        if (current !== owner) throw new Error('observer_scroller_missing');
        if (candidates.length !== 1) {
            throw new Error(candidates.length ? 'observer_scroller_ambiguous' : 'observer_scroller_missing');
        }
        return candidates[0];
    }

    function imageIdentities(gallery) {
        return Array.from(gallery.querySelectorAll('img[alt="Generated image"]'))
            .map((image) => normalizeGeneratedImageIdentity(image.currentSrc || image.src))
            .filter(Boolean);
    }

    function isGalleryLoading(gallery) {
        if (gallery.matches && gallery.matches(LOADER_SELECTOR)) return true;
        return Array.from(gallery.querySelectorAll(LOADER_SELECTOR)).length > 0;
    }

    function atBottom(scroller) {
        return scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
    }

    async function observeSavedGallery(options = {}) {
        const document = options.document || globalThis.document;
        const location = options.location || globalThis.location;
        const sleep = options.sleep || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
        const requestedProbes = Number(options.maxProbes);
        const maxProbes = Math.min(Number.isFinite(requestedProbes) && requestedProbes > 0
            ? Math.floor(requestedProbes)
            : MAX_PROBES, MAX_PROBES);
        if (!location || location.pathname !== '/imagine/saved') throw new Error('observer_route_mismatch');

        const gallery = findSemanticGallery(document);
        const owner = resolveSavedScope(gallery);
        const scroller = findGalleryScroller(gallery, owner);
        const initialScrollTop = scroller.scrollTop;
        const observer = createSavedGalleryObserver({ now: options.now || Date.now });

        try {
            scroller.scrollTop = 0;
            if (scroller.scrollTop !== 0) throw new Error('observer_top_unverified');
            for (let probe = 0; probe < maxProbes; probe += 1) {
                const snapshot = observer.capture({
                    pathname: location.pathname,
                    scope: 'all',
                    identities: imageIdentities(gallery),
                    atBottom: atBottom(scroller),
                    loading: isGalleryLoading(gallery)
                });
                if (snapshot.exhausted) return snapshot;
                scroller.scrollBy({ top: scroller.clientHeight, behavior: 'auto' });
                await sleep(PROBE_DELAY_MS);
            }
            return { ...observer.snapshot(), blocked: 'scan_limit', exhausted: false };
        } finally {
            scroller.scrollTop = initialScrollTop;
        }
    }

    return {
        REQUIRED_STABLE_BOTTOM_ROUNDS,
        MINIMUM_STABLE_BOTTOM_MS,
        MAX_PROBES,
        normalizeIdentity,
        normalizeGeneratedImageIdentity,
        createSavedGalleryObserver,
        observeSavedGallery
    };
}));
