const { test, expect } = require('@playwright/test');
const { Buffer } = require('buffer');
const fs = require('fs');
const path = require('path');

// Read content.js and CSS
const providerRegistryJsPath = path.join(__dirname, '../../providerRegistry.js');
const providerRunLedgerJsPath = path.join(__dirname, '../../providerRunLedger.js');
const chatGptImagesContentJsPath = path.join(__dirname, '../../chatgptImagesContent.js');
const utilsJsPath = path.join(__dirname, '../../recreateWorkflowUtils.js');
const contentActionsJsPath = path.join(__dirname, '../../recreateWorkflowContent.js');
const contentJsPath = path.join(__dirname, '../../content.js');
const styleCssPath = path.join(__dirname, '../../overlay.css');
const providerRegistryJs = fs.readFileSync(providerRegistryJsPath, 'utf8');
const providerRunLedgerJs = fs.readFileSync(providerRunLedgerJsPath, 'utf8');
const chatGptImagesContentJs = fs.readFileSync(chatGptImagesContentJsPath, 'utf8');
const utilsJs = fs.readFileSync(utilsJsPath, 'utf8');
const contentActionsJs = fs.readFileSync(contentActionsJsPath, 'utf8');
const contentJs = fs.readFileSync(contentJsPath, 'utf8');
const styleCss = fs.readFileSync(styleCssPath, 'utf8');
const { MAX_REFERENCE_BYTES } = require('../../recreateWorkflowUtils.js');

async function evaluateExtensionContent(page) {
    await page.evaluate(providerRegistryJs);
    await page.evaluate(providerRunLedgerJs);
    await page.evaluate(chatGptImagesContentJs);
    await page.evaluate(utilsJs);
    await page.evaluate(contentActionsJs);
    await page.evaluate(contentJs);
}

async function evaluateExtensionContentWithMockedRecreateActions(page) {
    await page.evaluate(providerRegistryJs);
    await page.evaluate(providerRunLedgerJs);
    await page.evaluate(chatGptImagesContentJs);
    await page.evaluate(utilsJs);
    await page.evaluate(contentActionsJs);
    await page.evaluate(() => {
        window.__recreateCalls = [];
        window.GrokRecreateContentActions = {
            readFileAsRecreateReference: async (file, source) => {
                window.__recreateCalls.push({
                    action: 'file',
                    name: file.name,
                    source
                });
                return {
                    name: file.name,
                    mimeType: file.type,
                    dataUrl: 'data:image/png;base64,aGVsbG8=',
                    source,
                    byteLength: file.size
                };
            },
            selectCurrentGeneratedImage: async () => {
                window.__recreateCalls.push({ action: 'current' });
                return {
                    name: 'current-grok-image.png',
                    mimeType: 'image/png',
                    dataUrl: 'data:image/png;base64,aGVsbG8=',
                    source: 'current-grok-image',
                    byteLength: 5
                };
            },
            runChatPromptStep: async (request) => {
                window.__recreateCalls.push({
                    action: 'chat',
                    runId: request.runId,
                    hasReference: !!request.reference
                });
                return {
                    ok: true,
                    runId: request.runId,
                    generatedPrompt: 'Mock generated Imagine prompt'
                };
            },
            runImagineSubmitStep: async (request) => {
                window.__recreateCalls.push({
                    action: 'imagine',
                    runId: request.runId,
                    generatedPrompt: request.generatedPrompt
                });
                return {
                    ok: true,
                    runId: request.runId,
                    submitted: true
                };
            }
        };
    });
    await page.evaluate(contentJs);
}

async function gotoMockProviderPage(page, url) {
    await page.goto(url);
    await page.addStyleTag({ content: styleCss });
}

