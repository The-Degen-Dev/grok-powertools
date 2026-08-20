const { execFileSync } = require('child_process');
const fs = require('fs');

function packageList() {
    return JSON.parse(
        execFileSync('node', ['tools/package-extension.js', '--list'], { encoding: 'utf8' })
    );
}

describe('release extension package allowlist', () => {
    test('includes every manifest-referenced runtime file', () => {
        const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
        const listed = new Set(packageList().files);

        expect(listed).toContain(manifest.background.service_worker);
        expect(listed).toContain(manifest.action.default_popup);

        for (const resource of manifest.web_accessible_resources.flatMap(
            (entry) => entry.resources
        )) {
            expect(listed).toContain(resource);
        }

        for (const script of manifest.content_scripts.flatMap((entry) => entry.js || [])) {
            expect(listed).toContain(script);
        }

        for (const css of manifest.content_scripts.flatMap((entry) => entry.css || [])) {
            expect(listed).toContain(css);
        }

        expect(listed).toContain('cloudSyncUtils.js');
        expect(listed).toContain('grokImagineAdapter.js');
        expect(listed).toContain('generationRunState.js');
        expect(listed).toContain('generationRunController.js');
        expect(listed).toContain('recreateWorkflowBackground.js');
        expect(listed).toContain('offscreen.html');
        expect(listed).toContain('offscreen.js');
    });

    test('excludes local, test, and secret-bearing paths', () => {
        const listed = packageList().files;

        expect(listed).not.toContain('.git');
        expect(listed).not.toContain('node_modules');
        expect(listed).not.toContain('test-results');
        expect(listed).not.toContain('playwright-report');
        expect(listed).not.toContain('temp_ref');
        expect(listed).not.toContain('acceptance/runs');
        expect(listed).not.toContain('web');
        expect(listed).not.toContain('cloud');
        expect(listed).not.toContain('tests');
        expect(listed).not.toContain('docs');
        expect(listed).not.toContain('README.md');
        expect(listed).not.toContain('RELEASE_POST.md');
        expect(listed).not.toContain('implementation-notes.html');
        expect(listed.some((file) => file.startsWith('.env'))).toBe(false);
        expect(listed.some((file) => file.endsWith('.pem'))).toBe(false);
        expect(listed.some((file) => file.endsWith('.crx'))).toBe(false);
    });
});
