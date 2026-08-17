const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawnSync } = require('child_process');
const {
    normalizeSavedAssetIdentity,
    reconcileSavedVaultInventory,
    redactInventoryItem,
    validateInventoryItems
} = require('../../acceptance/lib/saved-vault-reconciliation.js');

const repoRoot = path.resolve(__dirname, '../..');
const cli = path.join(repoRoot, 'acceptance/scripts/reconcile-production-vault.mjs');
const ID_1 = '11111111-1111-4111-8111-111111111111';
const ID_2 = '22222222-2222-4222-8222-222222222222';
const ID_3 = '33333333-3333-4333-8333-333333333333';

function createTempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'saved-vault-'));
}

function writeFetchMock(directory, pages, options = {}) {
    const modulePath = path.join(directory, 'mock-fetch.mjs');
    fs.writeFileSync(modulePath, [
        "import fs from 'node:fs';",
        `const pages = ${JSON.stringify(pages)};`,
        `const thrown = ${JSON.stringify(options.thrown || '')};`,
        `const logPath = ${JSON.stringify(options.logPath || '')};`,
        'let index = 0;',
        'globalThis.fetch = async (url, init) => {',
        "  if (logPath) fs.appendFileSync(logPath, `${init.method}:${url.search}\\n`);",
        '  if (thrown) throw new Error(thrown);',
        '  const page = pages[index++];',
        '  return { ok: true, status: 200, json: async () => page };',
        '};'
    ].join('\n'));
    return modulePath;
}

function runCli(directory, { observer, pages, env = {}, mockOptions = {} }) {
    const observerPath = path.join(directory, 'observer.json');
    const outputPath = path.join(directory, 'output.json');
    fs.writeFileSync(observerPath, JSON.stringify(observer));
    const mock = writeFetchMock(directory, pages, mockOptions);
    return {
        outputPath,
        result: spawnSync(process.execPath, [
            '--import', pathToFileURL(mock).href,
            cli,
            '--observer', observerPath,
            '--output', outputPath
        ], {
            cwd: repoRoot,
            encoding: 'utf8',
            env: { WORKER_URL: 'https://worker.example', CLIENT_API_KEY: 'test-client-key', ...env }
        })
    };
}

function completeObserver(identities = [ID_1, ID_2]) {
    return { schemaVersion: 1, exhausted: true, identities };
}

