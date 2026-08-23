#!/usr/bin/env node
const { spawnSync } = require('child_process');
const { createHash } = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'manifest.json'), 'utf8'));
const packageName = `grok-power-tools-v${manifest.version}.zip`;

const EXTENSION_PACKAGE_FILES = [
    'manifest.json',
    'background.js',
    'bridge.js',
    'cloudSyncUtils.js',
    'content.js',
    'offscreen.html',
    'offscreen.js',
    'overlay.css',
    'popup.css',
    'popup.html',
    'popup.js',
    'providerRegistry.js',
    'providerRunLedger.js',
    'chatgptImagesContent.js',
    'grokImagineAdapter.js',
    'generationRunState.js',
    'generationRunController.js',
    'recreateWorkflowBackground.js',
    'recreateWorkflowContent.js',
    'recreateWorkflowUtils.js',
];

const FORBIDDEN_PATH_PATTERNS = [
    /^\.git(?:\/|$)/,
    /^node_modules(?:\/|$)/,
    /^test-results(?:\/|$)/,
    /^playwright-report(?:\/|$)/,
    /^temp_ref(?:\/|$)/,
    /^acceptance\/runs(?:\/|$)/,
    /^cloud\/\.tmp-test(?:\/|$)/,
    /^\.env/,
    /\.pem$/,
    /\.crx$/,
];

function parseArgs(argv) {
    const options = {
        list: false,
        out: path.join(os.tmpdir(), packageName),
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--list') {
            options.list = true;
        } else if (arg === '--out') {
            const value = argv[index + 1];
            if (!value) throw new Error('--out requires a path');
            options.out = path.resolve(value);
            index += 1;
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }

    return options;
}

function validatePackageFiles(files) {
    for (const file of files) {
        if (path.isAbsolute(file) || file.includes('..')) {
            throw new Error(`Package path must be relative and contained: ${file}`);
        }
        if (FORBIDDEN_PATH_PATTERNS.some((pattern) => pattern.test(file))) {
            throw new Error(`Forbidden package path: ${file}`);
        }
        const absolute = path.join(repoRoot, file);
        if (!fs.existsSync(absolute)) throw new Error(`Missing package file: ${file}`);
        if (!fs.statSync(absolute).isFile()) {
            throw new Error(`Package entry is not a file: ${file}`);
        }
    }
}

function copyPackageFiles(files, stagingDir) {
    for (const file of files) {
        const source = path.join(repoRoot, file);
        const destination = path.join(stagingDir, file);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(source, destination);
    }
}

function sha256(filePath) {
    return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function ensureZipAvailable() {
    const result = spawnSync('zip', ['-v'], { encoding: 'utf8' });
    if (result.status !== 0) {
        throw new Error('zip command is required to build the extension package');
    }
}

function buildZip(outPath) {
    ensureZipAvailable();
    validatePackageFiles(EXTENSION_PACKAGE_FILES);

    const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-power-tools-package-'));
    try {
        copyPackageFiles(EXTENSION_PACKAGE_FILES, stagingDir);
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        if (fs.existsSync(outPath)) fs.unlinkSync(outPath);

        const result = spawnSync('zip', ['-X', '-r', outPath, ...EXTENSION_PACKAGE_FILES], {
            cwd: stagingDir,
            encoding: 'utf8',
        });

        if (result.status !== 0) {
            throw new Error(`zip failed: ${(result.stderr || result.stdout || '').trim()}`);
        }

        return {
            artifact: outPath,
            sha256: sha256(outPath),
            files: EXTENSION_PACKAGE_FILES,
        };
    } finally {
        fs.rmSync(stagingDir, { recursive: true, force: true });
    }
}

function run(argv = process.argv.slice(2)) {
    const options = parseArgs(argv);
    validatePackageFiles(EXTENSION_PACKAGE_FILES);

    if (options.list) {
        console.log(
            JSON.stringify({ version: manifest.version, files: EXTENSION_PACKAGE_FILES }, null, 2)
        );
    } else {
        console.log(JSON.stringify(buildZip(options.out), null, 2));
    }
}

if (require.main === module) {
    run();
}

module.exports = {
    EXTENSION_PACKAGE_FILES,
    FORBIDDEN_PATH_PATTERNS,
    buildZip,
    validatePackageFiles,
};
