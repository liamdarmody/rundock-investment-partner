'use strict';
// The view against the real Rundock UI, the way a frame runs it: the
// dashboard drawn from its named sources, every edit written back as it is
// made, the asks, and the fallbacks for a Rundock that cannot hand a view
// its sources yet. See helpers.js for RUNDOCK_UI.
const test = require('node:test');
const assert = require('node:assert/strict');

const lib = require('../ui/index.js');
const { mount, skip, starter, viewStateStore, SOURCES } = require('./helpers.js');

const ALLOWED = new Set(Object.values(lib.MESSAGES));
const dataOf = (content) => lib.readNote(content).data;
const sliderNamed = (f, name) => f.$$('.rui-slider-wrap').find((w) => w.textContent.startsWith(name)).querySelector('input');

test('the dashboard draws every section of the reference from its three sources', { skip }, async () => {
  const f = await mount();
  assert.deepEqual(f.sent[0], { type: 'ready' });
  f.dashboard();
  assert.equal(f.$('h1').textContent, 'Investment Partner');
  assert.deepEqual(f.$$('.rui-stat-value').map((v) => v.textContent), ['$399,920 · USD', '11.0%', 'Growth & income']);
  assert.ok(f.$('.rui-stat .rui-chip'), 'the regime is a chip');
  assert.ok(f.$$('.rui-btn-secondary').some((b) => b.textContent === '+ Propose a trade'), 'over a limit, Propose a trade steps back');

  const alert = f.$('.ip-risk .rui-alert-attention');
  assert.ok(alert, 'the risk alert is drawn');
  assert.match(alert.textContent, /Over limit: 2 allocations are outside your risk limits\./);
  assert.match(alert.textContent, /BTC is 15\.8% of the portfolio, above the 8.0% single-position maximum\./);
  assert.match(alert.textContent, /NVDA is 11\.3%/);

  const tabs = f.$$('[role=tab]').map((t) => t.textContent);
  assert.deepEqual(tabs, ['Asset class', 'Sector', 'Geography', 'Account type']);
  assert.match(f.$('.rui-canvas [role=img]').getAttribute('aria-label'), /^Allocation by asset class: Diversified \$154,730, 38\.7%; Equity \$120,000, 30\.0%/);
  assert.equal(f.$$('.ip-donut circle').length, 1 + 4, 'a track and one arc per row');

  const meters = f.$$('.rui-meter').map((m) => m.getAttribute('aria-label'));
  assert.equal(meters.length, 6, 'five accounts and cash');
  assert.match(meters[0], /^Taxable Brokerage · Taxable · \$196,500, 49\.1% of a 60\.0% maximum$/);
  assert.match(meters[5], /^Cash · \$43,900, 11\.0% of a 5\.0% minimum$/);

  assert.deepEqual(f.$$('.rui-slider').map((s) => s.getAttribute('aria-valuetext')), ['8.0%', '35.0%', '60.0%', '5.0%', '15.0%']);
  assert.equal(f.$$('[role=switch]').length, 2);
  assert.ok(f.$$('[role=switch]').every((t) => t.checked));
  assert.equal(f.$('[role=radio][aria-checked=true]').textContent, 'Growth & income');

  assert.deepEqual(f.$$('.rui-board-col-title').map((t) => t.textContent), ['Proposed', 'Approved', 'Executed', 'Rejected', 'Archived']);
  assert.deepEqual(f.$$('.rui-board-col').map((c) => c.querySelectorAll('.rui-board-card').length), [2, 1, 1, 1, 1]);
  assert.equal(f.$$('.rui-btn').filter((b) => /Ask Lead Partner/.test(b.textContent)).length, 1, 'one ask on the screen');
  assert.ok(f.$('.ip-risk .rui-alert-attention .rui-alert-action'), 'and it is the alert\'s');
  assert.equal(f.$('.ip-header-ask'), null);
  assert.equal(f.$$('.rui-card-title').filter((t) => t.textContent === 'Ask Lead Partner').length, 0, 'no ask card');
  // The cash tile's secondary line is the stat's own delta, with no trend dot.
  const delta = f.$$('.rui-stat')[1].querySelector('.rui-stat-delta');
  assert.equal(delta.textContent, '$43,900');
  assert.equal(delta.className, 'rui-stat-delta', 'no trend, so Rundock UI draws no trend dot');
  assert.ok(f.all('resize').length > 0);
  for (const m of f.sent) assert.ok(ALLOWED.has(m.type), `posted ${m.type}`);
  assert.equal(f.win.Rundock.ui.version, '1.0', 'ran against a real Rundock UI');
});

test('moving a limit writes the risk profile as a changeSource, updates the alert, and keeps the slider', { skip }, async () => {
  const f = await mount();
  f.dashboard();
  const slider = sliderNamed(f, 'Max single position');
  slider.focus();
  f.slide(slider, 20);
  const write = f.last('changeSource');
  assert.equal(write.source, 'Investments/Risk Profile.md');
  assert.equal(Object.keys(write).sort().join(','), 'content,source,type');
  assert.equal(dataOf(write.content).constraints.maximumSinglePositionFraction, 0.2);
  assert.equal(write.content.split('```json')[0], starter('Risk Profile.md').split('```json')[0], 'the prose is untouched');
  assert.equal(f.$('.ip-risk .rui-alert-attention'), null, 'nothing is over a 20% limit');
  assert.match(f.$('.ip-risk .rui-alert-success').textContent, /^Within limits/);
  assert.equal(f.$$('.rui-btn').filter((b) => /Ask Lead Partner/.test(b.textContent)).length, 1, 'still one ask');
  assert.ok(f.$('.ip-header-ask .rui-btn-secondary'), 'now a quiet one in the header');
  f.slide(slider, 8);
  assert.equal(f.$('.ip-header-ask'), null, 'and back to the alert\'s when something is over again');

  // Rundock reports the write back; the view takes its own echo quietly.
  f.send({ type: 'sources', sources: SOURCES.map((s) => (s.path === write.source ? { path: s.path, content: write.content } : s)) });
  assert.ok(slider.isConnected, 'the slider was not redrawn under the pointer');
  assert.equal(f.doc.activeElement, slider);
});

test('each limit, the two tax toggles and the regime write their own field', { skip }, async () => {
  const f = await mount();
  f.dashboard();
  const cases = [['Max sector concentration', 'maximumSectorFraction'], ['Max single account exposure', 'maximumAccountFraction'],
    ['Min cash reserve', 'minimumCashReserveFraction'], ['Max illiquid assets', 'maximumIlliquidFraction']];
  for (const [name, key] of cases) {
    f.slide(sliderNamed(f, name), 41);
    assert.equal(dataOf(f.last('changeSource').content).constraints[key], 0.41, key);
  }
  f.$$('[role=switch]')[1].click();
  assert.equal(dataOf(f.last('changeSource').content).taxPreferences.avoidShortTermGains, false);
  assert.equal(dataOf(f.last('changeSource').content).taxPreferences.preferTaxAdvantagedForDividends, true);
  const regime = f.$('[role=radio][aria-checked=true]');
  regime.focus();
  f.key(regime, 'ArrowDown');
  assert.equal(dataOf(f.last('changeSource').content).strategyRegime, 'capital-preservation');
  assert.equal(f.doc.activeElement.textContent, 'Capital preservation', 'focus moves with the choice');
  assert.equal(f.$$('.rui-stat-value')[2].textContent, 'Capital preservation', 'the stat follows');
});

