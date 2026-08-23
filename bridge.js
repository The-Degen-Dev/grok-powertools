// bridge.js — Runs in the page's MAIN world (not the content script's isolated world)
// Provides access to TipTap editor and Grok's fetch for the content script via custom events

(function initializeGrokPowerToolsBridge() {
if (window.__gptPowerToolsBridgeInstalled) return;
window.__gptPowerToolsBridgeInstalled = true;

function findGrokContentEditable() {
    var editors = Array.prototype.slice.call(
        document.querySelectorAll('[contenteditable], [role="textbox"], div[aria-label], div[data-placeholder]')
    ).filter(function(editor) {
        var editableState = String(editor.getAttribute('contenteditable') || editor.contentEditable || '').toLowerCase();
        return editableState === 'true' || editableState === 'plaintext-only' || editor.isContentEditable;
    });
    return editors.find(function(editor) {
        var label = [
            editor.getAttribute('aria-label'),
            editor.getAttribute('placeholder'),
            editor.getAttribute('data-placeholder')
        ].filter(Boolean).join(' ');

        return /ask\s+grok(?:\s+anything)?/i.test(label) || /(?:message|prompt)\s+grok/i.test(label);
    }) || editors[0] || null;
}

function dispatchEditorInput(editor, text) {
    try {
        editor.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: text
        }));
    } catch {
        editor.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    }

    editor.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
}

function replaceContentEditableText(editor, text) {
    editor.focus();

    var selection = window.getSelection && window.getSelection();
    var range = document.createRange();
    range.selectNodeContents(editor);
    if (selection) {
        selection.removeAllRanges();
        selection.addRange(range);
    }

    var inserted = false;
    try {
        inserted = document.execCommand && document.execCommand('insertText', false, text);
    } catch {
        inserted = false;
    }

    if (!inserted) {
        editor.textContent = text;
        dispatchEditorInput(editor, text);
    }
}

function insertContentEditableText(editor, text) {
    editor.focus();

    var inserted = false;
    try {
        inserted = document.execCommand && document.execCommand('insertText', false, text);
    } catch {
        inserted = false;
    }

    if (!inserted) {
        editor.textContent = (editor.textContent || '') + text;
        dispatchEditorInput(editor, text);
    }
}

document.addEventListener('__gpt_set_editor_content', function(e) {
    var marker = String((e.detail && e.detail.marker) || '');
    var ce = findMarkedPromptedVideoEditor(marker) || (!marker ? findGrokContentEditable() : null);
    var text = String((e.detail && e.detail.text) || '');
    if (!ce) return;

    if (ce.editor && ce.editor.commands) {
        ce.editor.commands.clearContent();
        ce.editor.commands.insertContent(text);
        return;
    }

    replaceContentEditableText(ce, text);
});

document.addEventListener('__gpt_append_editor_content', function(e) {
    var marker = String((e.detail && e.detail.marker) || '');
    var ce = findMarkedPromptedVideoEditor(marker) || (!marker ? findGrokContentEditable() : null);
    var text = String((e.detail && e.detail.text) || '');
    if (!ce) return;

    if (ce.editor && ce.editor.commands) {
        ce.editor.commands.focus('end');
        ce.editor.commands.insertContent(text);
        return;
    }

    insertContentEditableText(ce, text);
});

function findMarkedPromptedVideoEditor(marker) {
    if (!marker) return null;

    return Array.prototype.slice.call(document.querySelectorAll('[data-gpt-prompt-target]'))
        .find(function(editor) {
            var editableState = String(editor.getAttribute('contenteditable') || editor.contentEditable || '').toLowerCase();
            return editor.getAttribute('data-gpt-prompt-target') === marker
                && (editableState === 'true' || editableState === 'plaintext-only' || editor.isContentEditable);
        }) || null;
}

var promptedVideoBridgeState = window.__gptPromptedVideoBridgeState
    || (window.__gptPromptedVideoBridgeState = {});

