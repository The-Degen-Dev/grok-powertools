type AcceptanceEnv = {
  ACCEPTANCE_MODE?: string;
  ACCEPTANCE_RUN_ID?: string;
  ACCEPTANCE_KEY_PREFIX?: string;
  ACCEPTANCE_KILL_SWITCH?: string;
  WORKER_VERSION?: string;
  KEY_PREFIX?: string;
  R2_BUCKET_NAME?: string;
  R2_BUCKET?: unknown;
  DB?: unknown;
};

type AcceptanceWriteRequest = {
  objectKey: string;
  runId?: string | null;
  correlationId?: string | null;
};

type AcceptanceWriteResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

function cleanPrefix(value: string | undefined): string {
  return String(value || '').trim().replace(/^\/+|\/+$/g, '');
}

export function isAcceptanceMode(env: AcceptanceEnv): boolean {
  return env.ACCEPTANCE_MODE === 'true';
}

export function acceptanceKeyPrefix(env: AcceptanceEnv): string {
  return cleanPrefix(env.ACCEPTANCE_KEY_PREFIX || env.KEY_PREFIX);
}

export function buildAcceptanceIdentity(env: AcceptanceEnv) {
  return {
    ok: true,
    service: 'grok-r2-backup',
    acceptanceMode: isAcceptanceMode(env),
    workerVersion: env.WORKER_VERSION || 'unknown',
    runId: env.ACCEPTANCE_RUN_ID || null,
    keyPrefix: acceptanceKeyPrefix(env),
    killSwitchActive: env.ACCEPTANCE_KILL_SWITCH === 'true',
    r2: {
      bucketName: env.R2_BUCKET_NAME || null,
      bindingPresent: !!env.R2_BUCKET,
    },
    d1: {
      bindingPresent: !!env.DB,
    },
    refusalRules: {
      requiresRunId: true,
      requiresCorrelationId: true,
      rejectsProductionPrefix: true,
      rejectsDefaultPrefixFallback: true,
    },
  };
}

export function validateAcceptanceWrite(
  env: AcceptanceEnv,
  request: AcceptanceWriteRequest
): AcceptanceWriteResult {
  if (!isAcceptanceMode(env)) return { ok: true };

  if (env.ACCEPTANCE_KILL_SWITCH === 'true') {
    return { ok: false, status: 423, error: 'acceptance run is quarantined' };
  }

  const expectedRunId = String(env.ACCEPTANCE_RUN_ID || '').trim();
  const expectedPrefix = acceptanceKeyPrefix(env);

  if (!expectedRunId || !expectedPrefix) {
    return { ok: false, status: 500, error: 'acceptance run is not configured' };
  }

  if (request.runId !== expectedRunId) {
    return { ok: false, status: 400, error: 'acceptance run ID is required' };
  }

  if (!request.correlationId) {
    return { ok: false, status: 400, error: 'acceptance correlation ID is required' };
  }

  if (!request.objectKey.startsWith(`${expectedPrefix}/`)) {
    return { ok: false, status: 400, error: `objectKey must start with ${expectedPrefix}/` };
  }

  return { ok: true };
}