test('the allocation tabs switch by keyboard and keep focus', { skip }, async () => {
  const f = await mount();
  f.dashboard();
  const first = f.$('[role=tab]');
  first.focus();
  f.key(first, 'ArrowRight');
  assert.equal(f.doc.activeElement.textContent, 'Sector');
  assert.match(f.$('.rui-canvas [role=img]').getAttribute('aria-label'), /^Allocation by sector: Broad market \$134,450/);
  f.key(f.doc.activeElement, 'End');
  assert.match(f.$('.rui-canvas [role=img]').getAttribute('aria-label'), /^Allocation by account type: Taxable \$196,500, 49\.1%/);
});

test('a decision moves by its menu, writes the journal, and focus follows the card', { skip }, async () => {
  const f = await mount();
  f.dashboard();
  const card = f.$('.rui-board-col[data-column="proposed"] .rui-board-card');
  const trigger = card.querySelector('.rui-menu-btn');
  assert.equal(trigger.getAttribute('aria-label'), 'Move PLTR: buy');
  trigger.click();
  [...card.querySelectorAll('[role=menuitemradio]')].find((i) => i.textContent.includes('Approved')).click();
  const write = f.last('changeSource');
  assert.equal(write.source, 'Investments/Decision Journal.md');
  const entry = dataOf(write.content).entries.find((e) => e.ticker === 'PLTR');
  assert.equal(entry.status, 'approved');
  assert.notEqual(entry.updatedAt, '2026-09-21T10:00:00.000Z');
  assert.equal(f.doc.activeElement, f.$('.rui-board-col[data-column="approved"] .rui-board-card:last-child .rui-menu-btn'));
});

test('the alert and Ask Lead Partner each draft an ask, and a refusal is shown in place', { skip }, async () => {
  const f = await mount();
  f.dashboard();
  let ask;
  f.$('.ip-risk .rui-alert-attention .rui-alert-action').click();
  ask = f.last('ask');
  assert.match(ask.message, /^My dashboard shows allocations outside my risk limits:\n- BTC is 15\.8%/);

  f.slide(sliderNamed(f, 'Max single position'), 20);
  const button = f.$('.ip-header-ask .rui-btn');
  button.click();
  assert.match(f.last('ask').message, /Total value: \$399,920 \(USD\)\. Cash: 11\.0%\./);
  f.send({ type: 'refused', of: 'ask', reason: 'ask is honoured only after a click inside the view' });
  const note = button.parentNode.querySelector('.ip-ask-note .rui-alert');
  assert.ok(note, 'the refusal sits under the button that asked');
  assert.match(note.textContent, /^Not asked: .*only after a click/);
  assert.equal(f.all('ask').length, 2, 'one ask per click, none by script');
});

test('a change made elsewhere to a source redraws from the new text', { skip }, async () => {
  const f = await mount();
  f.dashboard();
  const p = dataOf(starter('Portfolio.md'));
  p.accounts[4].cashBalance = 126500;
  const changed = lib.writeNote(starter('Portfolio.md'), p);
  f.send({ type: 'sources', sources: [{ path: SOURCES[0].path, content: changed }, SOURCES[1], SOURCES[2]] });
  assert.equal(f.$$('.rui-stat-value')[0].textContent, '$499,920 · USD');
  // A later edit builds on the new text, not the old.
  f.slide(sliderNamed(f, 'Max sector concentration'), 50);
  f.$$('.rui-board-card .rui-menu-btn')[0].click();
  f.$$('[role=menuitemradio]').find((i) => i.textContent.includes('Rejected')).click();
  assert.equal(dataOf(f.last('changeSource').content).entries.find((e) => e.ticker === 'PLTR').status, 'rejected');
});

test('a mixed update keeps this view\'s newer write rather than an older copy of it', { skip }, async () => {
  const f = await mount();
  f.dashboard();
  const slider = sliderNamed(f, 'Max single position');
  f.slide(slider, 10);
  const older = f.last('changeSource').content;
  f.slide(slider, 12);
  const journal = dataOf(starter('Decision Journal.md'));
  journal.entries.pop();
  f.send({ type: 'sources', sources: [SOURCES[0], { path: SOURCES[1].path, content: older }, { path: SOURCES[2].path, content: lib.writeNote(starter('Decision Journal.md'), journal) }] });
  assert.equal(f.$$('.rui-board-card').length, 5, 'the outside change is drawn');
  assert.equal(sliderNamed(f, 'Max single position').getAttribute('aria-valuetext'), '12.0%', 'the newer limit is kept');
});

test('a refused or unreadable source is named, and the rest of the dashboard still draws', { skip }, async () => {
  const f = await mount();
  f.dashboard([SOURCES[0], { path: 'Investments/Risk Profile.md', refused: 'a hard link is never handed to a view' }, { path: 'Notes/x.md', content: '# not ours' }]);
  const notices = f.$$('.ip-notices .rui-alert').map((a) => a.textContent);
  assert.match(notices[0], /^Investments\/Risk Profile\.md is not drawn: Rundock did not hand it over \(a hard link is never handed to a view\)\.$/);
  assert.match(notices[1], /^Notes\/x\.md is not drawn: the note carries no investment-partner marker/);
  assert.equal(f.$('.ip-breaches'), null, 'no risk check without a risk profile');
  assert.equal(f.$('.ip-risk .rui-alert-success'), null);
  assert.ok(f.$('.rui-canvas'), 'the portfolio still draws');
  assert.equal(f.$$('.rui-empty-title').map((t) => t.textContent).join('|'), 'No risk profile listed|No decision journal listed');
});

test('on a Rundock without named sources, the dashboard says so and offers each note by click', { skip }, async () => {
  const f = await mount();
  f.init(starter('Investment Dashboard.md'), 'Investments/Investment Dashboard.md');
  assert.equal(f.$('.rui-empty-title').textContent, 'This Rundock cannot hand the dashboard its notes');
  const buttons = f.$$('.ip-open-row .rui-btn');
  assert.deepEqual(buttons.map((b) => b.textContent), ['Open Investments/Portfolio.md', 'Open Investments/Risk Profile.md', 'Open Investments/Decision Journal.md']);
  assert.equal(f.all('open').length, 0);
  buttons[1].click();
  assert.deepEqual(f.all('open'), [{ type: 'open', target: 'Investments/Risk Profile.md' }]);

  const g = await mount();
  g.dashboard([]);
  assert.equal(g.$('.rui-empty-title').textContent, 'Rundock handed this view none of its notes');
});

test('the portfolio note on its own: allocation and positions, edited in place with change', { skip }, async () => {
  const f = await mount();
  f.init(starter('Portfolio.md'), 'Investments/Portfolio.md');
  assert.equal(f.$('h1').textContent, 'Portfolio');
  assert.ok(f.$('.rui-canvas'));
  assert.equal(f.$('.rui-alert'), null, 'no risk check from one note');
  f.$('.rui-table tbody tr td:nth-child(3) .rui-cell').click();
  const qty = f.$('.rui-table .rui-cell-editor');
  assert.equal(qty.getAttribute('aria-label'), 'Quantity of VTI in Taxable Brokerage');
  qty.value = 'abc';
  f.key(qty, 'Enter');
  assert.equal(qty.getAttribute('aria-invalid'), 'true');
  assert.equal(f.doc.getElementById(qty.getAttribute('aria-describedby')).textContent, 'Quantity: Enter a number of 0 or more.', 'said on a line under the row, naming the column');
  assert.equal(f.all('change').length, 0, 'an invalid number is not written');
  qty.value = '300';
  f.key(qty, 'Enter');
  assert.equal(f.$('.rui-table .rui-cell-editor'), null);
  const change = f.last('change');
  assert.equal(Object.keys(change).sort().join(','), 'content,type');
  assert.equal(lib.allPositions(dataOf(change.content))[0].position.quantity, 300);
  assert.equal(f.$$('.rui-stat-value')[0].textContent, '$402,820 · USD ▾');
  assert.equal(f.doc.querySelector('.rui-table td:nth-child(5)').textContent, '$87,000');
  assert.equal(f.all('changeSource').length, 0);
  f.$$('.rui-btn').find((b) => b.textContent === 'Open the dashboard').click();
  assert.deepEqual(f.last('open'), { type: 'open', target: lib.DASHBOARD_PATH });
});

