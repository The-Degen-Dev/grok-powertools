const { test, expect } = require('@playwright/test');

const collection = {
    id: 'watch-mode-test-collection',
    name: 'Watch Mode Test',
    description: '',
    status: 'active',
    aspectRatioOverride: null,
    createdAt: '2026-05-19T00:00:00.000Z',
    updatedAt: '2026-05-19T00:00:00.000Z',
    items: [
        {
            id: 'video-1',
            grokPostId: 'video-1',
            sourceUrl: 'https://grok.com/imagine/post/video-1',
            videoUrl: 'https://example.com/video-1.mp4',
            thumbnailUrl: '',
            promptText: 'First playable prompt',
            position: 0,
            notes: '',
            createdAt: '2026-05-19T00:00:00.000Z',
        },
        {
            id: 'video-empty',
            grokPostId: 'video-empty',
            sourceUrl: 'https://grok.com/imagine/post/video-empty',
            videoUrl: '',
            thumbnailUrl: '',
            promptText: 'Missing video URL prompt',
            position: 1,
            notes: '',
            createdAt: '2026-05-19T00:00:00.000Z',
        },
        {
            id: 'video-2',
            grokPostId: 'video-2',
            sourceUrl: 'https://grok.com/imagine/post/video-2',
            videoUrl: 'https://example.com/video-2.mp4',
            thumbnailUrl: '',
            promptText: 'Second playable prompt',
            position: 2,
            notes: '',
            createdAt: '2026-05-19T00:00:00.000Z',
        },
        {
            id: 'video-3',
            grokPostId: 'video-3',
            sourceUrl: 'https://grok.com/imagine/post/video-3',
            videoUrl: 'https://example.com/video-3.mp4',
            thumbnailUrl: '',
            promptText: 'Third playable prompt',
            position: 3,
            notes: '',
            createdAt: '2026-05-19T00:00:00.000Z',
        },
    ],
};

const unplayableCollection = {
    ...collection,
    id: 'watch-mode-unplayable-collection',
    name: 'Watch Mode Empty Queue Test',
    items: [
        {
            id: 'video-empty-only',
            grokPostId: 'video-empty-only',
            sourceUrl: 'https://grok.com/imagine/post/video-empty-only',
            videoUrl: '',
            thumbnailUrl: '',
            promptText: 'Only missing video URL prompt',
            position: 0,
            notes: '',
            createdAt: '2026-05-19T00:00:00.000Z',
        },
    ],
};

async function resetDatabase(page) {
    await page.goto('/favicon.ico');
    await page.evaluate(async () => {
        await new Promise((resolve, reject) => {
            const request = indexedDB.deleteDatabase('grok-power-tools');
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
            request.onblocked = () => reject(new Error('IndexedDB delete blocked'));
        });
    });
}

async function seedCollection(page, seed = collection) {
    await resetDatabase(page);
    await page.evaluate(async (seedCollection) => {
        const db = await new Promise((resolve, reject) => {
            // Seed only the v1 stores needed for collections; the app should run normal upgrades on load.
            const request = indexedDB.open('grok-power-tools', 1);

            request.onupgradeneeded = () => {
                const db = request.result;

                const collectionStore = db.createObjectStore('collections', { keyPath: 'id' });
                collectionStore.createIndex('by-status', 'status');
                collectionStore.createIndex('by-updated', 'updatedAt');
                db.createObjectStore('settings');
            };

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });

        const tx = db.transaction('collections', 'readwrite');
        tx.objectStore('collections').put(seedCollection);
        await new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
        db.close();
    }, seed);

    await page.goto(`/collections/${seed.id}`);
}

