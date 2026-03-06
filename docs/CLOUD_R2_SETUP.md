# Cloud R2 Backup Setup (BYO Worker)

This guide configures optional dual-write backup:
- Local downloads stay unchanged.
- Media + prompt metadata are also synced to your own R2 bucket through your own Worker.

## Architecture

1. Chrome extension downloads media locally (existing behavior).
2. Extension asks your Worker for a presigned upload URL.
3. Extension uploads media bytes to R2 using that URL.
4. Extension posts metadata snapshots to Worker (`savedPrompts`, `promptHistory`, `processedIds`, backfill manifest).

## Prerequisites

- Cloudflare account
- `wrangler` CLI installed (`npm i -g wrangler`)
- Existing R2 bucket
- This repo loaded as unpacked extension

## 1) Create and configure R2 bucket

```bash
wrangler r2 bucket create YOUR_BUCKET_NAME --location=enam
```

## 2) Deploy Worker from this repo

```bash
cd cloud
npm install
```

Edit `cloud/wrangler.toml`:

- Set `bucket_name` in `[[r2_buckets]]`
- Set `[vars].R2_BUCKET_NAME`
- Set `[vars].R2_ACCOUNT_ID`
- (Optional) change `[vars].KEY_PREFIX` from `grok-powertools/v1`

Create secrets:

```bash
wrangler secret put CLIENT_API_KEY
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY
```

Deploy:

```bash
npm run deploy
```

After deploy, copy your Worker URL (`https://<worker>.<subdomain>.workers.dev`).

## 3) Configure extension popup

Open extension popup and set:

- `Backup Mode`: `Dual-write (Local + R2)`
- `Worker URL`: `https://<worker>.<subdomain>.workers.dev`
- `API Key`: same value as `CLIENT_API_KEY`
- `Key Prefix`: default `grok-powertools/v1` (or your override)

Click `Test Upload Pipeline`. This runs a 3-stage test: health check, presigned URL generation, and a test R2 upload.

## 4) Optional backfill

Click `Run Backfill` to upload metadata:

- `savedPrompts`
- `promptHistory`
- `processedIds`
- `backfill-manifest.<timestamp>.json`

**Important:** Backfill is metadata-only. Existing local media files (images/videos) are not uploaded to R2 during backfill. Media files are only synced to R2 when downloaded through the extension going forward.

## Worker API

- `GET /health`
- `POST /v1/presign`
- `POST /v1/metadata/snapshot`

All endpoints require `x-gpt-api-key`.

## R2 key layout

Base prefix: `grok-powertools/v1`

Media:

- `grok-powertools/v1/users/{activeGrokUserId}/media/{yyyy-mm-dd}_Auto/{filename}.{ext}`

Metadata latest snapshots:

- `grok-powertools/v1/users/{activeGrokUserId}/metadata/saved-prompts.latest.json`
- `grok-powertools/v1/users/{activeGrokUserId}/metadata/prompt-history.latest.json`
- `grok-powertools/v1/users/{activeGrokUserId}/metadata/processed-ids.latest.json`

Backfill manifest:

- `grok-powertools/v1/users/{activeGrokUserId}/metadata/backfill-manifest.{timestamp}.json`

## Troubleshooting

### Error prefix reference

Errors from the upload pipeline include a stage tag to help diagnose failures:

| Prefix | Stage | Meaning |
|--------|-------|---------|
| `[media-fetch]` | Fetch media blob | Extension cannot download the image/video from the source URL |
| `[presign]` | Get presigned URL | Worker failed to generate an R2 upload URL |
| `[r2-put]` | Upload to R2 | Uploading the media blob to R2 failed |
| `[health-check]` | Worker health | Worker is unreachable or API key is wrong |
| `[test-upload]` | Pipeline test | Test upload to R2 failed during pipeline test |

### `[media-fetch]` errors

The background service worker cannot fetch media from the source URL. Common causes:

- **Missing host permission**: `manifest.json` must include `*://imagine-public.x.ai/*` in `host_permissions`. If you see "source host not in known media hosts" in the error, this is the issue.
- **Temporary URL expired**: Some media URLs may expire. Retry the download.
- **Network error**: Check your internet connection.

### "Worker URL must match https://<worker>.<subdomain>.workers.dev"

Use your deployed `workers.dev` URL exactly. Custom domains are not supported in v1 validation.

### Test connection returns 401

`API Key` in popup does not match Worker secret `CLIENT_API_KEY`.

### Presign fails with credentials error

`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, or `R2_SECRET_ACCESS_KEY` is missing/invalid.

### Uploads remain unsynced

- Click `Retry Unsynced`
- Check popup `Last Error`
- Verify Worker is reachable and API key is valid

### Metadata not syncing

Metadata sync is debounced (~2 seconds) on local changes. Ensure backup mode is `Cloud only` or `Dual-write`.

### Test Upload Pipeline looks idle or confusing

Expected sequence in popup/log:

- `Testing upload pipeline...`
- `Full pipeline OK (health + presign + R2 upload)`
- `Last Test: OK at ...`

If you just reloaded the unpacked extension and still have existing `grok.com` tabs open, old content-script contexts may emit warnings like "Extension context refreshed/skipped ...". That warning is expected after reloads and does not indicate cloud auth failure. Close old Grok tabs and open a fresh `https://grok.com/imagine` tab.