test('the risk profile and journal notes on their own write with change', { skip }, async () => {
  const f = await mount();
  f.init(starter('Risk Profile.md'), 'Investments/Risk Profile.md');
  f.slide(f.$('.rui-slider'), 9);
  assert.equal(dataOf(f.last('change').content).constraints.maximumSinglePositionFraction, 0.09);
  const g = await mount();
  g.init(starter('Decision Journal.md'), 'Investments/Decision Journal.md');
  assert.equal(g.$$('.rui-board-card').length, 6);
});

test('a note it cannot read, or a Rundock without Rundock UI, is named as an error', { skip }, async () => {
  const f = await mount();
  f.init('---\ninvestment-partner: portfolio\n---\n```json\n{ broken\n```\n', 'x.md');
  assert.match(f.last('error').message, /not valid JSON/);
  const g = await mount({ withUi: false });
  g.dashboard();
  assert.match(g.last('error').message, /needs Rundock UI/);
});

test('messages from anything but the host are ignored, and markup in a note stays text', { skip }, async () => {
  const f = await mount();
  f.send({ type: 'init', path: 'x', content: starter('Investment Dashboard.md'), sources: SOURCES }, null);
  assert.equal(f.$('h1'), null);
  const hostile = '---\ninvestment-partner: decision-journal\n---\n```json\n'
    + JSON.stringify({ entries: [{ decisionId: 'x', ticker: '<img src=x onerror=alert(1)>', action: 'buy', status: 'proposed', thesis: '<script>1</script>' }] })
    + '\n```\n';
  f.init(hostile, 'j.md');
  assert.equal(f.$$('img').length, 0);
  assert.equal(f.$$('script').length, 0);
  assert.match(f.$('.rui-board-card-title').textContent, /<img src=x/);
});

const tradeButton = (f) => f.$('#ip-trade-button');

test('Propose a trade is primary within limits and steps back to secondary while anything is over', { skip }, async () => {
  const f = await mount();
  f.dashboard();
  assert.equal(tradeButton(f).textContent, '+ Propose a trade');
  assert.ok(tradeButton(f).classList.contains('rui-btn-secondary'));
  const action = f.$('.ip-risk .rui-alert-attention .rui-alert-action');
  assert.ok(action.classList.contains('rui-btn-primary'), 'the alert\'s Ask Lead Partner is the primary action');
  assert.deepEqual(f.$$('.rui-btn-primary').map((b) => b.textContent), ['Ask Lead Partner'], 'one primary action on the screen');
  const slider = sliderNamed(f, 'Max single position');
  slider.focus();
  f.slide(slider, 20);
  assert.ok(tradeButton(f).classList.contains('rui-btn-primary'), 'within limits it is the primary action again');
  assert.equal(f.$('.ip-risk .rui-alert-action'), null);
  assert.equal(f.doc.activeElement, slider, 'the redraw never takes focus from the slider');
  f.slide(slider, 8);
  assert.ok(tradeButton(f).classList.contains('rui-btn-secondary'));
});

test('the trade form opens in place, checks every field, and drafts a complete message', { skip }, async () => {
  const f = await mount();
  f.dashboard();
  const button = tradeButton(f);
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  assert.equal(f.$('#ip-trade-form'), null, 'closed until asked for');
  button.click();
  assert.equal(tradeButton(f).getAttribute('aria-expanded'), 'true');
  assert.equal(tradeButton(f).getAttribute('aria-controls'), 'ip-trade-form');
  assert.ok(f.$('#ip-trade-form'));
  assert.equal(f.doc.activeElement.id, 'ip-trade-ticker', 'focus lands on the first field');

  // Nothing filled: every field says what it needs, nothing is asked.
  // The frame is sandboxed without allow-forms, which blocks form submission
  // before a submit event fires: nothing here may rely on one.
  assert.equal(f.$('#ip-trade-form').tagName, 'DIV');
  assert.equal(f.$$('form, button[type=submit], input[type=submit]').length, 0);
  f.$('#ip-trade-form .rui-btn-primary').click();
  assert.equal(f.all('ask').length, 0);
  assert.equal(f.$('#ip-trade-ticker').getAttribute('aria-invalid'), 'true');
  assert.deepEqual(f.$$('#ip-trade-form .rui-field-error-text').map((e) => e.textContent).filter(Boolean), ['Enter a ticker, such as MSFT.', 'Enter an amount, in USD.']);

  assert.equal(f.doc.activeElement.id, 'ip-trade-ticker', 'focus goes to the first field in error');

  // Buy or sell is one line of Rundock UI tabs used as a segmented choice:
  // it always holds a side, Buy until changed, and arrows move it.
  const sides = f.$('#ip-trade-form [role=tablist]');
  assert.equal(sides.getAttribute('aria-labelledby'), 'ip-trade-side-label');
  assert.equal(f.$('#ip-trade-side-label').textContent, 'Buy or sell');
  const selected = () => f.$('#ip-trade-form [role=tab][aria-selected=true]');
  assert.equal(selected().textContent, 'Buy');
  selected().focus();
  f.key(selected(), 'ArrowRight');
  assert.equal(selected().textContent, 'Sell');
  assert.equal(f.doc.activeElement, selected(), 'focus moves with the choice');
  f.key(selected(), 'ArrowLeft');
  assert.equal(selected().textContent, 'Buy');

  // A negative amount is refused on its own field.
  f.type(f.$('#ip-trade-ticker'), 'msft');
  f.type(f.$('#ip-trade-amount'), '-50');
  f.$('#ip-trade-form .rui-btn-primary').click();
  assert.equal(f.all('ask').length, 0);
  assert.equal(f.$('#ip-trade-amount').getAttribute('aria-invalid'), 'true');
  assert.equal(f.$('#ip-trade-ticker').getAttribute('aria-invalid'), null, 'the fields that were right are no longer marked');
  assert.equal(f.$('#ip-trade-ticker').value, 'msft', 'what was typed survives the redraw');
  assert.equal(f.doc.activeElement.id, 'ip-trade-amount');

  f.type(f.$('#ip-trade-amount'), '5,000');
  f.key(f.$('#ip-trade-amount'), 'Enter');
  assert.equal(f.all('ask').length, 1, 'Enter in a field drafts');
  f.$('#ip-trade-form .rui-btn-primary').click();
  assert.equal(f.all('ask').length, 2, 'and so does the button');
  const ask = f.last('ask');
  assert.equal(ask.agent, 'lead-partner');
  assert.equal(ask.message.split('\n')[0], 'I want to buy $5,000 of MSFT. Check it against my risk limits first, and if it fits, add it to my decision journal as proposed.');
  assert.match(ask.message, /My notes: Investments\/Portfolio\.md, Investments\/Risk Profile\.md, Investments\/Decision Journal\.md\.$/);
  assert.equal(f.all('changeSource').length + f.all('change').length, 0, 'it never writes the journal or anything else itself');
  f.send({ type: 'refused', of: 'ask', reason: 'ask is honoured only after a click inside the view' });
  assert.match(f.$('#ip-trade-form .ip-ask-note').textContent, /^Not asked: /);
});

