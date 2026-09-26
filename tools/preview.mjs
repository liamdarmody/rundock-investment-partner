#!/usr/bin/env node
// Screenshots of the view in a real engine, in both themes, before a Rundock
// with named sources is at hand.
//
//   RUNDOCK=/path/to/rundock node tools/preview.mjs [out-dir]
//
// RUNDOCK is a Rundock checkout that ships Rundock UI (public/rundock-ui.js)
// and has Playwright installed. The frame is built by that checkout's own
// frame builder (buildRegionSrcdoc in public/extension-host.js): the same
// Content-Security-Policy, token block, element floor, Rundock UI stylesheet
// and library that a mounted view gets, in a sandbox="allow-scripts" frame.
// The page around it plays Rundock's side of the conversation: it answers
// `ready` with `init`, carrying the starter notes as named sources the way
// Rundock 0.15 hands them, and sizes the frame on `resize`. It is a preview,
// not the host: what the host enforces (which files, which clicks) is
// Rundock's to prove.
//
// Writes dashboard-{dark,light}.png at desktop width, dashboard-narrow.png
// at phone width, dashboard-within-limits.png, the three notes on their own, and preview.json with every
// message the view posted.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNDOCK = process.env.RUNDOCK;
if (!RUNDOCK || !fs.existsSync(path.join(RUNDOCK, 'public', 'rundock-ui.js'))) {
  console.error('Set RUNDOCK to a Rundock checkout that ships public/rundock-ui.js.');
  process.exit(2);
}
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'scratch', 'screenshots'));
fs.mkdirSync(OUT, { recursive: true });
const { chromium } = createRequire(path.join(RUNDOCK, 'package.json'))('playwright');

const starter = (name) => fs.readFileSync(path.join(ROOT, 'starter', 'Investments', name), 'utf8');
const SOURCES = ['Portfolio.md', 'Risk Profile.md', 'Decision Journal.md'].map((n) => ({ path: `Investments/${n}`, content: starter(n) }));
// Rundock draws an extension view full-bleed: the frame fills the pane and
// Rundock supplies the note's padding inside it. A checkout whose element
// floor does not yet carry that padding gets it here, ahead of the
// package's own styles, exactly where the host puts it; a checkout that has
// it gets nothing extra, so the preview never pads twice.
const HOST_INSIDE_PADDING = 'body { padding: 24px 32px; }';
const floor = fs.readFileSync(path.join(RUNDOCK, 'public', 'styles', 'extension-base.css'), 'utf8');
const hostPads = /padding:\s*24px 32px/.test(floor);
const payload = {
  entry: fs.readFileSync(path.join(ROOT, 'ui', 'index.js'), 'utf8'),
  styles: [...(hostPads ? [] : [HOST_INSIDE_PADDING]), fs.readFileSync(path.join(ROOT, 'ui', 'investment.css'), 'utf8')],
};

// The page: Rundock's stylesheets marked the way index.html marks them,
// and one frame built by Rundock's own builder.
const PAGE = `<!doctype html><html><head>
<link rel="stylesheet" href="/rundock/styles/tokens.css">
<link rel="stylesheet" href="/rundock/styles/extension-base.css" media="not all" data-extension-base>
<link rel="stylesheet" href="/rundock/styles/rundock-ui.css" data-rundock-ui>
<style>html,body{margin:0;background:var(--base)} iframe{display:block;width:100%;border:0}</style>
</head><body><script type="module">
import { buildRegionSrcdoc } from '/rundock/extension-host.js';
const job = await (await fetch('/job')).json();
if (job.theme === 'light') document.body.classList.add('light');
const frame = document.createElement('iframe');
frame.setAttribute('sandbox', 'allow-scripts');
frame.srcdoc = buildRegionSrcdoc(job.payload, document);
window.posted = [];
window.addEventListener('message', (event) => {
  if (event.source !== frame.contentWindow) return;
  const m = event.data;
  window.posted.push(m);
  if (m.type === 'ready') {
    const init = { type: 'init', path: job.path, content: job.content, theme: job.theme };
    if (job.sources) init.sources = job.sources;
    frame.contentWindow.postMessage(init, '*');
  }
  if (m.type === 'resize') { frame.style.height = Math.min(Math.max(m.height, 80), 8000) + 'px'; window.sized = true; }
});
document.body.appendChild(frame);
</script></body></html>`;

let job = null;
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(PAGE); return; }
  if (url === '/job') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(job)); return; }
  if (url.startsWith('/rundock/')) {
    const file = path.join(RUNDOCK, 'public', url.slice('/rundock/'.length));
    if (!file.startsWith(path.join(RUNDOCK, 'public') + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream';
    res.writeHead(200, { 'content-type': type });
    fs.createReadStream(file).pipe(res);
    return;
  }
  res.writeHead(404);
  res.end();
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch();
const record = {};
async function shot(name, theme, width, init) {
  job = { theme, payload, ...init };
  const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(base);
  await page.waitForFunction(() => window.sized === true, null, { timeout: 10000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  // Layout facts only a real engine with the stylesheet can report.
  const frame = page.frames().find((f) => f !== page.mainFrame());
  const layout = await frame.evaluate(() => {
    const delta = document.querySelector('.ip-stats .rui-stat-delta');
    const value = delta && delta.parentNode.querySelector('.rui-stat-value');
    return delta ? { deltaIndent: Math.round(delta.getBoundingClientRect().left - value.getBoundingClientRect().left) } : null;
  });
  if (layout && layout.deltaIndent !== 0) errors.push(`the cash tile's secondary line is indented: ${JSON.stringify(layout)}`);
  record[name] = { theme, width, layout, posted: await page.evaluate(() => window.posted), errors };
  await page.close();
}

const dashboard = { path: 'Investments/Investment Dashboard.md', content: starter('Investment Dashboard.md'), sources: SOURCES };
await shot('dashboard-dark', 'dark', 1280, dashboard);
await shot('dashboard-light', 'light', 1280, dashboard);
await shot('dashboard-narrow', 'dark', 390, dashboard);
// The same portfolio under a 20% single-position limit: nothing over, so
// the one ask moves from the alert to the header.
const loose = SOURCES.map((s) => (s.path.endsWith('Risk Profile.md') ? { ...s, content: s.content.replace('"maximumSinglePositionFraction": 0.08', '"maximumSinglePositionFraction": 0.2') } : s));
await shot('dashboard-within-limits', 'dark', 1280, { ...dashboard, sources: loose });
await shot('dashboard-without-sources', 'dark', 1280, { path: dashboard.path, content: dashboard.content });
await shot('portfolio-note', 'dark', 1280, { path: SOURCES[0].path, content: SOURCES[0].content });
await shot('risk-profile-note', 'light', 1280, { path: SOURCES[1].path, content: SOURCES[1].content });
await shot('decision-journal-note', 'dark', 1280, { path: SOURCES[2].path, content: SOURCES[2].content });
await browser.close();
server.close();

fs.writeFileSync(path.join(OUT, 'preview.json'), JSON.stringify(record, null, 2) + '\n');
const failed = Object.entries(record).filter(([, r]) => r.errors.length || r.posted.some((m) => m.type === 'error'));
for (const [name, r] of failed) console.error(`${name}: ${JSON.stringify(r.errors.concat(r.posted.filter((m) => m.type === 'error')))}`);
console.log(`Wrote ${Object.keys(record).length} screenshots to ${OUT}`);
process.exit(failed.length ? 1 : 0);
