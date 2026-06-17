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