test('Escape cancels the trade form and returns focus to its button; a redraw keeps it open with what was typed', { skip }, async () => {
  const f = await mount();
  f.dashboard();
  tradeButton(f).click();
  f.type(f.$('#ip-trade-ticker'), 'NVDA');
  // A change made elsewhere redraws the dashboard; the half-typed trade stays.
  const p = lib.readNote(starter('Portfolio.md')).data;
  p.accounts[4].cashBalance = 30000;
  f.send({ type: 'sources', sources: [{ path: SOURCES[0].path, content: lib.writeNote(starter('Portfolio.md'), p) }, SOURCES[1], SOURCES[2]] });
  assert.equal(f.$('#ip-trade-ticker').value, 'NVDA');
  f.key(f.$('#ip-trade-ticker'), 'Escape');
  assert.equal(f.$('#ip-trade-form'), null);
  assert.equal(tradeButton(f).getAttribute('aria-expanded'), 'false');
  assert.equal(f.doc.activeElement, tradeButton(f));
  // The button toggles it too.
  tradeButton(f).click();
  assert.ok(f.$('#ip-trade-form'));
  tradeButton(f).click();
  assert.equal(f.$('#ip-trade-form'), null);
  assert.equal(f.all('ask').length, 0);
});

test('a refusal says what did not happen: a refused open is not a save', { skip }, async () => {
  const f = await mount();
  f.dashboard(SOURCES);
  const last = () => { const all = f.$$('.ip-notices .rui-alert'); return all[all.length - 1].textContent; };
  f.send({ type: 'refused', of: 'open', reason: 'the click inside the view was already used; click again to open something else' });
  assert.equal(last(), 'Not opened: Rundock did not open it (the click inside the view was already used; click again to open something else).');
  f.send({ type: 'refused', of: 'openExternal', reason: 'openExternal takes an http or https address' });
  assert.equal(last(), 'Not opened: Rundock did not open it (openExternal takes an http or https address).');
  for (const of of ['save', 'change', 'saveSource', 'changeSource']) {
    f.send({ type: 'refused', of, reason: 'a view cannot change which files a note lists as sources' });
    assert.equal(last(), 'Not saved: Rundock refused the write (a view cannot change which files a note lists as sources).', of);
  }
  f.send({ type: 'refused', of: 'resize', reason: 'something else' });
  assert.equal(last(), 'Rundock refused resize (something else).');
  assert.ok(!f.$$('.ip-notices .rui-alert').some((a) => /Not saved/.test(a.textContent) && /open/.test(a.textContent.split('(')[0])), 'no open is ever called a save');
});

// The starter notes as a person's own: the sample flag gone.
function ownSources() {
  const p = dataOf(starter('Portfolio.md'));
  delete p.sample;
  return [{ path: SOURCES[0].path, content: lib.writeNote(starter('Portfolio.md'), p) }, SOURCES[1], SOURCES[2]];
}

test('the currency is a small label beside the total that opens the picker, relabels, takes Other codes, and can be undone', { skip }, async () => {
  const f = await mount();
  f.dashboard(ownSources());
  assert.equal(f.$('#ip-currency'), null, 'no select until asked for');
  const toggle = f.$('#ip-currency-toggle');
  assert.equal(f.$$('.rui-stat-value')[0].textContent, '$399,920 · USD ▾');
  assert.equal(toggle.getAttribute('aria-label'), 'Currency: USD. Change currency');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  toggle.click();
  assert.equal(f.$('#ip-currency-toggle').getAttribute('aria-expanded'), 'true');
  const select = f.$('#ip-currency');
  assert.equal(f.doc.activeElement, select, 'focus lands in the picker');
  assert.deepEqual([...select.options].map((o) => o.value), [...lib.COMMON_CURRENCIES, 'other']);
  assert.match(f.$('#ip-currency-picker .rui-field-help').textContent, /relabels every amount; nothing is converted/);
  select.value = 'GBP';
  select.dispatchEvent(new f.win.Event('change', { bubbles: true }));
  const data = dataOf(f.last('changeSource').content);
  assert.equal(data.baseCurrency, 'GBP');
  assert.ok(lib.allPositions(data).every((p) => p.position.currentPrice.currency === 'GBP'));
  assert.equal(lib.totalMarketValue(data), 399920, 'relabelled, not converted');
  assert.equal(f.$('#ip-currency-picker'), null, 'the picker closes on a choice');
  assert.equal(f.doc.activeElement, f.$('#ip-currency-toggle'), 'and focus returns to the label');
  assert.equal(f.$$('.rui-stat-value')[0].textContent, '£399,920 · GBP ▾');
  assert.match(f.$('.rui-meter').getAttribute('aria-label'), /£196,500/);
  const positions = f.$$('.rui-card').find((c) => c.querySelector('.rui-card-title') && c.querySelector('.rui-card-title').textContent === 'Positions');
  assert.equal(positions.querySelector('.rui-card-sub').textContent, 'Select a quantity or price to change it. Prices are entered by hand, in GBP, and marked stale after a day.');
  assert.ok(positions.querySelectorAll('th')[3].textContent === 'Price (GBP)');
  const undo = f.$('.ip-undo');
  assert.match(undo.closest('.rui-alert').textContent, /Currency set to GBP\. Every amount is relabelled; nothing was converted\./);
  undo.click();
  assert.equal(dataOf(f.last('changeSource').content).baseCurrency, 'USD');
  assert.equal(f.$$('.rui-stat-value')[0].textContent, '$399,920 · USD ▾');

  // Escape closes the picker without a change.
  f.$('#ip-currency-toggle').click();
  f.key(f.$('#ip-currency'), 'Escape');
  assert.equal(f.$('#ip-currency-picker'), null);
  assert.equal(f.doc.activeElement, f.$('#ip-currency-toggle'));

  // Other: any code this runtime knows, checked in place.
  f.$('#ip-currency-toggle').click();
  const sel = f.$('#ip-currency');
  sel.value = 'other';
  sel.dispatchEvent(new f.win.Event('change', { bubbles: true }));
  const code = f.$('#ip-currency-other');
  assert.equal(f.doc.activeElement, code);
  f.type(code, 'xyz');
  f.key(code, 'Enter');
  assert.equal(code.getAttribute('aria-invalid'), 'true');
  assert.match(f.$('.ip-currency-other .rui-field-error-text').textContent, /XYZ is not a currency code/);
  f.type(code, 'brl');
  f.key(code, 'Enter');
  assert.equal(dataOf(f.last('changeSource').content).baseCurrency, 'BRL');
  assert.equal(f.$$('.rui-stat-value')[0].textContent, 'R$399,920 · BRL ▾');
});

