# Grok Power Tools

Chrome extension tools for Grok Imagine workflows, prompt management, retry automation, media backup, and local/web collection work.

## Features

- Floating provider-aware overlay with prompt history, saved prompts, batch controls, auto-retry, video goals, Quality Repeat, and Recreate Media on Grok Imagine.
- ChatGPT Images text-to-image tracking on `chatgpt.com/images`: type in ChatGPT's native prompt bar, click its native send button, and the extension records the prompt/result run in provider history.
- Recreate Media workflow that accepts a local, pasted, dropped, or current Grok image, plus local MP4/MOV/WebM/GIF or trusted Grok video/post URLs, asks Grok chat for a Grok Imagine prompt, and submits that prompt back into Grok Imagine.
- Prompt history and saved prompt management backed by Chrome local storage, with settings import/export support.
- Smart media scraper and raw image handling for Grok media surfaces.
- Optional Cloudflare R2 backup through a bring-your-own Worker, with local-only, cloud-only, and dual-write modes.
- Web app under `web/` for collections, prompt library, clip editing, movie workflows, sharing, auth, and sync.
- Cloud Worker under `cloud/` for R2 upload, metadata, vault, repair, and sync routes.

Short video and GIF recreation depend on Grok Imagine Video availability and are validated by a playable generated video/post, not by exact visual matching.

## Install Or Update The Extension

1. Download and unzip the release artifact, or clone this repository.
2. Open Chrome and go to `chrome://extensions/`.
3. Enable Developer mode.
4. Click Load unpacked.
5. Select the unzipped extension folder or this repository root.
6. Open `https://grok.com/imagine` or `https://chatgpt.com/images`.
7. Refresh any already-open provider tabs after reloading the extension.

There is no extension build step. Chrome loads the raw MV3 files directly.

## Recreate Media

1. Open `https://grok.com/imagine`.
2. Open the Grok Power Tools overlay.
3. In Recreate Media, choose, drop, paste, or select the current Grok image. You can also paste a trusted Grok Imagine post URL for video recreation.
4. Optionally enable Grok Search for extra prompt-writing context.
5. Click Start Recreate.

The workflow uses Grok chat to analyze the reference and produce one final Grok Imagine prompt, then submits that prompt into Grok Imagine. Success should be judged by an actual generated Imagine result with openable media, not only by a submitted status.

## ChatGPT Images

1. Open `https://chatgpt.com/images`.
2. Type an image prompt into ChatGPT Images' native prompt bar.
3. Click ChatGPT's native send button.

The overlay identifies `Provider: ChatGPT Images`, hides Grok-only controls, and records text-to-image runs in local provider history after a new current-run image appears. ChatGPT reference-image edit/recreate, video, gallery scraping, and downloads are not part of this slice.

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
- Recreate Media depends on Grok chat returning the expected final prompt marker and Grok Imagine accepting the generated prompt.
- Generated results are model-dependent and are not guaranteed to match the reference exactly.
- Animated GIF frame sampling is limited by browser APIs; the GIF file is still treated as a motion reference.
- Short video generation depends on Grok Imagine Video quota and current Grok UI behavior.
- ChatGPT Images support depends on the current ChatGPT native composer DOM. Hidden fallback textareas should not be treated as the real prompt input.

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
