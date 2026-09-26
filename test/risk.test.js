'use strict';
// The risk check the dashboard's alert is drawn from: the portfolio against
// the five limits in the risk profile. One test per constraint going over,
// each on data that is otherwise inside every limit, so a breach can only
// come from the constraint under test.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const lib = require('../ui/index.js');

const starter = (name) => lib.readNote(fs.readFileSync(path.join(__dirname, '..', 'starter', 'Investments', name), 'utf8')).data;
const clone = (v) => JSON.parse(JSON.stringify(v));
const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} is not ${expected}`);

// Ten equal single-stock positions of 1,000 in two sectors and two
// accounts, and 2,000 of cash: 12,000 in all. Every holding is 8.3%, each
// sector 41.7%, each account half, cash 16.7%, nothing illiquid.
function calm() {
  const pos = (ticker, sector) => ({ ticker, quantity: 10, assetClass: 'Equity', sector, geography: 'United States', currentPrice: { amount: 100, currency: 'USD', asOf: '2026-09-22T00:00:00.000Z' } });
  return {
    schemaVersion: 2,
    accounts: [
      { name: 'A', type: 'Taxable', cashBalance: 1000, positions: ['A1', 'A2', 'A3', 'A4', 'A5'].map((t) => pos(t, 'Technology')) },
      { name: 'B', type: 'Roth IRA', cashBalance: 1000, positions: ['B1', 'B2', 'B3', 'B4', 'B5'].map((t) => pos(t, 'Healthcare')) },
    ],
  };
}
function loose() {
  return {
    schemaVersion: 2,
    constraints: { maximumSinglePositionFraction: 0.1, maximumSectorFraction: 0.5, maximumAccountFraction: 0.6, minimumCashReserveFraction: 0.1, maximumIlliquidFraction: 0.1 },
    taxPreferences: { preferTaxAdvantagedForDividends: true, avoidShortTermGains: true },
    strategyRegime: 'growth-and-income',
  };
}
const found = (portfolio, risk) => lib.breaches(lib.riskChecks(portfolio, risk));

test('the calm portfolio is inside all five limits', () => {
  assert.deepEqual(found(calm(), loose()), []);
});

test('the starter portfolio reproduces the reference figures', () => {
  const p = starter('Portfolio.md');
  assert.equal(lib.totalMarketValue(p), 399920);
  assert.equal(lib.totalCash(p), 43900);
  assert.equal(lib.pct1(lib.totalCash(p) / lib.totalMarketValue(p)), '11.0%');
  assert.deepEqual(lib.accountBreakdown(p).map((a) => [a.name, a.value, lib.pct1(a.fraction)]), [
    ['Taxable Brokerage', 196500, '49.1%'], ['Roth IRA', 50350, '12.6%'], ['Traditional IRA', 45280, '11.3%'],
    ['Crypto Wallet', 81290, '20.3%'], ['Cash Vault', 26500, '6.6%'],
  ]);
  assert.deepEqual(lib.allocation(p, 'assetClass').map((r) => [r.label, r.value, lib.pct1(r.fraction)]), [
    ['Diversified', 154730, '38.7%'], ['Equity', 120000, '30.0%'], ['Crypto', 81290, '20.3%'], ['Cash', 43900, '11.0%'],
  ]);
});

test('the starter portfolio is over its single-position limit in NVDA and BTC, and nothing else', () => {
  const b = found(starter('Portfolio.md'), starter('Risk Profile.md'));
  assert.deepEqual(b.map((x) => [x.check, x.name]), [['position', 'BTC'], ['position', 'NVDA']]);
  assert.equal(lib.breachSentence(b[0]), 'BTC is 15.8% of the portfolio, above the 8.0% single-position maximum.');
});

test('allocation rows always add up to the whole, in every dimension', () => {
  const p = starter('Portfolio.md');
  for (const d of lib.DIMENSIONS) {
    close(lib.allocation(p, d.value).reduce((s, r) => s + r.fraction, 0), 1, d.value);
  }
  assert.deepEqual(lib.allocation(p, 'accountType').map((r) => r.label), ['Taxable', 'Crypto', 'Roth IRA', 'Traditional IRA', 'Cash']);
  assert.deepEqual(lib.allocation(p, 'geography').map((r) => r.label), ['United States', 'Global', 'International', 'Cash']);
});

test('over: one position past the single-position maximum', () => {
  const p = calm();
  p.accounts[0].positions[0].quantity = 13; // 1,300 of 12,300 = 10.6%
  assert.deepEqual(found(p, loose()).map((x) => [x.check, x.name]), [['position', 'A1']]);
});

test('a ticker held in two accounts is one position', () => {
  const p = calm();
  p.accounts[1].positions[0].ticker = 'A1'; // A1 is now 2,000 of 12,000 = 16.7%
  const b = found(p, loose()).filter((x) => x.check === 'position');
  assert.deepEqual(b.map((x) => x.name), ['A1']);
  close(b[0].fraction, 2000 / 12000, 'combined');
});

test('a fund counts toward neither the single-position nor the sector limit', () => {
  const p = calm();
  p.accounts[0].positions.push({ ticker: 'VTI', quantity: 30, fund: true, sector: 'Broad market', currentPrice: { amount: 100 } });
  const b = found(p, Object.assign(loose(), { constraints: Object.assign(loose().constraints, { maximumAccountFraction: 1 }) }));
  assert.deepEqual(b, [], JSON.stringify(b));
});

test('over: one sector past the sector maximum', () => {
  const risk = loose();
  risk.constraints.maximumSectorFraction = 0.4; // each sector is 41.7%
  assert.deepEqual(found(calm(), risk).map((x) => [x.check, x.name]), [['sector', 'Technology'], ['sector', 'Healthcare']]);
});

test('over: one account past the single-account maximum', () => {
  const p = calm();
  p.accounts[0].cashBalance = 4000; // A holds 9,000 of 15,000 = 60%, cash 33%
  const risk = loose();
  risk.constraints.maximumAccountFraction = 0.55;
  assert.deepEqual(found(p, risk).map((x) => [x.check, x.name]), [['account', 'A']]);
});

test('under: cash below the minimum reserve', () => {
  const p = calm();
  p.accounts[0].cashBalance = 400; p.accounts[1].cashBalance = 400; // 800 of 10,800 = 7.4%
  const b = found(p, loose());
  assert.deepEqual(b.map((x) => [x.check, x.name]), [['cash', 'Cash']]);
  assert.equal(lib.breachSentence(b[0]), 'Cash is 7.4% of the portfolio, below the 10.0% minimum reserve.');
});

test('over: illiquid assets past the illiquid maximum', () => {
  const p = calm();
  p.accounts[0].positions[0].illiquid = true;
  p.accounts[0].positions[1].illiquid = true; // 2,000 of 12,000 = 16.7%
  const b = found(p, loose());
  assert.deepEqual(b.map((x) => [x.check, x.name]), [['illiquid', 'Illiquid assets']]);
  assert.match(lib.breachSentence(b[0]), /^Illiquid assets are 16\.7% of the portfolio, above the 10\.0% maximum\.$/);
});

test('exactly at a limit is inside it, for a maximum and for a minimum', () => {
  const p = calm();
  const risk = loose();
  risk.constraints.maximumAccountFraction = 0.5; // each account is exactly half
  risk.constraints.minimumCashReserveFraction = 2000 / 12000; // cash is exactly this
  assert.deepEqual(found(p, risk), []);
});

test('a schema 1 profile checks its three limits and reports the other two as not set', () => {
  const risk = loose();
  delete risk.constraints.maximumAccountFraction;
  delete risk.constraints.maximumIlliquidFraction;
  const p = calm();
  p.accounts[0].positions.forEach((x) => { x.illiquid = true; });
  const checks = lib.riskChecks(p, risk);
  assert.equal(checks.find((c) => c.id === 'account').limit, null);
  assert.equal(checks.find((c) => c.id === 'illiquid').limit, null);
  assert.deepEqual(lib.breaches(checks), []);
});

test('an empty portfolio breaches nothing: there is nothing to be over or under a limit', () => {
  assert.deepEqual(found({ schemaVersion: 2, accounts: [] }, loose()), []);
  assert.deepEqual(found({ schemaVersion: 2, accounts: [{ name: 'ISA', cashBalance: 0, positions: [] }] }, loose()), []);
  assert.equal(lib.riskChecks({ accounts: [] }, loose()).length, 5, 'still five checks, each reporting nothing');
});

test('a risk profile names a bad limit or regime rather than drawing it', () => {
  const note = (data) => '---\ninvestment-partner: risk-profile\n---\n```json\n' + JSON.stringify(data) + '\n```\n';
  const bad = loose();
  bad.constraints.maximumIlliquidFraction = 3;
  assert.match(lib.readNote(note(bad)).error, /"maximumIlliquidFraction" must be a number from 0 to 1/);
  const regime = loose();
  regime.strategyRegime = 'yolo';
  assert.match(lib.readNote(note(regime)).error, /"strategyRegime" must be one of aggressive-growth/);
});

test('the ask messages carry the state and the note paths, as text the person reviews', () => {
  const p = starter('Portfolio.md');
  const r = starter('Risk Profile.md');
  const paths = ['Investments/Portfolio.md', 'Investments/Risk Profile.md'];
  const m = lib.dashboardMessage(p, r, paths);
  assert.match(m, /Total value: \$399,920 \(USD\)\. Cash: 11\.0%\./);
  assert.match(m, /Strategy regime: Growth & income\./);
  assert.match(m, /- NVDA is 11\.3% of the portfolio, above the 8\.0% single-position maximum\./);
  assert.match(m, /My notes: Investments\/Portfolio\.md, Investments\/Risk Profile\.md\.$/);
  assert.match(lib.tradeMessage({ ticker: 'MSFT', side: 'buy', amount: 5000 }, paths), /^I want to buy \$5,000 of MSFT\./);
  assert.match(lib.breachMessage(lib.breaches(lib.riskChecks(p, r)), paths), /Propose each change for my decision journal/);
  for (const text of [m, lib.tradeMessage({ ticker: 'MSFT', side: 'buy', amount: 5000 }, paths)]) assert.ok(text.length >= 1 && text.length <= 4000);
});

test('every percentage is written one way, to one decimal', () => {
  assert.equal(lib.pct1(0.11), '11.0%');
  assert.equal(lib.pct1(0.05), '5.0%');
  assert.equal(lib.pct1(0.1098), '11.0%');
  assert.equal(lib.pct1(1), '100.0%');
  assert.equal(lib.pct1(0), '0.0%');
  assert.equal(lib.pct1(undefined), '0.0%');
  // The view has no second formatter to drift from this one.
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'ui', 'index.js'), 'utf8');
  assert.ok(!/function pct\(/.test(source), 'a second percentage formatter crept back in');
  assert.ok(!/\+ '%'/.test(source.replace("toFixed(1) + '%'", '')), 'a percentage built by hand outside pct1');
});

test('a proposed trade needs a ticker, a side and a positive amount, and drafts a complete message', () => {
  assert.deepEqual(lib.checkTrade({}).errors, { ticker: 'Enter a ticker, such as MSFT.', side: 'Choose buy or sell.', amount: 'Enter an amount, in USD.' });
  for (const bad of ['-50', '0', 'abc', '1.234', '5 000']) assert.ok(lib.checkTrade({ ticker: 'X', side: 'buy', amount: bad }).errors.amount, bad);
  assert.ok(lib.checkTrade({ ticker: 'NOT A TICKER', side: 'buy', amount: '1' }).errors.ticker);
  assert.ok(lib.checkTrade({ ticker: 'X', side: 'hold', amount: '1' }).errors.side, 'only buy or sell');
  assert.deepEqual(lib.checkTrade({ ticker: ' brk.b ', side: 'sell', amount: '$1,250.50' }).trade, { ticker: 'BRK.B', side: 'sell', amount: 1250.5 });
  assert.equal(lib.tradeMessage({ ticker: 'MSFT', side: 'buy', amount: 5000 }, []),
    'I want to buy $5,000 of MSFT. Check it against my risk limits first, and if it fits, add it to my decision journal as proposed.');
  assert.match(lib.tradeMessage({ ticker: 'BTC', side: 'sell', amount: 1250.5 }, ['a.md']), /^I want to sell \$1,250\.50 of BTC\..*\n\nMy notes: a\.md\.$/s);
});
