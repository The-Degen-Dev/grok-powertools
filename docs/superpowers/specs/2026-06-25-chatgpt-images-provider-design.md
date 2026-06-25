# ChatGPT Images Provider Design

## Context

Grok Power Tools is currently a Chrome MV3 extension centered on Grok Imagine. The next feature is first-class support for ChatGPT Images while keeping the existing Grok Imagine workflows intact.

The product direction is provider-aware, not a one-off ChatGPT panel bolted beside Grok. The overlay should detect the current provider, expose only the controls that make sense for that provider, and keep shared primitives such as prompt history, run state, result capture, and downloads reusable.

The first ChatGPT implementation slice is text-to-image on `https://chatgpt.com/images/`. Reference image edit/recreate is important, but it is not part of this first slice because upload/edit handling needs separate live validation and stronger result semantics.

## Source Notes

Official OpenAI docs confirm:

- ChatGPT Images can create new images and edit existing images.
- Existing images can be uploaded and edited by describing the desired change.
- Image generation may take a few minutes.
- Image inputs support static images only, not videos.
- Image uploads are capped at 20 MB per image.

Source links:

- https://help.openai.com/en/articles/11084440-images-in-chatgpt
- https://help.openai.com/en/articles/8400551-chatgpt-image-inputs-faq
- https://help.openai.com/en/articles/8555545-file-uploads-faq

Live discovery on 2026-06-25 against the user's loaded Chrome profile found the current `chatgpt.com/images` page exposes:

- `textarea[name="prompt-textarea"]` with placeholder `Describe a new image`
- `button[data-testid="send-button"]` with aria label `Send prompt`
- `input[name="images-app-drop-container-input"][type="file"]` with aria label `Attach images`
- Several alternate image file inputs, including `data-testid="upload-photos-input"`

These are good enough for a V1 selector contract, but live validation remains required because ChatGPT is a React app and the Images page can change without repo changes.

## Goals

- Add ChatGPT Images as a provider without regressing Grok Imagine.
- Keep one shared extension overlay whose labels, controls, and workflows are provider-aware.
- On `chatgpt.com/images`, allow a user to run a text prompt through ChatGPT Images.
- Detect new generated image results from the current run instead of mistaking existing gallery items for success.
- Record provider-specific run history so later prompt and provider behavior changes can be compared.
- Add focused tests before production code changes.
- Update repo context docs so future agents understand the provider split.

## Non-Goals

- No ChatGPT reference-image recreate/edit in the first slice.
- No ChatGPT video support. OpenAI docs describe image inputs as static images only.
- No attempt to clone Grok-only controls into ChatGPT, including Grok Search, Grok Imagine Video, auto-retry video goals, prompted batches, template batches, current Grok image capture, or Grok post URL handling.
- No API-backed OpenAI image generation path in this slice. This feature controls the in-app ChatGPT Images web UI.
- No broad rewrite of the extension into a bundled app. Keep the raw load-unpacked extension flow.
- No result quality scoring model in this slice. The first target is reliable control, result detection, and run ledger data.

## Provider Model

Add a provider registry with explicit capabilities. Suggested provider IDs:

- `grok-imagine`
- `chatgpt-images`
- `unknown`

Provider detection should be based on `location.hostname` and path:

- `grok.com` and `*.grok.com` stay Grok.
- `chatgpt.com/images` is ChatGPT Images.
- Other `chatgpt.com` routes should not enable generation controls unless selectors are validated for that route.

Each provider definition should expose capability flags instead of hardcoded UI checks:

- `canRunTextPrompt`
- `canUseReferenceImage`
- `canUseReferenceVideo`
- `canUseProviderSearch`
- `canUseCurrentProviderMedia`
- `canRunBatch`
- `canRunVideoGoals`
- `canCaptureGeneratedImages`
- `canDownloadGeneratedImages`

For V1, ChatGPT Images should enable:

- `canRunTextPrompt`
- `canCaptureGeneratedImages`
- `canDownloadGeneratedImages` only if live validation proves a safe, current-run download path

For V1, ChatGPT Images should disable:

- `canUseReferenceImage`
- `canUseReferenceVideo`
- `canUseProviderSearch`
- `canUseCurrentProviderMedia`
- `canRunBatch`
- `canRunVideoGoals`

The provider registry is the contract. UI and workflow code should read capabilities from it rather than checking hostnames in many places.

## UI

Keep the current floating overlay and adapt it by provider.

Shared header:

