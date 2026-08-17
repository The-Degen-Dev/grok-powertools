const {
    createSavedGalleryObserver,
    observeSavedGallery
} = require('../../acceptance/browser/saved-gallery-observer.js');

const ID_1 = '11111111-1111-4111-8111-111111111111';
const ID_2 = '22222222-2222-4222-8222-222222222222';
const ID_3 = '33333333-3333-4333-8333-333333333333';

function observation(overrides = {}) {
    return {
        pathname: '/imagine/saved',
        scope: 'all',
        identities: [],
        atBottom: false,
        loading: false,
        signature: 'empty',
        ...overrides
    };
}

function createFakeDriver(options = {}) {
    const scroller = {
        scrollTop: options.initialScrollTop || 0,
        clientHeight: 100,
        scrollHeight: 200,
        scrollBy({ top }) {
            this.scrollTop = Math.min(this.scrollTop + top, this.scrollHeight - this.clientHeight);
        }
    };
    const gallery = {
        querySelector: jest.fn((selector) => (
            selector === 'img[alt="Generated image"]' ? (options.images || [])[0] || null : null
        )),
        querySelectorAll: jest.fn(() => options.images || [])
    };
    const sleep = jest.fn(async () => undefined);
    return {
        location: { pathname: options.pathname || '/imagine/saved' },
        document: {
            querySelector: jest.fn((selector) => {
                if (selector === '[role="tab"][aria-selected="true"], [role="button"][aria-pressed="true"]') return options.scopeNode || null;
                if (selector === '[role="list"], [role="grid"]') return gallery;
                return null;
            }),
            querySelectorAll: jest.fn(() => [gallery])
        },
        sleep,
        scroller,
        gallery
    };
}

describe('Saved gallery observer core', () => {
    test('deduplicates identities across remounts and requires stable bottom proof', () => {
        let now = 0;
        const observer = createSavedGalleryObserver({ now: () => now });
        observer.capture(observation({ identities: [ID_1, ID_2], signature: 'page-1' }));
        observer.capture(observation({ identities: [ID_2, ID_3], atBottom: true, signature: 'page-2' }));
        for (let round = 0; round < 8; round += 1) {
            now += 750;
            observer.capture(observation({ identities: [ID_2, ID_3], atBottom: true, signature: 'page-2' }));
        }

        expect(observer.snapshot()).toMatchObject({
            identities: [ID_1, ID_2, ID_3],
            exhausted: true,
            stableBottomRounds: 8
        });
    });

    test.each([
        [observation({ pathname: '/imagine' }), 'observer_route_mismatch'],
        [observation({ scope: 'mine' }), 'observer_scope_mismatch']
    ])('rejects %s', (input, message) => {
        expect(() => createSavedGalleryObserver().capture(input)).toThrow(message);
    });

    test('resets bottom proof for a visible loader or a new identity', () => {
        let now = 0;
        const observer = createSavedGalleryObserver({ now: () => now });
        observer.capture(observation({ identities: [ID_1], atBottom: true }));
        now += 750;
        observer.capture(observation({ identities: [ID_1], atBottom: true }));
        now += 750;
        observer.capture(observation({ identities: [ID_1], atBottom: true, loading: true }));
        expect(observer.snapshot().stableBottomRounds).toBe(0);
        now += 750;
        observer.capture(observation({ identities: [ID_1, ID_2], atBottom: true }));
        expect(observer.snapshot()).toMatchObject({ stableBottomRounds: 0, exhausted: false });
    });

    test('does not retain invalid media URLs or full URLs in events', () => {
        const observer = createSavedGalleryObserver();
        observer.capture(observation({
            identities: [
                `https://assets.grok.com/images/${ID_1}.jpg?signature=private`,
                'https://assets.grok.com/images/not-an-identity.jpg?signature=private',
                ID_1
            ]
        }));
        const snapshot = observer.snapshot();
        expect(snapshot.identities).toEqual([ID_1]);
        expect(JSON.stringify(snapshot)).not.toContain('https://');
        expect(JSON.stringify(snapshot)).not.toContain('signature=private');
    });
});

describe('observeSavedGallery', () => {
    test('requires visible All scope and restores initial scroll after collection', async () => {
        const driver = createFakeDriver({
            initialScrollTop: 35,
            scopeNode: { textContent: 'All' },
            images: [
                { src: `https://assets.grok.com/images/${ID_1}.jpg`, alt: 'Generated image' },
                { src: `https://assets.grok.com/images/${ID_1}.jpg`, alt: 'Generated image' },
                { src: 'https://assets.grok.com/images/not-a-uuid.jpg', alt: 'Generated image' }
            ]
        });
        const result = await observeSavedGallery({
            document: driver.document,
            location: driver.location,
            sleep: driver.sleep,
            maxProbes: 1,
            getScroller: () => driver.scroller
        });

        expect(result).toMatchObject({ blocked: 'scan_limit', exhausted: false, identities: [ID_1] });
        expect(driver.scroller.scrollTop).toBe(35);
        expect(driver.sleep).toHaveBeenCalledWith(750);
    });

    test('blocks wrong route, missing All scope, and ambiguous gallery without scrolling', async () => {
        const routeDriver = createFakeDriver({ pathname: '/imagine' });
        await expect(observeSavedGallery({
            document: routeDriver.document,
            location: routeDriver.location,
            getScroller: () => routeDriver.scroller
        })).rejects.toThrow('observer_route_mismatch');

        const scopeDriver = createFakeDriver({ scopeNode: { textContent: 'Mine' } });
        await expect(observeSavedGallery({
            document: scopeDriver.document,
            location: scopeDriver.location,
            getScroller: () => scopeDriver.scroller
        })).rejects.toThrow('observer_scope_mismatch');

        const galleryDriver = createFakeDriver({ scopeNode: { textContent: 'All' } });
        galleryDriver.document.querySelector = jest.fn((selector) => (
            selector === '[role="tab"][aria-selected="true"], [role="button"][aria-pressed="true"]'
                ? { textContent: 'All' }
                : null
        ));
        galleryDriver.document.querySelectorAll = jest.fn(() => []);
        await expect(observeSavedGallery({
            document: galleryDriver.document,
            location: galleryDriver.location,
            getScroller: () => galleryDriver.scroller
        })).rejects.toThrow('observer_gallery_missing');
        expect(galleryDriver.scroller.scrollTop).toBe(0);
    });
});
