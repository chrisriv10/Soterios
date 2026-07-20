const fs = require('fs');
const path = require('path');
const os = require('os');

function reportsDir(ctx) {
  const base = path.join(os.homedir(), '.soterios');
  const dir = path.join(base, 'reports');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function esc(v) {
  return String(v ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

function renderHtml(report) {
  const issues = report.overview.issues || [];
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Soterios Report</title>
<style>body{font-family:Segoe UI,Arial,sans-serif;margin:32px;color:#16202a;background:#fff}h1{margin:0 0 4px}.muted{color:#667085}.score{font-size:48px;font-weight:700}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:20px 0}.card{border:1px solid #d7dde5;border-radius:6px;padding:14px}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{text-align:left;border-bottom:1px solid #e6eaf0;padding:8px;font-size:13px}.danger{color:#b42318}.warn{color:#b54708}.ok{color:#027a48}</style>
</head><body>
<h1>${esc(report.title || 'Soterios Report')}</h1>
<div class="muted">Generated ${esc(new Date(report.generatedAt).toLocaleString())}</div>
<div class="grid">
  <div class="card"><div class="muted">Security Score</div><div class="score ${esc(report.overview.level)}">${esc(report.overview.score)}</div></div>
  <div class="card"><div class="muted">Quarantine</div><h2>${esc(report.quarantine.length)}</h2></div>
  <div class="card"><div class="muted">Flagged in Last Scan</div><h2>${esc((report.recentScans[0] && report.recentScans[0].summary && report.recentScans[0].summary.flagged) || 0)}</h2></div>
</div>
<h2>Recommendations</h2>
<table><thead><tr><th>Level</th><th>Issue</th><th>Detail</th></tr></thead><tbody>
${issues.map((i) => `<tr><td class="${esc(i.level)}">${esc(i.level)}</td><td>${esc(i.title)}</td><td>${esc(i.detail)}</td></tr>`).join('')}
</tbody></table>
<h2>System</h2><pre>${esc(JSON.stringify(report.system, null, 2))}</pre>
</body></html>`;
}

module.exports = {
  id: 'generate-security-report', name: 'Generate Security Report',
  description: 'Export a local HTML and JSON security report with score, issues, and system info.',
  category: 'Reports', icon: 'list-checks',
  run: async (args, ctx) => {
    if (!ctx || !ctx.toolRegistry) throw new Error('toolRegistry is required in ctx');
    const overviewResult = await ctx.toolRegistry.run('security-overview', {}, ctx);
    const systemResult = await ctx.toolRegistry.run('system-monitor', {}, ctx);
    const scanReports = ctx.db && typeof ctx.db.getScanReports === 'function' ? ctx.db.getScanReports(5) : [];
    const quarantine = ctx.db && typeof ctx.db.getQuarantineList === 'function' ? ctx.db.getQuarantineList() : [];

    const generatedAt = new Date();
    const friendlyTitle = `Security Report · ${generatedAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} at ${generatedAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;

    const report = {
      title: friendlyTitle,
      generatedAt: generatedAt.toISOString(),
      app: { name: 'Soterios', version: args.version || '1.2.1' },
      overview: overviewResult.data,
      system: systemResult.data,
      recentScans: scanReports,
      quarantine,
      recommendations: overviewResult.data ? overviewResult.data.recommendations || [] : []
    };

    const stamp = generatedAt.toISOString().replace(/[:.]/g, '-');
    const dir = reportsDir(ctx);
    const jsonPath = path.join(dir, `soterios-report-${stamp}.json`);
    const htmlPath = path.join(dir, `soterios-report-${stamp}.html`);
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf-8');
    fs.writeFileSync(htmlPath, renderHtml(report), 'utf-8');

    if (ctx.appStore) ctx.appStore.addHistory('reports', { title: friendlyTitle, htmlPath, jsonPath, score: report.overview ? report.overview.score : null }, 20);
    return { report, files: { html: htmlPath, json: jsonPath }, path: jsonPath };
  }
};