- Rename the product label only if needed after implementation. `Grok Power Tools` can remain for now, but the UI should not show Grok-only labels on ChatGPT pages.
- Add a small provider status line such as `Provider: ChatGPT Images` or `Provider: Grok Imagine`.

ChatGPT Images V1 card:

- Title: `Create Image`
- Input: prompt textarea or saved prompt picker if existing prompt library wiring supports it cleanly.
- Primary button: `Generate Image`
- Status states: `Ready`, `Submitting`, `Generating`, `Generated image ready`, `Blocked`, `Failed`
- Optional controls only if already shared and meaningful: prompt history and save prompt.

Hide on ChatGPT pages:

- `Grok Search`
- `Recreate Media`
- Auto-retry video goals
- Template Batch
- Prompted Batch
- Quality Repeat if it depends on Grok `Generate More`
- Gallery scraper if it only understands Grok media

Grok pages should continue to show the current Grok-specific controls.

## ChatGPT Text-To-Image Workflow

V1 run sequence:

1. Detect `chatgpt-images` provider.
2. Verify the current URL is `https://chatgpt.com/images/` or route the user there.
3. Snapshot current result candidates before submit.
4. Fill `textarea[name="prompt-textarea"]` with the chosen prompt.
5. Verify `button[data-testid="send-button"]` is enabled.
6. Click send.
7. Mark the run as submitted with provider, prompt, timestamp, and pre-submit snapshot.
8. Wait for an in-progress signal or a new result candidate.
9. Detect a new generated image candidate that was not present in the pre-submit snapshot.
10. If possible, open or download only the new current-run image.
11. Record the result URL, media URL, thumbnail URL, or download evidence in the run ledger.

The run should fail fast when:

- The route is not `chatgpt.com/images` and cannot be reached.
- The prompt input is missing.
- The send button is missing or stays disabled after a non-empty prompt.
- The page shows login, subscription, usage, moderation, or rate-limit blocker text.
- No new result can be distinguished from the existing gallery before timeout.

## Result Detection

Result detection must not treat existing `My images` gallery items as success.

Use a pre-submit snapshot and detect deltas. Candidate signals can include:

- New image cards or links added after submit.
- A visible new generation container near the composer or top of the page.
- New media nodes with source URLs not present before submit.
- New page asset entries exposed by the browser runtime if they map to visible generated media.
- A post-generation route or modal opened after clicking the current-run result.

Do not scrape the user's full gallery as a default strategy. Limit detection to visible, current-run candidates and small DOM/media projections.

A successful V1 run requires:

- Submit was clicked.
- A new image candidate appeared after submit.
- The candidate is image media, not only a placeholder.
- The candidate is openable or has a retrievable media URL, thumbnail URL, or download event.
- The ledger entry distinguishes `submitted` from `generated`.

If download cannot be made reliable in V1, still record the generated candidate and mark `downloadStatus: not_supported_yet` rather than pretending the download worked.

## Storage And Ledger

Extend recreate/run history to be provider-aware without breaking existing Grok entries.

Suggested fields:

- `runId`
- `providerId`
- `workflow`: `text-to-image`, `image-recreate`, `video-recreate`
- `createdAt`
- `submittedAt`
- `completedAt`
- `prompt`
- `promptSource`: `typed`, `history`, `saved`
- `status`: `draft`, `submitted`, `generating`, `generated`, `failed`, `blocked`
- `failureCode`
- `resultPageUrl`
- `resultMediaUrl`
- `resultThumbnailUrl`
- `downloadStatus`
- `diagnostics`

Existing Grok history entries should either keep their current shape or migrate lazily when read. Do not do a risky storage migration just to support ChatGPT V1.

## Manifest And Injection

The implementation will need manifest changes:

- Add `https://chatgpt.com/*` to content script matches.
- Add `https://chatgpt.com/*` to host permissions only if the code needs host permission beyond content script injection.
- Add `https://chatgpt.com/*` to web-accessible resource matches only if a ChatGPT bridge is needed.

V1 should avoid a ChatGPT MAIN-world bridge unless direct content-script DOM interaction fails. ChatGPT Images uses a visible textarea, so bridge-free control is the starting assumption.

## Test-Driven Implementation Requirements

Use TDD for production changes. No production code should be added until a failing test proves the behavior gap.

Minimum test coverage before V1 is done:

