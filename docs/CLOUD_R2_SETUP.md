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

After deploy, copy your Worker URL (`https://<name>.workers.dev`).

## 3) Configure extension popup

Open extension popup and set:

- `Backup Mode`: `Dual-write (Local + R2)`
- `Worker URL`: `https://<name>.workers.dev`
- `API Key`: same value as `CLIENT_API_KEY`
- `Key Prefix`: default `grok-powertools/v1` (or your override)

Click `Test Connection`.

## 4) Optional backfill

Click `Run Backfill` to upload:

- `savedPrompts`
- `promptHistory`
- `processedIds`
- `backfill-manifest.<timestamp>.json`

Note: Existing local media files are not backfilled in v1.

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

### "Worker URL must match https://<name>.workers.dev"

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

Metadata sync is debounced (~2 seconds) on local changes. Ensure backup mode is `Dual-write`.
