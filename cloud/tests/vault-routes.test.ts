import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../src/index';

const headerName = ['x-gpt', 'api', 'key'].join('-');
const sampleKey = 'client-sample';
const syncSecret = 'sync-test-secret';

function base64url(value: string | Uint8Array): string {
    const buffer = typeof value === 'string' ? Buffer.from(value) : Buffer.from(value);
    return buffer.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function signSyncJWT(payloadOverrides: Record<string, unknown> = {}): Promise<string> {
    const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = base64url(JSON.stringify({
        sub: 'user-1',
        email: 'test@example.com',
        name: 'Test User',
        exp: Math.floor(Date.now() / 1000) + 3600,
        ...payloadOverrides,
    }));
    const signingInput = `${header}.${payload}`;
    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(syncSecret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const signature = new Uint8Array(await crypto.subtle.sign(
        'HMAC',
        key,
        new TextEncoder().encode(signingInput)
    ));
    return `${signingInput}.${base64url(signature)}`;
}

function env(overrides: Record<string, unknown> = {}) {
    return {
        CLIENT_API_KEY: sampleKey,
        R2_BUCKET_NAME: 'grok-gallery-001',
        KEY_PREFIX: 'grok-powertools/v1',
        R2_BUCKET: {
            list: async (options: { delimiter?: string } = {}) => options.delimiter === '/'
                ? {
                    objects: [],
                    delimitedPrefixes: ['grok-powertools/v1/users/greymaker/'],
                    truncated: false,
                    cursor: undefined,
                }
                : ({
                    objects: [
                        {
                            key: 'grok-powertools/v1/users/greymaker/media/by-asset/asset-video-1.mp4',
                            size: 2048,
                            etag: 'etag-1',
                            uploaded: new Date('2026-06-18T00:00:00.000Z'),
                            httpMetadata: { contentType: 'video/mp4' },
                            customMetadata: { assetId: 'asset-video-1', contentSha256: 'sha-1' },
                        },
                    ],
                    truncated: false,
                    cursor: undefined,
                }),
            get: async (key: string) => {
                if (key.endsWith('saved-prompts.latest.json')) {
                    return {
                        text: async () => JSON.stringify({ schemaVersion: 1, data: [{ id: 'prompt-1', text: 'Test prompt' }] }),
                        httpMetadata: { contentType: 'application/json' },
                    };
                }
                if (key.endsWith('asset-video-1.mp4')) {
                    return {
                        body: new ReadableStream({
                            start(controller) {
                                controller.enqueue(new Uint8Array([1, 2, 3]));
                                controller.close();
                            },
                        }),
                        httpMetadata: { contentType: 'video/mp4' },
                    };
                }
                return null;
            },
        },
        DB: {
            prepare: () => ({
                bind: () => ({
                    all: async () => ({ results: [] }),
                    first: async () => null,
                }),
            }),
        },
        ...overrides,
    } as never;
}

test('Vault identity is auth protected', async () => {
    const response = await worker.fetch(new Request('https://worker.example/v1/vault/identity'), env());
    assert.equal(response.status, 401);
});

test('Vault identity returns redacted target proof', async () => {
    const response = await worker.fetch(
        new Request('https://worker.example/v1/vault/identity', {
            headers: { [headerName]: sampleKey },
        }),
        env()
    );
    const body = await response.json() as Record<string, unknown>;
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.keyPrefix, 'grok-powertools/v1');
    assert.equal(JSON.stringify(body).includes(sampleKey), false);
});

test('Vault inventory treats R2 as authoritative when D1 is only a partial index', async () => {
    const d1Calls: Array<{ sql: string; args: unknown[] }> = [];
    const r2ListCalls: Array<Record<string, unknown>> = [];

    const response = await worker.fetch(
        new Request('https://worker.example/v1/vault/inventory', {
            headers: { [headerName]: sampleKey },
        }),
        env({
            R2_BUCKET: {
                list: async (options: Record<string, unknown>) => {
                    r2ListCalls.push(options);
                    return {
                        objects: [
                            {
                                key: 'grok-powertools/v1/users/Shared_Account/media/by-asset/asset-video-1.mp4',
                                size: 2048,
                                etag: 'etag-r2',
                                uploaded: new Date('2026-06-19T00:00:00.000Z'),
                                httpMetadata: { contentType: 'video/mp4' },
                                customMetadata: { 'asset-id': 'asset-video-1', sha256: 'sha-r2' },
                            },
                            {
                                key: 'grok-powertools/v1/users/Shared_Account/media/by-asset/asset-video-1.mp4.prompt.json',
                                size: 400,
                                etag: 'etag-sidecar',
                                uploaded: new Date('2026-06-19T00:00:00.000Z'),
                                httpMetadata: { contentType: 'application/json' },
                            },
                        ],
                        truncated: false,
                        cursor: undefined,
                    };
                },
            },
            DB: {
                prepare: (sql: string) => ({
                    bind: (...args: unknown[]) => ({
                        all: async () => {
                            d1Calls.push({ sql, args });
                            return {
                                results: [
                                    {
                                        asset_id: 'asset-image-1',
                                        canonical_object_key: 'grok-powertools/v1/users/greymaker/media/by-asset/asset-image-1.png',
                                        source_url_hashes: JSON.stringify(['source-hash-1']),
                                        content_sha256: 'sha-image-1',
                                        media_type: 'image',
                                        first_seen_at: '2026-06-17T00:00:00.000Z',
                                        last_seen_at: '2026-06-18T00:00:00.000Z',
                                        upload_status: 'verified',
                                        duplicate_object_keys: JSON.stringify([
                                            'grok-powertools/v1/users/greymaker/media/conflicts/asset-image-1.png',
                                        ]),
                                    },
                                ],
                            };
                        },
                    }),
                }),
            },
        })
    );
    const body = await response.json() as {
        items: Array<{ assetId: string; mediaType: string; legacyObjectKeys: string[]; canonicalObjectKey: string }>;
    };
    assert.equal(response.status, 200);
    assert.equal(body.items.length, 1);
    assert.equal(body.items[0].assetId, 'asset-video-1');
    assert.equal(body.items[0].mediaType, 'video');
    assert.equal(
        body.items[0].canonicalObjectKey,
        'grok-powertools/v1/users/Shared_Account/media/by-asset/asset-video-1.mp4'
    );
    assert.deepEqual(body.items[0].legacyObjectKeys, []);
    assert.equal(r2ListCalls.length, 1);
    assert.equal(d1Calls.length, 0);
});

test('Vault inventory falls back to R2 list when D1 has no rows', async () => {
    const response = await worker.fetch(
        new Request('https://worker.example/v1/vault/inventory', {
            headers: { [headerName]: sampleKey },
        }),
        env()
    );
    const body = await response.json() as { items: Array<{ assetId: string; mediaType: string }> };
    assert.equal(response.status, 200);
    assert.equal(body.items[0].assetId, 'asset-video-1');
    assert.equal(body.items[0].mediaType, 'video');
});

test('Vault inventory falls back to R2 list when D1 read fails', async () => {
    const response = await worker.fetch(
        new Request('https://worker.example/v1/vault/inventory', {
            headers: { [headerName]: sampleKey },
        }),
        env({
            DB: {
                prepare: () => {
                    throw new Error('D1 unavailable');
                },
            },
        })
    );
    const body = await response.json() as { items: Array<{ assetId: string; mediaType: string }> };
    assert.equal(response.status, 200);
    assert.equal(body.items[0].assetId, 'asset-video-1');
    assert.equal(body.items[0].mediaType, 'video');
});

test('Vault metadata returns saved prompt snapshots', async () => {
    const response = await worker.fetch(
        new Request('https://worker.example/v1/vault/metadata/savedPrompts', {
            headers: { [headerName]: sampleKey },
        }),
        env()
    );
    const body = await response.json() as { ok: boolean; kind: string; data: unknown[] };
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.kind, 'savedPrompts');
    assert.equal(body.data.length, 1);
});

