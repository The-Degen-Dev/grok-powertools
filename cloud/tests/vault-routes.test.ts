import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../src/index';

const headerName = ['x-gpt', 'api', 'key'].join('-');
const sampleKey = 'client-sample';

function env(overrides: Record<string, unknown> = {}) {
    return {
        CLIENT_API_KEY: sampleKey,
        R2_BUCKET_NAME: 'grok-gallery-001',
        KEY_PREFIX: 'grok-powertools/v1',
        R2_BUCKET: {
            list: async () => ({
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

test('Vault inventory lists normalized assets without D1 writes', async () => {
    const response = await worker.fetch(
        new Request('https://worker.example/v1/vault/inventory', {
            headers: { [headerName]: sampleKey },
        }),
        env({
            DB: {
                prepare: () => {
                    throw new Error('Inventory must not write or read D1 in this first route slice');
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