if (!promptedVideoBridgeState.setContentHandler) {
    promptedVideoBridgeState.setContentHandler = function(e) {
        var detail = e.detail || {};
        var marker = String(detail.marker || '');
        var text = String(detail.text || '');
        var editor = findMarkedPromptedVideoEditor(marker);
        var ok = false;
        var error = null;

        try {
            if (!editor) throw new Error('Marked prompted video editor not found');

            if (editor.editor && editor.editor.commands) {
                editor.editor.commands.clearContent();
                editor.editor.commands.insertContent(text);
            } else {
                replaceContentEditableText(editor, text);
            }
            ok = true;
        } catch (err) {
            error = err && err.message ? err.message : 'Failed to set prompted video content';
        } finally {
            if (editor) editor.removeAttribute('data-gpt-prompt-target');
            document.dispatchEvent(new CustomEvent('__gpt_set_prompted_video_content_result', {
                detail: { marker: marker, ok: ok, error: error }
            }));
        }
    };
    document.addEventListener('__gpt_set_prompted_video_content', promptedVideoBridgeState.setContentHandler);
}

// Fetch media with page cookies for R2 backup (content script can't include page cookies)
var mediaFetchBridgeState = window.__gptMediaFetchBridgeState
    || (window.__gptMediaFetchBridgeState = {
        released: new Set(),
        blobUrls: new Map(),
        expiryTimers: new Map()
    });

function releaseMediaFetchResult(requestId) {
    if (!requestId) return;
    mediaFetchBridgeState.released.add(requestId);
    var blobUrl = mediaFetchBridgeState.blobUrls.get(requestId);
    if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
        mediaFetchBridgeState.blobUrls.delete(requestId);
    }
    var expiryTimer = mediaFetchBridgeState.expiryTimers.get(requestId);
    if (expiryTimer) {
        clearTimeout(expiryTimer);
        mediaFetchBridgeState.expiryTimers.delete(requestId);
    }
    setTimeout(function() {
        mediaFetchBridgeState.released.delete(requestId);
    }, 60000);
}

document.addEventListener('__gpt_fetch_media_release', function(e) {
    releaseMediaFetchResult(e.detail && e.detail.requestId);
});

document.addEventListener('__gpt_fetch_media', function(e) {
    var url = e.detail && e.detail.url;
    var requestId = e.detail && e.detail.requestId;
    if (!url || !requestId) return;

    fetch(url, { credentials: 'include' })
        .then(function(resp) {
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            return resp.blob();
        })
        .then(function(blob) {
            if (mediaFetchBridgeState.released.has(requestId)) return;
            // Create blob URL — accessible from content script's isolated world (same page)
            var blobUrl = URL.createObjectURL(blob);
            mediaFetchBridgeState.blobUrls.set(requestId, blobUrl);
            mediaFetchBridgeState.expiryTimers.set(requestId, setTimeout(function() {
                releaseMediaFetchResult(requestId);
            }, 60000));
            document.dispatchEvent(new CustomEvent('__gpt_fetch_media_result', {
                detail: { requestId: requestId, blobUrl: blobUrl, size: blob.size, type: blob.type }
            }));
        })
        .catch(function(err) {
            if (mediaFetchBridgeState.released.has(requestId)) return;
            document.dispatchEvent(new CustomEvent('__gpt_fetch_media_result', {
                detail: { requestId: requestId, error: err.message }
            }));
        });
});

document.addEventListener('__gpt_media_fetch_bridge_probe', function(e) {
    var requestId = e.detail && e.detail.requestId;
    if (!requestId) return;
    document.dispatchEvent(new CustomEvent('__gpt_media_fetch_bridge_ready', {
        detail: { requestId: requestId }
    }));
});

var sensitiveMetadataKeyPattern = /(?:authorization|bearer|cookie|credential|password|secret|signature|token)/i;

function sanitizeMetadataString(value) {
    var text = String(value || '');
    if (/^https?:\/\//i.test(text)) {
        try {
            var parsed = new URL(text);
            parsed.search = '';
            parsed.hash = '';
            return parsed.toString();
        } catch {
            // Keep non-URL metadata text unchanged.
        }
    }
    return text;
}

