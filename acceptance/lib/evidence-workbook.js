const { redactEvidence } = require('./run-contract.js');

function buildEvidenceWorkbook({ runId, verdict, manifest, events, rows }) {
    return redactEvidence({
        schemaVersion: 1,
        runId,
        verdict,
        generatedAt: new Date().toISOString(),
        manifest: manifest || {},
        events: [...(events || [])].sort((a, b) => String(a.at).localeCompare(String(b.at))),
        rows: rows || []
    });
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function renderEvidenceHtml(workbook) {
    const rows = (workbook.rows || []).map((row) => `
      <tr>
        <td>${escapeHtml(row.status)}</td>
        <td>${escapeHtml(row.assetId)}</td>
        <td>${escapeHtml(row.r2ObjectKey)}</td>
      </tr>`).join('');

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Live Acceptance Evidence ${escapeHtml(workbook.runId)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 40px auto; max-width: 1080px; line-height: 1.5; color: #1f2328; }
    code { background: #f6f8fa; border-radius: 4px; padding: 0.1em 0.3em; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #d0d7de; padding: 8px 10px; text-align: left; }
    th { background: #f6f8fa; }
  </style>
</head>
<body>
  <h1>Live Acceptance Evidence</h1>
  <p>Run <code>${escapeHtml(workbook.runId)}</code> finished as <code>${escapeHtml(workbook.verdict)}</code>.</p>
  <table>
    <thead><tr><th>Status</th><th>Asset</th><th>R2 Object</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;
}

module.exports = {
    buildEvidenceWorkbook,
    renderEvidenceHtml
};
