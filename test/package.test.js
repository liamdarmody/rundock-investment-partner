'use strict';
// The package as Rundock will read it: one manifest claiming marked notes,
// handed their named sources, able to ask Lead Partner; three agents and two
// skills under .claude; starter notes that land where the person has
// nothing; and a version the tag and the install card agree on.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const lib = require('../ui/index.js');
const check = require('../scripts/check-version.js');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const manifest = JSON.parse(read('rundock.json'));

test('the manifest claims only notes carrying the marker, and asks to write them', () => {
  assert.equal(manifest.extension.match, '*.md');
  assert.equal(manifest.extension.declares, lib.MARKER);
  assert.equal(manifest.extension.writes, true);
  // Sources only ever with a marker (Rundock refuses the pair otherwise).
  assert.equal(manifest.extension.sources, true);
  assert.equal(typeof manifest.extension.declares, 'string');
  // The one agent the view asks, and it is one this package ships.
  assert.deepEqual(manifest.extension.asks, [lib.LEAD]);
  for (const id of manifest.extension.asks) {
    assert.match(id, /^[a-z0-9_-]{1,64}$/);
    assert.ok(fs.statSync(path.join(ROOT, '.claude', 'agents', `${id}.md`)).isFile(), id);
  }
  assert.match(manifest.extension.rundockUi, /^\d+\.\d+$/);
  assert.deepEqual(Object.keys(manifest).sort(), ['displayName', 'extension', 'name', 'version']);
  // The name people read, held to the rule Rundock enforces at install.
  assert.equal(manifest.displayName, 'Investment Partner');
  assert.doesNotMatch(manifest.displayName, /[<>\x00-\x1f\x7f]/);
  for (const p of [manifest.extension.entry, ...manifest.extension.styles]) {
    assert.ok(fs.statSync(path.join(ROOT, p)).isFile(), p);
  }
});

test('rundock.json and package.json name the same version', () => {
  assert.equal(manifest.version, JSON.parse(read('package.json')).version);
});

test('every starter note reads cleanly as the kind it claims, and the dashboard lists the other three', () => {
  const dir = path.join(ROOT, 'starter');
  const found = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
    // Rundock refuses a package with any hidden name under starter/.
    assert.ok(!e.name.startsWith('.'), `hidden name under starter/: ${e.name}`);
    if (e.isDirectory()) walk(path.join(d, e.name)); else found.push(path.relative(dir, path.join(d, e.name)));
  });
  walk(dir);
  const expect = { 'Investments/Portfolio.md': 'portfolio', 'Investments/Risk Profile.md': 'risk-profile', 'Investments/Decision Journal.md': 'decision-journal', 'Investments/Investment Dashboard.md': lib.DASHBOARD };
  assert.deepEqual(found.sort(), Object.keys(expect).sort());
  for (const [rel, kind] of Object.entries(expect)) {
    const text = read('starter', rel);
    if (kind === lib.DASHBOARD) {
      assert.equal(lib.kindOf(text), lib.DASHBOARD);
      assert.equal(rel, lib.DASHBOARD_PATH, 'the notes\' "Open the dashboard" button opens this path');
      assert.deepEqual(lib.sourcesListed(text), Object.keys(expect).filter((k) => expect[k] !== lib.DASHBOARD));
      assert.equal(lib.dataBlock(text), null, 'the dashboard holds no data of its own, so nothing ever writes it');
      continue;
    }
    const note = lib.readNote(text);
    assert.equal(note.error, undefined, `${rel}: ${note.error}`);
    assert.equal(note.kind, kind);
    assert.equal(note.data.schemaVersion, 2);
  }
});

test('the view reaches for no network, no storage and no parsed markup', () => {
  const source = read('ui', 'index.js');
  for (const pattern of [/\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /localStorage/, /sessionStorage/, /innerHTML/, /outerHTML/, /insertAdjacentHTML/, /\beval\s*\(/, /\bimport\s*\(/, /document\.write/]) {
    assert.ok(!pattern.test(source), `ui/index.js matches ${pattern}`);
  }
  // Every message is named once, in the adapter, and posted only from it.
  assert.equal((source.match(/postMessage\(/g) || []).length, 1);
  assert.deepEqual(Object.values(lib.MESSAGES).sort(), ['ask', 'change', 'changeSource', 'error', 'init', 'open', 'ready', 'refused', 'resize', 'sources']);
});

test('the stylesheet places Rundock UI and never restyles its controls', () => {
  const raw = read('ui', 'investment.css');
  // The one reach into a component: an over-limit meter takes the attention
  // tone, colour only. Everything else of a control's is Rundock UI's.
  const meterRules = raw.match(/\.ip-root \.rui-meter-[a-z]+\.rui-over \{[^}]*\}/g) || [];
  assert.equal(meterRules.length, 2);
  for (const rule of meterRules) assert.match(rule, /\{ (background|color): var\(--(attention|text-1)\); \}$/, rule);
  const css = raw.split('\n').filter((line) => !/^\.ip-root \.rui-meter-[a-z]+\.rui-over/.test(line)).join('\n');
  // The checkbox, toggle and slider geometry is Rundock's. Layout around a
  // stat, a button or a card is fine; the controls themselves are not ours.
  for (const cls of ['rui-slider', 'rui-toggle', 'rui-checkbox', 'rui-tab', 'rui-option', 'rui-menu', 'rui-board', 'rui-meter', 'rui-input']) {
    assert.ok(!new RegExp(`\\.${cls}\\b`).test(css), `investment.css restyles .${cls}`);
  }
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(css), 'colours come from tokens');
  // Rundock fills the pane with the frame and pads inside it; a second margin
  // of the package's own would inset the dashboard twice.
  const root = css.match(/\.ip-root \{([^}]*)\}/)[1];
  for (const prop of ['padding', 'margin', 'max-width']) assert.ok(!new RegExp(`(^|;)\\s*${prop}\\s*:`).test(root), `.ip-root sets ${prop}`);
  assert.ok(!/\.ip-root \{[^}]*padding/.test(css.split('@media').slice(1).join('@media')), 'no padding on .ip-root at any width');
  // The Propose a trade tile reads as a button in both variants: over a limit
  // a secondary button with a control's edge, not a card's; and pressed
  // while the form it opens is showing.
  assert.match(css, /\.ip-trade > \.rui-btn-secondary \{[^}]*border-color: var\(--text-3\)/);
  assert.match(css, /\.ip-trade > \.rui-btn\[aria-expanded="true"\] \{[^}]*box-shadow: inset/);
});

