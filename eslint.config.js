const baseGlobals = {
    chrome: 'readonly',
    console: 'readonly',
    document: 'readonly',
    window: 'readonly',
    setTimeout: 'readonly',
    clearTimeout: 'readonly',
    setInterval: 'readonly',
    clearInterval: 'readonly',
    URL: 'readonly',
    Response: 'readonly',
    fetch: 'readonly',
    Headers: 'readonly',
    Blob: 'readonly',
    FileReader: 'readonly',
    MouseEvent: 'readonly',
    confirm: 'readonly',
    prompt: 'readonly',
    module: 'readonly',
    require: 'readonly',
    __dirname: 'readonly',
    self: 'readonly',
    importScripts: 'readonly'
};

module.exports = [
    {
        files: ['**/*.js'],
        ignores: [
            'node_modules/**',
            'cloud/node_modules/**',
            'playwright-report/**',
            'test-results/**',
            'temp_ref/**'
        ],
        languageOptions: {
            ecmaVersion: 2021,
            sourceType: 'script',
            globals: baseGlobals
        },
        rules: {
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
            'no-console': 'off'
        }
    },
    {
        files: ['tests/**/*.js', 'jest.setup.js', 'playwright.config.js'],
        languageOptions: {
            globals: {
                ...baseGlobals,
                jest: 'readonly',
                test: 'readonly',
                expect: 'readonly',
                describe: 'readonly',
                beforeEach: 'readonly',
                afterEach: 'readonly',
                global: 'readonly'
            }
        }
    }
];
