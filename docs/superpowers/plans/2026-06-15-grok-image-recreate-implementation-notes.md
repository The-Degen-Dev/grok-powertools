# Grok Image Recreate Implementation Notes

## Design Decisions

- Execution is on `codex/grok-image-recreate` because the goal explicitly forbids implementing on `main`.
- Subagents implement bounded task slices, but the main thread owns integration, review, and commits to match the goal prompt.
- Task 1 utility validation is stricter than the original plan skeleton where needed: malformed base64 is rejected with decode validation, oversized references are rejected before decode allocation, and diagnostic key scrubbing catches compound cookie/auth/token variants.
- Task 2 kept trusted Grok media capture on the existing `__gpt_fetch_media` / `__gpt_fetch_media_result` blob URL bridge contract. Task 7 preserves that old contract for existing media fetch users and moves Recreate's trusted Grok media path to `__gpt_fetch_media_data_url` / `__gpt_fetch_media_data_url_result`.
- Task 3 scopes Search activation to the visible composer/editor region. Live Grok inspection showed the only visible `button[aria-label="Search"]` on clean Grok root/Imagine was a left-nav/global control, not a composer search toggle, so best-practices mode now fails fast with `chat_search_unavailable` instead of clicking it.
- Task 4 uses bounded receiver-not-ready retries and per-message timeouts for `chrome.tabs.sendMessage` because newly created MV3 tabs are not guaranteed to have content scripts ready when `tabs.create` returns.
- Task 5 keeps wiring extension-only: `manifest.json` loads recreate utilities before `content.js`, `background.js` owns one controller instance for start/abort messages, and `content.js` owns only phase-message delegation to `GrokRecreateContentActions`.
- Task 5 status handling calls `setRecreateStatus` when the Task 6 UI exists, with a fallback to the existing overlay status badge so background status messages are still observable during this wiring-only slice.
- Task 5 production background wiring sets a 150 second controller message timeout so the chat tab can wait for Grok's live response. The controller default stays shorter for focused timeout unit tests.
- Task 6 keeps Recreate Image overlay state local to `GrokOverlay`: the selected reference payload, running flag, and paste handler. It does not add storage or settings persistence.
- Task 6 uses `GrokRecreateContentActions` for local file and current-image reference capture, then sends `START_GPT_RECREATE` and `ABORT_GPT_RECREATE` through `chrome.runtime.sendMessage`.
- Task 6 preflights selected, dropped, and pasted files against shared recreate MIME and byte limits before reading them as data URLs.
- Task 6 clears the stored reference before any new file or current-image capture attempt so failed reselections cannot submit a stale previous image.
- Task 7 returns data URLs directly from the MAIN-world bridge for trusted Grok media, avoiding a content-script blob URL refetch for Recreate Image current-media capture.
- Task 7 rejects malformed bridge data URL results at the helper boundary before later reference normalization.
- Task 8 keeps background chat-phase failures fail-fast and records the regression with `chat_upload_input_missing` so the workflow cannot continue to Imagine after a missing chat upload input.
- Task 8 makes content bridge catch responses diagnostic-only: helper errors always return `phase: content`, preserve the run ID and trusted error code, and include only URL/title page diagnostics.
- Task 8 status rendering now includes phase context, for example `chat: chat_upload_input_missing`, instead of showing only the raw error code.
- Task 8 treats generic exception messages as `workflow_failed` in content bridge responses so arbitrary prompt or data URL text cannot leak through `error`.
- Final review changed the Recreate Grok Search toggle to default off. Live Grok currently exposes only a left-nav/global Search button, so default-on Search makes the default workflow fail before submission. Explicit Search opt-in still uses the composer-scoped verification path and fails fast with `chat_search_unavailable` when Grok does not expose a verifiable composer Search control.
- 2026-06-17 live fix added a direct/background fetch path for `https://imagine-public.x.ai` current-image references. Live Grok exposes Discover/current images from that host, and page canvas export is tainted by cross-origin media.
- 2026-06-17 live fix tightened upload input selection to exclude the extension overlay's own `#gptRecreateFileInput` and prefer Grok's composer file input.
- 2026-06-17 live fix waits for the chat upload input after opening the new Grok tab. Live `tabs.create` can return before Grok mounts the composer.
- 2026-06-17 live fix accepts Grok's current small uploaded thumbnail shape: a visible 34 px rendered `assets.grok.com/.../preview-image` near the `Attach` button, with larger natural dimensions.
- 2026-06-17 result-validation fix changes the success criterion from "Imagine submit clicked" to "new generated result card verified." The workflow now snapshots pre-submit result cards, rejects stale cards, rejects low-resolution placeholder data URL cards, and returns success only after a trusted Grok media URL or materially larger generated data/blob image appears.
- 2026-06-17 result-validation fix preserves useful content diagnostics such as placeholder counts while scrubbing image data URLs and other sensitive diagnostic fields at the content bridge boundary.

