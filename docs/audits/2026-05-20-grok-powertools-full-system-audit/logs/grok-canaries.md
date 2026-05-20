# Grok Creation Canaries

Live run timestamp: 2026-05-19 22:00 EDT for the 2026-05-20 audit.

Privacy handling: this log does not include raw data URIs, full user-scoped video asset URLs, or unrelated Grok prompt/media text from the live page.

## Pre-Canary Vault Count

- Local Vault file count before canary generation/download: 1,853.
- Evidence: `docs/audits/2026-05-20-grok-powertools-full-system-audit/logs/pre-canary-vault-count.txt`.

## Image Canary

- Prompt: `AUDIT CANARY 2026-05-20 image: a clean product-style tabletop photo of a small chrome compass on a white desk, no text, square composition, neutral lighting.`
- Submitted: yes. Chrome/Grok accepted the prompt from the live Imagine composer with Image mode selected, Quality selected, aspect ratio `1:1`, and Submit enabled before click.
- Result appeared: yes.
- Result URL or visible ID: `https://grok.com/imagine/post/8f02896a-552f-4825-8803-670f09024a43`.
- Media evidence: public image URL `https://imagine-public.x.ai/imagine-public/images/8f02896a-552f-4825-8803-670f09024a43.jpg`, natural size `960x960`.
- Errors: none observed.
- Screenshot submitted: `docs/audits/2026-05-20-grok-powertools-full-system-audit/screenshots/grok-image-canary-submitted.png`.
- Screenshot result: `docs/audits/2026-05-20-grok-powertools-full-system-audit/screenshots/grok-image-canary-result.png`.
- Flow notes: the page first exposed `data:` placeholder images. The audit waited for an `imagine-public.x.ai` image URL and captured the result from the canary post detail view.

## Video Canary

- Intended prompt: `AUDIT CANARY 2026-05-20 video: a five-second gentle camera push toward the small chrome compass on a white desk, no text, minimal motion, neutral lighting.`
- Actual flow: the visible Grok control on the image result was `Make video`; clicking it started image-to-video generation immediately. The flow did not expose a prompt entry field before generation began.
- Submitted: yes. The canary video post showed a live generation overlay with progress and a Cancel button.
- Result appeared: yes.
- Result URL or visible ID: `https://grok.com/imagine/post/595cb61b-d261-45ef-888f-bc4bd1fdb833`.
- Media evidence: visible video element loaded with `readyState=4`, natural size `544x544`, duration `10s`, and the UI showed `480p`. Full raw asset URL is omitted because it contains a user-scoped path; the post ID is recorded above.
- Errors: none observed.
- Screenshot submitted: `docs/audits/2026-05-20-grok-powertools-full-system-audit/screenshots/grok-video-canary-submitted.png`.
- Screenshot result: `docs/audits/2026-05-20-grok-powertools-full-system-audit/screenshots/grok-video-canary-result.png`.
- Flow notes: Grok produced a 10-second video from the image result even though the audit's intended video prompt specified five seconds. This is recorded as current Grok flow behavior, not an extension failure.
