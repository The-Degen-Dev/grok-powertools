# R2 Access

## wrangler bucket list without explicit account

 ⛅️ wrangler 4.67.0 (update available 4.93.0)
─────────────────────────────────────────────
Listing buckets...

✘ [ERROR] A request to the Cloudflare API (/accounts/ae55f67eccbee0bca65247faea6d5024/r2/buckets) failed.

  Authentication error [code: 10000]


Getting User settings...
👋 You are logged in with an OAuth Token, associated with the email [redacted-email].
┌───────────────────────────────┬──────────────────────────────────┐
│ Account Name                  │ Account ID                       │
├───────────────────────────────┼──────────────────────────────────┤
│ [redacted-account-name] │ e8d3925cac56cc5a4927c16024531994 │
└───────────────────────────────┴──────────────────────────────────┘
🔓 Token Permissions:
Scope (Access)
- account (read)
- user (read)
- workers (write)
- workers_kv (write)
- workers_routes (write)
- workers_scripts (write)
- workers_tail (read)
- d1 (write)
- pages (write)
- zone (read)
- ssl_certs (write)
- ai (write)
- ai-search (write)
- ai-search (run)
- queues (write)
- pipelines (write)
- secrets_store (write)
- artifacts (write)
- flagship (write)
- containers (write)
- cloudchamber (write)
- connectivity (admin)
- email_routing (write)
- email_sending (write)
- browser (write)
- offline_access 
🪵  Logs were written to "/Users/philipbankier/.wrangler/logs/wrangler-2026-05-20_01-26-17_016.log"

## wrangler bucket list account e8d3925cac56cc5a4927c16024531994

 ⛅️ wrangler 4.67.0 (update available 4.93.0)
─────────────────────────────────────────────
Listing buckets...

✘ [ERROR] A request to the Cloudflare API (/accounts/e8d3925cac56cc5a4927c16024531994/r2/buckets) failed.

  Please enable R2 through the Cloudflare Dashboard. [code: 10042]
  
  If you think this is a bug, please open an issue at: https://github.com/cloudflare/workers-sdk/issues/new/choose


🪵  Logs were written to "/Users/philipbankier/.wrangler/logs/wrangler-2026-05-20_01-26-19_807.log"

## wrangler bucket list account ae55f67eccbee0bca65247faea6d5024

 ⛅️ wrangler 4.67.0 (update available 4.93.0)
─────────────────────────────────────────────
Listing buckets...

✘ [ERROR] A request to the Cloudflare API (/accounts/ae55f67eccbee0bca65247faea6d5024/r2/buckets) failed.

  Authentication error [code: 10000]


Getting User settings...
👋 You are logged in with an OAuth Token, associated with the email [redacted-email].
┌───────────────────────────────┬──────────────────────────────────┐
│ Account Name                  │ Account ID                       │
├───────────────────────────────┼──────────────────────────────────┤
│ [redacted-account-name] │ e8d3925cac56cc5a4927c16024531994 │
└───────────────────────────────┴──────────────────────────────────┘
🔓 Token Permissions:
Scope (Access)
- account (read)
- user (read)
- workers (write)
- workers_kv (write)
- workers_routes (write)
- workers_scripts (write)
- workers_tail (read)
- d1 (write)
- pages (write)
- zone (read)
- ssl_certs (write)
- ai (write)
- ai-search (write)
- ai-search (run)
- queues (write)
- pipelines (write)
- secrets_store (write)
- artifacts (write)
- flagship (write)
- containers (write)
- cloudchamber (write)
- connectivity (admin)
- email_routing (write)
- email_sending (write)
- browser (write)
- offline_access 
🪵  Logs were written to "/Users/philipbankier/.wrangler/logs/wrangler-2026-05-20_01-26-21_015.log"

## wrangler bucket list account ba5339fd86e87c226bdc306347636042 from cloud/wrangler.toml

 ⛅️ wrangler 4.67.0 (update available 4.93.0)
─────────────────────────────────────────────
Listing buckets...

✘ [ERROR] A request to the Cloudflare API (/accounts/ba5339fd86e87c226bdc306347636042/r2/buckets) failed.

  Authentication error [code: 10000]


Getting User settings...
👋 You are logged in with an OAuth Token, associated with the email [redacted-email].
┌───────────────────────────────┬──────────────────────────────────┐
│ Account Name                  │ Account ID                       │
├───────────────────────────────┼──────────────────────────────────┤
│ [redacted-account-name] │ e8d3925cac56cc5a4927c16024531994 │
└───────────────────────────────┴──────────────────────────────────┘
🔓 Token Permissions:
Scope (Access)
- account (read)
- user (read)
- workers (write)
- workers_kv (write)
- workers_routes (write)
- workers_scripts (write)
- workers_tail (read)
- d1 (write)
- pages (write)
- zone (read)
- ssl_certs (write)
- ai (write)
- ai-search (write)
- ai-search (run)
- queues (write)
- pipelines (write)
- secrets_store (write)
- artifacts (write)
- flagship (write)
- containers (write)
- cloudchamber (write)
- connectivity (admin)
- email_routing (write)
- email_sending (write)
- browser (write)
- offline_access 
🪵  Logs were written to "/Users/philipbankier/.wrangler/logs/wrangler-2026-05-20_01-26-23_957.log"

## Extension Cloud Test

- Ran test: no
- Result text: not run
- Last error: live extension popup storage/config was not accessible through Chrome automation because `chrome-extension://.../popup.html` navigation was blocked by browser policy during Task 5.
- Evidence screenshot: `screenshots/extension-cloud-test-result.png`
- Notes: no Worker URL, API key, or live extension storage values were read. The Cloud Backup popup screenshot from Task 5 is a static source preview, not live configuration evidence.

## Sanitization

- Wrangler output was sanitized before committing: local Cloudflare email and account display name were replaced with `[redacted-email]` and `[redacted-account-name]`.
- ANSI color sequences were removed from this log for readability.