test('Vault metadata discovers and merges every R2 user namespace without a hardcoded account', async () => {
    const requestedKeys: string[] = [];
    const response = await worker.fetch(
        new Request('https://worker.example/v1/vault/metadata/savedPrompts', {
            headers: { [headerName]: sampleKey },
        }),
        env({
            R2_BUCKET: {
                list: async (options: { prefix: string; delimiter?: string; cursor?: string }) => {
                    assert.equal(options.prefix, 'grok-powertools/v1/users/');
                    assert.equal(options.delimiter, '/');
                    return {
                        objects: [],
                        delimitedPrefixes: [
                            'grok-powertools/v1/users/greymaker/',
                            'grok-powertools/v1/users/Shared_Account/',
                        ],
                        truncated: false,
                        cursor: undefined,
                    };
                },
                get: async (key: string) => {
                    requestedKeys.push(key);
                    if (key.includes('/greymaker/')) {
                        return { text: async () => JSON.stringify({ data: [{ id: 'prompt-1', text: 'first' }] }) };
                    }
                    if (key.includes('/Shared_Account/')) {
                        return { text: async () => JSON.stringify({ data: [{ id: 'prompt-2', text: 'second' }] }) };
                    }
                    return null;
                },
            },
        })
    );
    const body = await response.json() as {
        ok: boolean;
        kind: string;
        data: Array<{ id: string }>;
        sources: string[];
    };

    assert.equal(response.status, 200);
    assert.deepEqual(body.data.map((item) => item.id), ['prompt-2', 'prompt-1']);
    assert.deepEqual(body.sources, ['Shared_Account', 'greymaker']);
    assert.deepEqual(requestedKeys.sort(), [
        'grok-powertools/v1/users/Shared_Account/metadata/saved-prompts.latest.json',
        'grok-powertools/v1/users/greymaker/metadata/saved-prompts.latest.json',
    ]);
});

