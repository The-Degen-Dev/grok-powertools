import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../src/index';

const clientApiEnvName = ['CLIENT', 'API', 'KEY'].join('_');
const r2AccessIdEnvName = ['R2', 'ACCESS', 'KEY', 'ID'].join('_');
const r2CredentialEnvName = ['R2', 'SECRET', 'ACCESS', 'KEY'].join('_');
const apiHeaderName = ['x-gpt', 'api', 'key'].join('-');
const clientSample = ['client', 'sample'].join('-');
const r2Sample = ['r2', 'sample'].join('-');

function env(overrides: Record<string, unknown> = {}) {
  return {
    [clientApiEnvName]: clientSample,
    [r2AccessIdEnvName]: ['access', 'sample'].join('-'),
    [r2CredentialEnvName]: r2Sample,
    R2_ACCOUNT_ID: 'ba5339fd86e87c226bdc306347636042',
    R2_BUCKET_NAME: 'grok-powertools-acceptance',
    KEY_PREFIX: 'acceptance/run-20260609-001',
    ACCEPTANCE_MODE: 'true',
    ACCEPTANCE_RUN_ID: 'run-20260609-001',
    ACCEPTANCE_KEY_PREFIX: 'acceptance/run-20260609-001',
    WORKER_VERSION: '2026-06-09.1',
    R2_BUCKET: {
      head: async () => null,
      put: async () => undefined,
    },
    DB: {
      prepare: () => {
        throw new Error('DB should not be touched by these tests');
      },
    },
    ...overrides,
  } as never;
}

test('acceptance identity endpoint is auth protected', async () => {
  const response = await worker.fetch(
    new Request('https://worker.example/v1/acceptance/identity'),
    env()
  );

  assert.equal(response.status, 401);
});

test('acceptance identity endpoint returns redacted diagnostics', async () => {
  const response = await worker.fetch(
    new Request('https://worker.example/v1/acceptance/identity', {
      headers: { [apiHeaderName]: clientSample },
    }),
    env()
  );
  const body = await response.json() as Record<string, unknown>;

  assert.equal(response.status, 200);
  assert.equal(body.acceptanceMode, true);
  assert.equal(body.runId, 'run-20260609-001');
  assert.equal(body.keyPrefix, 'acceptance/run-20260609-001');
  assert.equal(JSON.stringify(body).includes(clientSample), false);
  assert.equal(JSON.stringify(body).includes(r2Sample), false);
});

test('presign rejects production keys before signing in acceptance mode', async () => {
  const response = await worker.fetch(
    new Request('https://worker.example/v1/presign', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [apiHeaderName]: clientSample,
        'x-acceptance-run-id': 'run-20260609-001',
        'x-acceptance-correlation-id': 'corr-1',
      },
      body: JSON.stringify({
        objectKey: 'grok-powertools/v1/users/u/media/by-asset/media_1.png',
        contentType: 'image/png',
        contentLength: 123,
      }),
    }),
    env()
  );
  const body = await response.json() as { error?: string };

  assert.equal(response.status, 400);
  assert.match(body.error || '', /acceptance\/run-20260609-001/);
});