test('while the sample banner is up, it holds the only currency control on screen', { skip }, async () => {
  const f = await mount();
  f.dashboard();
  assert.ok(f.$('#ip-start-currency'));
  assert.equal(f.$('#ip-currency-toggle'), null);
  assert.equal(f.$('#ip-currency'), null);
  assert.equal(f.$$('.rui-stat-value')[0].textContent, '$399,920 · USD', 'the code shows, as text');
  f.$('#ip-account-0').click();
  f.type(f.$('#ip-account-name-input'), 'Brokerage');
  assert.equal(f.$('#ip-start-currency'), null, 'an edit ends the sample, and the banner with it');
  assert.ok(f.$('#ip-currency-toggle'), 'and the label beside the total becomes the control');
  assert.equal(f.$$('select').filter((x) => /currency/i.test(x.id)).length, 0, 'never two at once, and none until opened');
});

test('the trade form speaks the portfolio currency', { skip }, async () => {
  const f = await mount();
  const gbp = lib.writeNote(starter('Portfolio.md'), lib.relabelCurrency(dataOf(starter('Portfolio.md')), 'GBP'));
  f.dashboard([{ path: SOURCES[0].path, content: gbp }, SOURCES[1], SOURCES[2]]);
  f.$('#ip-trade-button').click();
  assert.equal(f.$('label[for=ip-trade-amount]').textContent, 'Amount (GBP)');
  f.type(f.$('#ip-trade-ticker'), 'VOD');
  f.type(f.$('#ip-trade-amount'), '£2,500');
  f.key(f.$('#ip-trade-amount'), 'Enter');
  assert.match(f.last('ask').message, /^I want to buy £2,500 of VOD\./);
});

test('first run: sample data says so, and offers setup with Lead Partner or an empty start with undo', { skip }, async () => {
  const f = await mount();
  f.dashboard();
  const banner = f.$('.ip-banner');
  assert.ok(banner, 'the sample portfolio shows the banner');
  assert.match(banner.textContent, /^This is sample data\./);
  assert.equal(f.$('#ip-start-currency').value, 'USD', 'the start currency defaults from the locale (en-US here)');

  f.$$('.ip-banner .rui-btn').find((b) => b.textContent === 'Set up with Lead Partner').click();
  assert.match(f.last('ask').message, /^I would like to set up my investments with you/);
  assert.match(f.last('ask').message, /base currency \(I think it is USD\)/);

  const writes = f.all('changeSource').length;
  const sel = f.$('#ip-start-currency');
  sel.value = 'GBP';
  sel.dispatchEvent(new f.win.Event('change', { bubbles: true }));
  f.$$('.ip-banner .rui-btn').find((b) => b.textContent === 'Start empty').click();
  const after = f.all('changeSource').slice(writes);
  assert.deepEqual(after.map((w) => w.source), ['Investments/Portfolio.md', 'Investments/Decision Journal.md'], 'the risk profile is not written');
  const p = dataOf(after[0].content);
  assert.deepEqual({ ...p, updatedAt: 'x' }, { schemaVersion: 2, baseCurrency: 'GBP', accounts: [], updatedAt: 'x' });
  assert.deepEqual(dataOf(after[1].content).entries, []);
  assert.equal(f.$('.ip-banner'), null, 'no longer sample, so no banner');
  assert.equal(f.$$('.rui-stat-value')[0].textContent, '£0 · GBP ▾');
  const undo = f.$('.ip-undo');
  assert.equal(f.doc.activeElement, undo, 'never silent: the line says what happened and Undo takes focus');
  assert.match(undo.closest('.rui-alert').textContent, /Started empty in GBP\. Your portfolio and decision journal are blank; your risk profile keeps its defaults\./);
  undo.click();
  const restored = f.all('changeSource').slice(-2);
  assert.equal(dataOf(restored[0].content).sample, true);
  assert.equal(lib.totalMarketValue(dataOf(restored[0].content)), 399920);
  assert.equal(dataOf(restored[1].content).entries.length, 6);
  assert.ok(f.$('.ip-banner'), 'the sample, and its banner, are back');
});

test('any edit to the portfolio clears the sample, and the banner goes', { skip }, async () => {
  const f = await mount();
  f.init(starter('Portfolio.md'), 'Investments/Portfolio.md');
  f.$('.rui-table .rui-cell').click();
  f.$('.rui-table .rui-cell-editor').value = '291';
  f.key(f.$('.rui-table .rui-cell-editor'), 'Enter');
  assert.equal(dataOf(f.last('change').content).sample, undefined);
  const g = await mount();
  g.dashboard();
  g.$('#ip-account-1').click();
  g.type(g.$('#ip-account-name-input'), 'Roth');
  assert.equal(dataOf(g.last('changeSource').content).sample, undefined);
  assert.equal(g.$('.ip-banner'), null);
});

const accountNames = (f) => dataOf(f.last('changeSource').content).accounts.map((a) => a.name);

test('an account is renamed and retyped in place, saving as it goes, and the account type tab follows', { skip }, async () => {
  const f = await mount();
  f.dashboard();
  const name = f.$('#ip-account-0');
  assert.equal(name.textContent, 'Taxable Brokerage');
  assert.equal(name.getAttribute('aria-label'), 'Edit Taxable Brokerage, Taxable');
  name.click();
  const input = f.$('#ip-account-name-input');
  assert.equal(f.doc.activeElement, input, 'the name is ready to type over');
  f.type(input, 'Roth IRA');
  assert.match(f.$('#ip-account-field-name .rui-field-error-text').textContent, /Another account is already called Roth IRA\./);
  assert.equal(input.getAttribute('aria-invalid'), 'true');
  assert.equal(f.all('changeSource').length, 0, 'a clashing name is not written');
  f.type(input, 'Brokerage');
  assert.deepEqual(accountNames(f).slice(0, 2), ['Brokerage', 'Roth IRA']);
  assert.equal(input.getAttribute('aria-invalid'), null);
  assert.deepEqual([...f.$$('#ip-account-types option')].map((o) => o.value), lib.accountTypeSuggestions('USD'));
  assert.equal(f.$('#ip-account-type-input').getAttribute('list'), 'ip-account-types');
  f.type(f.$('#ip-account-type-input'), 'Joint taxable');
  assert.equal(dataOf(f.last('changeSource').content).accounts[0].type, 'Joint taxable', 'type is free text');
  f.key(f.$('#ip-account-type-input'), 'Escape');
  assert.equal(f.$('.ip-account-editor'), null);
  assert.equal(f.doc.activeElement, f.$('#ip-account-0'), 'focus returns to the name');
  assert.equal(f.$('#ip-account-0').textContent, 'Brokerage');
  const tab = f.$$('[role=tab]').find((t) => t.textContent === 'Account type');
  tab.click();
  assert.match(f.$('.rui-canvas [role=img]').getAttribute('aria-label'), /^Allocation by account type: Joint taxable \$196,500/);
});

test('suggested account types follow the currency', { skip }, async () => {
  const f = await mount();
  const gbp = lib.writeNote(starter('Portfolio.md'), lib.relabelCurrency(dataOf(starter('Portfolio.md')), 'GBP'));
  f.dashboard([{ path: SOURCES[0].path, content: gbp }, SOURCES[1], SOURCES[2]]);
  f.$('#ip-account-0').click();
  assert.deepEqual([...f.$$('#ip-account-types option')].map((o) => o.value), lib.accountTypeSuggestions('GBP'));
  assert.equal(f.$('label[for=ip-account-cash-input]').textContent, 'Cash (GBP)');
});

