import fs from 'node:fs';
import path from 'node:path';

function required(name) {
    const value = process.env[name];
    if (!value || !value.trim()) {
        throw new Error(`${name} is required`);
    }
    return value.trim();
}

const workerName = required('ACCEPTANCE_WORKER_NAME');
const bucketName = required('ACCEPTANCE_R2_BUCKET');
const databaseName = required('ACCEPTANCE_D1_DATABASE');
const databaseId = required('ACCEPTANCE_D1_DATABASE_ID');
const accountId = required('CLOUDFLARE_ACCOUNT_ID');
const keyPrefix = required('ACCEPTANCE_KEY_PREFIX');
const runId = required('ACCEPTANCE_RUN_ID');

if (!keyPrefix.startsWith(`acceptance/${runId}`)) {
    throw new Error('ACCEPTANCE_KEY_PREFIX must start with the active acceptance run ID');
}

const output = `name = "${workerName}"
main = "src/index.ts"
compatibility_date = "2026-06-09"
account_id = "${accountId}"

[vars]
KEY_PREFIX = "${keyPrefix}"
R2_ACCOUNT_ID = "${accountId}"
R2_BUCKET_NAME = "${bucketName}"
ACCEPTANCE_MODE = "true"
ACCEPTANCE_RUN_ID = "${runId}"
ACCEPTANCE_KEY_PREFIX = "${keyPrefix}"
WORKER_VERSION = "2026-06-09.1"

[[r2_buckets]]
binding = "R2_BUCKET"
bucket_name = "${bucketName}"

[[d1_databases]]
binding = "DB"
database_name = "${databaseName}"
database_id = "${databaseId}"
`;

const target = path.join(process.cwd(), 'cloud', 'wrangler.acceptance.generated.toml');
fs.writeFileSync(target, output);
console.log(JSON.stringify({
    ok: true,
    path: target,
    workerName,
    bucketName,
    databaseName,
    keyPrefix
}, null, 2));
