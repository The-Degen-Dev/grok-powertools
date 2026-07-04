# Movie Maker Review Bay Research Audit

Date: 2026-06-28

Status: Research and spec-audit pass. No implementation plan. No build.

Scope: Review the current Movie Maker Review Bay spec and Phase 1 plan against current repo reality and current browser-video tooling before planning implementation.

## Local Baseline

The current branch being audited is `codex/vault-movie-drafts-exec` in:

`/Users/philipbankier/.codex/worktrees/vault-movie-drafts-exec/chrome-extension-powertools`

The active root repo checkout at `/Users/philipbankier/Development/skunkworks/Grok-Tinker/chrome-extension-powertools` is on `main` and does not contain the new Movie Maker full-program spec. The worktree branch is the correct source for this research lane.

Current relevant commits:

- `30e4fa0 docs: add movie maker full program spec`
- `f824660 docs: audit movie review bay plan`
- `044ff3c Merge remote-tracking branch 'origin/main' into codex/vault-movie-drafts-exec`
- `dcad5aa feat: add chatgpt images provider support`

Repo state checked:

- Current Movie Maker remains a simple canvas-based editor.
- `web/src/components/movie/ExportMovieButton.tsx` exports WebM through `canvas.captureStream()` and `MediaRecorder`.
- `web/src/lib/useFFmpeg.ts` hard-codes `@ffmpeg/core@0.12.6`.
- Current package metadata reports `@ffmpeg/core` and `@ffmpeg/core-mt` at `0.12.10`, `@ffmpeg/ffmpeg` at `0.12.15`, Mediabunny at `1.49.0`, and Remotion packages at `4.0.484`.
- Root Playwright is configured at `1.57.0`; web package scripts do not list Playwright directly, but root E2E config and tests do.

## What The Spec Already Gets Right

- Product shape is right: Review Bay, not a generic full NLE clone.
- Safety boundary is right: local app work only, no R2, D1, Worker repair, processed-ID, live Grok, env, or secret changes.
- Director boundary is right: rule-based fallback, model-backed off by default, server/API boundary, schema validation, proposal-only mutations.
- Export quality bar is right: MP4 must be real MP4, audio proof must use stream inspection, WebM fallback is acceptable but cannot be relabeled.
- Data model direction is right: schema-first project state, additive IndexedDB stores, no signed URLs in stored movie records.
- UX direction is right: dense operator console, keyboard-first review, visible provenance, no landing-page shell.

## Research Findings

FFmpeg.wasm remains the safest near-term export default, but it should be treated as an engine choice, not a permanent architecture. The current docs show 0.12 single-thread core loading with `coreURL` and `wasmURL`, and multi-thread core loading with `workerURL` plus SharedArrayBuffer requirements. That means Phase 1 can use single-thread FFmpeg.wasm first, but any multithread jump needs cross-origin isolation work and explicit browser checks.

Mediabunny is the most important new tool to track. It is a browser-first media toolkit for reading, writing, and converting MP4, WebM, and other media, built around WebCodecs where available. It can mux MP4, work with canvas sources, handle audio/video tracks, and stream data. This is directly relevant because WebCodecs alone does not solve container muxing or full editor export.

Remotion is useful as a design reference for deterministic React video composition and export, but it is not automatically the right Phase 1 dependency. It brings a larger rendering model, its own licensing boundary, and can imply server or Chromium rendering unless the web-renderer path is deliberately chosen and proven. Its newer web rendering path also points back toward WebCodecs and Mediabunny-like browser media primitives.

Open-source projects show two real patterns:

- Browser-native editors are moving toward WebCodecs, Mediabunny, WebGPU, and direct MP4/WebM writing. FreeCut is the clearest current example.
- React timeline products often use a richer project graph and Remotion-backed render path. DesignCombo is the clearest example, but it is a heavier product shape than this app needs for Phase 1.

WebAV is a useful research reference for a WebCodecs-based SDK that composes video, audio, images, text, and animation and records MP4. It may be more framework than this app needs, but it validates that a browser-native MP4 route is real.

WebCodecs adds power and risk. It exposes low-level frames and samples, so implementation must close or release frame-like resources and plan fallback behavior. It also does not remove the need for MP4 muxing, browser support checks, and test fixtures.

Preview stability needs more than "do not seek every frame." The spec should require a stable timebase, `requestVideoFrameCallback` where available, last-good-frame retention, one cleanup story for object URLs and media elements, and audio state shared between preview and export.