describe('Saved vault reconciliation', () => {
    test('normalizes raw and media-prefixed UUIDs to one identity', () => {
        expect(normalizeSavedAssetIdentity(ID_1)).toBe(ID_1);
        expect(normalizeSavedAssetIdentity(`media_${ID_1}`)).toBe(ID_1);
        expect(normalizeSavedAssetIdentity('not-an-identity')).toBeNull();
    });

    test('sorts every identity classification regardless of input ordering', () => {
        const inventory = [
            { assetId: ID_2, canonicalObjectKey: `prefix/${ID_2}.jpg`, verificationStatus: 'verified' },
            { assetId: ID_1, canonicalObjectKey: `prefix/${ID_1}.jpg`, verificationStatus: 'verified' },
            { assetId: ID_3, canonicalObjectKey: `prefix/${ID_3}.jpg`, verificationStatus: 'verified' }
        ];
        const first = reconcileSavedVaultInventory({ savedIdentities: [ID_2, ID_1], inventoryItems: inventory });
        const second = reconcileSavedVaultInventory({ savedIdentities: [ID_1, ID_2], inventoryItems: [...inventory].reverse() });
        expect(first).toEqual(second);
        expect(first.verified).toEqual([ID_1, ID_2]);
        expect(first.extra).toEqual([ID_3]);
    });

    test('reports missing, duplicate canonical, and unverified identities', () => {
        const result = reconcileSavedVaultInventory({
            savedIdentities: [ID_1, ID_2, ID_3],
            inventoryItems: [
                { assetId: `media_${ID_1}`, canonicalObjectKey: `prefix/${ID_1}.jpg`, verificationStatus: 'verified' },
                { assetId: ID_1, canonicalObjectKey: `prefix/duplicate-${ID_1}.jpg`, verificationStatus: 'verified' },
                { assetId: ID_2, canonicalObjectKey: `prefix/${ID_2}.mp4`, verificationStatus: 'unproven' }
            ]
        });
        expect(result).toMatchObject({
            missing: [ID_3], duplicateCanonical: [ID_1], unverified: [ID_2], verified: [], legacyDuplicates: []
        });
    });

    test('allowlists media metadata and rejects adversarial object-key and status text', () => {
        expect(redactInventoryItem({
            assetId: ID_1,
            canonicalObjectKey: `private/${ID_1}.jpg`,
            legacyObjectKeys: [`private/${ID_1}.not-metadata-SENTINEL`],
            verificationStatus: 'SENTINEL_STATUS'
        })).toEqual({
            identity: '...11111111',
            verificationStatus: 'unknown',
            canonicalObjectKey: { mediaType: 'image/jpeg' },
            legacyObjectKeys: [null]
        });
    });

    test.each([
        [null],
        [[[]]],
        [{ assetId: 'SENTINEL_NOT_AN_IDENTITY' }],
        [{ assetId: ID_1, legacyObjectKeys: 'SENTINEL_NOT_AN_ARRAY' }]
    ])('rejects malformed inventory rows without dereferencing them', (items) => {
        expect(validateInventoryItems(items)).toBe(false);
        expect(() => reconcileSavedVaultInventory({ savedIdentities: [ID_1], inventoryItems: items })).toThrow('inventory_items_invalid');
    });
});

