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
            window.chrome = {
                runtime: {
                    sendMessage: () => { },
                    onMessage: { addListener: () => { } }
                },
                storage: {
                    local: {
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
});
