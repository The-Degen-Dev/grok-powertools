# Grok Image Recreate Implementation Notes

## Design Decisions

- Execution is on `codex/grok-image-recreate` because the goal explicitly forbids implementing on `main`.
- Subagents implement bounded task slices, but the main thread owns integration, review, and commits to match the goal prompt.
- Task 1 utility validation is stricter than the original plan skeleton where needed: malformed base64 is rejected with decode validation, oversized references are rejected before decode allocation, and diagnostic key scrubbing catches compound cookie/auth/token variants.
- Task 2 keeps trusted Grok media capture on the existing `__gpt_fetch_media` / `__gpt_fetch_media_result` blob URL bridge contract. The later Task 7 bridge data-URL change is intentionally deferred.
- Task 3 scopes Search activation to the visible composer/editor region. Live Grok inspection showed the only visible `button[aria-label="Search"]` on clean Grok root/Imagine was a left-nav/global control, not a composer search toggle, so best-practices mode now fails fast with `chat_search_unavailable` instead of clicking it.

## Deviations

- None yet.

## Tradeoffs

- None yet.

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

## Live Grok Validation

- Pending.

## Selector Notes

- Live Chrome inspection on 2026-06-16, read-only, clean tabs:
  - `https://grok.com/` exposes a visible contenteditable editor with `aria-label="Ask Grok anything"`, a visible `button[aria-label="Attach"]`, and hidden file inputs. The attachment file input had no `accept` value and `multiple=true`.
  - `https://grok.com/imagine` exposes a visible contenteditable editor with `aria-label="Ask Grok anything"`, a visible `button[aria-label="Upload"]`, a disabled `button[aria-label="Submit"]` before prompt entry, Image/Video/Agent mode buttons, and Speed/Quality controls.
  - Both clean pages exposed a visible `button[aria-label="Search"]` at the left nav/global position with `data-active="false"` and `data-state="closed"`. It was not inside the composer/editor region.
  - A temporary clean Grok tab click on that left-nav Search control did not make it active. The workflow should not treat it as best-practices search.
