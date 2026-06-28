# Video/GIF Recreate Design

## Context

Grok Power Tools already ships Image Recreate: pick an image, ask Grok chat to produce a Grok Imagine prompt, submit that prompt back to Grok Imagine, and verify a new openable image result. This spec extends that workflow to short video and GIF references without changing the working image path except for shared helpers covered by tests.

Canonical fixture:

- Source post: https://grok.com/imagine/post/9171bd6b-496d-49ee-a91e-e82c9e392b6c
- Local MP4: `/tmp/grok-video-example-9171bd6b.mp4`
- Contact sheet: `/tmp/grok-video-example-9171bd6b-contact.jpg`
- Source prompt metadata: `he catches up with her and embraces her slowly`

Live discovery on 2026-06-24 found:

- Grok Imagine exposes `Image`, `Video`, and `Agent` composer modes.
- Video mode exposes resolution controls `480p` and `720p`, with `720p` selected.
- Video mode exposes duration controls `6s` and `10s`, with `10s` selected.
- Prompt entry works in Video mode and enables Submit.
- Grok may rate-limit 720p and auto-downgrade to 480p while still producing a valid 10-second video.
- Public post HTML exposes `og:video` on `imagine-public.x.ai/...share-videos/..._1080_hd.mp4`.
- Plain unauthenticated CLI fetch of that MP4 returns HTTP 403.
- Grok server config reports video mode enabled and `web_file_upload.max_upload_video_size_mb:150`.
- Live generated output can surface as authenticated `assets.grok.com/.../generated_video.mp4?cache=1` on an opened `/imagine/post/...` page.

## Goals

- Accept local `mp4`, `mov`, `webm`, and `gif` files as recreate references.
- Accept Grok Imagine post URLs and direct trusted Grok video URLs as recreate references.
- Produce a Grok Imagine-specific video prompt from reference motion, not generic video-model wording.
- Submit the generated prompt to Grok Imagine Video mode.
- Verify success only from a new generated video/post with playable or fetchable video media.
- Record enough run data to compare prompt changes, Grok behavior changes, and output quality over time.

## Non-Goals

- No broad model router.
- No separate evaluation platform.
- No hidden Deep Lab workflow inside the one-click path.
- No full visual similarity scoring in this slice.
- No changes to unrelated batch, retry, vault, web app, or cloud surfaces unless a shared helper needs a covered fix.
- No exact-copy claims. The workflow is recreation by prompt and motion structure, not deterministic duplication.

## Inputs

Supported local files:

- `video/mp4`
- `video/quicktime`
- `video/webm`
- `image/gif`

Supported URL inputs:

- `https://grok.com/imagine/post/<id>`
- Trusted Grok media URLs on `imagine-public.x.ai`, `images-public.x.ai`, and `assets.grok.com` when the media type is video or a reference poster is available.

Input limits:

- Keep the existing 8 MB image data URL limit for Image Recreate.
- Add a separate video reference limit. Start at 32 MB for in-extension local payloads to avoid brittle MV3 message payloads.
- Grok itself may accept larger video files, but the extension should not pass huge video bytes through runtime messages in this slice.
- For larger references, prefer URL/post ingestion plus metadata and frame extraction when available.

## Reference Model

Add a media-aware reference shape while preserving the existing image fields:

- `kind`: `image` or `video`
- `name`
- `mimeType`
- `source`: `local`, `paste`, `drop`, `current-grok-image`, `grok-post-url`, `grok-video-url`
- `byteLength`
- `dataUrl` for image references and small local video/GIF references
- `url` for Grok post/media URL references
- `metadata`: duration, dimensions, fps, detected poster URL, and source prompt if known
- `frames`: representative frame data URLs or a contact sheet data URL when sampled

Existing Image Recreate should continue to call the same public action names. New helper names should be media-specific where behavior differs.

## Frame Sampling

For local MP4/MOV/WebM:

- Use browser APIs first: `HTMLVideoElement`, object URL, canvas draws, and `loadedmetadata`.
- Sample at least 5 frames for normal clips: start, early action, midpoint, late action, final frame.
- For clips over 8 seconds, sample 7 to 9 frames if browser decode is reliable.
- Build a single contact sheet JPEG data URL from sampled frames.
- Capture metadata: duration, width, height, fps when available, and frame count sampled.

For GIF:

- Treat animated GIF as a motion reference, not a static image.
- Browser-native GIF frame extraction is weak. The V1 path uploads the GIF file when Grok chat accepts it; otherwise use the first visible frame and marks `gifFrameSamplingLimited` in metadata.
- Do not pretend GIF temporal analysis is complete unless real multi-frame extraction is implemented.

For Grok post URLs:

- Fetch public HTML metadata when available: description, `og:image`, `og:video`.
- If direct video fetch 403s, record `requires_browser_fetch`.
- Use page/bridge fetch for authenticated media when running inside Grok.
- If the video bytes cannot be fetched, still use post description plus poster/contact image as prompt context, but mark output confidence lower in the ledger.

## Prompt Strategy

Create a separate video instruction builder. It should ask Grok chat for one final Grok Imagine Video prompt and should give Grok the right product context:

