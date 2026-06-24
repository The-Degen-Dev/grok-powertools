const utils = require('../../recreateWorkflowUtils.js');
const { createRecreateWorkflowController } = require('../../recreateWorkflowBackground.js');

function createChromeHarness() {
    const messages = [];
    const createdTabs = [];
    const chromeApi = {
        tabs: {
            create: jest.fn((options, callback) => {
                const tab = { id: createdTabs.length + 10, url: options.url, active: options.active, status: 'complete' };
                createdTabs.push(tab);
                callback(tab);
            }),
            get: jest.fn((tabId, callback) => {
                callback(createdTabs.find((tab) => tab.id === tabId) || {
                    id: tabId,
                    url: 'https://grok.com/',
                    status: 'complete'
                });
            }),
            sendMessage: jest.fn((tabId, message, callback) => {
                messages.push({ tabId, message });
                if (message.action === 'GPT_RECREATE_CHAT_STEP') {
                    callback({ ok: true, runId: message.runId, generatedPrompt: 'A red cabin in snow.' });
                    return;
                }
                if (message.action === 'GPT_RECREATE_IMAGINE_STEP') {
                    callback({
                        ok: true,
                        runId: message.runId,
                        submitted: true,
                        resultReady: true,
                        result: { sourceKind: 'trusted-grok-media' }
                    });
                    return;
                }
                callback({ ok: true });
            }),
            update: jest.fn((tabId, options, callback) => {
                callback({ id: tabId, status: 'complete', ...options });
            })
        },
        scripting: {
            executeScript: jest.fn((_options, callback) => callback()),
            insertCSS: jest.fn((_options, callback) => callback())
        },
        runtime: { lastError: null }
    };
    return { chromeApi, createdTabs, messages };
}

function createStartRequest(overrides = {}) {
    return {
        reference: {
            name: 'sample.png',
            mimeType: 'image/png',
            dataUrl: 'data:image/png;base64,aGVsbG8=',
            source: 'local'
        },
        bestPracticesEnabled: false,
        ...overrides
    };
}

async function waitForPendingChatStep(getCallback) {
    for (let attempt = 0; attempt < 10; attempt++) {
        if (typeof getCallback() === 'function') return;
        await Promise.resolve();
    }
}

function callbackWithLastError(chromeApi, message, callback) {
    chromeApi.runtime.lastError = { message };
    callback();
    chromeApi.runtime.lastError = null;
}

function getStatusMessages(messages) {
    return messages
        .filter((entry) => entry.message.action === 'GPT_RECREATE_STATUS')
        .map((entry) => entry.message);
}

