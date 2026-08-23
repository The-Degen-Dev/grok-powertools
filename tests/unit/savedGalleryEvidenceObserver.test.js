const fs = require('fs');
const vm = require('vm');
const {
    createSavedGalleryObserver,
    observeSavedGallery
} = require('../../acceptance/browser/saved-gallery-observer.js');

const observerPath = require.resolve('../../acceptance/browser/saved-gallery-observer.js');
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
        ...overrides
    };
}

function image(url) {
    return { alt: 'Generated image', currentSrc: url, src: url };
}

function createNode(options = {}) {
    return {
        parentElement: null,
        children: [],
        textContent: options.textContent || '',
        scrollTop: options.scrollTop || 0,
        clientHeight: options.clientHeight || 0,
        scrollHeight: options.scrollHeight || 0,
        selected: Boolean(options.selected),
        busy: Boolean(options.busy),
        loading: Boolean(options.loading),
        images: options.images || [],
        append(child) {
            child.parentElement = this;
            this.children.push(child);
            return child;
        },
        scrollBy({ top }) {
            this.scrollTop = Math.min(this.scrollTop + top, this.scrollHeight - this.clientHeight);
        },
        matches(selector) {
            return (selector.includes('aria-busy') && this.busy)
                || (selector.includes('data-loading') && this.loading);
        },
        querySelectorAll(selector) {
            const descendants = [];
            const visit = (current) => {
                for (const child of current.children) {
                    descendants.push(child);
                    visit(child);
                }
            };
            visit(this);
            if (selector.includes('Generated image')) return typeof this.images === 'function' ? this.images() : this.images;
            if (selector.includes('aria-selected') || selector.includes('aria-pressed')) {
                return descendants.filter((child) => child.selected);
            }
            if (selector.includes('progressbar') || selector.includes('aria-busy') || selector.includes('data-loading')) {
                return descendants.filter((child) => child.busy || child.loading);
            }
            return [];
        },
        querySelector(selector) {
            return this.querySelectorAll(selector)[0] || null;
        }
    };
}

function createDriver(options = {}) {
    const region = createNode({ scrollHeight: options.regionOverflow ? 300 : 0, clientHeight: 100 });
    const scroller = region.append(createNode({ scrollTop: options.initialScrollTop || 0, scrollHeight: 200, clientHeight: 100 }));
    const gallery = scroller.append(createNode({
        images: options.images || [],
        busy: options.galleryBusy,
        loading: options.galleryLoading
    }));
    region.append(createNode({ textContent: 'All', selected: options.allSelected !== false }));
    if (options.competingSelected) region.append(createNode({ textContent: 'Mine', selected: true }));
    if (options.descendantLoading) gallery.append(createNode({ loading: true }));
    const document = {
        querySelectorAll: jest.fn((selector) => (selector.includes('[role="list"]') ? [gallery] : []))
    };
    let now = 0;
    const sleep = jest.fn(async () => {
        now += 750;
        if (options.sleepError) throw new Error('sleep_failed');
    });
    return {
        document,
        gallery,
        region,
        scroller,
        location: { pathname: options.pathname || '/imagine/saved' },
        sleep,
        now: () => now
    };
}

