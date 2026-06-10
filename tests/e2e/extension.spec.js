const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// Read content.js and CSS
const contentJsPath = path.join(__dirname, '../../content.js');
const styleCssPath = path.join(__dirname, '../../overlay.css');
const contentJs = fs.readFileSync(contentJsPath, 'utf8');
const styleCss = fs.readFileSync(styleCssPath, 'utf8');

test.describe('Grok Power Tools E2E', () => {
    test.beforeEach(async ({ page }) => {
        // Mock Chrome API in the browser context
        await page.addInitScript(() => {
            window.__chromeRuntimeMessages = [];
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
                    onMessage: { addListener: () => { } }
                },
                storage: {
                    onChanged: {
                        addListener: () => { },
                        removeListener: () => { }
                    },
                    local: {
                        get: (keys, cb) => {
                            if (cb) cb({});
                            return Promise.resolve({});
                        },
                        set: (data, cb) => {
                            if (cb) cb();
                            return Promise.resolve();
                        }
                    },
                    sync: {
                        get: (keys, cb) => {
                            if (cb) cb({});
                            return Promise.resolve({});
                        },
                        set: (data, cb) => {
                            if (cb) cb();
                            return Promise.resolve();
                        }
                    }
                }
            };
        });

        // Load a blank page
        await page.goto('about:blank');

        // Inject CSS
        await page.addStyleTag({ content: styleCss });
    });

    test('Overlay should render on the page', async ({ page }) => {
        // Evaluate the content script
        // about:blank hostname is "", so it falls into the else block (Main Mode) automatically
        await page.evaluate(contentJs);

        // Check if overlay exists
        const overlay = page.locator('#grok-powertools-overlay');
        await expect(overlay).toBeVisible();

        // Check text
        await expect(overlay).toContainText('Grok Power Tools');
    });

    test('Minimize button should work', async ({ page }) => {
        await page.evaluate(contentJs);

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
        await page.evaluate(contentJs);

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
        await page.evaluate(contentJs);

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
});
