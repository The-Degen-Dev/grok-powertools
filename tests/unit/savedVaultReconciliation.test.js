const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
    normalizeSavedAssetIdentity,
    reconcileSavedVaultInventory,
    redactInventoryItem,
    redactReconciliationOutput
} = require('../../acceptance/lib/saved-vault-reconciliation.js');

const repoRoot = path.resolve(__dirname, '../..');
const cli = path.join(repoRoot, 'acceptance/scripts/reconcile-production-vault.mjs');
const ID_1 = '11111111-1111-4111-8111-111111111111';
const ID_2 = '22222222-2222-4222-8222-222222222222';
const ID_3 = '33333333-3333-4333-8333-333333333333';

describe('Saved vault reconciliation', () => {
    test('normalizes raw and media-prefixed UUIDs to one identity', () => {
        expect(normalizeSavedAssetIdentity(ID_1)).toBe(ID_1);
        expect(normalizeSavedAssetIdentity(`media_${ID_1}`)).toBe(ID_1);
        expect(normalizeSavedAssetIdentity('not-an-identity')).toBeNull();
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
            savedCount: 3,
            inventoryCount: 3,
            missing: [ID_3],
            duplicateCanonical: [ID_1],
            unverified: [ID_2],
            verified: [],
            legacyDuplicates: []
        });
    });

    test('deduplicates saved identities and reports verified, legacy, and extra inventory', () => {
        const result = reconcileSavedVaultInventory({
            savedIdentities: [ID_1, `media_${ID_1}`, ID_2],
            inventoryItems: [
                {
                    assetId: ID_1,
                    canonicalObjectKey: `private/prefix/${ID_1}.jpg`,
                    verificationStatus: 'verified',
                    legacyObjectKeys: [`private/legacy/${ID_1}.jpg`]
                },
                { assetId: ID_3, canonicalObjectKey: `private/prefix/${ID_3}.jpg`, verificationStatus: 'verified' }
            ]
        });
        expect(result).toMatchObject({
            savedCount: 2,
            verified: [ID_1],
            missing: [ID_2],
            legacyDuplicates: [ID_1],
            extra: [ID_3]
        });
    });

    test('redacts object keys and identity display metadata', () => {
        const safe = redactReconciliationOutput({
            verified: [ID_1],
            item: {
                canonicalObjectKey: `private/prefix/${ID_1}.jpg`,
                legacyObjectKeys: [`private/legacy/${ID_1}.jpg`],
                sourceUrl: 'https://assets.grok.com/private.jpg?sig=secret',
                verificationStatus: 'verified'
            }
        });
        const serialized = JSON.stringify(safe);
        expect(serialized).not.toContain('private/prefix');
        expect(serialized).not.toContain('https://');
        expect(safe.verified).toEqual(['...11111111']);
        expect(safe.item).toEqual({
            canonicalObjectKey: { suffix: '.jpg' },
            legacyObjectKeys: [{ suffix: '.jpg' }],
            verificationStatus: 'verified'
        });
    });

    test('retains only redacted metadata for persisted inventory rows', () => {
        const safe = redactInventoryItem({
            assetId: ID_1,
            canonicalObjectKey: `private/prefix/${ID_1}.jpg`,
            legacyObjectKeys: [`private/legacy/${ID_1}.jpg`],
            sourceUrl: 'https://assets.grok.com/private.jpg?sig=secret',
            verificationStatus: 'verified'
        });
        expect(safe).toEqual({
            identity: '...11111111',
            verificationStatus: 'verified',
            canonicalObjectKey: { suffix: '.jpg' },
            legacyObjectKeys: [{ suffix: '.jpg' }]
        });
        expect(JSON.stringify(safe)).not.toContain('private');
    });
});

describe('reconciliation CLI', () => {
    test('blocks before any network request when arguments and environment are absent', () => {
        const result = spawnSync(process.execPath, [cli], {
            cwd: repoRoot,
            encoding: 'utf8',
            env: {}
        });
        expect(result.status).not.toBe(0);
        expect(`${result.stdout}${result.stderr}`).toContain('blocked: required --observer and --output arguments');
        expect(`${result.stdout}${result.stderr}`).not.toMatch(/WORKER_API_KEY|CLIENT_API_KEY|Authorization/);
    });

    test('blocks invalid non-HTTPS worker URLs without reading observer data', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'saved-vault-'));
        const observerPath = path.join(tempDir, 'observer.json');
        fs.writeFileSync(observerPath, '{ invalid json');
        const result = spawnSync(process.execPath, [cli, '--observer', observerPath, '--output', path.join(tempDir, 'out.json')], {
            cwd: repoRoot,
            encoding: 'utf8',
            env: { WORKER_URL: 'http://worker.example', WORKER_API_KEY: 'do-not-print' }
        });
        fs.rmSync(tempDir, { recursive: true, force: true });
        expect(result.status).not.toBe(0);
        expect(`${result.stdout}${result.stderr}`).toContain('blocked: WORKER_URL must be an HTTPS URL');
        expect(`${result.stdout}${result.stderr}`).not.toContain('do-not-print');
    });

    test('uses GET only and rejects repeated inventory cursors with a mocked fetch', () => {
        const moduleUrl = new URL(`file://${cli}`).href;
        const script = [
            `import { fetchInventory } from ${JSON.stringify(moduleUrl)};`,
            'const calls = [];',
            'globalThis.fetch = async (_url, init) => {',
            '  calls.push(init.method);',
            "  return { ok: true, status: 200, json: async () => ({ items: [], nextCursor: 'again' }) };",
            '};',
            "try { await fetchInventory({ worker: new URL('https://worker.example'), apiKey: 'test-only' }); }",
            "catch (error) { process.stdout.write(`${error.message}:${calls.join(',')}`); }"
        ].join('\n');
        const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
            cwd: repoRoot,
            encoding: 'utf8',
            env: {}
        });
        expect(result.status).toBe(0);
        expect(result.stdout).toBe('inventory_cursor_repeated:GET,GET');
        expect(result.stdout).not.toMatch(/POST|PUT|PATCH|DELETE/);
    });
});