async function getMovies(page) {
    return page.evaluate(async () => {
        const db = await new Promise((resolve, reject) => {
            const request = indexedDB.open('grok-power-tools');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });

        const tx = db.transaction('movies', 'readonly');
        const movies = await new Promise((resolve, reject) => {
            const request = tx.objectStore('movies').getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        db.close();
        return movies;
    });
}

async function seedCollections(page, seeds) {
    await resetDatabase(page);
    await page.evaluate(async (seedCollections) => {
        const db = await new Promise((resolve, reject) => {
            const request = indexedDB.open('grok-power-tools', 1);

            request.onupgradeneeded = () => {
                const db = request.result;

                const collectionStore = db.createObjectStore('collections', { keyPath: 'id' });
                collectionStore.createIndex('by-status', 'status');
                collectionStore.createIndex('by-updated', 'updatedAt');
                db.createObjectStore('settings');
            };

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });

        const tx = db.transaction('collections', 'readwrite');
        for (const seedCollection of seedCollections) {
            tx.objectStore('collections').put(seedCollection);
        }
        await new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
        db.close();
    }, seeds);

    await page.goto(`/collections/${seeds[0].id}`);
}

async function installMediaPlaybackStub(page) {
    await page.addInitScript(() => {
        window.__watchModePauseCalls = 0;

        Object.defineProperty(HTMLMediaElement.prototype, 'paused', {
            configurable: true,
            get() {
                return this.__watchModePaused ?? true;
            },
        });

        HTMLMediaElement.prototype.load = function load() {};
        HTMLMediaElement.prototype.play = function play() {
            this.__watchModePaused = false;
            return Promise.resolve();
        };
        HTMLMediaElement.prototype.pause = function pause() {
            this.__watchModePaused = true;
            window.__watchModePauseCalls += 1;
        };
    });
}

async function createPlayableVideoDataUrl(page) {
    await page.goto('/favicon.ico');
    return page.evaluate(async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 160;
        canvas.height = 90;
        const context = canvas.getContext('2d');
        const stream = canvas.captureStream(12);
        const chunks = [];
        const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
            ? 'video/webm;codecs=vp8'
            : 'video/webm';
        const recorder = new MediaRecorder(stream, { mimeType });
        recorder.ondataavailable = (event) => {
            if (event.data.size) chunks.push(event.data);
        };

        const done = new Promise((resolve, reject) => {
            recorder.onstop = resolve;
            recorder.onerror = () => reject(recorder.error);
        });

        context.fillStyle = '#0f766e';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = '#ffffff';
        context.font = '700 18px system-ui, sans-serif';
        context.fillText('Watch', 42, 52);
        recorder.start();
        await new Promise((resolve) => setTimeout(resolve, 500));
        recorder.stop();
        await done;
        stream.getTracks().forEach((track) => track.stop());

        const blob = new Blob(chunks, { type: 'video/webm' });
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
        });
    });
}