- Provider detection returns `chatgpt-images` for `https://chatgpt.com/images/` and does not enable ChatGPT controls on unrelated hosts.
- Provider capability flags hide Grok-only controls on ChatGPT pages.
- Existing Grok controls remain visible on Grok pages.
- ChatGPT prompt runner fills the textarea and submits through the send button in a mocked ChatGPT Images DOM.
- ChatGPT runner fails with a clear code when the prompt input is missing.
- ChatGPT runner fails with a clear code when the send button is missing or disabled.
- ChatGPT result detection ignores pre-existing gallery media and accepts only a new post-submit image candidate.
- Run ledger records `providerId`, workflow, prompt, status, and result evidence.
- Manifest coverage includes ChatGPT URL matches without dropping existing Grok matches.

Regression coverage:

- Existing Grok unit tests continue to pass.
- Existing mocked extension E2E overlay tests continue to pass.
- New E2E fixture for ChatGPT Images shows provider-aware overlay rendering and a mocked submit flow.

## Live Validation Requirements

Mocked tests are not enough for this feature because both providers are live web apps.

Before calling the implementation done:

1. Reload the unpacked extension in Chrome.
2. Open `https://chatgpt.com/images/`.
3. Confirm the overlay appears and identifies ChatGPT Images.
4. Confirm Grok-only controls are hidden.
5. Submit a harmless canary prompt with a unique marker.
6. Confirm ChatGPT accepts the prompt.
7. Confirm a new generated image appears.
8. Confirm the run status becomes generated, not just submitted.
9. Confirm result evidence is recorded in storage.
10. Open or download the new result if a reliable safe path exists.
11. Run a quick Grok page smoke check to confirm the Grok overlay still renders.

Use narrow Chrome inspection. Do not enumerate every tab, scrape the whole gallery, or operate on unrelated private generated images.

## Pause Criteria

Pause for user input or action if any of these happen:

- ChatGPT requires login, plan upgrade, CAPTCHA, or account action.
- A generation would consume meaningful quota after an initial harmless canary already proved the flow.
- ChatGPT shows moderation, rate-limit, or policy text that needs product judgment.
- The current ChatGPT UI differs enough that selectors cannot be updated from a narrow live inspection.
- Result detection cannot distinguish the new canary from existing gallery items without reading or opening unrelated private images.
- Download support requires browser permission prompts or access to private files not already authorized.
- Adding ChatGPT support would require a broader extension permission than `chatgpt.com` host access.

Do not pause merely because a selector changed if a narrow live inspection can identify the current selector safely.

## Repo Context Docs To Update

Implementation is not done until these context docs are updated:

- `README.md`: describe ChatGPT Images V1 support and explicitly separate it from Grok Imagine workflows.
- `HACKING.md`: add ChatGPT Images selector/debug notes and explain provider capability flags.
- `AGENTS.md`: update repo shape and validation notes for provider-aware extension behavior.
- `docs/AGENT_HANDOFF_PROMPT.md`: mention the provider registry, ChatGPT Images V1, and live validation expectations.

Do not update user-facing docs to claim reference-image ChatGPT recreate/edit until that workflow is actually built and validated.

## Follow-Up Slices

After V1 text-to-image is proven:

1. ChatGPT reference-image edit/recreate:
   - Upload an image through the ChatGPT Images attach input.
   - Prompt ChatGPT to edit or recreate the uploaded reference.
   - Detect generated result separately from uploaded reference preview.
   - Add prompt guidance tuned for ChatGPT Images, not Grok Imagine.

2. Shared provider history:
   - Filter history by provider and workflow.
   - Compare prompt variants across providers.
   - Track manual quality notes.

3. Download hardening:
   - Identify a stable ChatGPT generated-image download path.
   - Store only current-run result evidence.
   - Avoid scraping private gallery content.

4. Provider-specific prompt libraries:
   - Keep Grok Imagine prompt patterns separate from ChatGPT Images prompt patterns.
   - Avoid generic model prompt guidance when the target provider has distinct behavior.

## Recommended Implementation Sequence

1. Add provider detection and capability tests.
2. Add provider registry and make the overlay read capabilities.
3. Add ChatGPT URL matches to the manifest under test.
4. Add ChatGPT overlay rendering tests.
5. Add mocked ChatGPT prompt runner tests.
6. Add mocked ChatGPT result detection tests.
7. Add production ChatGPT prompt runner.
8. Add run ledger fields.
9. Update README, HACKING, AGENTS, and handoff docs.
10. Run unit, E2E, and lint.
11. Reload extension and run live ChatGPT canary.
12. Run a Grok overlay smoke check.