function sanitizeAssetMetadataValue(value, depth) {
    if (depth > 8) throw new Error('asset_metadata_too_deep');
    if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
    if (typeof value === 'string') return sanitizeMetadataString(value);
    if (Array.isArray(value)) {
        return value.map(function(item) {
            return sanitizeAssetMetadataValue(item, depth + 1);
        });
    }
    if (!value || typeof value !== 'object') return null;

    return Object.keys(value).sort().reduce(function(result, key) {
        if (sensitiveMetadataKeyPattern.test(key)) return result;
        result[key] = sanitizeAssetMetadataValue(value[key], depth + 1);
        return result;
    }, {});
}

function readPromptText(mediaGenInput) {
    if (typeof mediaGenInput === 'string' && mediaGenInput.trim()) return mediaGenInput;
    if (!mediaGenInput || typeof mediaGenInput !== 'object') return '';
    var keys = ['prompt', 'promptText', 'text'];
    for (var index = 0; index < keys.length; index++) {
        var value = mediaGenInput[keys[index]];
        if (typeof value === 'string' && value.trim()) return value;
    }

    var candidates = [];
    function collectPromptText(value, depth) {
        if (!value || typeof value !== 'object' || depth > 8) return;
        if (Array.isArray(value)) {
            value.forEach(function(item) {
                collectPromptText(item, depth + 1);
            });
            return;
        }
        keys.forEach(function(key) {
            var candidate = value[key];
            if (typeof candidate === 'string' && candidate.trim()) candidates.push(candidate);
        });
        Object.keys(value).sort().forEach(function(key) {
            if (keys.indexOf(key) !== -1) return;
            collectPromptText(value[key], depth + 1);
        });
    }
    collectPromptText(mediaGenInput, 0);

    var uniqueCandidates = [];
    candidates.forEach(function(candidate) {
        var normalized = candidate.trim();
        if (!uniqueCandidates.some(function(existing) {
            return existing.trim() === normalized;
        })) {
            uniqueCandidates.push(candidate);
        }
    });
    return uniqueCandidates.length === 1 ? uniqueCandidates[0] : '';
}

function readAssetPromptEvidence(response, assetMetadata) {
    var responsePrompt = readPromptText(response && response.mediaGenInput);
    if (responsePrompt) {
        return {
            promptText: responsePrompt,
            promptEvidenceSource: 'response_media_gen_input'
        };
    }

    var assetPrompt = readPromptText(assetMetadata && assetMetadata.mediaGenInput);
    if (assetPrompt) {
        return {
            promptText: assetPrompt,
            promptEvidenceSource: 'asset_media_gen_input'
        };
    }

    return {
        promptText: '',
        promptEvidenceSource: 'unavailable'
    };
}

function buildAssetCaptureMetadata(payload, conversationId, assetId) {
    var responses = Array.isArray(payload && payload.responses)
        ? payload.responses
        : (Array.isArray(payload && payload.data && payload.data.responses) ? payload.data.responses : []);
    var normalizedAssetId = String(assetId || '').toLowerCase();
    var matches = [];

    responses.forEach(function(response) {
        var assets = Array.isArray(response && response.fileAttachmentAssetMetadata)
            ? response.fileAttachmentAssetMetadata
            : [];
        assets.forEach(function(assetMetadata) {
            if (String(assetMetadata && assetMetadata.assetId || '').toLowerCase() !== normalizedAssetId) return;
            matches.push({ response: response, assetMetadata: assetMetadata });
        });
    });

    if (matches.length === 0) throw new Error('asset_metadata_missing');
    if (matches.length !== 1) throw new Error('asset_metadata_ambiguous');

    var match = matches[0];
    var response = match.response || {};
    var mediaGenInput = response.mediaGenInput !== undefined
        ? response.mediaGenInput
        : match.assetMetadata.mediaGenInput;
    var promptEvidence = readAssetPromptEvidence(response, match.assetMetadata);
    var metadata = {
        schemaVersion: 2,
        evidenceSource: 'grok_conversation_response',
        conversationId: String(conversationId),
        assetId: String(match.assetMetadata.assetId),
        responseId: String(response.responseId || response.id || ''),
        parentResponseId: String(response.parentResponseId || ''),
        rootResponseId: String(response.rootResponseId || ''),
        promptText: promptEvidence.promptText,
        promptEvidenceSource: promptEvidence.promptEvidenceSource,
        assetMetadata: sanitizeAssetMetadataValue(match.assetMetadata, 0),
        mediaGenInput: sanitizeAssetMetadataValue(mediaGenInput === undefined ? null : mediaGenInput, 0)
    };
    var responseCreatedAt = response.createdAt || response.createTime || response.created_at;
    if (responseCreatedAt !== undefined && responseCreatedAt !== null && responseCreatedAt !== '') {
        metadata.responseCreatedAt = sanitizeMetadataString(responseCreatedAt);
    }
    if (JSON.stringify(metadata).length > 262144) throw new Error('asset_metadata_too_large');
    return metadata;
}

var conversationInventoryUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var conversationInventoryMaxAssets = 2048;
var conversationInventoryMaxBytes = 2097152;

function getSerializedByteLength(value) {
    return new Blob([value]).size;
}

function getConversationAssetSourceUrl(assetMetadata) {
    var candidates = [];
    ['url', 'sourceUrl', 'downloadUrl', 'imageUrl', 'videoUrl'].forEach(function(key) {
        var value = assetMetadata && assetMetadata[key];
        if (typeof value === 'string' && value.trim()) candidates.push(value.trim());
    });
    var objectKey = assetMetadata && assetMetadata.key;
    if (typeof objectKey === 'string' && objectKey.trim()) {
        var normalizedKey = objectKey.trim().replace(/^\/+/, '');
        if (!normalizedKey || normalizedKey.split('/').some(function(part) { return part === '..'; })) {
            throw new Error('conversation_asset_source_invalid');
        }
        candidates.push('https://assets.grok.com/' + normalizedKey);
    }

    var normalizedCandidates = [];
    candidates.forEach(function(value) {
        var parsed;
        try {
            parsed = new URL(value);
        } catch {
            throw new Error('conversation_asset_source_invalid');
        }
        if (parsed.protocol !== 'https:' || parsed.username || parsed.password || (parsed.port && parsed.port !== '443')) {
            throw new Error('conversation_asset_source_invalid');
        }
        var trustedHost = parsed.hostname === 'assets.grok.com' || parsed.hostname === 'imagine-public.x.ai';
        if (!trustedHost) throw new Error('conversation_asset_source_untrusted');
        parsed.search = '';
        parsed.hash = '';
        var normalized = parsed.toString();
        if (normalizedCandidates.indexOf(normalized) === -1) normalizedCandidates.push(normalized);
    });
    if (normalizedCandidates.length === 0) throw new Error('conversation_asset_source_missing');
    if (normalizedCandidates.length !== 1) throw new Error('conversation_asset_source_conflict');
    return normalizedCandidates[0];
}

function getConversationAssetMediaKind(assetMetadata, sourceUrl) {
    var mimeType = String(
        assetMetadata && (assetMetadata.mimeType || assetMetadata.contentType || assetMetadata.mediaType) || ''
    ).trim().toLowerCase();
    var mimeKind = mimeType.indexOf('image/') === 0
        ? 'image'
        : (mimeType.indexOf('video/') === 0 ? 'video' : '');
    var pathname = new URL(sourceUrl).pathname.toLowerCase();
    var extensionKind = /\.(?:mp4|webm|mov|m4v)$/.test(pathname)
        ? 'video'
        : (/\.(?:png|jpe?g|webp|gif|bmp|avif)$/.test(pathname) ? 'image' : '');
    if (mimeKind && extensionKind && mimeKind !== extensionKind) {
        throw new Error('conversation_asset_media_type_conflict');
    }
    var mediaKind = mimeKind || extensionKind;
    if (!mediaKind) throw new Error('conversation_asset_media_type_missing');
    return mediaKind;
}