async function dispatchRuntimeMessage(page, message) {
    return page.evaluate(async (runtimeMessage) => {
        const responses = [];
        const listeners = window.__chromeMessageListeners || [];

        for (const listener of listeners) {
            let responded = false;
            let responseValue;
            const sendResponse = (value) => {
                responded = true;
                responseValue = value;
            };
            const result = listener(runtimeMessage, { tab: { id: 1, url: window.location.href } }, sendResponse);

            if (result === true) {
                for (let attempt = 0; attempt < 20 && !responded; attempt++) {
                    await new Promise((resolve) => setTimeout(resolve, 0));
                }
            }

            if (responded) responses.push(responseValue);
        }

        return responses;
    }, message);
}

test.describe('Grok Power Tools E2E', () => {
    test.beforeEach(async ({ page }) => {
        // Mock Chrome API in the browser context
        await page.addInitScript(() => {
            const localState = {};
            const syncState = {};
            const readStorage = (state, keys) => {
                if (keys === null || typeof keys === 'undefined') return { ...state };
                if (Array.isArray(keys)) {
                    return keys.reduce((acc, key) => {
                        acc[key] = state[key];
                        return acc;
                    }, {});
                }
                if (typeof keys === 'string') return { [keys]: state[keys] };
                if (typeof keys === 'object') {
                    return Object.keys(keys).reduce((acc, key) => {
                        acc[key] = Object.prototype.hasOwnProperty.call(state, key) ? state[key] : keys[key];
                        return acc;
                    }, {});
                }
                return {};
            };
            window.__chromeRuntimeMessages = [];
            window.__chromeMessageListeners = [];
            window.__chromeStorageLocalState = localState;
            window.__chromeStorageSyncState = syncState;
            window.chrome = {
                runtime: {
                    getURL: (resourcePath) => resourcePath,
                    sendMessage: (message, callback) => {
                        window.__chromeRuntimeMessages.push(message);
                        if (message?.action === 'VALIDATE_CLOUD_CONFIG' && callback) {
                            callback({ valid: true });
                        }
                        return Promise.resolve({ ok: true });
                    },
                    onMessage: {
                        addListener: (listener) => {
                            window.__chromeMessageListeners.push(listener);
                        }
                    }
                },
                storage: {
                    onChanged: {
                        addListener: () => { },
                        removeListener: () => { }
                    },
                    local: {
                        get: (keys, cb) => {
                            const result = readStorage(localState, keys);
                            if (cb) cb(result);
                            return Promise.resolve(result);
                        },
                        set: (data, cb) => {
                            Object.assign(localState, data || {});
                            if (cb) cb();
                            return Promise.resolve();
                        }
                    },
                    sync: {
                        get: (keys, cb) => {
                            const result = readStorage(syncState, keys);
                            if (cb) cb(result);
                            return Promise.resolve(result);
                        },
                        set: (data, cb) => {
                            Object.assign(syncState, data || {});
                            if (cb) cb();
                            return Promise.resolve();
                        }
                    }
                }
            };
        });

        await page.route('**/*', (route) => route.fulfill({
            status: 200,
            contentType: 'text/html',
            body: '<!doctype html><html><head><title>Mock Provider</title></head><body></body></html>'
        }));

        await gotoMockProviderPage(page, 'https://grok.com/imagine/favorites');
    });

    test('Overlay should render on the page', async ({ page }) => {
        // Evaluate the content scripts
        await evaluateExtensionContent(page);

        // Check if overlay exists
        const overlay = page.locator('#grok-powertools-overlay');
        await expect(overlay).toBeVisible();

        // Check text
        await expect(overlay).toContainText('Grok Power Tools');
    });

    test('Minimize button should work', async ({ page }) => {
        await evaluateExtensionContent(page);

        const overlay = page.locator('#grok-powertools-overlay');
        const minBtn = page.locator('#gptMinBtn');

        // Initial state: not minimized
        await expect(overlay).not.toHaveClass(/minimized/);

        // Click minimize
        await minBtn.click();

        // Should be minimized
        await expect(overlay).toHaveClass(/minimized/);

        // Click to restore (the whole overlay)
        await overlay.click();

        // Should be restored
        await expect(overlay).not.toHaveClass(/minimized/);
    });

    test('Page-origin full R2 backup command should fail closed', async ({ page }) => {
        await evaluateExtensionContent(page);

        await page.evaluate(() => {
            document.dispatchEvent(new CustomEvent('grok-powertools-command', {
                detail: { action: 'INIT_R2_BACKUP', mode: 'full' }
            }));
        });
        await page.waitForTimeout(50);

        const runtimeMessages = await page.evaluate(() => window.__chromeRuntimeMessages);
        expect(runtimeMessages).not.toContainEqual({ action: 'VALIDATE_CLOUD_CONFIG' });
    });

    test('Page-origin R2 canary command is bounded and carries acceptance metadata', async ({ page }) => {
        await evaluateExtensionContent(page);

        await page.evaluate(() => {
            document.dispatchEvent(new CustomEvent('grok-powertools-command', {
                detail: {
                    action: 'INIT_R2_CANARY',
                    runId: 'run-20260609-001',
                    correlationId: 'corr-1',
                    keyPrefix: 'acceptance/run-20260609-001'
                }
            }));
        });
        await page.waitForTimeout(50);

        const runtimeMessages = await page.evaluate(() => window.__chromeRuntimeMessages);
        expect(runtimeMessages).toContainEqual(expect.objectContaining({
            action: 'VALIDATE_CLOUD_CONFIG'
        }));
    });

    test('Provider and recreate helper globals should be available before content script', async ({ page }) => {
        await page.evaluate(providerRegistryJs);
        await page.evaluate(providerRunLedgerJs);
        await page.evaluate(chatGptImagesContentJs);
        await page.evaluate(utilsJs);
        await page.evaluate(contentActionsJs);

        const globals = await page.evaluate(() => ({
            hasProviderRegistry: !!window.GrokPowerToolsProviderRegistry,
            hasProviderRunLedger: !!window.GrokPowerToolsProviderRunLedger,
            hasChatGptImagesActions: !!window.ChatGPTImagesContentActions,
            hasUtils: !!window.GrokRecreateWorkflowUtils,
            hasContentActions: !!window.GrokRecreateContentActions
        }));

        expect(globals).toEqual({
            hasProviderRegistry: true,
            hasProviderRunLedger: true,
            hasChatGptImagesActions: true,
            hasUtils: true,
            hasContentActions: true
        });
    });

    test('ChatGPT Images overlay should submit a current-run image and write provider history', async ({ page }) => {
        await gotoMockProviderPage(page, 'https://chatgpt.com/images/');
        await page.evaluate(() => {
            const existing = document.createElement('img');
            existing.src = 'https://cdn.example.com/existing-gallery.png';
            existing.alt = 'existing gallery image';
            Object.defineProperty(existing, 'naturalWidth', { configurable: true, value: 1024 });
            Object.defineProperty(existing, 'naturalHeight', { configurable: true, value: 1024 });
            existing.getBoundingClientRect = () => ({ left: 20, top: 240, width: 320, height: 320 });
            document.body.appendChild(existing);

            const input = document.createElement('textarea');
            input.name = 'prompt-textarea';
            input.placeholder = 'Describe a new image';
            document.body.appendChild(input);

            const send = document.createElement('button');
            send.dataset.testid = 'send-button';
            send.setAttribute('aria-label', 'Send prompt');
            send.textContent = 'Send prompt';
            send.getBoundingClientRect = () => ({ left: 20, top: 20, width: 120, height: 40 });
            send.addEventListener('click', () => {
                const generated = document.createElement('img');
                generated.src = 'https://cdn.example.com/gpt-img-provider-001.png';
                generated.alt = 'generated canary image';
                Object.defineProperty(generated, 'naturalWidth', { configurable: true, value: 1024 });
                Object.defineProperty(generated, 'naturalHeight', { configurable: true, value: 1024 });
                generated.getBoundingClientRect = () => ({ left: 20, top: 90, width: 320, height: 320 });
                document.body.appendChild(generated);
            });
            document.body.appendChild(send);
        });

        await evaluateExtensionContent(page);

        const overlay = page.locator('#grok-powertools-overlay');
        await expect(overlay).toBeVisible();
        await expect(page.locator('#gptProviderLabel')).toHaveText('Provider: ChatGPT Images');
        await expect(page.locator('#gptChatGptImageSection')).toBeVisible();
        await expect(page.locator('#gptRecreateSection')).toBeHidden();
        await expect(page.locator('#gptAutoRetrySection')).toBeHidden();

        await page.locator('#gptChatGptPrompt').fill('GPT-IMG-PROVIDER-001 harmless blue glass cube');
        await page.locator('#gptChatGptGenerateBtn').click();
        await expect(page.locator('#gptChatGptStatus')).toHaveText('Generated image ready');

        const storageState = await page.evaluate(() => window.__chromeStorageLocalState);
        expect(storageState.providerRunHistory[0]).toEqual(expect.objectContaining({
            providerId: 'chatgpt-images',
            workflow: 'text-to-image',
            prompt: 'GPT-IMG-PROVIDER-001 harmless blue glass cube',
            status: 'generated',
            resultMediaUrl: 'https://cdn.example.com/gpt-img-provider-001.png'
        }));
        expect(storageState.providerRunHistory[0].resultMediaUrl).not.toBe('https://cdn.example.com/existing-gallery.png');
    });

    test('Recreate content bridge should handle status messages', async ({ page }) => {
        await evaluateExtensionContentWithMockedRecreateActions(page);

        const listenerCount = await page.evaluate(() => window.__chromeMessageListeners.length);
        const responses = await dispatchRuntimeMessage(page, {
            action: 'GPT_RECREATE_STATUS',
            runId: 'run-status',
            phase: 'chat',
            message: 'Chat step ready',
            type: 'success'
        });

        expect(listenerCount).toBeGreaterThan(0);
        expect(responses).toContainEqual({ ok: true, runId: 'run-status' });
        await expect(page.locator('#gptRecreateStatus')).toHaveText('chat: Chat step ready');
    });

    test('Recreate Image controls should render', async ({ page }) => {
        await evaluateExtensionContent(page);

        const overlay = page.locator('#grok-powertools-overlay');
        await expect(overlay).toContainText('Recreate Media');
        await expect(overlay).toContainText('Drop, paste, choose image/video/GIF, or use current Grok image');
        await expect(page.locator('#gptRecreateFileInput')).toHaveCount(1);
        await expect(page.locator('#gptRecreateFileInput')).toHaveAttribute('accept', /image\/png/);
        await expect(page.locator('#gptRecreateFileInput')).toHaveAttribute('accept', /video\/mp4/);
        await expect(page.locator('#gptRecreateChooseBtn')).toBeVisible();
        await expect(page.locator('#gptRecreateCurrentBtn')).toBeVisible();
        await expect(page.locator('#gptRecreateBestPractices')).not.toBeChecked();
        await expect(page.locator('#gptRecreateStartBtn')).toBeVisible();
        await expect(page.locator('#gptRecreateStopBtn')).toBeHidden();
        await expect(page.locator('#gptRecreateStatus')).toHaveText('No reference selected.');
    });

    test('Recreate Image controls should start from mocked local file selection', async ({ page }) => {
        await evaluateExtensionContentWithMockedRecreateActions(page);

        await page.locator('#gptRecreateFileInput').setInputFiles({
            name: 'sample.png',
            mimeType: 'image/png',
            buffer: Buffer.from('sample-image')
        });
        await expect(page.locator('#gptRecreateStatus')).toContainText('sample.png');

        await page.locator('#gptRecreateStartBtn').click();
        await expect(page.locator('#gptRecreateStatus')).toHaveText('Generated image ready.');

        const runtimeMessages = await page.evaluate(() => window.__chromeRuntimeMessages);
        expect(runtimeMessages).toContainEqual(expect.objectContaining({
            action: 'START_GPT_RECREATE',
            bestPracticesEnabled: false,
            reference: expect.objectContaining({
                name: 'sample.png',
                source: 'local'
            })
        }));

        const calls = await page.evaluate(() => window.__recreateCalls);
        expect(calls).toContainEqual({
            action: 'file',
            name: 'sample.png',
            source: 'local'
        });
    });

    test('Recreate Image controls should send explicit Grok Search opt-in', async ({ page }) => {
        await evaluateExtensionContentWithMockedRecreateActions(page);

        await page.locator('#gptRecreateFileInput').setInputFiles({
            name: 'sample.png',
            mimeType: 'image/png',
            buffer: Buffer.from('sample-image')
        });
        await page.locator('#gptRecreateSection .gpt-toggle-switch').click();
        await expect(page.locator('#gptRecreateBestPractices')).toBeChecked();

        await page.locator('#gptRecreateStartBtn').click();
        await expect(page.locator('#gptRecreateStatus')).toHaveText('Generated image ready.');

        const runtimeMessages = await page.evaluate(() => window.__chromeRuntimeMessages);
        expect(runtimeMessages).toContainEqual(expect.objectContaining({
            action: 'START_GPT_RECREATE',
            bestPracticesEnabled: true,
            reference: expect.objectContaining({
                name: 'sample.png',
                source: 'local'
            })
        }));
    });

    test('Recreate Image controls should reject oversized files before reading', async ({ page }) => {
        await evaluateExtensionContentWithMockedRecreateActions(page);

        await page.locator('#gptRecreateFileInput').setInputFiles({
            name: 'oversized.png',
            mimeType: 'image/png',
            buffer: Buffer.alloc(MAX_REFERENCE_BYTES + 1)
        });

        await expect(page.locator('#gptRecreateStatus')).toHaveText('reference_invalid');
        const calls = await page.evaluate(() => window.__recreateCalls);
        expect(calls).toEqual([]);
    });

    test('Recreate Image controls should clear prior reference after invalid reselection', async ({ page }) => {
        await evaluateExtensionContentWithMockedRecreateActions(page);

        await page.locator('#gptRecreateFileInput').setInputFiles({
            name: 'sample.png',
            mimeType: 'image/png',
            buffer: Buffer.from('sample-image')
        });
        await expect(page.locator('#gptRecreateStatus')).toContainText('sample.png');

        await page.locator('#gptRecreateFileInput').setInputFiles({
            name: 'oversized.png',
            mimeType: 'image/png',
            buffer: Buffer.alloc(MAX_REFERENCE_BYTES + 1)
        });
        await expect(page.locator('#gptRecreateStatus')).toHaveText('reference_invalid');

        await page.locator('#gptRecreateStartBtn').click();
        await expect(page.locator('#gptRecreateStatus')).toHaveText('Select a reference media file first.');

        const runtimeMessages = await page.evaluate(() => window.__chromeRuntimeMessages);
        expect(runtimeMessages).not.toContainEqual(expect.objectContaining({
            action: 'START_GPT_RECREATE'
        }));
    });

    test('Recreate Image paste should only apply inside recreate controls', async ({ page }) => {
        await evaluateExtensionContentWithMockedRecreateActions(page);

        await page.evaluate(() => {
            const file = new File(['paste-image'], 'paste.png', { type: 'image/png' });
            const event = new Event('paste', { bubbles: true, cancelable: true });
            Object.defineProperty(event, 'clipboardData', {
                value: {
                    items: [{ type: 'image/png', getAsFile: () => file }]
                }
            });
            document.body.dispatchEvent(event);
        });
        await expect(page.locator('#gptRecreateStatus')).toHaveText('No reference selected.');

        await page.locator('#gptRecreateDropzone').click();
        await page.evaluate(() => {
            const file = new File(['paste-image'], 'paste.png', { type: 'image/png' });
            const event = new Event('paste', { bubbles: true, cancelable: true });
            Object.defineProperty(event, 'clipboardData', {
                value: {
                    items: [{ type: 'image/png', getAsFile: () => file }]
                }
            });
            document.getElementById('gptRecreateDropzone').dispatchEvent(event);
        });

        await expect(page.locator('#gptRecreateStatus')).toContainText('paste.png');
        const calls = await page.evaluate(() => window.__recreateCalls);
        expect(calls).toEqual([
            { action: 'file', name: 'paste.png', source: 'paste' }
        ]);
    });

    test('Recreate Image stop should wait for pending start to settle', async ({ page }) => {
        await evaluateExtensionContentWithMockedRecreateActions(page);

        await page.locator('#gptRecreateFileInput').setInputFiles({
            name: 'sample.png',
            mimeType: 'image/png',
            buffer: Buffer.from('sample-image')
        });
        await page.evaluate(() => {
            window.__resolveRecreateStart = null;
            window.chrome.runtime.sendMessage = (message) => {
                window.__chromeRuntimeMessages.push(message);
                if (message?.action === 'START_GPT_RECREATE') {
                    return new Promise((resolve) => {
                        window.__resolveRecreateStart = resolve;
                    });
                }
                if (message?.action === 'ABORT_GPT_RECREATE') {
                    return Promise.resolve({ ok: true });
                }
                return Promise.resolve({ ok: true });
            };
        });

        await page.locator('#gptRecreateStartBtn').click();
        await expect(page.locator('#gptRecreateStartBtn')).toBeHidden();
        await expect(page.locator('#gptRecreateStopBtn')).toBeVisible();

        await page.locator('#gptRecreateStopBtn').click();
        await expect(page.locator('#gptRecreateStatus')).toHaveText('Stopping...');
        await expect(page.locator('#gptRecreateStartBtn')).toBeHidden();
        await expect(page.locator('#gptRecreateStopBtn')).toBeDisabled();

        await page.evaluate(() => {
            window.__resolveRecreateStart({ ok: false, error: 'workflow_aborted' });
        });
        await expect(page.locator('#gptRecreateStatus')).toHaveText('Stopped.');
        await expect(page.locator('#gptRecreateStartBtn')).toBeVisible();
        await expect(page.locator('#gptRecreateStopBtn')).toBeHidden();
    });

    test('Recreate content bridge should dispatch mocked chat and imagine actions', async ({ page }) => {
        await evaluateExtensionContentWithMockedRecreateActions(page);

        const chatResponses = await dispatchRuntimeMessage(page, {
            action: 'GPT_RECREATE_CHAT_STEP',
            runId: 'run-actions',
            reference: {
                name: 'sample.png',
                mimeType: 'image/png',
                dataUrl: 'data:image/png;base64,aGVsbG8=',
                source: 'local'
            },
            bestPracticesEnabled: false
        });
        const imagineResponses = await dispatchRuntimeMessage(page, {
            action: 'GPT_RECREATE_IMAGINE_STEP',
            runId: 'run-actions',
            generatedPrompt: 'Mock generated Imagine prompt',
            autoSubmit: true
        });
        const calls = await page.evaluate(() => window.__recreateCalls);

        expect(chatResponses).toContainEqual({
            ok: true,
            runId: 'run-actions',
            generatedPrompt: 'Mock generated Imagine prompt'
        });
        expect(imagineResponses).toContainEqual({
            ok: true,
            runId: 'run-actions',
            submitted: true
        });
        expect(calls).toEqual([
            { action: 'chat', runId: 'run-actions', hasReference: true },
            { action: 'imagine', runId: 'run-actions', generatedPrompt: 'Mock generated Imagine prompt' }
        ]);
        await expect(page.locator('#gptHistoryList')).toContainText('Mock generated Imagine prompt');
    });
});