test('+ Add account adds one at the end and opens it for naming', { skip }, async () => {
  const f = await mount();
  f.dashboard();
  f.$('#ip-add-account').click();
  const data = dataOf(f.last('changeSource').content);
  assert.equal(data.accounts.length, 6);
  assert.deepEqual(data.accounts[5], { name: 'New account', cashBalance: 0, positions: [] });
  assert.equal(f.doc.activeElement, f.$('#ip-account-name-input'));
  f.type(f.$('#ip-account-name-input'), 'Stocks & Shares ISA');
  f.key(f.$('#ip-account-name-input'), 'Enter');
  assert.equal(accountNames(f)[5], 'Stocks & Shares ISA');
  assert.equal(f.$('#ip-account-5').textContent, 'Stocks & Shares ISA');
});

test('an account holding positions cannot be removed, and one that holds none is removed with undo', { skip }, async () => {
  const f = await mount();
  f.dashboard();
  f.$('#ip-account-0').click();
  const remove = f.$$('.ip-account-editor .rui-btn').find((b) => b.textContent === 'Remove account');
  assert.equal(remove.disabled, true);
  assert.equal(f.$('#' + remove.getAttribute('aria-describedby')).textContent, 'Move or remove its 4 positions first; an account is removed only when it holds none.');
  f.key(f.$('#ip-account-name-input'), 'Escape');

  // Cash Vault holds cash and no positions.
  f.$('#ip-account-4').click();
  f.$$('.ip-account-editor .rui-btn').find((b) => b.textContent === 'Remove account').click();
  assert.deepEqual(accountNames(f), ['Taxable Brokerage', 'Roth IRA', 'Traditional IRA', 'Crypto Wallet']);
  const undo = f.$('.ip-undo');
  assert.equal(f.doc.activeElement, undo, 'Undo takes focus from the button that is gone');
  assert.match(undo.closest('.rui-alert').textContent, /^Account removed: Cash Vault, with its \$26,500 of cash\./);
  assert.equal(f.$$('.rui-stat-value')[0].textContent, '$373,420 · USD ▾');
  undo.click();
  assert.deepEqual(accountNames(f), ['Taxable Brokerage', 'Roth IRA', 'Traditional IRA', 'Crypto Wallet', 'Cash Vault']);
  assert.equal(dataOf(f.last('changeSource').content).accounts[4].cashBalance, 26500);
  assert.equal(f.$('.ip-undo'), null);
  assert.equal(f.doc.activeElement, f.$('#ip-account-4'));
});

const positionsOf = (f) => lib.allPositions(dataOf(f.last('changeSource').content)).map((x) => `${x.position.ticker}@${x.account.name}`);

test('a position is added from the row, checked field by field, with its categories defaulted and editable', { skip }, async () => {
  const f = await mount();
  f.dashboard();
  assert.equal(f.$('.ip-add-position'), null, 'the row waits behind its button');
  const openButton = f.$('#ip-add-position-button');
  assert.equal(openButton.textContent, '+ Add position');
  openButton.click();
  assert.ok(f.$('.ip-add-position'));
  assert.equal(f.doc.activeElement.id, 'ip-newpos-ticker');
  f.key(f.$('#ip-newpos-ticker'), 'Escape');
  assert.equal(f.$('.ip-add-position'), null, 'Escape closes it');
  assert.equal(f.doc.activeElement, f.$('#ip-add-position-button'), 'and returns focus to the button');
  f.$('#ip-add-position-button').click();
  assert.equal(f.$('#ip-newpos-assetClass').value, 'Equity');
  assert.equal(f.$('#ip-newpos-geography').value, 'United States', 'from the locale (en-US here)');
  const add = () => f.$$('.ip-add-position .rui-btn').find((b) => b.textContent === 'Add position').click();
  add();
  assert.equal(f.all('changeSource').length, 0);
  assert.equal(f.$('#ip-newpos-ticker').getAttribute('aria-invalid'), 'true');
  assert.equal(f.doc.activeElement.id, 'ip-newpos-ticker');
  f.type(f.$('#ip-newpos-ticker'), 'pltr');
  const sel = f.$('#ip-newpos-account');
  sel.value = '1';
  sel.dispatchEvent(new f.win.Event('change', { bubbles: true }));
  f.type(f.$('#ip-newpos-quantity'), '100');
  f.type(f.$('#ip-newpos-price'), '0');
  add();
  assert.match(f.$$('.ip-add-position .rui-field-error-text').map((e) => e.textContent).join('|'), /Enter the price of one, in USD, above zero\./);
  f.type(f.$('#ip-newpos-price'), '41.50');
  f.type(f.$('#ip-newpos-sector'), 'Technology');
  assert.ok(f.$('#ip-newpos-fund').closest('label').textContent.startsWith('Fund'));
  f.$('#ip-newpos-illiquid').click();
  f.key(f.$('#ip-newpos-price'), 'Enter');
  const added = lib.allPositions(dataOf(f.last('changeSource').content)).find((x) => x.position.ticker === 'PLTR');
  assert.equal(added.account.name, 'Roth IRA');
  assert.deepEqual({ ...added.position, currentPrice: { ...added.position.currentPrice, asOf: 'x' } },
    { ticker: 'PLTR', quantity: 100, assetClass: 'Equity', sector: 'Technology', geography: 'United States', illiquid: true, currentPrice: { amount: 41.5, currency: 'USD', asOf: 'x' } });
  assert.equal(f.$('#ip-newpos-illiquid').checked, false, 'the flags clear for the next one');
  assert.equal(f.$('#ip-newpos-ticker').value, '', 'ready for the next one');
  assert.equal(f.$('#ip-newpos-account').value, '1', 'the account stays chosen');
  assert.equal(f.doc.activeElement.id, 'ip-newpos-ticker');
  assert.equal(f.$$('.rui-stat-value')[0].textContent, '$404,070 · USD ▾');
  assert.ok(f.$$('.rui-table tbody tr').some((tr) => tr.textContent.startsWith('PLTR')));
});

test('a position moves to another account and is removed with undo, from one quiet menu per row', { skip }, async () => {
  const f = await mount();
  f.dashboard();
  assert.equal(f.$$('.rui-table select').length, 0, 'no select per row');
  assert.equal(f.$$('.rui-table .rui-btn-danger').length, 0, 'and no red Remove button per row');
  assert.equal(f.$('.rui-table input'), null, 'no input until a value is selected');
  assert.ok(f.$('.rui-table .rui-cell'), 'quantity and price stay editable in place');
  const trigger = f.$('#ip-pos-menu-1');
  assert.equal(trigger.getAttribute('aria-label'), 'Actions for NVDA in Taxable Brokerage');
  trigger.click();
  const items = [...trigger.closest('.rui-menu').querySelectorAll('[role^=menuitem]')].map((i) => i.textContent);
  assert.deepEqual(items, ['Move to Roth IRA', 'Move to Traditional IRA', 'Move to Crypto Wallet', 'Move to Cash Vault', 'Remove NVDA'], 'every other account, then Remove');
  assert.deepEqual([...trigger.closest('.rui-menu').querySelector('[role=menu]').children].map((c) => c.getAttribute('role')),
    ['menuitem', 'menuitem', 'menuitem', 'menuitem', 'separator', 'menuitem'], 'a rule sets Remove apart from the moves');
  [...trigger.closest('.rui-menu').querySelectorAll('[role^=menuitem]')].find((i) => i.textContent === 'Move to Traditional IRA').click();
  assert.ok(positionsOf(f).includes('NVDA@Traditional IRA'));
  assert.ok(!positionsOf(f).includes('NVDA@Taxable Brokerage'));
  assert.equal(f.doc.activeElement.getAttribute('aria-label'), 'Actions for NVDA in Traditional IRA', 'focus follows the position to its new row');

  const first = f.$('#ip-pos-menu-0');
  first.click();
  [...first.closest('.rui-menu').querySelectorAll('[role^=menuitem]')].find((i) => i.textContent === 'Remove VTI').click();
  assert.ok(!positionsOf(f).some((x) => x.startsWith('VTI@')));
  const undo = f.$('.ip-undo');
  assert.equal(f.doc.activeElement, undo);
  assert.match(undo.closest('.rui-alert').textContent, /^Position removed: VTI from Taxable Brokerage\./);
  undo.click();
  assert.equal(positionsOf(f)[0], 'VTI@Taxable Brokerage', 'back in its place');
  assert.equal(f.doc.activeElement, f.$('#ip-pos-menu-0'));
});

