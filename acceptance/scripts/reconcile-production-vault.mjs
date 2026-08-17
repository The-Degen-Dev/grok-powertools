#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
    const {
    reconcileSavedVaultInventory,
    redactInventoryItem,
    redactReconciliationOutput
} = require('../lib/saved-vault-reconciliation.js');

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

function blocked(message) {
    process.stderr.write(`blocked: ${message}\n`);
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

async function fetchInventory({ worker, apiKey }) {
    const items = [];
    const cursors = new Set();
    let cursor = null;
    do {
        const requestUrl = new URL('/v1/vault/inventory', worker);
        requestUrl.searchParams.set('limit', '1000');
        if (cursor) requestUrl.searchParams.set('cursor', cursor);
        const response = await fetch(requestUrl, {
            method: 'GET',
            headers: { Authorization: `Bearer ${apiKey}` }
        });
        if (!response.ok) throw new Error(`inventory_request_failed_${response.status}`);
        const page = await response.json();
        if (!Array.isArray(page.items)) throw new Error('inventory_items_invalid');
        items.push(...page.items);
        cursor = page.nextCursor === null ? null : page.nextCursor;
        if (cursor && (typeof cursor !== 'string' || cursors.has(cursor))) throw new Error('inventory_cursor_repeated');
        if (cursor) cursors.add(cursor);
    } while (cursor);
    return items;
}

async function main() {
    const args = parseArguments(process.argv.slice(2));
    if (!args.observer || !args.output) return blocked('required --observer and --output arguments');

    const worker = workerUrl(process.env.WORKER_URL);
    if (!worker) return blocked('WORKER_URL must be an HTTPS URL');
    const apiKey = process.env.WORKER_API_KEY || process.env.CLIENT_API_KEY;
    if (!apiKey) return blocked('worker API credential is required');

    let observer;
    try {
        observer = JSON.parse(fs.readFileSync(args.observer, 'utf8'));
    } catch {
        return blocked('observer JSON is unreadable');
    }
    if (!Array.isArray(observer.identities)) return blocked('observer JSON does not contain identities');

    let inventoryItems;
    try {
        inventoryItems = await fetchInventory({ worker, apiKey });
    } catch (error) {
        return blocked(error instanceof Error ? error.message : 'inventory_request_failed');
    }

    const reconciliation = reconcileSavedVaultInventory({
        savedIdentities: observer.identities,
        inventoryItems
    });
    const output = redactReconciliationOutput({
        schemaVersion: 1,
        ...reconciliation,
        inventory: inventoryItems.map(redactInventoryItem)
    });
    fs.mkdirSync(path.dirname(args.output), { recursive: true });
    fs.writeFileSync(args.output, `${JSON.stringify(output, null, 2)}\n`);
    process.stdout.write(`${args.output}\n`);
    if (reconciliation.missing.length || reconciliation.duplicateCanonical.length || reconciliation.unverified.length) {
        process.exitCode = 1;
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main();
}

export { fetchInventory, parseArguments, workerUrl };
