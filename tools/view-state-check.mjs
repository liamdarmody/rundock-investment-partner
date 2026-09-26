#!/usr/bin/env node
// Positions keeps its widths through Rundock's own view state, checked in a
// real engine on a real mount.
//
//   RUNDOCK=/path/to/rundock node tools/view-state-check.mjs
//
// RUNDOCK is a Rundock checkout with view state (0.15) and Playwright. The
// page mounts the dashboard through that checkout's own host
// (mountExtension in public/extension-host.js): the real sandboxed frame,
// the real bootstrap that installs Rundock.viewState, and the real `setState`
// check. It plays the rest of Rundock's side: it keeps what `onState` hands
// it, as Rundock's server would, and hands it back on the next mount.
//
// It resizes the Account column with the keyboard, remounts (a reload, or
// leaving the note and coming back), and checks the column opens at the
// kept width, that the width is kept under the Positions key, and that
// nothing was written to any note. Exits 1 on any failure, naming it.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNDOCK = process.env.RUNDOCK;
if (!RUNDOCK || !fs.existsSync(path.join(RUNDOCK, 'public', 'extension-host.js'))) {
  console.error('Set RUNDOCK to a Rundock checkout that ships public/extension-host.js.');
  process.exit(2);
}
const { chromium } = createRequire(path.join(RUNDOCK, 'package.json'))('playwright');
const starter = (name) => fs.readFileSync(path.join(ROOT, 'starter', 'Investments', name), 'utf8');
const job = {
  payload: { entry: fs.readFileSync(path.join(ROOT, 'ui', 'index.js'), 'utf8'), styles: [fs.readFileSync(path.join(ROOT, 'ui', 'investment.css'), 'utf8')], writes: true, sources: true },
  path: 'Investments/Investment Dashboard.md',
  content: starter('Investment Dashboard.md'),
  sources: ['Portfolio.md', 'Risk Profile.md', 'Decision Journal.md'].map((n) => ({ path: `Investments/${n}`, content: starter(n) })),
};

const PAGE = `<!doctype html><html><head>
<link rel="stylesheet" href="/rundock/styles/tokens.css">
<link rel="stylesheet" href="/rundock/styles/extension-base.css" media="not all" data-extension-base>
<link rel="stylesheet" href="/rundock/styles/rundock-ui.css" data-rundock-ui>
<style>html,body{margin:0;background:var(--base)} iframe{display:block;width:100%;border:0;height:2400px}</style>
</head><body><div id="pane"></div><script type="module">
import { mountExtension } from '/rundock/extension-host.js';
const job = await (await fetch('/job')).json();
window.kept = null;
window.writes = [];
window.mountWith = (state) => {
  if (window.handle) window.handle.teardown();
  window.handle = mountExtension({
    paneElement: document.getElementById('pane'), payload: job.payload, path: job.path, content: job.content, sources: job.sources, state,
    onState: (s) => { window.kept = JSON.parse(JSON.stringify(s)); },
    onSave: (c) => window.writes.push(['save', c]), onChange: (c) => window.writes.push(['change', c]),
    onSaveSource: (p) => window.writes.push(['saveSource', p]), onChangeSource: (p) => window.writes.push(['changeSource', p]),
    onDegrade: (reason) => { window.degraded = reason; },
  });
};
window.mountWith(null);
</script></body></html>`;

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(PAGE); return; }
  if (url === '/job') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(job)); return; }
  const file = path.join(RUNDOCK, 'public', url.slice('/rundock/'.length));
  if (!url.startsWith('/rundock/') || !file.startsWith(path.join(RUNDOCK, 'public') + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': file.endsWith('.js') ? 'text/javascript' : 'text/css' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

const failures = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', (e) => failures.push(`page error: ${e}`));
await page.goto(`http://127.0.0.1:${server.address().port}/`);
const view = page.frameLocator('#pane iframe');
const handle = view.locator('.ip-positions thead th', { hasText: 'Account' }).locator('.rui-col-resize');
// The width a handle reports once the table has laid out, polled because
// layout follows the frame's first paint.
async function width(until) {
  let value = null;
  for (let i = 0; i < 50; i += 1) {
    const raw = await handle.getAttribute('aria-valuenow').catch(() => null);
    value = raw === null ? null : Number(raw);
    if (value !== null && (until === undefined || value === until)) break;
    await page.waitForTimeout(100);
  }
  return value;
}
await handle.waitFor({ timeout: 10000 });
const rule = await width();
await handle.focus();
for (let i = 0; i < 3; i += 1) await handle.press('Shift+ArrowRight');
await page.waitForFunction(() => window.kept !== null, null, { timeout: 5000 }).catch(() => failures.push('no state was handed to Rundock after a resize'));
const kept = await page.evaluate(() => window.kept);
const widened = Number(await handle.getAttribute('aria-valuenow'));
if (!(widened > rule)) failures.push(`the column did not widen: ${rule} to ${widened}`);
if (JSON.stringify(kept) !== JSON.stringify({ 'rui.table.positions': { account: widened } })) failures.push(`kept ${JSON.stringify(kept)}, expected the Account width under rui.table.positions`);
await page.evaluate((state) => window.mountWith(state), kept);
await handle.waitFor({ timeout: 10000 });
const reopened = await width(widened);
if (reopened !== widened) failures.push(`a new mount opened the column at ${reopened}, not the kept ${widened}`);
const writes = await page.evaluate(() => window.writes);
if (writes.length) failures.push(`notes were written: ${JSON.stringify(writes.map((w) => w[0]))}`);
const degraded = await page.evaluate(() => window.degraded);
if (degraded) failures.push(`the view degraded: ${degraded}`);
await browser.close();
server.close();

console.log(JSON.stringify({ rule, widened, kept, reopened, failures }, null, 2));
process.exit(failures.length ? 1 : 0);