test('Positions reads as text: quantity and price open in place through the table, and nothing else is editable', { skip }, async () => {
  const f = await mount();
  f.dashboard();
  const card = f.$$('.rui-card').find((c) => c.querySelector('.rui-card-title') && c.querySelector('.rui-card-title').textContent === 'Positions');
  assert.equal(card.querySelector('.rui-card-sub').textContent, 'Select a quantity or price to change it. Prices are entered by hand, in USD, and marked stale after a day.');
  assert.ok(card.classList.contains('ip-positions'), 'the Positions card is marked, so its instruction can be styled');
  assert.match(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'ui', 'investment.css'), 'utf8'),
    /\.ip-positions > \.rui-card-sub \{ color: var\(--text-1\); \}/, 'the instruction is essential text, so it reads in --text-1');
  const css = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'ui', 'investment.css'), 'utf8');
  assert.doesNotMatch(css, /ip-card-title|ip-card-head/, 'no card heading of our own: every card title is Rundock UI\'s');
  const table = card.querySelector('.rui-table');
  assert.equal(table.querySelector('colgroup'), null, 'no hand-set widths: Rundock UI measures every column and locks it on first render');
  assert.match(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'ui', 'index.js'), 'utf8'),
    /\{ key: 'account', label: 'Account', grow: true \}/, 'Account is the main column: it takes the spare room, so the table fills its width with the row menu at the right edge');
  assert.equal((require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'ui', 'index.js'), 'utf8').match(/grow: true/g) || []).length, 1,
    'no other column grows: each keeps its natural width');
  assert.equal(table.querySelector('input'), null, 'every value reads as text until selected');
  const first = [...table.querySelectorAll('tbody tr')[0].children];
  assert.deepEqual(first.map((td) => !!td.querySelector('.rui-cell')), [false, false, true, true, false, false, false],
    'quantity and price are editable; ticker, account, market value and priced are not');
  assert.equal(first[2].querySelector('.rui-cell').getAttribute('aria-label'), 'Quantity of VTI in Taxable Brokerage, 290');
  assert.equal(first[3].querySelector('.rui-cell').getAttribute('aria-label'), 'Price (USD) of VTI in Taxable Brokerage, 290.00');

  first[3].querySelector('.rui-cell').click();
  const price = first[3].querySelector('.rui-cell-editor');
  assert.equal(f.doc.activeElement, price);
  assert.equal(price.value, '290.00', 'opens on the text the cell shows, so nothing moves');
  price.value = '300.5';
  f.key(price, 'Tab');
  const written = lib.allPositions(dataOf(f.last('changeSource').content))[0].position;
  assert.equal(written.currentPrice.amount, 300.5);
  assert.equal(written.currentPrice.currency, 'USD');
  assert.ok(Date.now() - Date.parse(written.currentPrice.asOf) < 60000, 'priced now');
  assert.equal(first[3].querySelector('.rui-cell').textContent, '300.50');
  assert.equal(first[4].textContent, '$87,145', 'the market value follows');
  const second = [...table.querySelectorAll('tbody tr')[1].children];
  assert.equal(f.doc.activeElement, second[2].querySelector('.rui-cell-editor'), 'Tab goes on to the next quantity');
  f.key(f.doc.activeElement, 'Escape');
  assert.equal(f.doc.activeElement, second[2].querySelector('.rui-cell'));

  second[2].querySelector('.rui-cell').click();
  second[2].querySelector('.rui-cell-editor').value = '-3';
  f.key(second[2].querySelector('.rui-cell-editor'), 'Enter');
  assert.equal(f.doc.getElementById(second[2].querySelector('.rui-cell-editor').getAttribute('aria-describedby')).textContent, 'Quantity: Enter a number of 0 or more.');
  f.key(second[2].querySelector('.rui-cell-editor'), 'Escape');

  const menu = first[6].querySelector('.rui-menu');
  const items = [...menu.querySelectorAll('[role^=menuitem]')].map((i) => i.textContent);
  assert.ok(items.every((t) => /^Move to /.test(t) || t === 'Remove VTI'), `the row menu is only Move and Remove: ${items.join(' | ')}`);
  assert.deepEqual([...table.querySelectorAll('tbody tr')].map((tr) => tr.querySelectorAll('[aria-haspopup]').length),
    [...table.querySelectorAll('tbody tr')].map(() => 1), 'exactly one row menu per row');
  assert.equal(table.querySelectorAll('.rui-td-edit svg').length, 0, 'no pencil: the hover tint is the cue');
});

test('every dashboard card is headed by Rundock UI\'s own card title, with its controls in the card\'s actions', { skip }, async () => {
  const f = await mount();
  f.dashboard();
  assert.equal(f.$('.ip-card-title, .ip-card-head, h2'), null, 'no heading drawn by the package');
  const titles = f.$$('.rui-card-title').map((t) => t.textContent);
  for (const t of ['Portfolio & allocation', 'Risk control panel', 'Decision board', 'Positions']) assert.ok(titles.includes(t), `${t} is a card title: ${titles.join(' | ')}`);
  const cardOf = (t) => f.$$('.rui-card').find((c) => { const x = c.querySelector('.rui-card-title'); return x && x.textContent === t; });
  assert.ok(cardOf('Portfolio & allocation').querySelector('.rui-card-head > .rui-card-actions [role=tablist]'), 'the grouping tabs sit on the title line');
  assert.equal(cardOf('Decision board').querySelector('.rui-card-head > .rui-card-actions').textContent, 'Move a card with its menu, or drag it.');
  assert.match(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'ui', 'investment.css'), 'utf8'),
    /\.ip-hint \{ color: var\(--text-1\);/, 'the board\'s hint is an instruction, so it reads in --text-1');
});