## Spec Changes Made From This Research

The full-program spec now requires an export-engine decision gate before export work starts.

The spec now says FFmpeg.wasm is the conservative Phase 1 default, but WebCodecs plus Mediabunny can replace it only after a short proof covers MP4 plus audio, browser support, memory behavior, and testability.

The spec now says Remotion can inform future deterministic rendering architecture, but must not become a hidden server or licensing dependency for local-only Phase 1 without a separate decision record.

The spec now requires handling FFmpeg.wasm multithread SharedArrayBuffer and cross-origin isolation requirements before selecting multithread.

The spec now requires WebCodecs plans to cover browser support, MP4 muxing, frame/audio cleanup, and fallback behavior.

The spec now adds a Preview, Media, And Timebase Model requiring stable timebase math, frame callback usage where available, last-good-frame behavior, lifecycle cleanup, audio state parity, and centralized media feature detection.

The spec footgun register now includes assuming WebCodecs includes MP4 muxing, choosing FFmpeg.wasm without memory and cancellation proof, leaking media resources, and letting floating-point timeline drift create preview/export mismatches.

## Build-Plan Implications

The future build plan should start with Phase 0 verification and an export-engine spike, not direct UI coding.

The spike should compare:

- FFmpeg.wasm single-thread MP4 with AAC audio, using fixture media.
- FFmpeg.wasm multithread only if cross-origin isolation is practical in the local Next app.
- WebCodecs plus Mediabunny MP4 with audio, using the same fixture media.
- Keeping MediaRecorder only as an explicit WebM fallback, never as MP4.

The spike should produce a short decision record with:

- Browser support result.
- Memory and cancellation behavior.
- Bundle or download cost.
- Audio proof result.
- Fixture test feasibility.
- Failure path and fallback.

The Review Bay project model should use integer frame ticks or another stable timebase from the start. Do not let UI state accumulate floating-point seconds and then ask export to reproduce it.

The preview work should be done through a `useMovieMediaEngine` or equivalent boundary that owns media elements, audio graph, object URLs, frame callbacks, last-good-frame cache, feature detection, and cleanup.

The Director work should stay behind schemas and a server route. Current OpenAI-compatible and CLIProxyAPI goals still fit the research.

The Prompt Spine should stay metadata-first. Embeddings or perceptual hashing are useful later, but Phase 2 should first prove deterministic prompt/source grouping and only add heavier analysis behind explicit thresholds and privacy/performance notes.

## Pitfalls To Avoid

- Starting with a full NLE timeline and losing the Review Bay workflow.
- Making FFmpeg.wasm a hidden hard dependency before proving it on actual fixture media.
- Adding WebCodecs without a muxer and cleanup model.
- Assuming browser MP4 export works the same across Chrome, Safari, and Firefox.
- Treating Remotion as "just a player" while accidentally importing server render assumptions.
- Using MediaRecorder output for anything that claims to be MP4.
- Creating signed URL or blob URL persistence in IndexedDB.
- Testing only silent video fixtures.
- Testing only one short clip and missing memory or cancellation behavior.
- Letting model proposals or auto-director edits bypass explicit user approval.

## Source Notes

- MDN WebCodecs API: https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API
- MDN `requestVideoFrameCallback`: https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback
- MDN SharedArrayBuffer security requirements: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer#security_requirements
- FFmpeg.wasm usage docs: https://github.com/ffmpegwasm/ffmpeg.wasm/blob/main/apps/website/docs/getting-started/usage.md
- Mediabunny docs: https://mediabunny.dev/
- Mediabunny GitHub: https://github.com/Vanilagy/mediabunny
- Remotion web renderer docs: https://www.remotion.dev/docs/web-renderer/render-media-on-web
- Remotion license docs: https://www.remotion.dev/docs/license
- FreeCut GitHub: https://github.com/walterlow/freecut
- WebAV GitHub: https://github.com/WebAV-Tech/WebAV
- DesignCombo React Video Editor GitHub: https://github.com/designcombo/react-video-editor

## Bottom Line

The Movie Maker product spec is directionally sound and safe enough to become the source of a future build plan after these research-driven edits. The biggest change is that export should be planned as a small engine decision first, not as an assumed FFmpeg-only task. The second biggest change is that timebase and resource cleanup need to be first-class acceptance criteria, because they directly affect strobing, audio sync, browser memory, and trust in exported output.
