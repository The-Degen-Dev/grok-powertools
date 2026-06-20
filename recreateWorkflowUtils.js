(function (root, factory) {
    const utils = factory();

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = utils;
    }

    if (root) {
        root.GrokRecreateWorkflowUtils = utils;
    }
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const ALLOWED_RECREATE_MIME_TYPES = [
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
        'image/bmp',
        'image/tiff'
    ];
    const ALLOWED_RECREATE_SOURCES = ['local', 'paste', 'drop', 'current-grok-image'];
    const FINAL_PROMPT_MARKER = 'FINAL_IMAGINE_PROMPT:';
    const MAX_REFERENCE_BYTES = 8 * 1024 * 1024;
    const SENSITIVE_EXACT_DIAGNOSTIC_KEYS = new Set([
        'dataurl',
        'reference'
    ]);
    const SENSITIVE_DIAGNOSTIC_KEY_SUBSTRINGS = [
        'cookie',
        'authheader',
        'authorization',
        'token',
        'apikey',
        'password',
        'secret',
        'bearer'
    ];

    function fail(error) {
        const wrapped = new Error(error);
        wrapped.code = error;
        return wrapped;
    }

    function createRecreateRunId(now = Date.now()) {
        return `recreate_${now}_${Math.random().toString(16).slice(2, 10)}`;
    }

    function isBase64AlphabetCode(code) {
        return (
            (code >= 65 && code <= 90) ||
            (code >= 97 && code <= 122) ||
            (code >= 48 && code <= 57) ||
            code === 43 ||
            code === 47
        );
    }

    function isStrictBase64(clean) {
        if (!clean || clean.length % 4 !== 0) return false;

        const firstPaddingIndex = clean.indexOf('=');
        const contentEnd = firstPaddingIndex === -1 ? clean.length : firstPaddingIndex;

        for (let index = 0; index < contentEnd; index++) {
            if (!isBase64AlphabetCode(clean.charCodeAt(index))) return false;
        }

        if (firstPaddingIndex === -1) return true;

        const paddingCount = clean.length - firstPaddingIndex;
        if (paddingCount > 2) return false;

        for (let index = firstPaddingIndex; index < clean.length; index++) {
            if (clean[index] !== '=') return false;
        }

        return true;
    }

    function getEstimatedDecodedBase64ByteLength(clean) {
        const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
        return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
    }

    function validateBase64Decode(clean) {
        try {
            if (typeof atob === 'function') {
                if (atob(clean).length <= 0) throw fail('reference_invalid');
                return;
            }

            if (typeof Buffer !== 'undefined') {
                if (Buffer.from(clean, 'base64').length <= 0) throw fail('reference_invalid');
                return;
            }
        } catch {
            throw fail('reference_invalid');
        }
    }

    function getDecodedBase64ByteLength(base64) {
        const clean = String(base64 || '').replace(/\s+/g, '');
        if (!isStrictBase64(clean)) {
            throw fail('reference_invalid');
        }

        const estimatedByteLength = getEstimatedDecodedBase64ByteLength(clean);
        if (estimatedByteLength <= 0 || estimatedByteLength > MAX_REFERENCE_BYTES) {
            throw fail('reference_invalid');
        }

        validateBase64Decode(clean);
        return estimatedByteLength;
    }

    function parseRecreateDataUrl(dataUrl) {
        const match = String(dataUrl || '').match(/^data:([^;,]+);base64,([a-zA-Z0-9+/=\s]+)$/);
        if (!match) throw fail('reference_invalid');

        const mimeType = match[1].toLowerCase();
        if (!ALLOWED_RECREATE_MIME_TYPES.includes(mimeType)) throw fail('reference_invalid');

        const base64 = match[2].replace(/\s+/g, '');
        const byteLength = getDecodedBase64ByteLength(base64);
        if (byteLength <= 0 || byteLength > MAX_REFERENCE_BYTES) throw fail('reference_invalid');

        return { mimeType, base64, byteLength };
    }

    function normalizeRecreateReference(input) {
        if (!input || typeof input !== 'object') throw fail('reference_missing');

        const parsed = parseRecreateDataUrl(input.dataUrl);
        const mimeType = String(input.mimeType || parsed.mimeType).toLowerCase();
        if (mimeType !== parsed.mimeType || !ALLOWED_RECREATE_MIME_TYPES.includes(mimeType)) {
            throw fail('reference_invalid');
        }

        const source = ALLOWED_RECREATE_SOURCES.includes(input.source) ? input.source : 'local';
        const name = String(input.name || 'reference-image').trim().slice(0, 120) || 'reference-image';

        return {
            name,
            mimeType,
            dataUrl: String(input.dataUrl),
            source,
            byteLength: parsed.byteLength
        };
    }

    function extractFinalImaginePrompt(answerText) {
        const text = String(answerText || '');
        const markerIndex = text.indexOf(FINAL_PROMPT_MARKER);
        if (markerIndex < 0) throw fail('chat_prompt_marker_missing');

        const rawPrompt = text.slice(markerIndex + FINAL_PROMPT_MARKER.length).trim();
        const stopPatterns = [
            /\n\s*\d+\s+sources?\b/i,
            /\n\s*(?:Explore|Omit)\b/i,
            /\n\s*Agent\s+\d+\b/i,
            /\s+Agent\s+\d+\b/i,
            /\n\s*(?:Final suggestion|My final suggested prompt text)\s*:/i,
            /\s+(?:Final suggestion|My final suggested prompt text)\s*:/i
        ];
        const stopIndex = stopPatterns.reduce((earliest, pattern) => {
            const match = rawPrompt.match(pattern);
            if (!match || typeof match.index !== 'number') return earliest;
            return earliest === -1 ? match.index : Math.min(earliest, match.index);
        }, -1);
        const prompt = (stopIndex >= 0 ? rawPrompt.slice(0, stopIndex) : rawPrompt)
            .trim()
            .replace(/^["“”]+|["“”]+$/g, '')
            .trim();
        if (!prompt) throw fail('chat_prompt_marker_missing');

        return prompt;
    }

    function buildRecreateChatInstruction(options = {}) {
        const bestPracticesLine = options.bestPracticesEnabled
            ? 'If best-practices mode is enabled, use Grok search to find current Grok Imagine prompt best practices and apply them.'
            : 'Use only your visual analysis of the attached image and the prompt-writing instructions below.';

        return [
            'You are creating a Grok Imagine prompt from the attached reference image.',
            '',
            'Analyze composition, subject, pose, camera angle, focal length, lighting, color, materials, mood, background, and style. Preserve the important visual structure while avoiding references to this instruction.',
            '',
            bestPracticesLine,
            '',
            'Return exactly one final prompt for Grok Imagine. Do not include alternatives, commentary, markdown tables, or explanations.',
            '',
            FINAL_PROMPT_MARKER,
            '<one ready-to-paste Grok Imagine prompt>'
        ].join('\n');
    }

    function isTrustedGrokMediaUrl(value) {
        try {
            const parsed = new URL(String(value || ''));
            return (
                parsed.protocol === 'https:' &&
                (
                    parsed.hostname === 'imagine-public.x.ai' ||
                    parsed.hostname === 'images-public.x.ai' ||
                    parsed.hostname === 'assets.grok.com'
                )
            );
        } catch {
            return false;
        }
    }

    function isSupportedCurrentImageSrc(src) {
        const value = String(src || '');
        return value.startsWith('data:image/') || value.startsWith('blob:') || isTrustedGrokMediaUrl(value);
    }

    function isLikelyGeneratedImageCandidate(candidate) {
        if (!candidate) return false;
        if (String(candidate.alt || '').trim() === 'Generated image') return true;
        return isTrustedGrokMediaUrl(candidate.src);
    }

    function isVisibleRect(rect) {
        if (!rect) return false;
        return Number(rect.width || 0) > 0 && Number(rect.height || 0) > 0;
    }

    function intersectsViewport(rect, viewport) {
        if (!isVisibleRect(rect)) return false;

        const viewportWidth = viewport && Number.isFinite(viewport.width) ? viewport.width : 0;
        const viewportHeight = viewport && Number.isFinite(viewport.height) ? viewport.height : 0;
        if (viewportWidth <= 0 || viewportHeight <= 0) return true;

        const left = Number(rect.left || 0);
        const top = Number(rect.top || 0);
        const right = left + Number(rect.width || 0);
        const bottom = top + Number(rect.height || 0);

        return right > 0 && bottom > 0 && left < viewportWidth && top < viewportHeight;
    }

    function chooseBestGeneratedImageCandidate(candidates, viewport) {
        const viewportWidth = viewport && Number.isFinite(viewport.width) ? viewport.width : 0;
        const viewportHeight = viewport && Number.isFinite(viewport.height) ? viewport.height : 0;
        const centerX = viewportWidth / 2;
        const centerY = viewportHeight / 2;

        return (
            (Array.isArray(candidates) ? candidates : [])
                .filter((candidate) => {
                    if (!isLikelyGeneratedImageCandidate(candidate)) return false;
                    if (!isSupportedCurrentImageSrc(candidate.src)) return false;
                    if (!intersectsViewport(candidate.rect, viewport)) return false;
                    return Math.max(candidate.naturalWidth || 0, candidate.naturalHeight || 0) >= 256;
                })
                .map((candidate) => {
                    const rect = candidate.rect || {};
                    const x = Number(rect.left || 0) + Number(rect.width || 0) / 2;
                    const y = Number(rect.top || 0) + Number(rect.height || 0) / 2;

                    return {
                        ...candidate,
                        _distance: Math.hypot(x - centerX, y - centerY)
                    };
                })
                .sort((a, b) => a._distance - b._distance)[0] || null
        );
    }

    function shouldScrubValue(value) {
        return typeof value === 'string' && value.trimStart().startsWith('data:image/');
    }

    function scrubDiagnosticValue(value) {
        if (shouldScrubValue(value)) return undefined;

        if (Array.isArray(value)) {
            return value
                .map((entry) => scrubDiagnosticValue(entry))
                .filter((entry) => typeof entry !== 'undefined');
        }

        if (value && typeof value === 'object') {
            return scrubDiagnostics(value);
        }

        return value;
    }

    function isSensitiveDiagnosticKey(key) {
        const normalizedKey = String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        if (SENSITIVE_EXACT_DIAGNOSTIC_KEYS.has(normalizedKey)) return true;

        return SENSITIVE_DIAGNOSTIC_KEY_SUBSTRINGS.some((substring) => normalizedKey.includes(substring));
    }

    function scrubDiagnostics(diagnostics) {
        const safe = {};

        Object.entries(diagnostics || {}).forEach(([key, value]) => {
            if (isSensitiveDiagnosticKey(key)) return;

            const scrubbed = scrubDiagnosticValue(value);
            if (typeof scrubbed !== 'undefined') {
                safe[key] = scrubbed;
            }
        });

        return safe;
    }

    function buildRecreateFailure({ runId, phase, error, diagnostics }) {
        return {
            ok: false,
            runId,
            phase,
            error,
            diagnostics: scrubDiagnostics(diagnostics)
        };
    }

    return {
        ALLOWED_RECREATE_MIME_TYPES,
        FINAL_PROMPT_MARKER,
        MAX_REFERENCE_BYTES,
        buildRecreateChatInstruction,
        buildRecreateFailure,
        chooseBestGeneratedImageCandidate,
        createRecreateRunId,
        extractFinalImaginePrompt,
        isLikelyGeneratedImageCandidate,
        isSupportedCurrentImageSrc,
        isTrustedGrokMediaUrl,
        normalizeRecreateReference,
        parseRecreateDataUrl
    };
});
