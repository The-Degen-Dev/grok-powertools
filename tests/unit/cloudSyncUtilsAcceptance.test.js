const CloudSync = require('../../cloudSyncUtils.js');

describe('CloudSync acceptance context', () => {
    test('recognizes only an exact normalized acceptance run prefix as acceptance config', () => {
        expect(CloudSync.isAcceptanceCloudConfig({
            keyPrefix: '/acceptance/run-20260609-001/'
        })).toBe(true);
        expect(CloudSync.isAcceptanceCloudConfig({
            keyPrefix: 'acceptance/run-20260609-001/nested'
        })).toBe(false);
        expect(CloudSync.isAcceptanceCloudConfig({
            keyPrefix: 'grok-powertools/v1'
        })).toBe(false);
    });

    test('normalizes a valid acceptance context', () => {
        expect(CloudSync.normalizeAcceptanceContext({
            runId: 'run-20260609-001',
            correlationId: 'corr-1',
            keyPrefix: '/acceptance/run-20260609-001/'
        })).toEqual({
            runId: 'run-20260609-001',
            correlationId: 'corr-1',
            keyPrefix: 'acceptance/run-20260609-001'
        });
    });

    test('rejects production prefixes', () => {
        expect(() => CloudSync.normalizeAcceptanceContext({
            runId: 'run-1',
            correlationId: 'corr-1',
            keyPrefix: 'grok-powertools/v1'
        })).toThrow('acceptance prefix');
    });

    test('builds acceptance headers without credential material', () => {
        const headers = CloudSync.buildAcceptanceHeaders({
            acceptance: {
                runId: 'run-20260609-001',
                correlationId: 'corr-1',
                keyPrefix: 'acceptance/run-20260609-001'
            }
        });

        expect(headers).toEqual({
            'x-acceptance-run-id': 'run-20260609-001',
            'x-acceptance-correlation-id': 'corr-1'
        });
    });

    test('returns empty headers outside acceptance mode', () => {
        expect(CloudSync.buildAcceptanceHeaders({})).toEqual({});
        expect(CloudSync.buildAcceptanceHeaders({ acceptance: null })).toEqual({});
    });
});
