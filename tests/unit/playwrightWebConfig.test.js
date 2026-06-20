const fs = require('fs');

describe('web Playwright config', () => {
    test('uses an isolated web server instead of reusing port 3001', () => {
        const config = fs.readFileSync('playwright.web.config.js', 'utf8');

        expect(config).toContain('const webPort = 43118;');
        expect(config).toContain('WORKER_URL=http://127.0.0.1:${workerPort} WORKER_API_KEY=client-sample CLIENT_API_KEY=client-sample');
        expect(config).toContain('reuseExistingServer: false');
        expect(config).not.toContain('const webPort = 3001;');
    });
});