## Deviations

- Task 5 E2E smoke tests mock `GrokRecreateContentActions` for chat and Imagine dispatch. This validates extension wiring and message contracts only, not live Grok DOM behavior.
- Task 6 mocked E2E coverage validates overlay rendering, local file selection, and start-message wiring only. It does not validate live Grok DOM behavior, actual uploads, tab orchestration, or Grok Search activation.
- The initial plan asked to keep Grok Search enabled for the final live run. Current live Grok made that impossible without clicking an unrelated left-nav Search control, so the usable default is now no-search and Search remains an explicit fail-fast opt-in.

## Tradeoffs

- Task 5 records the generated Imagine prompt through the existing prompt history helper only after a successful mocked or real Imagine step response. It does not add any new storage path.
- Task 5 adds a narrow background wiring unit test for the production timeout option because mocked E2E actions return instantly and would not catch this live-path timeout regression.
- Task 6 leaves the Grok Search checkbox as a per-run UI control only. Persisting it would add settings surface area outside this task.
- Task 6 keeps Start hidden while an abort is unwinding. The overlay shows a stopping state until the original start request settles so quick restarts do not collide with the active background workflow.
- Task 6 only accepts image paste events when focus or the paste target is inside the Recreate Image section. This avoids stealing image pastes intended for the Grok composer.
- Task 7 keeps `fetchViaBridgeAsBlobUrl` exported so existing blob URL bridge tests and non-Recreate media fetch callers remain covered.

## Open Questions

- None yet.

## Automated Validation

- Task 1:
  - `npm run test:unit -- tests/unit/recreateWorkflowUtils.test.js` passed with 10 tests.
  - `npx eslint recreateWorkflowUtils.js tests/unit/recreateWorkflowUtils.test.js` passed.
  - Spec review: approved after base64 and diagnostic-scrub fixes.
  - Code-quality review: approved after compound sensitive-key and oversize-before-decode fixes.
- Task 2:
  - `npm run test:unit -- tests/unit/recreateWorkflowContent.test.js` passed with 12 tests.
  - `npx eslint recreateWorkflowContent.js tests/unit/recreateWorkflowContent.test.js` passed.
  - Spec review: approved after mapping conversion failures to `reference_capture_failed`.
  - Code-quality review: approved after enforcing async predicate timeouts and restoring test `global.fetch`.
- Task 3:
  - `npm run test:unit -- tests/unit/recreateWorkflowContent.test.js` passed with 35 tests.
  - `npx eslint recreateWorkflowContent.js tests/unit/recreateWorkflowContent.test.js` passed.
  - Spec review: approved after editor targeting required a visible Grok-labeled editor and Search was composer-scoped.
  - Code-quality review: approved after upload preview snapshotting and pointer/mouse click sequencing.
- Task 4:
  - `npm run test:unit -- tests/unit/recreateWorkflowBackground.test.js` passed with 12 tests.
  - `npx eslint recreateWorkflowBackground.js tests/unit/recreateWorkflowBackground.test.js jest.setup.js` passed.
  - Spec review: approved after requiring non-empty generated prompts, explicit Imagine submission confirmation, and named tab failures.
  - Code-quality review: approved after bounded receiver-not-ready retry and per-message timeout handling.
- Task 5:
  - `npm run test:unit` passed with 241 tests.
  - `npm run test:unit -- tests/unit/backgroundRecreateWorkflow.test.js tests/unit/recreateWorkflowBackground.test.js tests/unit/recreateWorkflowContent.test.js` passed with 48 tests.
  - `npm run test:e2e` passed with 7 tests.
  - `npm run lint` passed with warnings only. The warnings are existing unused-variable warnings outside the Task 5 changes.