test('Positions keeps its widths in the view\'s own state, across a redraw, a reload and a return, and writes nothing to a note', { skip }, async () => {
  const store = viewStateStore();
  const f = await mount({ viewState: store });
  f.dashboard();
  const handleOf = (g) => g.$$('.ip-positions thead th').find((th) => th.textContent === 'Account').querySelector('.rui-col-resize');
  const kept = () => (store.kept['rui.table.positions'] || {}).account;
  assert.ok(handleOf(f), 'the columns can be resized');
  const changesBefore = f.all('change').length;
  const sourcesBefore = f.all('changeSource').length;
  f.key(handleOf(f), 'ArrowRight');
  assert.equal(f.all('change').length, changesBefore, 'nothing is written to the dashboard note');
  assert.equal(f.all('changeSource').length, sourcesBefore, 'nor to the portfolio');
  const width = kept();
  assert.ok(typeof width === 'number' && width > 0, `kept: ${JSON.stringify(store.kept)}`);
  assert.deepEqual(Object.keys(store.kept), ['rui.table.positions'], 'kept by Rundock UI under the Positions key, and nothing else');
  const at = f.$$('.ip-positions thead th').findIndex((th) => th.textContent === 'Account');
  assert.equal(f.$$('.ip-positions colgroup col')[at].style.width, `${width}px`, 'the kept width is the width drawn');
  // A redraw of Positions (here, moving a position redraws it) starts from
  // the kept width: one more step lands one step past it.
  const trigger = f.$('#ip-pos-menu-1');
  trigger.click();
  [...trigger.closest('.rui-menu').querySelectorAll('[role^=menuitem]')].find((i) => i.textContent === 'Move to Traditional IRA').click();
  assert.notEqual(f.$('#ip-pos-menu-1'), trigger, 'Positions was redrawn');
  f.key(handleOf(f), 'ArrowRight');
  assert.equal(kept(), width + 8, 'kept across a redraw');
  // A reload, or leaving the note and coming back, is a new view on the same
  // state, and starts from the kept width too.
  const g = await mount({ viewState: store });
  g.dashboard();
  g.key(handleOf(g), 'ArrowRight');
  assert.equal(kept(), width + 16, 'kept across a new view');
  // Enter puts the column back, and the state forgets it.
  g.key(handleOf(g), 'Enter');
  assert.deepEqual(store.kept, {}, 'a reset removes the width');
  assert.equal(f.all('change').length + g.all('change').length, changesBefore, 'and no note was written at any point');
});

test('the view keeps no widths of its own: Rundock UI does, through stateKey', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'ui', 'index.js'), 'utf8');
  assert.match(source, /stateKey: 'positions'/);
  assert.doesNotMatch(source, /columnWidths|keptWidth|keepWidth|onResize|viewState/, 'no width bookkeeping in the package');
});

test('without Rundock.viewState, Positions still resizes and writes nothing', { skip }, async () => {
  const f = await mount();
  f.dashboard();
  const handle = f.$('.ip-positions .rui-col-resize');
  f.key(handle, 'ArrowRight');
  assert.equal(f.all('change').length, 0);
  assert.equal(f.all('changeSource').length, 0);
});

test('the portfolio note on its own resizes too, and writes no view settings into it', { skip }, async () => {
  const f = await mount();
  f.init(starter('Portfolio.md'), 'Investments/Portfolio.md');
  const handle = f.$('.ip-positions .rui-col-resize');
  assert.ok(handle);
  f.key(handle, 'ArrowRight');
  assert.equal(f.all('change').length, 0, 'a width is not the portfolio\'s data');
});

test('Positions sits below the Decision board', { skip }, async () => {
  const f = await mount();
  f.dashboard();
  const titles = f.$$('.rui-card-title').map((t) => t.textContent);
  assert.ok(titles.indexOf('Decision board') < titles.indexOf('Positions'), titles.join(' | '));
});

test('after an empty start, every panel teaches what to do next', { skip }, async () => {
  const f = await mount();
  f.dashboard();
  f.$$('.ip-banner .rui-btn').find((b) => b.textContent === 'Start empty').click();
  const text = f.doc.body.textContent;
  assert.match(text, /Nothing to chart yet/);
  assert.match(text, /No accounts yet\. Add one, or ask Lead Partner to set up from your statements\./);
  assert.match(text, /No positions yet/);
  assert.match(text, /No decisions yet/);
  assert.equal(f.$('.ip-risk .rui-alert'), null, 'an empty portfolio is neither inside nor outside a limit, so no alert at all');
  assert.match(text, /No cash held yet\./);
  assert.equal(f.$$('.rui-meter.rui-over').length, 0, 'and nothing is drawn as over');
  assert.ok(f.$$('.rui-btn').some((b) => b.textContent === 'Set up with Lead Partner'));
  f.$('#ip-add-account').click();
  assert.match(f.doc.body.textContent, /No positions yet\. Add one, or ask Lead Partner/);
  assert.ok(f.$('#ip-add-position-button'), 'with an account, + Add position appears');
});

test('no id is used twice on the dashboard, whatever is open', { skip }, async () => {
  const f = await mount();
  f.dashboard();
  f.$('#ip-trade-button').click();
  f.$('#ip-account-0').click();
  const ids = f.$$('[id]').map((e) => e.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepEqual(dupes, []);
});

test('a change made outside the dashboard redraws it live and says so; its own writes do not', { skip }, async () => {
  const f = await mount();
  f.dashboard();
  assert.equal(f.$('.ip-updated').textContent, '', 'nothing on first draw');
  f.slide(sliderNamed(f, 'Max single position'), 20);
  const own = f.last('changeSource');
  f.send({ type: 'sources', sources: SOURCES.map((x) => (x.path === own.source ? { path: x.path, content: own.content } : x)) });
  assert.equal(f.$('.ip-updated').textContent, '', 'its own echo is not news');
  // Lead Partner adds a proposed decision to the journal.
  const j = dataOf(starter('Decision Journal.md'));
  j.entries.push({ decisionId: 'lp-1', ticker: 'MSFT', action: 'buy', status: 'proposed', thesis: 'From Lead Partner.', createdAt: 'x', updatedAt: 'x' });
  f.send({ type: 'sources', sources: [SOURCES[0], { path: SOURCES[1].path, content: own.content }, { path: SOURCES[2].path, content: lib.writeNote(starter('Decision Journal.md'), j) }] });
  assert.equal(f.$('.ip-updated').textContent, 'Updated just now, from a change made outside this dashboard.');
  assert.equal(f.$('.ip-updated').getAttribute('role'), 'status');
  assert.equal(f.$$('.rui-board-col[data-column="proposed"] .rui-board-card').length, 3, 'the new decision is on the board');
  assert.equal(sliderNamed(f, 'Max single position').getAttribute('aria-valuetext'), '20.0%', 'and the view\'s own change is kept');
});

test('a refusal Rundock already shows above the view is not shown again; every other refusal still is', { skip }, async () => {
  const f = await mount();
  f.dashboard();
  const notices = () => f.$$('.ip-notices .rui-alert, .ip-ask-note .rui-alert').map((a) => a.textContent);
  f.$$('.rui-btn').find((b) => b.textContent === 'Ask Lead Partner').click();
  for (const of of ['open', 'openExternal', 'ask']) {
    for (const reason of lib.HOST_SHOWN_REASONS) f.send({ type: 'refused', of, reason });
  }
  assert.deepEqual(notices(), [], 'nine refusals Rundock shows itself, none repeated by the view');

  // The same reasons on a write are still the view's to explain.
  f.send({ type: 'refused', of: 'changeSource', reason: lib.HOST_SHOWN_REASONS[0] });
  assert.equal(notices().length, 1);
  // And the ask refusals Rundock does not show stay, in place.
  for (const reason of ['this extension did not declare that agent in its manifest', 'there is no agent called lead-partner on this team', 'an embedded view cannot ask']) {
    f.send({ type: 'refused', of: 'ask', reason });
    assert.match(notices().join('|'), new RegExp('Not asked: .*' + reason.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  f.send({ type: 'refused', of: 'save', reason: 'the note changed on disk since it was opened' });
  f.send({ type: 'refused', of: 'open', reason: 'open takes a workspace path' });
  const all = notices().join('|');
  assert.match(all, /Not saved: Rundock refused the write \(the note changed on disk since it was opened\)\./);
  assert.match(all, /Not opened: Rundock did not open it \(open takes a workspace path\)\./, 'an open refusal Rundock does not show is still explained');
});
