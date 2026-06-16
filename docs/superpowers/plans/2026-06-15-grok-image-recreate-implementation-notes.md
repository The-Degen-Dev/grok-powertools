# Grok Image Recreate Implementation Notes

## Design Decisions

- Execution is on `codex/grok-image-recreate` because the goal explicitly forbids implementing on `main`.
- Subagents implement bounded task slices, but the main thread owns integration, review, and commits to match the goal prompt.
- Task 1 utility validation is stricter than the original plan skeleton where needed: malformed base64 is rejected with decode validation, oversized references are rejected before decode allocation, and diagnostic key scrubbing catches compound cookie/auth/token variants.
- Task 2 keeps trusted Grok media capture on the existing `__gpt_fetch_media` / `__gpt_fetch_media_result` blob URL bridge contract. The later Task 7 bridge data-URL change is intentionally deferred.

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

## Live Grok Validation

- Pending.

## Selector Notes

- Pending live validation.