function buildConversationAssetDescriptor(response, assetMetadata) {
    var assetId = String(assetMetadata && assetMetadata.assetId || '').toLowerCase();
    if (!conversationInventoryUuidPattern.test(assetId)) throw new Error('conversation_asset_id_invalid');
    var sourceUrl = getConversationAssetSourceUrl(assetMetadata);
    if (sourceUrl.toLowerCase().indexOf(assetId) === -1) {
        throw new Error('conversation_asset_source_mismatch');
    }
    var mediaGenInput = response && response.mediaGenInput !== undefined
        ? response.mediaGenInput
        : assetMetadata.mediaGenInput;
    var promptEvidence = readAssetPromptEvidence(response, assetMetadata);
    return {
        assetId: assetId,
        responseId: String(response && (response.responseId || response.id) || ''),
        parentResponseId: String(response && response.parentResponseId || ''),
        mediaKind: getConversationAssetMediaKind(assetMetadata, sourceUrl),
        sourceUrl: sourceUrl,
        promptText: promptEvidence.promptText,
        promptEvidenceSource: promptEvidence.promptEvidenceSource,
        assetMetadata: sanitizeAssetMetadataValue(assetMetadata, 0),
        mediaGenInput: sanitizeAssetMetadataValue(mediaGenInput === undefined ? null : mediaGenInput, 0)
    };
}

function collectConversationMirrorAssetIds(value, depth) {
    if (depth === undefined) depth = 0;
    if (depth > 5 || value === null || value === undefined) return [];
    if (typeof value === 'string') {
        var direct = value.match(conversationInventoryUuidPattern);
        var generated = value.match(/\/generated\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i);
        return generated ? [generated[1].toLowerCase()] : (direct ? [direct[0].toLowerCase()] : []);
    }
    if (Array.isArray(value)) {
        return value.reduce(function(ids, item) {
            return ids.concat(collectConversationMirrorAssetIds(item, depth + 1));
        }, []);
    }
    if (typeof value !== 'object') return [];

    var ids = [];
    ['assetId', 'fileMetadataId'].forEach(function(key) {
        var candidate = String(value[key] || '').toLowerCase();
        if (conversationInventoryUuidPattern.test(candidate)) ids.push(candidate);
    });
    ['url', 'sourceUrl', 'downloadUrl', 'imageUrl', 'videoUrl', 'fileUri', 'parsedFileUri', 'key']
        .forEach(function(key) {
            ids = ids.concat(collectConversationMirrorAssetIds(value[key], depth + 1));
        });
    return ids;
}

function verifyConversationAssetMirrors(response, attachmentAssets) {
    var authoritativeIds = new Set(attachmentAssets.map(function(asset) {
        return String(asset && asset.assetId || '').toLowerCase();
    }).filter(Boolean));
    var mirrorFields = [
        'fileAttachments',
        'fileAttachmentsMetadata',
        'fileUris',
        'generatedImageUrls',
        'imageAttachments',
        'imageEditUris'
    ];
    mirrorFields.forEach(function(field) {
        var values = Array.isArray(response && response[field]) ? response[field] : [];
        values.forEach(function(value) {
            var ids = Array.from(new Set(collectConversationMirrorAssetIds(value)));
            if (ids.length === 0 || ids.some(function(assetId) { return !authoritativeIds.has(assetId); })) {
                throw new Error('conversation_asset_unrecognized_media_shape');
            }
        });
    });
}

