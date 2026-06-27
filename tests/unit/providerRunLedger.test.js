const {
    PROVIDER_RUN_HISTORY_KEY,
    appendProviderRunLedgerEntry,
    createProviderRunId,
    normalizeProviderRunLedgerEntry
} = require('../../providerRunLedger.js');

function createStorage(initial = {}) {
    const state = { ...initial };
    return {
        state,
        get: jest.fn((keys) => {
            const list = Array.isArray(keys) ? keys : [keys];
            return Promise.resolve(list.reduce((acc, key) => {
                acc[key] = state[key];
                return acc;
            }, {}));
        }),
        set: jest.fn((next) => {
            Object.assign(state, next);
            return Promise.resolve();
        })
    };
}

describe('provider run ledger', () => {
    test('creates provider run ids with stable prefix', () => {
        expect(createProviderRunId({ now: () => 123, random: () => 0.5 })).toMatch(/^provider_run_123_/);
    });

    test('normalizes ChatGPT submitted and generated run entries', () => {
        const submitted = normalizeProviderRunLedgerEntry({
            runId: 'provider_run_1',
            providerId: 'chatgpt-images',
            workflow: 'text-to-image',
            prompt: '  a brass observatory  ',
            status: 'submitted'
        }, { now: () => 456 });
        const generated = normalizeProviderRunLedgerEntry({
            ...submitted,
            status: 'generated',
            result: {
                src: 'https://cdn.example.com/generated.png',
                href: 'https://chatgpt.com/images/abc'
            }
        }, { now: () => 789 });

        expect(submitted).toEqual(expect.objectContaining({
            status: 'submitted',
            resultMediaUrl: '',
            downloadStatus: 'not_supported_yet'
        }));
        expect(generated).toEqual(expect.objectContaining({
            runId: 'provider_run_1',
            providerId: 'chatgpt-images',
            workflow: 'text-to-image',
            prompt: 'a brass observatory',
            status: 'generated',
            resultMediaUrl: 'https://cdn.example.com/generated.png',
            resultPageUrl: 'https://chatgpt.com/images/abc',
            downloadStatus: 'not_supported_yet',
            createdAt: 456
        }));
    });

    test('appends newest entries first and limits stored history', async () => {
        const storage = createStorage({
            [PROVIDER_RUN_HISTORY_KEY]: [{ runId: 'old', createdAt: 1 }]
        });

        await appendProviderRunLedgerEntry({
            runId: 'new',
            providerId: 'chatgpt-images',
            workflow: 'text-to-image',
            prompt: 'new prompt',
            status: 'generated'
        }, { storage, maxEntries: 1, now: () => 2 });

        expect(storage.set).toHaveBeenCalledWith({
            [PROVIDER_RUN_HISTORY_KEY]: [
                expect.objectContaining({ runId: 'new', createdAt: 2 })
            ]
        });
    });
});