- Task 6:
  - `npm run test:e2e -- tests/e2e/extension.spec.js -g "Recreate Image"` passed with 6 tests.
  - `npm run test:e2e -- tests/e2e/extension.spec.js` passed with 13 tests.
  - `npm run test:unit` passed with 241 tests.
  - `npx eslint content.js tests/e2e/extension.spec.js` passed with warnings and 0 errors. The warnings are unused-variable warnings outside the Task 6 additions.
- Task 7:
  - `npm run test:unit -- tests/unit/recreateWorkflowContent.test.js -t "sourceToDataUrl dispatches"` passed with 1 matching test.
  - `npm run test:unit -- tests/unit/recreateWorkflowContent.test.js` passed with 38 tests.
  - `npx eslint bridge.js recreateWorkflowContent.js tests/unit/recreateWorkflowContent.test.js` passed with 0 errors and 1 pre-existing warning in `bridge.js`.
  - `git diff --check -- bridge.js recreateWorkflowContent.js tests/unit/recreateWorkflowContent.test.js docs/superpowers/plans/2026-06-15-grok-image-recreate-implementation-notes.md` passed.
- Task 8:
  - `npm run test:unit -- tests/unit/recreateWorkflowBackground.test.js tests/unit/recreateWorkflowContent.test.js` passed with 54 tests.
  - `npm run test:unit` passed with 248 tests.
  - `npm run test:e2e -- tests/e2e/extension.spec.js -g "Recreate content bridge should handle status messages"` passed with 1 test.
  - `npm run test:e2e -- tests/e2e/extension.spec.js` passed with 13 tests.
  - `npx eslint recreateWorkflowBackground.js content.js tests/unit/recreateWorkflowBackground.test.js tests/unit/recreateWorkflowContent.test.js tests/e2e/extension.spec.js` passed with 0 errors and 7 pre-existing warnings in `content.js`.
- Task 9:
  - `npm run test:unit` passed with 248 tests.
  - `npm run test:e2e` passed with 14 tests after adding explicit Grok Search opt-in coverage.
  - `npm run lint` passed with 0 errors and 19 pre-existing warnings.
- 2026-06-17 live-fix focused checks:
  - `npm run test:unit -- tests/unit/recreateWorkflowContent.test.js` passed with 48 tests.
  - `npx eslint recreateWorkflowContent.js tests/unit/recreateWorkflowContent.test.js` passed.
- 2026-06-17 final full gates:
  - `npm run test:unit` passed with 258 tests.
  - `npm run test:e2e` passed with 14 tests.
  - `npm run lint` passed.
  - `git diff --check -- background.js content.js recreateWorkflowContent.js recreateWorkflowUtils.js tests/unit/backgroundRecreateWorkflow.test.js tests/unit/recreateWorkflowContent.test.js tests/unit/recreateWorkflowUtils.test.js docs/superpowers/plans/2026-06-15-grok-image-recreate-implementation-notes.md` passed.
- 2026-06-17 result-validation focused checks:
  - `npm test -- --runTestsByPath tests/unit/recreateWorkflowContent.test.js tests/unit/recreateWorkflowBackground.test.js` initially failed because content error diagnostics propagated a `data:image` payload.
  - `npm run test:unit -- --runTestsByPath tests/unit/recreateWorkflowContent.test.js tests/unit/recreateWorkflowBackground.test.js` passed with 66 tests after adding bridge diagnostic scrubbing.
  - `git diff --check -- recreateWorkflowContent.js recreateWorkflowBackground.js content.js tests/unit/recreateWorkflowContent.test.js tests/unit/recreateWorkflowBackground.test.js` passed.

## Live Grok Validation

- 2026-06-16 live Chrome validation against `https://grok.com/imagine` passed for the no-search path after the unpacked extension was manually reloaded.
- Source intake:
  - The supported Chrome file chooser upload path failed with the Chrome runtime error `Not allowed`. Per Chrome file-management guidance, this points to the Codex Chrome extension needing "Allow access to file URLs" before local file chooser uploads can be automated.
  - Recreate paste intake succeeded with the harmless local PNG `/tmp/grok-recreate-reference.png`; overlay status changed to `Selected clipboard.png (0 KB)`.