function buildConversationAssetInventory(payload, conversationId) {
    if (!conversationInventoryUuidPattern.test(String(conversationId || ''))) {
        throw new Error('conversation_inventory_identity_invalid');
    }
    var responses = Array.isArray(payload && payload.responses)
        ? payload.responses
        : (Array.isArray(payload && payload.data && payload.data.responses) ? payload.data.responses : []);
    var descriptorsByAssetId = new Map();
    var assets = [];
    var failureCount = responses.reduce(function(count, response) {
        return count + (Array.isArray(response && response.streamErrors)
            && response.streamErrors.length > 0 ? 1 : 0);
    }, 0);
    var inflightResponsesRaw = Array.isArray(payload && payload.inflightResponses)
        ? payload.inflightResponses
        : (Array.isArray(payload && payload.data && payload.data.inflightResponses)
            ? payload.data.inflightResponses
            : []);
    var responseIdentity = function(response) {
        var responseId = String(response && (response.responseId || response.id) || '').toLowerCase();
        var parentResponseId = String(response && response.parentResponseId || '').toLowerCase();
        if (!conversationInventoryUuidPattern.test(responseId)) return null;
        if (parentResponseId && !conversationInventoryUuidPattern.test(parentResponseId)) return null;
        return { responseId: responseId, parentResponseId: parentResponseId };
    };
    var failedResponses = responses
        .filter(function(response) {
            return Array.isArray(response && response.streamErrors)
                && response.streamErrors.length > 0;
        })
        .map(responseIdentity)
        .filter(Boolean);
    var inflightResponses = inflightResponsesRaw
        .map(responseIdentity)
        .filter(Boolean);
    var videoGenerationResponses = responses
        .filter(function(response) {
            return String(response && response.model || '').trim().toLowerCase() === 'imagine-video-gen'
                && String(response && response.queryType || '').trim().toLowerCase() === 'imagine';
        })
        .map(responseIdentity)
        .filter(function(identity) { return !!(identity && identity.parentResponseId); });

    responses.forEach(function(response) {
        var attachmentAssets = Array.isArray(response && response.fileAttachmentAssetMetadata)
            ? response.fileAttachmentAssetMetadata
            : [];
        verifyConversationAssetMirrors(response, attachmentAssets);
        attachmentAssets.forEach(function(assetMetadata) {
            var descriptor = buildConversationAssetDescriptor(response, assetMetadata);
            var canonical = JSON.stringify({
                assetId: descriptor.assetId,
                mediaKind: descriptor.mediaKind,
                sourceUrl: descriptor.sourceUrl,
                assetMetadata: descriptor.assetMetadata
            });
            var existing = descriptorsByAssetId.get(descriptor.assetId);
            if (existing && existing !== canonical) throw new Error('conversation_asset_duplicate_conflict');
            if (existing) return;
            if (assets.length >= conversationInventoryMaxAssets) {
                throw new Error('conversation_inventory_asset_limit');
            }
            descriptorsByAssetId.set(descriptor.assetId, canonical);
            assets.push(descriptor);
        });
    });

    if (assets.length === 0) throw new Error('conversation_inventory_empty');
    var inventory = {
        schemaVersion: 1,
        conversationId: String(conversationId).toLowerCase(),
        failureCount: failureCount,
        inflightResponseCount: inflightResponsesRaw.length,
        failedResponses: failedResponses,
        inflightResponses: inflightResponses,
        videoGenerationResponses: videoGenerationResponses,
        assets: assets
    };
    if (getSerializedByteLength(JSON.stringify(inventory)) > conversationInventoryMaxBytes) {
        throw new Error('conversation_inventory_too_large');
    }
    return inventory;
}

document.addEventListener('__gpt_fetch_asset_metadata', function(e) {
    var detail = e.detail || {};
    var requestId = detail.requestId;
    var conversationId = String(detail.conversationId || '');
    var assetId = String(detail.assetId || '');
    var uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!requestId || !uuidPattern.test(conversationId) || !uuidPattern.test(assetId)) return;

    fetch('/rest/app-chat/conversations/' + encodeURIComponent(conversationId) + '/responses', {
        credentials: 'include'
    })
        .then(function(response) {
            if (!response.ok) throw new Error('asset_metadata_http_' + response.status);
            return response.json();
        })
        .then(function(payload) {
            document.dispatchEvent(new CustomEvent('__gpt_fetch_asset_metadata_result', {
                detail: {
                    requestId: requestId,
                    metadata: buildAssetCaptureMetadata(payload, conversationId, assetId)
                }
            }));
        })
        .catch(function(error) {
            document.dispatchEvent(new CustomEvent('__gpt_fetch_asset_metadata_result', {
                detail: { requestId: requestId, error: String(error && error.message || 'asset_metadata_failed') }
            }));
        });
});

