# Grok Power Tools v0.2.0 Release Notes

This release ships the current Grok Power Tools extension with Recreate Media, prompt and retry workflow updates, R2 backup support, and the current web/cloud companion surfaces.

## Shipped In v0.2.0

- Recreate Media in the Grok overlay. It accepts a local, dropped, pasted, or current Grok image, plus local MP4/MOV/WebM/GIF and trusted Grok video/post URLs, sends the reference through Grok chat for a Grok Imagine prompt, and submits the prompt back into Grok Imagine.
- Optional Grok Search context for the Recreate Media prompt-generation step.
- Prompt history and saved prompt controls in the overlay, plus settings import/export support.
- Auto-Retry, Video Goal, Template Batch, Prompted Batch, Quick Batch, and Quality Repeat controls for Grok Imagine workflows. Retry behavior is based on failed generation attempts, not a single fixed error string.
- Smart media scraping and raw image handling for Grok media surfaces.
- Cloudflare R2 backup options in the extension popup, including local-only, cloud-only, dual-write, unsynced retry, metadata-only backfill, one-media canary, and full media backup controls.
- Web app surfaces for collections, prompt library, vault, clip editing, movie workflows, sharing, auth, and sync.
- Cloud Worker support for R2 upload, vault metadata, sync, repair, and related API routes.

## Install Or Update

1. Download and unzip `grok-power-tools-v0.2.0.zip`.
2. Open Chrome and go to `chrome://extensions/`.
3. Enable Developer mode.
4. Click Load unpacked.
5. Select the unzipped extension folder.
6. Refresh open Grok tabs, then open `https://grok.com/imagine`.

The release artifact is a raw MV3 load-unpacked extension package. It does not include the web app, Cloud Worker source, tests, local artifacts, or development dependencies.

## Validation Required Before Publishing

The final release must be published only after these gates are recorded in `implementation-notes.html`:

- `npm run test:unit`
- `npm run test:e2e`
- `npm run lint`
- `npm run build --prefix web`
- `npm run lint --prefix web`
- `npm run typecheck --prefix cloud`
- `npm run test:acceptance --prefix cloud`
- `npx playwright test -c playwright.web.config.js`
- Live Grok Recreate Media validation that reaches a new Grok Imagine result with openable generated media.
- Live Grok video recreation validation with the canonical clip that reaches a new playable generated video/post after the unpacked extension is reloaded.

## Known Limitations

- Grok UI changes can break live automation and may require selector updates.
- The extension has no hot reload. Reload it from `chrome://extensions/` and refresh Grok tabs after updates.
- Recreate Media is validated by generated openable media, not by exact visual matching.
- Animated GIF frame sampling is limited by browser APIs; the GIF file is still treated as a motion reference.
- Short video generation depends on Grok Imagine Video quota and current Grok UI behavior.

## Future Work

Future work should add stronger visual similarity measurement, richer GIF frame extraction, and operator-facing run comparison tools.