describe('Saved gallery observer core', () => {
    test('deduplicates identities across remounts and requires stable bottom proof', () => {
        let now = 0;
        const observer = createSavedGalleryObserver({ now: () => now });
        observer.capture(observation({ identities: [ID_1, ID_2] }));
        observer.capture(observation({ identities: [ID_2, ID_3], atBottom: true }));
        for (let round = 0; round < 8; round += 1) {
            now += 750;
            observer.capture(observation({ identities: [ID_2, ID_3], atBottom: true }));
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
    ])('rejects invalid core observations', (input, message) => {
        expect(() => createSavedGalleryObserver().capture(input)).toThrow(message);
    });
});

describe('browser global and dynamic gallery driver', () => {
    test('exposes the required browser global without CommonJS', () => {
        const context = { globalThis: {} };
        vm.runInNewContext(fs.readFileSync(observerPath, 'utf8'), context);
        expect(typeof context.globalThis.GrokSavedEvidenceObserver.observeSavedGallery).toBe('function');
    });

    test('uses the real gallery-owner scope and scroller resolvers through virtualized remounts', async () => {
        const driver = createDriver({
            initialScrollTop: 30,
            images: () => driver.scroller.scrollTop === 0
                ? [image(`https://assets.grok.com/images/${ID_1}.jpg`)]
                : [image(`https://assets.grok.com/images/${ID_2}.png`)]
        });
        const result = await observeSavedGallery({
            document: driver.document,
            location: driver.location,
            sleep: driver.sleep,
            now: driver.now,
            maxProbes: 20
        });
        expect(result).toMatchObject({ exhausted: true, identities: [ID_1, ID_2], stableBottomRounds: 8 });
        expect(driver.scroller.scrollTop).toBe(30);
    });

    test('rejects competing selected scope controls and multiple gallery-owned overflow ancestors', async () => {
        const competing = createDriver({
            competingSelected: true,
            images: [image(`https://assets.grok.com/images/${ID_1}.jpg`)]
        });
        await expect(observeSavedGallery({
            document: competing.document,
            location: competing.location,
            sleep: competing.sleep,
            now: competing.now
        })).rejects.toThrow('observer_scope_ambiguous');

        const multipleScrollers = createDriver({
            regionOverflow: true,
            images: [image(`https://assets.grok.com/images/${ID_1}.jpg`)]
        });
        await expect(observeSavedGallery({
            document: multipleScrollers.document,
            location: multipleScrollers.location,
            sleep: multipleScrollers.sleep,
            now: multipleScrollers.now
        })).rejects.toThrow('observer_scroller_ambiguous');
    });

    test.each([
        ['root', { galleryBusy: true }],
        ['descendant', { descendantLoading: true }]
    ])('treats %s semantic loading as active and resets stability', async (_name, options) => {
        const driver = createDriver({
            ...options,
            images: [image(`https://assets.grok.com/images/${ID_1}.jpg`)]
        });
        const result = await observeSavedGallery({
            document: driver.document,
            location: driver.location,
            sleep: driver.sleep,
            now: driver.now,
            maxProbes: 3
        });
        expect(result).toMatchObject({ blocked: 'scan_limit', exhausted: false, stableBottomRounds: 0 });
    });

    test('rejects an eligible-looking UUID when the image URL is not approved generated media', async () => {
        const driver = createDriver({
            images: [
                image(`https://tracking.example/${ID_1}.jpg`),
                image(`https://assets.grok.com/images/${ID_2}.jpg?duplicate=${ID_1}`)
            ]
        });
        const result = await observeSavedGallery({
            document: driver.document,
            location: driver.location,
            sleep: driver.sleep,
            now: driver.now,
            maxProbes: 1
        });
        expect(result.identities).toEqual([ID_2]);
        expect(JSON.stringify(result)).not.toContain('https://');
    });

    test('restores scroll on driver failure and performs exactly 1000 guarded probes', async () => {
        const failure = createDriver({
            initialScrollTop: 25,
            sleepError: true,
            images: [image(`https://assets.grok.com/images/${ID_1}.jpg`)]
        });
        await expect(observeSavedGallery({
            document: failure.document,
            location: failure.location,
            sleep: failure.sleep,
            now: failure.now
        })).rejects.toThrow('sleep_failed');
        expect(failure.scroller.scrollTop).toBe(25);

        const limit = createDriver({
            galleryLoading: true,
            images: [image(`https://assets.grok.com/images/${ID_1}.jpg`)]
        });
        const result = await observeSavedGallery({
            document: limit.document,
            location: limit.location,
            sleep: limit.sleep,
            now: limit.now
        });
        expect(result).toMatchObject({ blocked: 'scan_limit', exhausted: false });
        expect(limit.sleep).toHaveBeenCalledTimes(1000);
    });
});
