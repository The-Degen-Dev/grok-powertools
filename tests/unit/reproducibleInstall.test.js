const fs = require('fs');
const { execSync } = require('child_process');

function trackedFiles() {
    return execSync('git ls-files package-lock.json web/package-lock.json cloud/package-lock.json', {
        encoding: 'utf8'
    })
        .split('\n')
        .filter(Boolean);
}

function ignoredLockfiles() {
    try {
        return execSync('git check-ignore --no-index package-lock.json web/package-lock.json cloud/package-lock.json', {
            encoding: 'utf8'
        })
            .split('\n')
            .filter(Boolean);
    } catch (error) {
        if (error.status === 1) {
            return [];
        }

        throw error;
    }
}

describe('reproducible npm installs', () => {
    test('root, web, and cloud lockfiles are tracked', () => {
        expect(trackedFiles().sort()).toEqual([
            'cloud/package-lock.json',
            'package-lock.json',
            'web/package-lock.json'
        ]);
    });

    test('root gitignore does not ignore npm package lockfiles', () => {
        expect(ignoredLockfiles()).toEqual([]);
    });

    test('all package lockfiles parse as npm lockfile v3', () => {
        for (const file of ['package-lock.json', 'web/package-lock.json', 'cloud/package-lock.json']) {
            const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
            expect(parsed.lockfileVersion).toBe(3);
            expect(parsed.packages).toBeTruthy();
            expect(Object.keys(parsed.packages).length).toBeGreaterThan(0);
        }
    });
});
