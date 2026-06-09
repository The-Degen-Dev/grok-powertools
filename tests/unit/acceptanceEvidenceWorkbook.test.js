const {
    buildEvidenceWorkbook,
    renderEvidenceHtml
} = require('../../acceptance/lib/evidence-workbook.js');

describe('acceptance evidence workbook', () => {
    test('orders events and redacts unsafe fields', () => {
        const signedParam = ['X-Amz', 'Signature'].join('-');
        const sensitiveValue = ['sec', 'ret'].join('');
        const workbook = buildEvidenceWorkbook({
            runId: 'run-20260609-001',
            verdict: 'verified',
            manifest: { cloud: { keyPrefix: 'acceptance/run-20260609-001' } },
            events: [
                { id: '2', at: '2026-06-09T10:01:00.000Z', type: 'upload', payload: { uploadUrl: `https://x?${signedParam}=abc` } },
                { id: '1', at: '2026-06-09T10:00:00.000Z', type: 'preflight', payload: { apiKey: sensitiveValue } }
            ],
            rows: [
                {
                    id: 'row-1',
                    status: 'verified',
                    assetId: 'media_1',
                    mediaType: 'image',
                    r2ObjectKey: 'acceptance/run-20260609-001/users/u/media/by-asset/media_1.png'
                }
            ]
        });

        expect(workbook.events.map((event) => event.id)).toEqual(['1', '2']);
        expect(JSON.stringify(workbook)).not.toContain(sensitiveValue);
        expect(JSON.stringify(workbook)).not.toContain(signedParam);
    });

    test('renders a small HTML review artifact', () => {
        const html = renderEvidenceHtml({
            schemaVersion: 1,
            runId: 'run-20260609-001',
            verdict: 'blocked',
            generatedAt: '2026-06-09T10:00:00.000Z',
            manifest: {},
            events: [],
            rows: []
        });

        expect(html).toContain('<title>Live Acceptance Evidence run-20260609-001</title>');
        expect(html).toContain('blocked');
    });
});