document.addEventListener('__gpt_fetch_conversation_asset_inventory', function(e) {
    var detail = e.detail || {};
    var requestId = detail.requestId;
    var conversationId = String(detail.conversationId || '').toLowerCase();
    if (!requestId) return;
    if (!conversationInventoryUuidPattern.test(conversationId)) {
        document.dispatchEvent(new CustomEvent('__gpt_fetch_conversation_asset_inventory_result', {
            detail: { requestId: requestId, error: 'conversation_inventory_identity_invalid' }
        }));
        return;
    }

    fetch('/rest/app-chat/conversations/' + encodeURIComponent(conversationId) + '/responses', {
        credentials: 'include'
    })
        .then(function(response) {
            if (!response.ok) throw new Error('conversation_inventory_http_' + response.status);
            return response.json();
        })
        .then(function(payload) {
            document.dispatchEvent(new CustomEvent('__gpt_fetch_conversation_asset_inventory_result', {
                detail: {
                    requestId: requestId,
                    inventory: buildConversationAssetInventory(payload, conversationId)
                }
            }));
        })
        .catch(function(error) {
            document.dispatchEvent(new CustomEvent('__gpt_fetch_conversation_asset_inventory_result', {
                detail: {
                    requestId: requestId,
                    error: String(error && error.message || 'conversation_inventory_failed')
                }
            }));
        });
});

document.addEventListener('__gpt_fetch_media_data_url', function(e) {
    var url = e.detail && e.detail.url;
    var requestId = e.detail && e.detail.requestId;
    var maxInlineBytes = Number(e.detail && e.detail.maxInlineBytes) || 0;
    if (!url || !requestId) return;

    fetch(url, { credentials: 'include' })
        .then(function(resp) {
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            return resp.blob();
        })
        .then(function(blob) {
            if (maxInlineBytes > 0 && blob.size > maxInlineBytes) {
                return {
                    dataUrl: '',
                    size: blob.size,
                    type: blob.type,
                    tooLarge: true
                };
            }
            return new Promise(function(resolve, reject) {
                var reader = new FileReader();
                reader.onload = function() {
                    resolve({
                        dataUrl: String(reader.result || ''),
                        size: blob.size,
                        type: blob.type
                    });
                };
                reader.onerror = function() {
                    reject(new Error('FileReader failed'));
                };
                reader.readAsDataURL(blob);
            });
        })
        .then(function(result) {
            document.dispatchEvent(new CustomEvent('__gpt_fetch_media_data_url_result', {
                detail: {
                    requestId: requestId,
                    dataUrl: result.dataUrl,
                    size: result.size,
                    type: result.type,
                    tooLarge: result.tooLarge === true
                }
            }));
        })
        .catch(function(err) {
            document.dispatchEvent(new CustomEvent('__gpt_fetch_media_data_url_result', {
                detail: { requestId: requestId, error: err.message }
            }));
        });
});

// Intercept upload-file responses to capture image URLs for template batch
(function() {
    var _origFetch = window.fetch;
    window.fetch = function() {
        var args = arguments;
        var resp = _origFetch.apply(this, args);
        resp.then(function(r) {
            try {
                var url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url);
                if (url && url.indexOf('/rest/app-chat/upload-file') !== -1) {
                    r.clone().json().then(function(data) {
                        if (data && data.fileMetadata && data.fileMetadata.url) {
                            document.dispatchEvent(new CustomEvent('__gpt_upload_complete', {
                                detail: { imageUrl: data.fileMetadata.url }
                            }));
                        }
                    }).catch(function() {});
                }
            } catch {}
        }).catch(function() {});
        return resp;
    };
})();

})();
