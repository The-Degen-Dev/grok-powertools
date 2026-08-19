const TRANSIENT_CODES = new Set([
    'ECONNRESET',
    'EPIPE',
    'ETIMEDOUT',
    'EAI_AGAIN',
    'ENETDOWN',
    'ENETRESET',
    'ENETUNREACH',
    'RequestTimeout',
    'SlowDown',
    'Throttling',
    'TimeoutError'
]);

function isTransientReadError(error) {
    if (error?.$retryable) return true;
    if (TRANSIENT_CODES.has(error?.code) || TRANSIENT_CODES.has(error?.name)) return true;
    return /socket hang up|connection reset|network error|timed out/i.test(String(error?.message || ''));
}

async function withRetries(operation, options = {}) {
    const attempts = Number(options.attempts) || 3;
    const baseDelayMs = Number(options.baseDelayMs) || 250;
    const shouldRetry = options.shouldRetry || isTransientReadError;
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            return await operation(attempt);
        } catch (error) {
            lastError = error;
            if (attempt >= attempts || !shouldRetry(error)) throw error;
            await new Promise((resolve) => setTimeout(resolve, baseDelayMs * (2 ** (attempt - 1))));
        }
    }
    throw lastError;
}

module.exports = {
    isTransientReadError,
    withRetries
};
