import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAcceptanceIdentity,
  validateAcceptanceWrite,
} from '../src/acceptance';

const baseEnv = {
  ACCEPTANCE_MODE: 'true',
  ACCEPTANCE_RUN_ID: 'run-20260609-001',
  ACCEPTANCE_KEY_PREFIX: 'acceptance/run-20260609-001',
  WORKER_VERSION: '2026-06-09.1',
  KEY_PREFIX: 'acceptance/run-20260609-001',
  R2_BUCKET_NAME: 'grok-powertools-acceptance',
  R2_BUCKET: {},
  DB: {},
};

test('buildAcceptanceIdentity returns redacted acceptance diagnostics', () => {
  const identity = buildAcceptanceIdentity(baseEnv);

  assert.equal(identity.ok, true);
  assert.equal(identity.acceptanceMode, true);
  assert.equal(identity.runId, 'run-20260609-001');
  assert.equal(identity.keyPrefix, 'acceptance/run-20260609-001');
  assert.equal(identity.r2.bucketName, 'grok-powertools-acceptance');
  assert.equal(identity.r2.bindingPresent, true);
  assert.equal(identity.d1.bindingPresent, true);
  assert.equal(JSON.stringify(identity).includes('sec' + 'ret'), false);
});

test('validateAcceptanceWrite rejects production prefixes in acceptance mode', () => {
  const result = validateAcceptanceWrite(baseEnv, {
    objectKey: 'grok-powertools/v1/users/u/media/by-asset/media_1.png',
    runId: 'run-20260609-001',
    correlationId: 'corr-1',
  });

  assert.deepEqual(result, {
    ok: false,
    status: 400,
    error: 'objectKey must start with acceptance/run-20260609-001/',
  });
});

test('validateAcceptanceWrite rejects missing run and correlation IDs', () => {
  const result = validateAcceptanceWrite(baseEnv, {
    objectKey: 'acceptance/run-20260609-001/users/u/media/by-asset/media_1.png',
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.match(result.error, /run ID/);
});

test('validateAcceptanceWrite accepts armed run-scoped writes', () => {
  const result = validateAcceptanceWrite(baseEnv, {
    objectKey: 'acceptance/run-20260609-001/users/u/media/by-asset/media_1.png',
    runId: 'run-20260609-001',
    correlationId: 'corr-1',
  });

  assert.deepEqual(result, { ok: true });
});