test.describe('Collection Watch Mode', () => {
    test('Watch All opens playable videos only and saves a crossfade movie', async ({ page }) => {
        await seedCollection(page);

        const watchAllButton = page.getByRole('button', { name: /Watch All/i });
        await expect(watchAllButton).toBeVisible({ timeout: 5000 });
        await watchAllButton.click();

        const viewer = page.getByTestId('fullscreen-viewer');
        await expect(viewer.getByText('Watch Mode', { exact: true })).toBeVisible();
        await expect(viewer.getByText('1 / 3')).toBeVisible();

        await viewer.getByRole('button', { name: 'Next' }).click();
        await expect(viewer.getByText('2 / 3')).toBeVisible();

        await viewer.getByRole('button', { name: /Save as Movie/i }).click();
        await expect(page).toHaveURL(/\/movie\?id=/);

        const movies = await getMovies(page);
        expect(movies).toHaveLength(1);
        expect(movies[0].name).toBe('Watch Mode Test Compilation');
        expect(movies[0].clips).toHaveLength(3);
        expect(movies[0].clips[0].transition).toEqual({ type: 'cut', duration: 0 });
        expect(movies[0].clips[1].transition).toEqual({ type: 'crossfade', duration: 0.5 });
        expect(movies[0].clips[2].transition).toEqual({ type: 'crossfade', duration: 0.5 });
        expect(movies[0].clips.map((clip) => clip.videoUrl)).toEqual([
            'https://example.com/video-1.mp4',
            'https://example.com/video-2.mp4',
            'https://example.com/video-3.mp4',
        ]);
    });

    test('Watch Selected uses selected playable videos in collection order', async ({ page }) => {
        await seedCollection(page);

        await page.getByRole('button', { name: /^Select$/i }).click();
        await page.getByRole('button', { name: /Third playable prompt/ }).first().click();
        await page.getByRole('button', { name: /Missing video URL prompt/ }).first().click();
        await page.getByRole('button', { name: /First playable prompt/ }).first().click();

        const watchSelectedButton = page.getByRole('button', { name: /Watch Selected/i });
        await expect(watchSelectedButton).toBeVisible({ timeout: 5000 });
        await watchSelectedButton.click();

        const viewer = page.getByTestId('fullscreen-viewer');
        await expect(viewer.getByText('Watch Mode', { exact: true })).toBeVisible();
        await expect(viewer.getByText('1 / 2')).toBeVisible();
        await viewer.getByRole('button', { name: /Prompt info/i }).click();
        await expect(viewer.getByText('First playable prompt', { exact: true })).toBeVisible();

        await viewer.getByRole('button', { name: 'Next' }).click();
        await expect(viewer.getByText('2 / 2')).toBeVisible();
        await expect(viewer.getByText('Third playable prompt', { exact: true })).toBeVisible();
    });

    test('Watch actions are disabled when no playable videos are available', async ({ page }) => {
        await seedCollection(page, unplayableCollection);

        await expect(page.getByRole('button', { name: /Watch All/i })).toBeDisabled();

        await page.getByRole('button', { name: /^Select$/i }).click();
        await page.getByRole('button', { name: /Only missing video URL prompt/ }).first().click();

        await expect(page.getByRole('button', { name: /Watch Selected/i })).toBeDisabled();
    });

    test('Watch Selected is clickable from the mobile bulk action bar', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await seedCollection(page);

        await page.getByRole('button', { name: /^Select$/i }).click();
        await page.getByRole('button', { name: /Third playable prompt/ }).first().click();
        await page.getByRole('button', { name: /Missing video URL prompt/ }).first().click();
        await page.getByRole('button', { name: /First playable prompt/ }).first().click();

        const hasHorizontalOverflow = await page.evaluate(
            () => document.documentElement.scrollWidth > window.innerWidth + 1
        );
        expect(hasHorizontalOverflow).toBe(false);

        await page.getByRole('button', { name: /Watch Selected/i }).click();

        const viewer = page.getByTestId('fullscreen-viewer');
        await expect(viewer.getByText('Watch Mode', { exact: true })).toBeVisible();
        await expect(viewer.getByText('1 / 2')).toBeVisible();
    });

    test('Skim playback stops on the final video after the skim interval', async ({ page }) => {
        await installMediaPlaybackStub(page);
        const videoUrl = await createPlayableVideoDataUrl(page);
        await seedCollection(page, {
            ...collection,
            id: 'watch-mode-skim-final-collection',
            name: 'Watch Mode Skim Final Test',
            items: collection.items.map((item) => ({
                ...item,
                videoUrl: item.videoUrl ? videoUrl : '',
            })).filter((item) => item.videoUrl).slice(0, 1),
        });

        await page.getByRole('button', { name: /Watch All/i }).click();

        const viewer = page.getByTestId('fullscreen-viewer');
        await expect(viewer.getByText('Watch Mode', { exact: true })).toBeVisible();
        await expect(viewer.getByText('1 / 1')).toBeVisible();

        await viewer.getByRole('button', { name: 'Skim' }).click();
        await viewer.getByLabel('Skim interval').selectOption('5');
        await page.evaluate(() => {
            document.querySelectorAll('video').forEach((video) => {
                video.__watchModePaused = true;
            });
        });
        await viewer.getByRole('button', { name: /Play \(Space\)/ }).click();
        await expect(viewer.getByText('Video failed to load')).toHaveCount(0);
        await expect(viewer.getByRole('button', { name: /Pause \(Space\)/ })).toBeVisible();
        await expect.poll(() => page.evaluate(() => window.__watchModePauseCalls)).toBe(0);

        await page.waitForTimeout(5500);

        expect(await page.evaluate(() => window.__watchModePauseCalls)).toBeGreaterThan(0);
        await expect(viewer.getByRole('button', { name: /Play \(Space\)/ })).toBeVisible();
    });

    test('Mobile collection drawer can reach collections outside the compact rail', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        const manyCollections = Array.from({ length: 10 }, (_, index) => ({
            ...collection,
            id: `watch-mode-collection-${index + 1}`,
            name: `Collection ${index + 1}`,
            items: [],
        }));

        await seedCollections(page, manyCollections);

        await page.getByRole('button', { name: /Open collections/i }).click();
        await page.getByRole('button', { name: /^Collection 10\b/ }).click();

        await expect(page).toHaveURL(/\/collections\/watch-mode-collection-10$/);
    });
});