test('Vault metadata fails closed when namespace pagination exceeds its safety bound', async () => {
    let listCalls = 0;
    await assert.rejects(
        worker.fetch(
            new Request('https://worker.example/v1/vault/metadata/savedPrompts', {
                headers: { [headerName]: sampleKey },
            }),
            env({
                R2_BUCKET: {
                    list: async () => {
                        listCalls += 1;
                        return {
                            objects: [],
                            delimitedPrefixes: [],
                            truncated: true,
                            cursor: `page-${listCalls + 1}`,
                        };
                    },
                    get: async () => null,
                },
            })
        ),
        /vault_metadata_namespace_limit_exceeded/
    );
    assert.equal(listCalls, 100);
});

test('Vault metadata fails closed when a truncated namespace page omits its cursor', async () => {
    await assert.rejects(
        worker.fetch(
            new Request('https://worker.example/v1/vault/metadata/savedPrompts', {
                headers: { [headerName]: sampleKey },
            }),
            env({
                R2_BUCKET: {
                    list: async () => ({
                        objects: [],
                        delimitedPrefixes: [],
                        truncated: true,
                        cursor: undefined,
                    }),
                    get: async () => null,
                },
            })
        ),
        /vault_metadata_cursor_missing/
    );
});

test('Vault media streams object bytes for server-side proxy', async () => {
    const response = await worker.fetch(
        new Request('https://worker.example/v1/vault/media?assetId=asset-video-1', {
            headers: { [headerName]: sampleKey },
        }),
        env()
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'video/mp4');
});