- Search-enabled fail-fast:
  - With Grok Search enabled, the live run stopped at `content: chat_search_unavailable`.
  - Live chat inspection showed only the left-nav/global `button[aria-label="Search"]` at `data-active="false"`, not a composer-scoped Search control. This validates the intentional Task 3 fail-fast behavior.
- No-search workflow:
  - Grok Search was disabled in the overlay for the validation run. A final review fix changed this to the UI default so the default workflow matches current live Grok.
  - Overlay status moved from `chat: Opening Grok chat tab...` to `Submitted to Grok Imagine.` in about 12 seconds.
  - The chat tab created a new Grok conversation URL under `/c/...`, retained visible uploaded image content, and contained the exact `FINAL_IMAGINE_PROMPT:` marker. The generated prompt text was not copied into notes.
  - The Imagine tab remained on `https://grok.com/imagine`; after submission the editor was empty, Submit was disabled, Upload was visible, and the overlay showed `Submitted to Grok Imagine.`. This is consistent with a successful auto-submit.
- 2026-06-16 final live Chrome validation after reloading the updated extension:
  - Actual Computer Use verified Chrome was focused on `https://grok.com/imagine` and the Grok Downloader extension had access to the site.
  - DOM inspection confirmed the Recreate Grok Search checkbox was unchecked by default and no longer had a `checked` attribute.
  - Paste intake succeeded again with the harmless local PNG; overlay status changed to `Selected clipboard.png (0 KB)`.
  - The default no-search run moved from `chat: Opening Grok chat tab...` to `Submitted to Grok Imagine.` in about 38 seconds.
  - The chat tab used a new `/c/...` conversation, retained one visible uploaded image, and contained the exact `FINAL_IMAGINE_PROMPT:` marker. The generated prompt text was not copied into notes.
  - The Imagine tab remained on `https://grok.com/imagine`; after submission the editor was empty, Submit was disabled, Upload was visible, Search was still unchecked, and the overlay showed `Submitted to Grok Imagine.`.
- 2026-06-17 live Chrome validation against `https://grok.com/imagine` reproduced and fixed the user-reported missing-image failure:
  - Initial live run opened a Grok chat tab and sent the instruction, but Grok responded as if no image was attached. Root cause: upload input matching could choose the extension overlay file input and preview detection did not prove a Grok composer attachment.
  - Current-image capture initially failed with `reference_capture_failed` because visible Discover images came from `https://imagine-public.x.ai` and canvas export was tainted. Node fetch of the same public image URL succeeded, so the fix added public image fetch with background fallback.
  - Extension reload behavior was verified manually in `chrome://extensions/?id=bcjoehhhmhpjmlmjhojcokmfeafcmimd`. Chrome point coordinates were 2x the first attempted coordinate space; the reliable reload path was to re-enable the unpacked extension and confirm the details page showed `On`.
  - After fixes, `Current` selected the visible Grok image and `Start Recreate` created a real `/c/...` Grok conversation.
  - The chat conversation contained the user instruction text, one visible uploaded reference thumbnail, and an assistant message with the `FINAL_IMAGINE_PROMPT:` marker.
  - The source Imagine tab showed `Submitted to Grok Imagine.` after the generated prompt was returned from chat.
  - The Imagine editor was empty after submit and the Submit button was disabled, consistent with successful auto-submit.
  - Evidence screenshots were saved only under `/tmp`: `/tmp/grok-recreate-chat-submitted.png` and `/tmp/grok-recreate-imagine-submitted.png`.
- 2026-06-17 user review showed the previous live acceptance was insufficient:
  - The workflow had treated `Submitted to Grok Imagine.` as done, but the visible result cards were four blurry/gray outputs.
  - Live DOM inspection of the same `https://grok.com/imagine` tab showed four visible `img[alt="Generated image"]` cards with `data:image/png` sources, natural dimensions `144x256`, rendered around `354x433`, and zero trusted/high-resolution result candidates.
  - The result-validation fix would classify that state as placeholder/unverified instead of success.
