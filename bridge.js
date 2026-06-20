// bridge.js — Runs in the page's MAIN world (not the content script's isolated world)
// Provides access to TipTap editor and Grok's fetch for the content script via custom events

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
    var ce = findGrokContentEditable();
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
    var ce = findGrokContentEditable();
    var text = String((e.detail && e.detail.text) || '');
    if (!ce) return;

    if (ce.editor && ce.editor.commands) {
        ce.editor.commands.focus('end');
        ce.editor.commands.insertContent(text);
        return;
    }

    insertContentEditableText(ce, text);
});

// Fetch media with page cookies for R2 backup (content script can't include page cookies)
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
            // Create blob URL — accessible from content script's isolated world (same page)
            var blobUrl = URL.createObjectURL(blob);
            document.dispatchEvent(new CustomEvent('__gpt_fetch_media_result', {
                detail: { requestId: requestId, blobUrl: blobUrl, size: blob.size, type: blob.type }
            }));
        })
        .catch(function(err) {
            document.dispatchEvent(new CustomEvent('__gpt_fetch_media_result', {
                detail: { requestId: requestId, error: err.message }
            }));
        });
});

document.addEventListener('__gpt_fetch_media_data_url', function(e) {
    var url = e.detail && e.detail.url;
    var requestId = e.detail && e.detail.requestId;
    if (!url || !requestId) return;

    fetch(url, { credentials: 'include' })
        .then(function(resp) {
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            return resp.blob();
        })
        .then(function(blob) {
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
                    type: result.type
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
                    });
                }
            } catch {}
        });
        return resp;
    };
})();
