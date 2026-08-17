#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    normalizeSavedAssetIdentity,
    reconcileSavedVaultInventory,
    redactInventoryItem,
    redactReconciliationOutput,
    sortRedactedInventory
} = require('../lib/saved-vault-reconciliation.js');
const INVENTORY_ERROR_CODES = new Set([
    'inventory_cursor_invalid',
    'inventory_cursor_repeated',
    'inventory_request_failed',
    'inventory_response_invalid'
]);

function parseArguments(args) {
    const values = {};
    for (let index = 0; index < args.length; index += 1) {
        if (args[index] === '--observer' || args[index] === '--output') {
            values[args[index].slice(2)] = args[index + 1];
            index += 1;
        }
    }
    return values;
}

function blocked(code) {
    process.stderr.write(`blocked: ${code}\n`);
    process.exitCode = 1;
}

function workerUrl(value) {
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'https:' ? parsed : null;
    } catch {
        return null;
    }
}

function hasValidObserverEvidence(observer) {
    return Boolean(observer)
        && observer.schemaVersion === 1
        && observer.exhausted === true
        && !Object.prototype.hasOwnProperty.call(observer, 'blocked')
        && Array.isArray(observer.identities)
        && observer.identities.every((identity) => normalizeSavedAssetIdentity(identity) === identity);
}

function inventoryError(code) {
    const error = new Error(code);
    error.code = code;
    return error;
}

function inventoryErrorCode(error) {
    return INVENTORY_ERROR_CODES.has(error?.code) ? error.code : 'inventory_request_failed';
}

async function fetchInventory({ worker, apiKey, fetchImpl = fetch }) {
    const items = [];
    const cursors = new Set();
    let cursor = null;
    do {
        const requestUrl = new URL('/v1/vault/inventory', worker);
        requestUrl.searchParams.set('limit', '1000');
        if (cursor) requestUrl.searchParams.set('cursor', cursor);
        let response;
        try {
            response = await fetchImpl(requestUrl, {
                method: 'GET',
                headers: { Authorization: `Bearer ${apiKey}` }
            });
        } catch {
            throw inventoryError('inventory_request_failed');
        }
        if (!response.ok) throw inventoryError('inventory_request_failed');

        let page;
        try {
            page = await response.json();
        } catch {
            throw inventoryError('inventory_response_invalid');
        }
        if (!page || !Array.isArray(page.items)) throw inventoryError('inventory_response_invalid');
        if (page.nextCursor !== null && (typeof page.nextCursor !== 'string' || !page.nextCursor.trim())) {
            throw inventoryError('inventory_cursor_invalid');
        }
        items.push(...page.items);
        cursor = page.nextCursor;
        if (cursor && cursors.has(cursor)) throw inventoryError('inventory_cursor_repeated');
        if (cursor) cursors.add(cursor);
    } while (cursor !== null);
    return items;
}

async function main() {
    const args = parseArguments(process.argv.slice(2));
    if (!args.observer || !args.output) return blocked('required_arguments');

    const worker = workerUrl(process.env.WORKER_URL);
    if (!worker) return blocked('worker_url_invalid');
    const apiKey = process.env.WORKER_API_KEY || process.env.CLIENT_API_KEY;
    if (!apiKey) return blocked('worker_credential_missing');

    let observer;
    try {
        observer = JSON.parse(fs.readFileSync(args.observer, 'utf8'));
    } catch {
        return blocked('observer_json_unreadable');
    }
    if (!hasValidObserverEvidence(observer)) return blocked('observer_evidence_invalid');

    let inventoryItems;
    try {
        inventoryItems = await fetchInventory({ worker, apiKey });
    } catch (error) {
        return blocked(inventoryErrorCode(error));
    }

    const reconciliation = reconcileSavedVaultInventory({
        savedIdentities: observer.identities,
        inventoryItems
    });
    const output = redactReconciliationOutput({
        schemaVersion: 1,
        ...reconciliation,
        inventory: sortRedactedInventory(inventoryItems.map(redactInventoryItem))
    });
    try {
        fs.mkdirSync(path.dirname(args.output), { recursive: true });
        fs.writeFileSync(args.output, `${JSON.stringify(output, null, 2)}\n`);
    } catch {
        return blocked('output_write_failed');
    }
    process.stdout.write('reconciliation_complete\n');
    if (reconciliation.missing.length || reconciliation.duplicateCanonical.length || reconciliation.unverified.length) {
        process.exitCode = 1;
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main();
}

export { fetchInventory, hasValidObserverEvidence, inventoryErrorCode, parseArguments, workerUrl };