- 2026-06-18 live retry after Chrome restart used a harmless local system image copied to `/tmp/grok-recreate-test.png`:
  - Source intake succeeded through clipboard paste after focusing `#gptRecreateDropzone`; overlay status changed to `Selected image.png (582 KB)`.
  - The run moved from `chat: Opening Grok chat tab...` to `imagine: Submitting prompt and waiting for generated images...`.
  - Grok showed four visible `img[alt="Generated image"]` cards with `data:image` sources, natural dimensions `144x256`, and rendered dimensions about `354x433`.
  - The updated workflow did not report success. It stopped with `content: imagine_result_placeholder`, hid Stop again, and the placeholders remained unchanged for the next minute of passive polling.
  - Evidence screenshot was saved under `/tmp/grok-placeholder-fail.png`.
- 2026-06-19 live validation finally met the actual acceptance bar:
  - Root causes found during the run:
    - The overlay could cover Grok submit buttons, so native click dispatch could report success without Grok receiving the click.
    - Chat submit needed a post-click proof that the prompt left the editor; otherwise it could wait on an answer for a message that was never sent.
    - The page-world editor bridge could leave the contenteditable editor empty, so the content action now falls back to direct contenteditable insertion and verifies the instruction text before submit.
    - Chrome extension reload verification must clear the `chrome://extensions` search filter first; otherwise the Grok extension card can be hidden and a coordinate reload can hit the wrong area.
  - Verified flow used `/tmp/grok-recreate-geometry-reference-live.png`, a clean 768x1024 PNG with a black-framed beige square, red circle, green triangle, blue square, yellow circle, and purple diagonal shapes.
  - Overlay intake on the existing `https://grok.com/imagine` source tab showed `Selected image.png (9 KB)`.
  - After `Start Recreate`, the chat phase navigated to a real `/c/...` Grok conversation URL and then returned to Imagine.
  - Final open post: `https://grok.com/imagine/post/467cd7c9-25b6-4912-beca-918cfdeb252b`.
  - Trusted result media: `https://imagine-public.x.ai/imagine-public/images/467cd7c9-25b6-4912-beca-918cfdeb252b.jpg`.
  - Download proof: `/tmp/grok-extension-final-result.jpg`, JPEG, `720x1280`.
  - Visual proof: the generated image recreated the framed beige composition with a red circle, central green triangle, blue square, yellow bottom circle, purple diagonal/diamond shapes, saturated flat fills, and heavy black outlines.
  - Overlay status on the final post included `Generated image ready.`.
  - Focused validation before the live run: `npm run test:unit -- --runTestsByPath tests/unit/recreateWorkflowContent.test.js tests/unit/recreateWorkflowUtils.test.js tests/unit/recreateWorkflowBackground.test.js tests/unit/backgroundRecreateWorkflow.test.js` passed with 91 tests, and `npm run lint` passed.
- 2026-06-19 follow-up live validation after the user reported a newly opened Imagine tab without the extension:
  - Root causes found during the follow-up:
    - Newly created Grok tabs could receive workflow messages before the content scripts were available. The background controller now waits for tab readiness and injects the recreate script/CSS stack once before retrying a `Receiving end does not exist` message.
    - Grok post detail images often use the generated prompt as the `alt` text instead of `Generated image`. Current-image selection now accepts visible trusted Grok media URLs even when the alt text is prompt text.
  - Extension reload was verified through the existing Chrome extensions tab, then the active Grok post was refreshed.
  - `Current` on a Grok post detail page selected the visible public Grok image instead of returning `reference_missing`.
  - The recreated live run reached a final Grok Imagine post with the extension overlay injected and visible.
  - Final open post: `https://grok.com/imagine/post/a701bd58-c865-41d8-aea9-10075d004e7f`.
  - Trusted result media: `https://imagine-public.x.ai/imagine-public/images/a701bd58-c865-41d8-aea9-10075d004e7f.jpg`.
  - Download proof: `/tmp/grok-recreate-a701bd58.jpg`, JPEG, `720x1280`.
  - Visual proof: the generated image recreated the framed geometric reference with a red circle, central green triangle, blue square, yellow circle, purple shapes, saturated flat fills, and heavy black outlines.
  - Computer Use verified the active Chrome tab URL, the visible generated result image, and the `Grok Power Tools` overlay on the final Grok post.
  - Validation after the live run: `npm run test:unit -- --runTestsByPath tests/unit/recreateWorkflowContent.test.js tests/unit/recreateWorkflowBackground.test.js tests/unit/recreateWorkflowUtils.test.js tests/unit/backgroundRecreateWorkflow.test.js` passed with 92 tests, `npm run test:unit` passed with 275 tests, `npm run lint` passed, `npm run test:e2e` passed with 14 tests after installing the missing Playwright Chromium browser, `npm test` passed, and `git diff --check` passed for the changed extension workflow files.