test('Vault media assetId lookup follows inventory pagination', async () => {
    const objectKey = 'grok-powertools/v1/users/greymaker/media/by-asset/asset-page-2.mp4';
    const listCalls: Array<string | null> = [];
    const response = await worker.fetch(
        new Request('https://worker.example/v1/vault/media?assetId=asset-page-2', {
            headers: { [headerName]: sampleKey },
        }),
        env({
            R2_BUCKET: {
                list: async ({ cursor }: { cursor?: string }) => {
                    listCalls.push(cursor || null);
                    if (!cursor) {
                        return { objects: [], truncated: true, cursor: 'page-2' };
                    }
                    return {
                        objects: [
                            {
                                key: objectKey,
                                size: 2048,
                                etag: 'etag-page-2',
                                uploaded: new Date('2026-06-18T00:00:00.000Z'),
                                httpMetadata: { contentType: 'video/mp4' },
                                customMetadata: { assetId: 'asset-page-2' },
                            },
                        ],
                        truncated: false,
                        cursor: undefined,
                    };
                },
                get: async (key: string) => {
                    assert.equal(key, objectKey);
                    return {
                        body: new ReadableStream({
                            start(controller) {
                                controller.enqueue(new Uint8Array([1, 2, 3]));
                                controller.close();
                            },
                        }),
                        httpMetadata: { contentType: 'video/mp4' },
                    };
                },
            },
        })
    );
    assert.equal(response.status, 200);
    assert.deepEqual(listCalls, [null, 'page-2']);
});

test('Vault media streams exact objectKey without inventory lookup', async () => {
    const objectKey = 'grok-powertools/v1/users/greymaker/media/by-asset/asset-video-1.mp4';
    const response = await worker.fetch(
        new Request(`https://worker.example/v1/vault/media?assetId=asset-video-1&objectKey=${encodeURIComponent(objectKey)}`, {
            headers: { [headerName]: sampleKey },
        }),
        env({
            R2_BUCKET: {
                list: async () => {
                    throw new Error('objectKey media fetch should not list inventory');
                },
                get: async (key: string) => {
                    assert.equal(key, objectKey);
                    return {
                        body: new ReadableStream({
                            start(controller) {
                                controller.enqueue(new Uint8Array([1, 2, 3]));
                                controller.close();
                            },
                        }),
                        httpMetadata: { contentType: 'video/mp4' },
                    };
                },
            },
        })
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'video/mp4');
});

test('Vault media rejects invalid objectKey', async () => {
    const response = await worker.fetch(
        new Request('https://worker.example/v1/vault/media?assetId=asset-video-1&objectKey=../secret.mp4', {
            headers: { [headerName]: sampleKey },
        }),
        env()
    );
    assert.equal(response.status, 400);
});

test('Object HEAD proof is read-only and does not write to D1', async () => {
    const objectKey = 'grok-powertools/v1/users/greymaker/media/by-asset/asset-video-1.mp4';
    const response = await worker.fetch(
        new Request(`https://worker.example/v1/objects/verify?objectKey=${encodeURIComponent(objectKey)}`, {
            method: 'HEAD',
            headers: { [headerName]: sampleKey },
        }),
        env({
            R2_BUCKET: {
                head: async (key: string) => {
                    assert.equal(key, objectKey);
                    return {
                        key,
                        size: 2048,
                        etag: 'etag-1',
                        uploaded: new Date('2026-06-18T00:00:00.000Z'),
                        httpMetadata: { contentType: 'video/mp4' },
                        customMetadata: { contentSha256: 'sha-1' },
                    };
                },
            },
            DB: {
                prepare: (sql: string) => {
                    assert.fail(`Object HEAD proof must not touch D1: ${sql}`);
                },
            },
        })
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'video/mp4');
    assert.equal(response.headers.get('x-r2-size-bytes'), '2048');
    assert.equal(response.headers.get('x-r2-etag'), 'etag-1');
    assert.equal(response.headers.get('x-r2-sha256'), 'sha-1');
});