describe('reconciliation CLI', () => {
    test('blocks before any network request when arguments and environment are absent', () => {
        const result = spawnSync(process.execPath, [cli], { cwd: repoRoot, encoding: 'utf8', env: {} });
        expect(result.status).toBe(1);
        expect(`${result.stdout}${result.stderr}`).toBe('blocked: required_arguments\n');
    });

    test('blocks a non-HTTPS worker URL before mocked fetch', () => {
        const directory = createTempDir();
        const fetchLog = path.join(directory, 'fetch.log');
        const { result } = runCli(directory, {
            observer: completeObserver([ID_1]),
            pages: [],
            env: { WORKER_URL: 'http://worker.example' },
            mockOptions: { logPath: fetchLog }
        });
        expect(result.status).toBe(1);
        expect(`${result.stdout}${result.stderr}`).toBe('blocked: worker_url_invalid\n');
        expect(fs.existsSync(fetchLog)).toBe(false);
        fs.rmSync(directory, { recursive: true, force: true });
    });

    test.each([
        [{ schemaVersion: 1, exhausted: false, identities: [ID_1] }],
        [{ schemaVersion: 1, exhausted: true, blocked: 'scan_limit', identities: [ID_1] }],
        [{ schemaVersion: 1, exhausted: true, blocked: '', identities: [ID_1] }],
        [{ schemaVersion: 2, exhausted: true, identities: [ID_1] }],
        [{ schemaVersion: 1, exhausted: true, identities: [`media_${ID_1}`] }]
    ])('rejects incomplete observer evidence before mocked fetch', (observer) => {
        const directory = createTempDir();
        const fetchLog = path.join(directory, 'fetch.log');
        const { result } = runCli(directory, { observer, pages: [], mockOptions: { logPath: fetchLog } });
        expect(result.status).toBe(1);
        expect(`${result.stdout}${result.stderr}`).toBe('blocked: observer_evidence_invalid\n');
        expect(fs.existsSync(fetchLog)).toBe(false);
        fs.rmSync(directory, { recursive: true, force: true });
    });

    test.each([undefined, '', 0, false, {}])('rejects malformed terminal cursor %p', (nextCursor) => {
        const directory = createTempDir();
        const { result } = runCli(directory, {
            observer: completeObserver([ID_1]),
            pages: [{ items: [], nextCursor }]
        });
        expect(result.status).toBe(1);
        expect(`${result.stdout}${result.stderr}`).toBe('blocked: inventory_cursor_invalid\n');
        fs.rmSync(directory, { recursive: true, force: true });
    });

    test.each([
        [null],
        [[[]]],
        [{ assetId: 'SENTINEL_NOT_AN_IDENTITY' }],
        [{ assetId: ID_1, canonicalObjectKey: `private/${ID_1}.jpg`, legacyObjectKeys: 'SENTINEL_NOT_AN_ARRAY' }]
    ])('rejects malformed successful inventory rows with fixed output and no evidence', (items) => {
        const directory = createTempDir();
        const { outputPath, result } = runCli(directory, {
            observer: completeObserver([ID_1]),
            pages: [{ items, nextCursor: null }]
        });
        const output = `${result.stdout}${result.stderr}`;
        expect(result.status).toBe(1);
        expect(output).toBe('blocked: inventory_response_invalid\n');
        expect(output).not.toContain('SENTINEL');
        expect(output).not.toContain(directory);
        expect(output).not.toContain('private/');
        expect(fs.existsSync(outputPath)).toBe(false);
        fs.rmSync(directory, { recursive: true, force: true });
    });

    test('uses CLIENT_API_KEY fallback, GET-only multi-page inventory, and stable redacted output', () => {
        const firstDir = createTempDir();
        const firstLog = path.join(firstDir, 'fetch.log');
        const pages = [
            { items: [{ assetId: ID_2, canonicalObjectKey: `private/${ID_2}.png`, verificationStatus: 'verified' }], nextCursor: 'page-2' },
            { items: [{ assetId: ID_1, canonicalObjectKey: `private/${ID_1}.jpg`, verificationStatus: 'verified' }], nextCursor: null }
        ];
        const first = runCli(firstDir, {
            observer: completeObserver([ID_2, ID_1]), pages, mockOptions: { logPath: firstLog }
        });
        expect(first.result.status).toBe(0);
        expect(first.result.stdout).toBe('reconciliation_complete\n');
        expect(first.result.stderr).toBe('');
        expect(fs.readFileSync(firstLog, 'utf8')).toBe('GET:?limit=1000\nGET:?limit=1000&cursor=page-2\n');

        const secondDir = createTempDir();
        const second = runCli(secondDir, {
            observer: completeObserver([ID_1, ID_2]),
            pages: [
                { items: [{ assetId: ID_1, canonicalObjectKey: `private/${ID_1}.jpg`, verificationStatus: 'verified' }], nextCursor: 'page-2' },
                { items: [{ assetId: ID_2, canonicalObjectKey: `private/${ID_2}.png`, verificationStatus: 'verified' }], nextCursor: null }
            ]
        });
        expect(second.result.status).toBe(0);
        expect(fs.readFileSync(first.outputPath)).toEqual(fs.readFileSync(second.outputPath));
        const output = JSON.parse(fs.readFileSync(first.outputPath, 'utf8'));
        expect(output).toMatchObject({ verified: ['...11111111', '...22222222'] });
        expect(JSON.stringify(output)).not.toContain('private');
        expect(JSON.stringify(output)).not.toContain('test-client-key');
        fs.rmSync(firstDir, { recursive: true, force: true });
        fs.rmSync(secondDir, { recursive: true, force: true });
    });

    test('maps unexpected fetch errors to fixed non-sensitive process output', () => {
        const directory = createTempDir();
        const { result } = runCli(directory, {
            observer: completeObserver([ID_1]),
            pages: [],
            mockOptions: { thrown: 'SENTINEL_THROWN_ERROR' }
        });
        expect(result.status).toBe(1);
        expect(`${result.stdout}${result.stderr}`).toBe('blocked: inventory_request_failed\n');
        expect(`${result.stdout}${result.stderr}`).not.toContain('SENTINEL_THROWN_ERROR');
        fs.rmSync(directory, { recursive: true, force: true });
    });
});