describe('recreate background controller', () => {
    test('runs chat step before imagine step', async () => {
        const { chromeApi, createdTabs, messages } = createChromeHarness();
        const controller = createRecreateWorkflowController({
            chromeApi,
            utils,
            now: () => 1000,
            random: () => 0.5
        });

        const result = await controller.start(createStartRequest({ bestPracticesEnabled: true }), {
            sourceTabId: 1,
            sourceTabUrl: 'https://grok.com/imagine'
        });

        expect(result).toEqual(
            expect.objectContaining({
                ok: true,
                generatedPrompt: 'A red cabin in snow.',
                submitted: true,
                resultReady: true
            })
        );
        expect(createdTabs.map((tab) => tab.url)).toEqual(['https://grok.com/']);
        expect(createdTabs[0].active).toBe(true);
        expect(chromeApi.tabs.update).toHaveBeenCalledWith(1, { active: true }, expect.any(Function));
        expect(messages.map((entry) => entry.message.action)).toEqual([
            'GPT_RECREATE_STATUS',
            'GPT_RECREATE_CHAT_STEP',
            'GPT_RECREATE_STATUS',
            'GPT_RECREATE_IMAGINE_STEP',
            'GPT_RECREATE_STATUS'
        ]);
    });

    test('threads video references through chat and Imagine video mode', async () => {
        const { chromeApi, messages } = createChromeHarness();
        chromeApi.tabs.sendMessage = jest.fn((tabId, message, callback) => {
            messages.push({ tabId, message });
            if (message.action === 'GPT_RECREATE_CHAT_STEP') {
                callback({
                    ok: true,
                    runId: message.runId,
                    generatedPrompt: 'A handheld 10-second embrace.',
                    referenceSummary: {
                        kind: 'video',
                        sourceHash: 'sourcehash'
                    }
                });
                return;
            }
            if (message.action === 'GPT_RECREATE_IMAGINE_STEP') {
                callback({
                    ok: true,
                    runId: message.runId,
                    mediaKind: 'video',
                    submitted: true,
                    resultReady: true,
                    result: {
                        mediaKind: 'video',
                        sourceKind: 'trusted-grok-video',
                        url: 'https://imagine-public.x.ai/imagine-public/share-videos/generated_1080_hd.mp4',
                        outputMediaHash: 'outputhash'
                    }
                });
                return;
            }
            callback({ ok: true });
        });
        const controller = createRecreateWorkflowController({
            chromeApi,
            utils,
            now: () => 1000,
            random: () => 0.5
        });

        const result = await controller.start(createStartRequest({
            reference: {
                name: 'sample.mp4',
                kind: 'video',
                mimeType: 'video/mp4',
                dataUrl: 'data:video/mp4;base64,aGVsbG8=',
                source: 'local'
            }
        }), {
            sourceTabId: 1,
            sourceTabUrl: 'https://grok.com/imagine'
        });

        const chatMessage = messages.find((entry) => entry.message.action === 'GPT_RECREATE_CHAT_STEP').message;
        const imagineMessage = messages.find((entry) => entry.message.action === 'GPT_RECREATE_IMAGINE_STEP').message;
        const doneStatus = getStatusMessages(messages).at(-1);

        expect(result).toEqual(expect.objectContaining({
            ok: true,
            referenceKind: 'video',
            resultReady: true
        }));
        expect(chatMessage.referenceKind).toBe('video');
        expect(chatMessage.reference).toEqual(expect.objectContaining({ kind: 'video' }));
        expect(imagineMessage.targetMode).toBe('video');
        expect(imagineMessage.referenceKind).toBe('video');
        expect(doneStatus).toEqual(expect.objectContaining({
            phase: 'done',
            message: 'Generated video ready.',
            type: 'success'
        }));
    });

    test('reuses source Imagine tab when context source URL is https://grok.com/imagine', async () => {
        const { chromeApi, createdTabs, messages } = createChromeHarness();
        const controller = createRecreateWorkflowController({ chromeApi, utils });

        await controller.start(createStartRequest(), {
            sourceTabId: 7,
            sourceTabUrl: 'https://grok.com/imagine'
        });

        const imagineMessage = messages.find((entry) => entry.message.action === 'GPT_RECREATE_IMAGINE_STEP');
        expect(createdTabs.map((tab) => tab.url)).toEqual(['https://grok.com/']);
        expect(createdTabs[0].active).toBe(true);
        expect(chromeApi.tabs.update).toHaveBeenCalledWith(7, { active: true }, expect.any(Function));
        expect(imagineMessage.tabId).toBe(7);
    });

    test('opens a new Imagine tab when source tab is not Imagine', async () => {
        const { chromeApi, createdTabs, messages } = createChromeHarness();
        const controller = createRecreateWorkflowController({ chromeApi, utils });

        await controller.start(createStartRequest(), {
            sourceTabId: 1,
            sourceTabUrl: 'https://grok.com/'
        });

        const imagineMessage = messages.find((entry) => entry.message.action === 'GPT_RECREATE_IMAGINE_STEP');
        expect(createdTabs.map((tab) => tab.url)).toEqual(['https://grok.com/', 'https://grok.com/imagine']);
        expect(createdTabs.map((tab) => tab.active)).toEqual([true, true]);
        expect(chromeApi.tabs.update).not.toHaveBeenCalledWith(1, { active: true }, expect.any(Function));
        expect(imagineMessage.tabId).toBe(11);
    });

    test('opens a new Imagine tab when source tab is an Imagine post detail page', async () => {
        const { chromeApi, createdTabs, messages } = createChromeHarness();
        const controller = createRecreateWorkflowController({ chromeApi, utils });

        await controller.start(createStartRequest(), {
            sourceTabId: 7,
            sourceTabUrl: 'https://grok.com/imagine/post/ecda4c9e-a6f1-46b6-9d6c-cf204a6f5c2f'
        });

        const imagineMessage = messages.find((entry) => entry.message.action === 'GPT_RECREATE_IMAGINE_STEP');
        expect(createdTabs.map((tab) => tab.url)).toEqual(['https://grok.com/', 'https://grok.com/imagine']);
        expect(chromeApi.tabs.update).not.toHaveBeenCalledWith(7, { active: true }, expect.any(Function));
        expect(imagineMessage.tabId).toBe(11);
    });

    test('invalid reference fails safely without reference payload leaking', async () => {
        const { chromeApi, createdTabs, messages } = createChromeHarness();
        const controller = createRecreateWorkflowController({ chromeApi, utils });

        const result = await controller.start(
            createStartRequest({
                reference: {
                    name: 'bad.txt',
                    mimeType: 'text/plain',
                    dataUrl: 'data:text/plain;base64,aGVsbG8=',
                    source: 'local'
                }
            }),
            {
                sourceTabId: 1,
                sourceTabUrl: 'https://grok.com/imagine'
            }
        );

        expect(result).toEqual(
            expect.objectContaining({
                ok: false,
                error: 'reference_invalid'
            })
        );
        expect(createdTabs).toEqual([]);
        expect(JSON.stringify(result)).not.toContain('data:text/plain');
        expect(JSON.stringify(messages)).not.toContain('data:text/plain');
    });

    test('abort marks active workflow aborted while chat step is pending', async () => {
        const { chromeApi, messages } = createChromeHarness();
        let chatCallback = null;
        chromeApi.tabs.sendMessage = jest.fn((tabId, message, callback) => {
            messages.push({ tabId, message });
            if (message.action === 'GPT_RECREATE_CHAT_STEP') {
                chatCallback = callback;
                return;
            }
            callback({ ok: true });
        });
        const controller = createRecreateWorkflowController({ chromeApi, utils });

        const promise = controller.start(createStartRequest(), {
            sourceTabId: 1,
            sourceTabUrl: 'https://grok.com/imagine'
        });

        await waitForPendingChatStep(() => chatCallback);

        const abortResult = controller.abort('user');
        expect(abortResult).toEqual(expect.objectContaining({ ok: true, aborted: true }));
        expect(typeof chatCallback).toBe('function');

        chatCallback({ ok: true, generatedPrompt: 'A red cabin in snow.' });

        const result = await promise;
        expect(result).toEqual(expect.objectContaining({ ok: false, error: 'workflow_aborted' }));
        expect(messages.some((entry) => entry.message.action === 'GPT_RECREATE_IMAGINE_STEP')).toBe(false);
    });

    test('requires chat response to include a non-empty generated prompt before Imagine step', async () => {
        const { chromeApi, messages } = createChromeHarness();
        chromeApi.tabs.sendMessage = jest.fn((tabId, message, callback) => {
            messages.push({ tabId, message });
            if (message.action === 'GPT_RECREATE_CHAT_STEP') {
                callback({ ok: true, runId: message.runId, generatedPrompt: '   ' });
                return;
            }
            callback({ ok: true });
        });
        const controller = createRecreateWorkflowController({ chromeApi, utils });

        const result = await controller.start(createStartRequest(), {
            sourceTabId: 1,
            sourceTabUrl: 'https://grok.com/imagine'
        });

        const statuses = getStatusMessages(messages);
        expect(result).toEqual(expect.objectContaining({ ok: false, phase: 'chat', error: 'chat_prompt_marker_missing' }));
        expect(messages.some((entry) => entry.message.action === 'GPT_RECREATE_IMAGINE_STEP')).toBe(false);
        expect(statuses[statuses.length - 1]).toEqual(
            expect.objectContaining({
                phase: 'chat',
                message: 'chat_prompt_marker_missing',
                type: 'error'
            })
        );
    });

    test('chat phase upload input failure is returned without continuing to Imagine', async () => {
        const { chromeApi, messages } = createChromeHarness();
        chromeApi.tabs.sendMessage = jest.fn((tabId, message, callback) => {
            messages.push({ tabId, message });
            if (message.action === 'GPT_RECREATE_CHAT_STEP') {
                callback({
                    ok: false,
                    runId: message.runId,
                    phase: 'chat',
                    error: 'chat_upload_input_missing',
                    diagnostics: { url: 'https://grok.com/' }
                });
                return;
            }
            callback({ ok: true });
        });
        const controller = createRecreateWorkflowController({ chromeApi, utils });

        const result = await controller.start(createStartRequest(), {
            sourceTabId: 1,
            sourceTabUrl: 'https://grok.com/imagine'
        });

        const statuses = getStatusMessages(messages);
        expect(result).toEqual(
            expect.objectContaining({
                ok: false,
                phase: 'chat',
                error: 'chat_upload_input_missing',
                diagnostics: expect.objectContaining({ url: 'https://grok.com/' })
            })
        );
        expect(messages.some((entry) => entry.message.action === 'GPT_RECREATE_IMAGINE_STEP')).toBe(false);
        expect(statuses[statuses.length - 1]).toEqual(
            expect.objectContaining({
                phase: 'chat',
                message: 'chat_upload_input_missing',
                type: 'error'
            })
        );
        expect(controller.getActiveRunForTest()).toBeNull();
    });

    test('content phase chat failure is returned without continuing to Imagine', async () => {
        const { chromeApi, messages } = createChromeHarness();
        chromeApi.tabs.sendMessage = jest.fn((tabId, message, callback) => {
            messages.push({ tabId, message });
            if (message.action === 'GPT_RECREATE_CHAT_STEP') {
                callback({
                    ok: false,
                    runId: message.runId,
                    phase: 'content',
                    error: 'chat_upload_input_missing',
                    diagnostics: { url: 'https://grok.com/' }
                });
                return;
            }
            callback({ ok: true });
        });
        const controller = createRecreateWorkflowController({ chromeApi, utils });

        const result = await controller.start(createStartRequest(), {
            sourceTabId: 1,
            sourceTabUrl: 'https://grok.com/imagine'
        });

        const statuses = getStatusMessages(messages);
        expect(result).toEqual(
            expect.objectContaining({
                ok: false,
                phase: 'content',
                error: 'chat_upload_input_missing',
                diagnostics: expect.objectContaining({ url: 'https://grok.com/' })
            })
        );
        expect(messages.some((entry) => entry.message.action === 'GPT_RECREATE_IMAGINE_STEP')).toBe(false);
        expect(statuses[statuses.length - 1]).toEqual(
            expect.objectContaining({
                phase: 'content',
                message: 'chat_upload_input_missing',
                type: 'error'
            })
        );
        expect(controller.getActiveRunForTest()).toBeNull();
    });

    test('requires Imagine response to confirm submission', async () => {
        const { chromeApi, messages } = createChromeHarness();
        chromeApi.tabs.sendMessage = jest.fn((tabId, message, callback) => {
            messages.push({ tabId, message });
            if (message.action === 'GPT_RECREATE_CHAT_STEP') {
                callback({ ok: true, runId: message.runId, generatedPrompt: 'A red cabin in snow.' });
                return;
            }
            if (message.action === 'GPT_RECREATE_IMAGINE_STEP') {
                callback({ ok: true, runId: message.runId });
                return;
            }
            callback({ ok: true });
        });
        const controller = createRecreateWorkflowController({ chromeApi, utils });

        const result = await controller.start(createStartRequest(), {
            sourceTabId: 1,
            sourceTabUrl: 'https://grok.com/imagine'
        });

        const statuses = getStatusMessages(messages);
        expect(result).toEqual(expect.objectContaining({ ok: false, phase: 'imagine', error: 'imagine_submit_failed' }));
        expect(messages.some((entry) => entry.message.action === 'GPT_RECREATE_IMAGINE_STEP')).toBe(true);
        expect(statuses[statuses.length - 1]).toEqual(
            expect.objectContaining({
                phase: 'imagine',
                message: 'imagine_submit_failed',
                type: 'error'
            })
        );
    });

    test('requires Imagine response to confirm generated result readiness', async () => {
        const { chromeApi, messages } = createChromeHarness();
        chromeApi.tabs.sendMessage = jest.fn((tabId, message, callback) => {
            messages.push({ tabId, message });
            if (message.action === 'GPT_RECREATE_CHAT_STEP') {
                callback({ ok: true, runId: message.runId, generatedPrompt: 'A red cabin in snow.' });
                return;
            }
            if (message.action === 'GPT_RECREATE_IMAGINE_STEP') {
                callback({ ok: true, runId: message.runId, submitted: true });
                return;
            }
            callback({ ok: true });
        });
        const controller = createRecreateWorkflowController({ chromeApi, utils });

        const result = await controller.start(createStartRequest(), {
            sourceTabId: 1,
            sourceTabUrl: 'https://grok.com/imagine'
        });

        const statuses = getStatusMessages(messages);
        expect(result).toEqual(expect.objectContaining({ ok: false, phase: 'imagine', error: 'imagine_result_unverified' }));
        expect(statuses[statuses.length - 1]).toEqual(
            expect.objectContaining({
                phase: 'imagine',
                message: 'imagine_result_unverified',
                type: 'error'
            })
        );
    });

    test('returns content result validation failures without treating submit as success', async () => {
        const { chromeApi, messages } = createChromeHarness();
        chromeApi.tabs.sendMessage = jest.fn((tabId, message, callback) => {
            messages.push({ tabId, message });
            if (message.action === 'GPT_RECREATE_CHAT_STEP') {
                callback({ ok: true, runId: message.runId, generatedPrompt: 'A red cabin in snow.' });
                return;
            }
            if (message.action === 'GPT_RECREATE_IMAGINE_STEP') {
                callback({
                    ok: false,
                    runId: message.runId,
                    phase: 'imagine',
                    error: 'imagine_result_placeholder',
                    diagnostics: { placeholderResultCount: 4 }
                });
                return;
            }
            callback({ ok: true });
        });
        const controller = createRecreateWorkflowController({ chromeApi, utils });

        const result = await controller.start(createStartRequest(), {
            sourceTabId: 1,
            sourceTabUrl: 'https://grok.com/imagine'
        });

        const statuses = getStatusMessages(messages);
        expect(result).toEqual(
            expect.objectContaining({
                ok: false,
                phase: 'imagine',
                error: 'imagine_result_placeholder',
                diagnostics: expect.objectContaining({ placeholderResultCount: 4 })
            })
        );
        expect(statuses[statuses.length - 1]).toEqual(
            expect.objectContaining({
                phase: 'imagine',
                message: 'imagine_result_placeholder',
                type: 'error'
            })
        );
    });

    test('maps Chrome chat tab create failures to named chat errors', async () => {
        const { chromeApi } = createChromeHarness();
        chromeApi.tabs.create = jest.fn((_options, callback) => {
            callbackWithLastError(chromeApi, 'Could not create tab', callback);
        });
        const controller = createRecreateWorkflowController({ chromeApi, utils });

        const result = await controller.start(createStartRequest(), {
            sourceTabId: 1,
            sourceTabUrl: 'https://grok.com/imagine'
        });

        expect(result).toEqual(
            expect.objectContaining({
                ok: false,
                phase: 'chat',
                error: 'chat_tab_unavailable',
                diagnostics: expect.objectContaining({
                    chromeLastError: 'Could not create tab'
                })
            })
        );
        expect(result.error).not.toBe('Could not create tab');
    });

    test('maps Chrome Imagine tab send failures to named Imagine errors', async () => {
        const { chromeApi, messages } = createChromeHarness();
        chromeApi.tabs.sendMessage = jest.fn((tabId, message, callback) => {
            messages.push({ tabId, message });
            if (message.action === 'GPT_RECREATE_CHAT_STEP') {
                callback({ ok: true, runId: message.runId, generatedPrompt: 'A red cabin in snow.' });
                return;
            }
            if (message.action === 'GPT_RECREATE_IMAGINE_STEP') {
                callbackWithLastError(chromeApi, 'Could not establish connection', callback);
                return;
            }
            callback({ ok: true });
        });
        const controller = createRecreateWorkflowController({ chromeApi, utils });

        const result = await controller.start(createStartRequest(), {
            sourceTabId: 1,
            sourceTabUrl: 'https://grok.com/imagine'
        });

        expect(result).toEqual(
            expect.objectContaining({
                ok: false,
                phase: 'imagine',
                error: 'imagine_tab_unavailable',
                diagnostics: expect.objectContaining({
                    chromeLastError: 'Could not establish connection'
                })
            })
        );
        expect(result.error).not.toBe('Could not establish connection');
    });

    test('recovers when Imagine submit navigates and closes the message channel', async () => {
        const { chromeApi, messages } = createChromeHarness();
        let imagineTabUrl = 'https://grok.com/imagine';
        chromeApi.tabs.get = jest.fn((tabId, callback) => {
            callback({ id: tabId, url: imagineTabUrl, status: 'complete' });
        });
        chromeApi.tabs.update = jest.fn((tabId, options, callback) => {
            callback({ id: tabId, url: imagineTabUrl, status: 'complete', ...options });
        });
        chromeApi.tabs.sendMessage = jest.fn((tabId, message, callback) => {
            messages.push({ tabId, message });
            if (message.action === 'GPT_RECREATE_CHAT_STEP') {
                callback({
                    ok: true,
                    runId: message.runId,
                    generatedPrompt: 'A handheld 10-second embrace.'
                });
                return;
            }
            if (message.action === 'GPT_RECREATE_IMAGINE_STEP') {
                imagineTabUrl = 'https://grok.com/imagine/post/live-video-proof';
                callbackWithLastError(
                    chromeApi,
                    'A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received',
                    callback
                );
                return;
            }
            if (message.action === 'GPT_RECREATE_IMAGINE_POST_VALIDATION_STEP') {
                callback({
                    ok: true,
                    runId: message.runId,
                    mediaKind: 'video',
                    submitted: true,
                    resultReady: true,
                    result: {
                        mediaKind: 'video',
                        sourceKind: 'trusted-grok-video',
                        url: 'https://assets.grok.com/users/test/generated/live-video-proof/generated_video.mp4?cache=1',
                        outputMediaHash: 'outputhash'
                    }
                });
                return;
            }
            callback({ ok: true });
        });
        const controller = createRecreateWorkflowController({
            chromeApi,
            utils,
            receiverRetryDelayMs: 0,
            tabReadyPollMs: 0
        });

        const result = await controller.start(createStartRequest({
            reference: {
                name: 'sample.mp4',
                kind: 'video',
                mimeType: 'video/mp4',
                dataUrl: 'data:video/mp4;base64,aGVsbG8=',
                source: 'local'
            }
        }), {
            sourceTabId: 1,
            sourceTabUrl: 'https://grok.com/imagine'
        });

        expect(result).toEqual(expect.objectContaining({
            ok: true,
            referenceKind: 'video',
            submitted: true,
            resultReady: true
        }));
        expect(messages.some((entry) => entry.message.action === 'GPT_RECREATE_IMAGINE_POST_VALIDATION_STEP')).toBe(true);
        expect(chromeApi.scripting.executeScript).toHaveBeenCalledWith(
            {
                target: { tabId: 1 },
                files: ['recreateWorkflowUtils.js', 'recreateWorkflowContent.js', 'content.js']
            },
            expect.any(Function)
        );
        expect(getStatusMessages(messages)).toContainEqual(expect.objectContaining({
            phase: 'imagine',
            message: 'Validating opened Grok post video...',
            type: 'info'
        }));
        expect(getStatusMessages(messages).at(-1)).toEqual(expect.objectContaining({
            phase: 'done',
            message: 'Generated video ready.',
            type: 'success'
        }));
    });

    test('retries a newly created tab when receiver is not ready, then succeeds', async () => {
        const { chromeApi, messages } = createChromeHarness();
        let chatAttempts = 0;
        chromeApi.tabs.sendMessage = jest.fn((tabId, message, callback) => {
            messages.push({ tabId, message });
            if (message.action === 'GPT_RECREATE_CHAT_STEP') {
                chatAttempts++;
                if (chatAttempts === 1) {
                    callbackWithLastError(
                        chromeApi,
                        'Could not establish connection. Receiving end does not exist.',
                        callback
                    );
                    return;
                }
                callback({ ok: true, runId: message.runId, generatedPrompt: 'A red cabin in snow.' });
                return;
            }
            if (message.action === 'GPT_RECREATE_IMAGINE_STEP') {
                callback({ ok: true, runId: message.runId, submitted: true, resultReady: true });
                return;
            }
            callback({ ok: true });
        });
        const controller = createRecreateWorkflowController({
            chromeApi,
            utils,
            receiverRetryDelayMs: 0,
            receiverRetryAttempts: 2
        });

        const result = await controller.start(createStartRequest(), {
            sourceTabId: 1,
            sourceTabUrl: 'https://grok.com/imagine'
        });

        expect(result).toEqual(expect.objectContaining({ ok: true, submitted: true }));
        expect(chatAttempts).toBe(2);
        expect(messages.filter((entry) => entry.message.action === 'GPT_RECREATE_CHAT_STEP')).toHaveLength(2);
        expect(chromeApi.scripting.insertCSS).toHaveBeenCalledWith(
            { target: { tabId: 10 }, files: ['overlay.css'] },
            expect.any(Function)
        );
        expect(chromeApi.scripting.executeScript).toHaveBeenCalledWith(
            {
                target: { tabId: 10 },
                files: ['recreateWorkflowUtils.js', 'recreateWorkflowContent.js', 'content.js']
            },
            expect.any(Function)
        );
    });

    test('chat send timeout fails with named chat error instead of hanging', async () => {
        const { chromeApi } = createChromeHarness();
        chromeApi.tabs.sendMessage = jest.fn((_tabId, message, callback) => {
            if (message.action === 'GPT_RECREATE_CHAT_STEP') return;
            callback({ ok: true });
        });
        const controller = createRecreateWorkflowController({
            chromeApi,
            utils,
            messageTimeoutMs: 5,
            statusMessageTimeoutMs: 5
        });

        const result = await controller.start(createStartRequest(), {
            sourceTabId: 1,
            sourceTabUrl: 'https://grok.com/imagine'
        });

        expect(result).toEqual(
            expect.objectContaining({
                ok: false,
                phase: 'chat',
                error: 'chat_tab_unavailable',
                diagnostics: expect.objectContaining({
                    reason: 'message_timeout',
                    action: 'GPT_RECREATE_CHAT_STEP'
                })
            })
        );
        expect(controller.getActiveRunForTest()).toBeNull();
    });

    test('Imagine send timeout fails with named Imagine error instead of hanging', async () => {
        const { chromeApi, messages } = createChromeHarness();
        chromeApi.tabs.sendMessage = jest.fn((_tabId, message, callback) => {
            messages.push({ message });
            if (message.action === 'GPT_RECREATE_CHAT_STEP') {
                callback({ ok: true, runId: message.runId, generatedPrompt: 'A red cabin in snow.' });
                return;
            }
            if (message.action === 'GPT_RECREATE_IMAGINE_STEP') return;
            callback({ ok: true });
        });
        const controller = createRecreateWorkflowController({
            chromeApi,
            utils,
            messageTimeoutMs: 5,
            statusMessageTimeoutMs: 5
        });

        const result = await controller.start(createStartRequest(), {
            sourceTabId: 1,
            sourceTabUrl: 'https://grok.com/imagine'
        });

        expect(result).toEqual(
            expect.objectContaining({
                ok: false,
                phase: 'imagine',
                error: 'imagine_tab_unavailable',
                diagnostics: expect.objectContaining({
                    reason: 'message_timeout',
                    action: 'GPT_RECREATE_IMAGINE_STEP'
                })
            })
        );
        expect(messages.some((entry) => entry.message.action === 'GPT_RECREATE_IMAGINE_STEP')).toBe(true);
        expect(controller.getActiveRunForTest()).toBeNull();
    });
});
