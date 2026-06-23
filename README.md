# Grok Power Tools

Chrome extension tools for Grok Imagine workflows, prompt management, retry automation, media backup, and local/web collection work.

## Features

- Floating Grok overlay with prompt history, saved prompts, batch controls, auto-retry, video goals, Quality Repeat, and Image Recreate.
- Image Recreate workflow that accepts a local, pasted, dropped, or current Grok image, asks Grok chat for a Grok Imagine prompt, and submits that prompt back into Grok Imagine.
- Prompt history and saved prompt management backed by Chrome local storage, with settings import/export support.
- Smart media scraper and raw image handling for Grok media surfaces.
- Optional Cloudflare R2 backup through a bring-your-own Worker, with local-only, cloud-only, and dual-write modes.
- Web app under `web/` for collections, prompt library, clip editing, movie workflows, sharing, auth, and sync.
- Cloud Worker under `cloud/` for R2 upload, metadata, vault, repair, and sync routes.

Short video and GIF recreation are not part of v0.2.0. They are future work.

## Install Or Update The Extension

1. Download and unzip the release artifact, or clone this repository.
2. Open Chrome and go to `chrome://extensions/`.
3. Enable Developer mode.
4. Click Load unpacked.
5. Select the unzipped extension folder or this repository root.
6. Open `https://grok.com/imagine`.
7. Refresh any already-open Grok tabs after reloading the extension.

There is no extension build step. Chrome loads the raw MV3 files directly.

## Image Recreate

1. Open `https://grok.com/imagine`.
2. Open the Grok Power Tools overlay.
3. In Recreate Image, choose, drop, paste, or select the current Grok image.
4. Optionally enable Grok Search for extra prompt-writing context.
5. Click Start Recreate.

The workflow uses Grok chat to analyze the reference and produce one `FINAL_IMAGINE_PROMPT`, then submits that prompt into Grok Imagine. Success should be judged by an actual generated Imagine result with openable media, not only by a submitted status.

## Auto-Retry And Goals

Open the Auto-Retry section in the overlay to retry failed video-generation attempts and run video goals. The goal counter is intended to track generated results after the workflow starts, not merely button clicks.

## Prompt Management

Use the overlay History and Saved tabs to reuse prompts. The plus button saves prompt text, and the JSON import/export controls back up extension settings.

## Cloud Backup

Open the extension popup to configure optional Cloudflare R2 backup. You need a deployed Worker URL and API key.

Backup modes:

- Local only
- Cloud only (R2)
- Dual-write (Local + R2)

Metadata backfill covers prompts, history, and processed IDs. Media backup is handled through the R2 media backup controls.

Backfill is metadata-only. Existing local media files are not uploaded during backfill.

Setup guide: [docs/CLOUD_R2_SETUP.md](docs/CLOUD_R2_SETUP.md)

## Known Limitations

- Grok UI changes can break live automation selectors.
- The unpacked extension must be manually reloaded in Chrome after file changes or release updates.
- Image Recreate depends on Grok chat returning the expected final prompt marker and Grok Imagine accepting the generated prompt.
- Generated results are model-dependent and are not guaranteed to match the reference exactly.
- Animated GIF files can be used as image references, but GIF recreation as a motion workflow is not shipped.
- Short video and GIF recreation are not shipped in v0.2.0.

## Development

- [AGENTS.md](AGENTS.md) has agent-specific repo instructions.
- [CONTRIBUTING.md](CONTRIBUTING.md) covers setup, tests, and PR workflow.
- [HACKING.md](HACKING.md) covers architecture, debugging, and Chrome MV3 gotchas.

Root extension:

```bash
npm install
npm run test:unit
npm run test:e2e
npm run lint
```

Web app:

```bash
npm install --prefix web
npm run build --prefix web
npm run lint --prefix web
```

Cloud Worker:

```bash
npm install --prefix cloud
npm run typecheck --prefix cloud
npm run test:acceptance --prefix cloud
```

Build the load-unpacked extension zip:

```bash
npm run package:extension -- --out /tmp/grok-power-tools-v0.2.0.zip
```

## License

MIT. See [LICENSE](LICENSE).