test('the reset skill puts back empty, valid notes, and the same dashboard the package ships', () => {
  const dir = ['.claude', 'skills', 'investment-reset', 'templates'];
  const expect = { 'Portfolio.md': 'portfolio', 'Risk Profile.md': 'risk-profile', 'Decision Journal.md': 'decision-journal' };
  for (const [name, kind] of Object.entries(expect)) {
    const note = lib.readNote(read(...dir, name));
    assert.equal(note.error, undefined, `${name}: ${note.error}`);
    assert.equal(note.kind, kind);
    assert.equal(note.data.schemaVersion, 2);
  }
  assert.deepEqual(lib.readNote(read(...dir, 'Portfolio.md')).data.accounts, []);
  assert.deepEqual(lib.readNote(read(...dir, 'Decision Journal.md')).data.entries, []);
  assert.deepEqual(lib.readNote(read(...dir, 'Risk Profile.md')).data.constraints, lib.readNote(read('starter', 'Investments', 'Risk Profile.md')).data.constraints);
  assert.equal(read(...dir, 'Investment Dashboard.md'), read('starter', 'Investments', 'Investment Dashboard.md'));
  assert.ok(!fs.existsSync(path.join(ROOT, '.claude', 'skills', 'investment-setup')), 'setup no longer creates files; starter files do');
});

test('the agents are told the schema the view reads and writes', () => {
  const review = read('.claude', 'skills', 'investment-review', 'SKILL.md');
  for (const key of ['maximumSinglePositionFraction', 'maximumSectorFraction', 'maximumAccountFraction', 'minimumCashReserveFraction',
    'maximumIlliquidFraction', 'preferTaxAdvantagedForDividends', 'avoidShortTermGains', 'strategyRegime', 'fund: true', 'illiquid: true',
    'baseCurrency', '"sample": true']) {
    assert.ok(review.includes(key), `the review skill does not name ${key}`);
  }
  for (const r of lib.REGIMES) assert.ok(review.includes(r.value), r.value);
  for (const st of lib.STATUSES) assert.ok(review.includes('`' + st + '`'), st);
  const lead = read('.claude', 'agents', 'lead-partner.md');
  assert.match(lead, /Investments\/Investment Dashboard\.md/);
  assert.match(lead, /investment-reset/);
  for (const part of [/baseCurrency/, /never convert between currencies/, /remove `"sample": true`/, /which country they live in/]) assert.match(lead, part);
  assert.match(read('.claude', 'skills', 'investment-reset', 'SKILL.md'), /only a portfolio that still carries `"sample": true` may be emptied/);
  assert.ok(!/investment-setup/.test(lead));
});

function frontmatter(text) {
  const block = text.split('\n---')[0].slice(4);
  const out = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^([A-Za-z]+):\s*(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

test('the team: Lead Partner joins under the workspace leader, the other two under Lead Partner', () => {
  const agents = Object.fromEntries(['lead-partner', 'equity-analyst', 'risk-manager']
    .map((slug) => [slug, frontmatter(read('.claude', 'agents', `${slug}.md`))]));
  for (const [slug, fm] of Object.entries(agents)) {
    assert.equal(fm.name, slug);
    assert.equal(fm.type, 'specialist');
  }
  // Rundock puts an agent on the team only when it carries an order; one
  // with a type and no order is "available", gets no skills, and cannot be
  // asked from a view. Decimals group the two under Lead Partner, and 10
  // keeps clear of a workspace's own 1, 2, 3.
  assert.deepEqual(Object.fromEntries(Object.entries(agents).map(([slug, fm]) => [slug, fm.order])),
    { 'lead-partner': '10', 'equity-analyst': '10.1', 'risk-manager': '10.2' });
  assert.equal(agents['lead-partner'].reportsTo, undefined);
  assert.equal(agents['equity-analyst'].reportsTo, 'lead-partner');
  assert.equal(agents['risk-manager'].reportsTo, 'lead-partner');
});

test('nothing in the package points at the old plugin storage', () => {
  const files = ['.claude/agents/lead-partner.md', '.claude/agents/equity-analyst.md', '.claude/agents/risk-manager.md',
    '.claude/skills/investment-review/SKILL.md', '.claude/skills/investment-reset/SKILL.md', 'ui/index.js'];
  // Nothing to install lives in the old places either: the notes are starter files now.
  assert.ok(!fs.existsSync(path.join(ROOT, 'example')));
  for (const f of files) assert.ok(!read(f).includes('plugin-data'), f);
});

const inRepo = check.isRepository();

test('every tag agrees with its manifest', { skip: !inRepo && 'not a git checkout' }, () => {
  assert.deepEqual(check.checkAllTags(), []);
});