test('Sync push rejects invalid JWT before vault overlay writes', async () => {
    const writes: string[] = [];
    const response = await worker.fetch(
        new Request('https://worker.example/v1/sync/push', {
            method: 'POST',
            headers: {
                authorization: 'Bearer invalid-token',
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                vaultOverlays: [
                    {
                        assetId: 'asset-image-1',
                        data: JSON.stringify({ assetId: 'asset-image-1', tags: ['keep'] }),
                        updatedAt: '2026-06-18T12:00:00.000Z',
                        deletedAt: null,
                    },
                ],
            }),
        }),
        env({
            SYNC_SECRET: syncSecret,
            DB: {
                prepare: (sql: string) => ({
                    bind: () => ({
                        run: async () => {
                            writes.push(sql);
                        },
                        all: async () => ({ results: [] }),
                        first: async () => null,
                    }),
                }),
            },
        })
    );

    assert.equal(response.status, 401);
    assert.deepEqual(writes, []);
});

test('Sync push writes vault overlays without source-fact writes', async () => {
    const calls: Array<{ sql: string; args: unknown[] }> = [];
    const token = await signSyncJWT();

    const response = await worker.fetch(
        new Request('https://worker.example/v1/sync/push', {
            method: 'POST',
            headers: {
                authorization: `Bearer ${token}`,
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                vaultOverlays: [
                    {
                        assetId: 'asset-image-1',
                        data: JSON.stringify({
                            assetId: 'asset-image-1',
                            tags: ['keep'],
                            hidden: false,
                            favorite: true,
                            updatedAt: '2026-06-18T12:00:00.000Z',
                        }),
                        updatedAt: '2026-06-18T12:00:00.000Z',
                        deletedAt: null,
                    },
                ],
            }),
        }),
        env({
            SYNC_SECRET: syncSecret,
            DB: {
                prepare: (sql: string) => ({
                    bind: (...args: unknown[]) => ({
                        run: async () => {
                            calls.push({ sql, args });
                        },
                        all: async () => ({ results: [] }),
                        first: async () => null,
                    }),
                }),
            },
        })
    );

    assert.equal(response.status, 200);
    assert.equal(calls.some((call) => call.sql.includes('vault_overlays')), true);
    assert.equal(calls.some((call) => call.args.includes('asset-image-1')), true);
    assert.equal(calls.some((call) => call.sql.includes('r2_dedupe_index')), false);
    assert.equal(calls.some((call) => call.sql.includes('metadata_snapshot_index')), false);
});

test('Sync pull returns vault overlays for the authenticated user', async () => {
    const token = await signSyncJWT();

    const response = await worker.fetch(
        new Request('https://worker.example/v1/sync/pull?since=2026-06-18T00%3A00%3A00.000Z', {
            headers: {
                authorization: `Bearer ${token}`,
            },
        }),
        env({
            SYNC_SECRET: syncSecret,
            DB: {
                prepare: (sql: string) => ({
                    bind: () => ({
                        all: async () => ({
                            results: sql.includes('vault_overlays')
                                ? [
                                    {
                                        user_id: 'user-1',
                                        asset_id: 'asset-image-1',
                                        data: JSON.stringify({
                                            assetId: 'asset-image-1',
                                            tags: ['keep'],
                                            hidden: false,
                                            favorite: true,
                                            updatedAt: '2026-06-18T12:00:00.000Z',
                                        }),
                                        updated_at: '2026-06-18T12:00:00.000Z',
                                        deleted_at: null,
                                    },
                                ]
                                : [],
                        }),
                        first: async () => null,
                    }),
                }),
            },
        })
    );

    const body = await response.json() as {
        vaultOverlays: Array<{ assetId: string; data: string; updatedAt: string; deletedAt: string | null }>;
    };
    assert.equal(response.status, 200);
    assert.equal(body.vaultOverlays.length, 1);
    assert.equal(body.vaultOverlays[0].assetId, 'asset-image-1');
    assert.deepEqual(JSON.parse(body.vaultOverlays[0].data), {
        assetId: 'asset-image-1',
        tags: ['keep'],
        hidden: false,
        favorite: true,
        updatedAt: '2026-06-18T12:00:00.000Z',
    });
});
