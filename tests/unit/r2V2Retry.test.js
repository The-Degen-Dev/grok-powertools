const { isTransientReadError, withRetries } = require('../../tools/r2-v2/retry');

describe('Grok Gallery v2 read retries', () => {
    test('retries a transient stream failure and returns the successful result', async () => {
        let attempts = 0;
        const value = await withRetries(async () => {
            attempts += 1;
            if (attempts === 1) {
                const error = new Error('socket reset');
                error.code = 'ECONNRESET';
                throw error;
            }
            return 'verified';
        }, { attempts: 3, baseDelayMs: 1 });

        expect(value).toBe('verified');
        expect(attempts).toBe(2);
    });

    test('does not retry deterministic proof failures', async () => {
        let attempts = 0;
        await expect(withRetries(async () => {
            attempts += 1;
            throw new Error('decoder_hash_mismatch');
        }, { attempts: 3, baseDelayMs: 1 })).rejects.toThrow('decoder_hash_mismatch');

        expect(attempts).toBe(1);
        expect(isTransientReadError(new Error('decoder_hash_mismatch'))).toBe(false);
    });
});