- Grok Imagine is not Runway, Midjourney, Stable Diffusion, or a generic video model.
- Use concrete visible motion and composition language.
- Describe the opening frame, motion beats, camera movement, subject continuity, setting, lighting, style, and ending frame.
- Preserve temporal order.
- Avoid keyword soup.
- Avoid claims like `exactly matching the reference`.
- Avoid mentioning the analysis instructions or source attachment mechanics.
- Return exactly one marker: `FINAL_IMAGINE_VIDEO_PROMPT:`.

For the canonical clip, the output should preserve:

- Beach setting, sunny natural light, casual cinematic realism.
- Woman in red swimwear moving along the shore.
- Man catching up from behind or from the waterline.
- Slow affectionate embrace as the final beat.
- Smooth, continuous, natural camera and body motion.

## UI

Keep the current card compact.

Preferred V1 UI:

- Rename card from `Recreate Image` to `Recreate Media`.
- Dropzone text: `Drop, paste, choose image/video/GIF, or use current Grok image`.
- File picker accepts existing image types plus `video/mp4`, `video/quicktime`, `video/webm`, and `image/gif`.
- Add a small selected-reference status that includes detected kind, size, and duration when known.
- Keep `Current` image-only for now unless current Grok video capture is implemented and verified.
- `Start Recreate` routes by `reference.kind`.

Do not add a separate dashboard in this slice.

## Workflow

Image path:

1. Keep current behavior.
2. Ensure any shared helper change is covered by existing image tests.

Video/GIF path:

1. Normalize selected reference as `kind: video`.
2. Extract or fetch metadata and representative frames/contact sheet where possible.
3. Open Grok chat.
4. Upload either the original reference when supported, or contact sheet/frames plus metadata when not.
5. Ask Grok chat for `FINAL_IMAGINE_VIDEO_PROMPT:`.
6. Open/reuse Grok Imagine.
7. Select Video mode.
8. Inject the generated video prompt.
9. Submit only when submit is enabled and quota does not block the selected settings.
10. Snapshot existing results before submit.
11. Wait for a new video result/post.
12. Verify video media is playable/openable/fetchable as video bytes.
13. Write ledger entry.

## Result Validation

A successful video recreate run requires all of:

- A submit action was sent.
- A new result appeared after the pre-submit snapshot.
- The new result is video, not just a still image.
- The result opens to a Grok Imagine post or exposes a trusted video URL/blob.
- The video bytes can be fetched through raw, background, or page/bridge path, or the opened Grok post video element reports playable media with duration, dimensions, and loaded/decoded state.
- The result is not a stale Discover card, existing history item, placeholder, broken template video, or image-only result.

Video candidates should include:

- `video` elements with visible size and `currentSrc` or nested `source`.
- Links/cards that navigate to `/imagine/post/<id>` and contain a video marker.
- Trusted Grok video URLs with paths containing `share-videos` or authenticated `assets.grok.com` generated video files.
- Blob URLs that can be opened and inspected as video.

Failure codes should distinguish:

- `video_mode_unavailable`
- `video_quota_limited`
- `video_reference_invalid`
- `video_metadata_failed`
- `video_frame_sampling_failed`
- `video_prompt_marker_missing`
- `video_submit_failed`
- `video_result_timeout`
- `video_result_unopenable`
- `video_result_not_video`

## Ledger

Store local recreate run ledger entries in `chrome.storage.local`.

Key fields:

- `runId`
- `createdAt`
- `referenceKind`
- `referenceSource`
- `referenceName`
- `referenceMimeType`
- `sourceUrl`
- `sourceHash`
- `sourceByteLength`
- `durationSec`
- `width`
- `height`
- `fps`
- `frameSampleCount`
- `promptVersion`
- `generatedPrompt`
- `imagineMode`
- `videoResolution`
- `videoDuration`
- `resultUrl`
- `resultMediaUrl`
- `resultHash`
- `resultByteLength`
- `status`
- `failureCode`
- `subjectiveNotes`

Do not store cookies, auth headers, signed URLs beyond their visible public URL form, or full local video bytes in the ledger.

## Tests

Unit tests:

- Video MIME and source normalization in `recreateWorkflowUtils.test.js`.
- Prompt marker extraction for `FINAL_IMAGINE_VIDEO_PROMPT:`.
- Video instruction builder includes Grok Imagine-specific video context and excludes exact-copy wording.
- Frame/contact-sheet helpers with mocked video/canvas where practical.
- Video mode selection and submit routing in `recreateWorkflowContent.test.js`.
- Video result candidate classification and openability failure codes.
- Background controller passes `targetMode: video` and records video result requirements.

E2E/mocked extension tests:

- File picker accepts a mocked MP4/GIF reference.
- Overlay status displays video metadata.
- `START_GPT_RECREATE` payload includes `kind: video`.
- Image recreate payload remains unchanged for image references.

Live validation:

- Use canonical clip.
- Confirm generated prompt goes into Grok Imagine Video mode.
- Confirm a new generated video/post appears after quota allows generation.
- Confirm generated media is playable/openable/fetchable as video bytes.

## Implementation Notes

- Prefer browser sampling over adding a heavy ffmpeg dependency to the extension.
- Keep CLI `ffmpeg`/`ffprobe` use only for local development fixtures and notes.
- Keep direct public fetch as the first attempt for public media, but fallback through background and bridge paths.
- Do not rely on DevTools MCP for final validation; it timed out repeatedly. Use visible Chrome/Computer Use plus extension behavior evidence.
- Update `implementation-notes.html` after each meaningful divergence or live finding.