- 2026-06-20 live validation after a careful overlay-state check:
  - Initial visual automation incorrectly treated the overlay as missing because it checked the wrong overlay root ID and did not account for the minimized overlay state. The speculative overlay-recovery edit was removed before continuing.
  - Computer Use confirmed the expanded overlay on the active `https://grok.com/imagine` tab and selected the harmless local reference `/Users/philipbankier/Documents/grok-recreate-careful-reference.png`.
  - After `Start Recreate`, the workflow opened a real Grok chat conversation, attached the reference image, submitted the recreate prompt after the upload finished, returned to the original Imagine surface, submitted the generated prompt, and opened a final Grok Imagine post.
  - Final open post: `https://grok.com/imagine/post/298c8bfe-59b4-41a9-be54-4c2226a85041`.
  - Trusted result media: `https://imagine-public.x.ai/imagine-public/images/298c8bfe-59b4-41a9-be54-4c2226a85041.jpg`.
  - Download proof: `/tmp/grok-recreate-output.jpg`, JPEG, `720x1280`.
  - Visual proof: the generated image opened locally and showed a beige-background framed geometric composition with a red circle, central green triangle, purple diamond, and heavy black outlines.
  - Overlay status on the final post was `Generated image ready.`.
  - Validation after the live run: focused recreate unit tests passed with 92 tests, full root unit tests passed with 276 tests, `tests/e2e` passed with 14 tests, `eslint . --ext .js` passed, and `git diff --check` passed for the changed extension workflow files.
- No data URLs, cookies, auth values, or generated prompt text were written to notes.

## Selector Notes

- Live Chrome inspection on 2026-06-16, read-only, clean tabs:
  - `https://grok.com/` exposes a visible contenteditable editor with `aria-label="Ask Grok anything"`, a visible `button[aria-label="Attach"]`, and hidden file inputs. The attachment file input had no `accept` value and `multiple=true`.
  - `https://grok.com/imagine` exposes a visible contenteditable editor with `aria-label="Ask Grok anything"`, a visible `button[aria-label="Upload"]`, a disabled `button[aria-label="Submit"]` before prompt entry, Image/Video/Agent mode buttons, and Speed/Quality controls.
  - Both clean pages exposed a visible `button[aria-label="Search"]` at the left nav/global position with `data-active="false"` and `data-state="closed"`. It was not inside the composer/editor region.
  - A temporary clean Grok tab click on that left-nav Search control did not make it active. The workflow should not treat it as best-practices search.
- Live Chrome validation on 2026-06-16, write path:
  - Recreate overlay controls appeared after manual unpacked-extension reload and Grok tab refresh.
  - `#gptRecreateSection`, `#gptRecreateDropzone`, `#gptRecreateBestPractices`, `#gptRecreateStartBtn`, and `#gptRecreateStatus` were visible after expanding the overlay.
  - The no-search validation reused the same Grok selectors: chat editor `aria-label="Ask Grok anything"`, chat Attach button `aria-label="Attach"`, chat upload preview image detection, chat marker extraction with `FINAL_IMAGINE_PROMPT:`, Imagine editor `aria-label="Ask Grok anything"`, and Imagine Submit button `aria-label="Submit"`.
- Live Chrome validation on 2026-06-17, write path:
  - Chat upload input: `<input class="hidden" multiple type="file" name="files">`; `accept` was empty, `multiple` was true.
  - Chat upload button: `button[aria-label="Attach"]`.
  - Uploaded reference preview: visible `assets.grok.com/users/.../preview-image` thumbnail, rendered about 34 by 34 px near the Attach button.
  - Imagine status proof: overlay `#gptRecreateStatus` text was `Submitted to Grok Imagine.` after chat marker extraction and Imagine submit.
