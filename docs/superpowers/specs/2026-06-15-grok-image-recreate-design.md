# Grok Image Recreate Workflow Design

## Context

The current product has three surfaces:

- The Chrome extension at the repo root controls live Grok pages through `content.js`, `background.js`, and `bridge.js`.
- The web app under `web/` handles collections, prompt library, editing, movie maker, sharing, auth, and sync.
- The Cloudflare Worker under `cloud/` handles R2 upload and sync.

This feature starts as a Chrome extension workflow because the extension already controls `grok.com` pages and can reuse the existing overlay, tab messaging, prompt history, and `bridge.js` TipTap insertion path. The web app becomes a later caller after the browser workflow works reliably.

Live Chrome inspection on 2026-06-15 found these current Grok UI facts:

- Grok chat exposes a visible `contenteditable` textbox with `aria-label="Ask Grok anything"`.
- Grok chat exposes a visible `button[aria-label="Attach"]` and hidden `input[type="file"]` controls.
- Grok Imagine exposes the same editor label, a visible `button[aria-label="Upload"]`, a disabled `button[aria-label="Submit"]` before prompt entry, Image/Video/Agent mode buttons, Speed/Quality controls, and aspect ratio controls.
- Current visible Imagine images can appear as `data:image/...` sources, not only `imagine-public.x.ai` or `assets.grok.com` URLs.

## Goal

Add a two-tab extension workflow that recreates a reference image:

1. Accept a reference image from local file, paste, drag/drop, or the currently visible Grok image.
2. Use a Grok chat tab to analyze the reference and produce a Grok Imagine prompt.
3. Use a separate Grok Imagine tab to inject that generated prompt.
4. Auto-submit the Imagine prompt.
5. Stop immediately after submit.

The workflow is fail-fast. If any browser step cannot be verified, the run stops with a named error so selectors or assumptions can be fixed.

## Non-Goals

V1 does not include:

- Web app control.
- Queueing multiple reference images.
- Waiting for generated images to finish.
- Auto-saving or downloading the result.
- Manual fallback.
- Persisting reference images.
- Reworking prompt library, cloud sync, or R2 backup.
- Bypassing Grok safety or moderation. If Grok blocks a request, the workflow surfaces the failure.

## Architecture

The workflow has four bounded units.

`GrokOverlay` in `content.js` owns the user-facing controls:

- Recreate Image section.
- Source picker for local file, paste/drop, and current visible Grok image.
- Best-practices toggle, default on.
- Start/Stop controls.
- Status text for each phase.

`background.js` owns tab coordination:

- Creates a `runId`.
- Opens dedicated Grok chat and Imagine tabs for the active run, or reuses tabs created by the same active run.
- May reuse the current Imagine tab when the overlay starts from `https://grok.com/imagine`.
- Must not navigate unrelated existing Grok conversation tabs.
- Sends phase commands to content scripts in those tabs.
- Tracks in-memory run state and last failure.
- Routes status back to the overlay.

`content.js` owns page-level DOM work:

- Captures the current visible Grok image when selected.
- Uploads the reference image into Grok chat.
- Injects the chat instruction.
- Submits the chat request.
- Extracts the final generated prompt.
- Injects and submits the prompt in Imagine.

`bridge.js` remains the page-world helper:

- Inserts text into Grok TipTap/contenteditable editors.
- Provides any page-world access needed for editor state or cookie-bearing page fetches.

This keeps tab orchestration out of the overlay and keeps page-specific selectors out of the service worker.

## User Flow

The overlay gets a new Recreate Image section.

Controls:

- Source: local image or current visible Grok image.
- Local input: file picker plus drag/drop and paste support.
- Best-practices mode: on by default. When on, the Grok chat instruction asks Grok to search current Grok Imagine prompt best practices before writing the final prompt. When off, it uses only the local instruction.
- Start.
- Stop while running.
- Status text.

Run flow:

1. User chooses or captures a reference image.
2. User clicks Start.
3. The extension validates the reference image before opening tabs.
4. The background script opens a dedicated Grok chat tab.
5. The chat content script uploads the image, injects the instruction, submits, waits for the answer, and extracts the prompt.
6. The background script opens a dedicated Grok Imagine tab, or reuses the current Imagine tab if the run started there.
7. The Imagine content script selects Image mode if needed, injects the prompt, waits until Submit is enabled, and clicks Submit.
8. The workflow stops after submit.
9. The generated prompt is added to prompt history.

## Reference Image Handling

The workflow normalizes references into:

```js
{
  name: string,
  mimeType: string,
  dataUrl: string,
  source: "local" | "paste" | "drop" | "current-grok-image"
}
```

Validation rules:

- `mimeType` must be one of `image/jpeg`, `image/png`, `image/gif`, `image/webp`, `image/bmp`, or `image/tiff`.
- `dataUrl` must start with `data:image/`.
- The decoded payload must be non-empty.
- The reference image is held in memory for the active run only.

Current Grok image selection:

- Prefer visible `img[alt="Generated image"]` elements with natural size above 256 px in either dimension.
- If multiple candidates are visible, pick the image nearest the viewport center.
- Support `data:image/...`, `blob:`, and trusted Grok media URLs.
- Convert the selected image to a data URL before sending it to the background workflow.
- For trusted Grok media URLs, use page-world fetch through `bridge.js` when page cookies are required.
- If conversion to a data URL fails, stop with `reference_capture_failed`.

## Chat Instruction

The chat instruction should force a strict extraction marker:

```text
You are creating a Grok Imagine prompt from the attached reference image.

Analyze composition, subject, pose, camera angle, focal length, lighting, color, materials, mood, background, and style. Preserve the important visual structure while avoiding references to this instruction.

If best-practices mode is enabled, use Grok search to find current Grok Imagine prompt best practices and apply them.

Return exactly one final prompt for Grok Imagine. Do not include alternatives, commentary, markdown tables, or explanations.

FINAL_IMAGINE_PROMPT:
<one ready-to-paste Grok Imagine prompt>
```

The extractor reads only content after `FINAL_IMAGINE_PROMPT:`. If the marker is missing, the run fails.

When best-practices mode is enabled, the chat content script must enable Grok Search before submitting. Current live UI exposes `button[aria-label="Search"]`. If the workflow cannot verify that Search is available or active, it stops before sending the chat request.

## Message Contracts

Background to chat content script:

```js
{
  action: "GPT_RECREATE_CHAT_STEP",
  runId,
  reference,
  bestPracticesEnabled
}
```

Chat content script response:

```js
{
  ok: true,
  runId,
  generatedPrompt
}
```

Background to Imagine content script:

```js
{
  action: "GPT_RECREATE_IMAGINE_STEP",
  runId,
  generatedPrompt,
  autoSubmit: true
}
```

Imagine content script response:

```js
{
  ok: true,
  runId,
  submitted: true
}
```

Failure response shape:

```js
{
  ok: false,
  runId,
  phase,
  error,
  diagnostics
}
```

`diagnostics` must avoid secrets, cookies, auth headers, and reference image payloads.

## Failure Handling

Each phase has a timeout and a named failure:

- `reference_missing`
- `reference_invalid`
- `reference_capture_failed`
- `chat_tab_unavailable`
- `chat_not_authenticated`
- `chat_search_unavailable`
- `chat_upload_input_missing`
- `chat_upload_preview_missing`
- `chat_editor_missing`
- `chat_submit_missing`
- `chat_answer_timeout`
- `chat_prompt_marker_missing`
- `imagine_tab_unavailable`
- `imagine_editor_missing`
- `imagine_submit_disabled`
- `imagine_submit_failed`
- `workflow_aborted`

The overlay shows the phase and concise error. Console logs include selector diagnostics and current URL/title. The workflow does not retry silently in v1.

## Testing

Required automated checks:

- Unit tests for data URL validation and reference normalization.
- Unit tests for current visible image selection rules.
- Unit tests for `FINAL_IMAGINE_PROMPT:` extraction.
- Unit tests for background workflow state transitions and fail-fast errors.
- E2E overlay smoke test confirming the Recreate Image controls render.
- Mocked content-script tests for chat and Imagine phase guards where jsdom can model them.

Required live validation:

- Reload the unpacked extension.
- Refresh Grok tabs.
- Run one controlled, harmless reference image through the full workflow on `grok.com`.
- Verify upload, chat answer extraction, Imagine prompt injection, and auto-submit.
- Document the observed selectors or drift in the implementation notes.

Root validation commands after code changes:

```bash
npm run test:unit
npm run test:e2e
npm run lint
```

## Rollout

Phase 1 is extension-only:

- Add the overlay workflow.
- Add background tab coordination.
- Add chat and Imagine page actions.
- Add tests and live validation notes.

Phase 2 adds web app control after Phase 1 works:

- Add a web app upload screen.
- Add an extension command bridge through `externally_connectable`.
- Reuse the same background workflow message contracts.
- Show run status in the web app while the extension controls Grok tabs.

Phase 2 must not start until the extension-only workflow is stable enough to run manually from the overlay.
