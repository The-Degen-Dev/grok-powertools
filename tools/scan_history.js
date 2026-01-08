const fs = require('fs');
const path = require('path');

// Usage: node tools/scan_history.js <path_to_grok_vault>
const targetDir = process.argv[2];

if (!targetDir) {
    console.error('Please provide a target directory path.');
    console.error('Usage: node tools/scan_history.js /path/to/GrokVault');
    process.exit(1);
}

const processedIds = new Set();
// UUID Regex: 8-4-4-4-12
const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function scanDir(dir) {
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir);

    files.forEach(file => {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            scanDir(fullPath);
        } else {
            const match = file.match(uuidRegex);
            if (match) {
                processedIds.add(match[0]);
            }
        }
    });
}

console.log(`Scanning: ${targetDir}...`);
scanDir(targetDir);

const output = {
    processedIds: Array.from(processedIds)
};

const outputPath = path.join(__dirname, 'history.json');
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

console.log(`Done! Found ${processedIds.size} unique UUIDs.`);
console.log(`Saved to: ${outputPath}`);
console.log('');
console.log('Now go to Chrome Extension -> Settings -> Advanced -> Import JSON and select this file.');
