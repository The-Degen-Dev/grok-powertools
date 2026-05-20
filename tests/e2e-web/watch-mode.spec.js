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
});
