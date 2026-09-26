'use strict';
// The schema this round adds: one currency per portfolio, written in the
// person's locale and never converted; sample data and the empty notes that
// replace it; and accounts and positions as the dashboard edits them.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const lib = require('../ui/index.js');
const starter = (name) => lib.readNote(fs.readFileSync(path.join(__dirname, '..', 'starter', 'Investments', name), 'utf8')).data;
const NBSP = ' ';

test('amounts are written in the portfolio currency and the person\'s locale', () => {
  assert.equal(lib.money(399920, 'GBP', 'en-GB'), '£399,920');
  assert.equal(lib.money(399920, 'USD', 'en-US'), '$399,920');
  assert.equal(lib.money(399920, 'EUR', 'de-DE'), `399.920${NBSP}€`);
  assert.equal(lib.money(399920, 'EUR', 'fr-FR'), `399 920${NBSP}€`);
  assert.equal(lib.money(399920, 'JPY', 'ja-JP'), '￥399,920');
  assert.equal(lib.money(399920, 'JPY', 'en-GB'), 'JP¥399,920', 'en-GB tells yen from yuan');
  // Whole units unless asked for exactly, and then the currency's own minor units.
  assert.equal(lib.money(1250.5, 'GBP', 'en-GB', true), '£1,250.50');
  assert.equal(lib.money(1250.5, 'JPY', 'en-GB', true), 'JP¥1,251', 'JPY has no minor units');
  assert.equal(lib.money(1250, 'GBP', 'en-GB', true), '£1,250');
});

test('a new portfolio\'s currency comes from the locale\'s region', () => {
  assert.equal(lib.defaultCurrency('en-GB'), 'GBP');
  assert.equal(lib.defaultCurrency('en-US'), 'USD');
  assert.equal(lib.defaultCurrency('de-DE'), 'EUR');
  assert.equal(lib.defaultCurrency('fr-CA'), 'CAD');
  assert.equal(lib.defaultCurrency('ja'), 'JPY', 'a language alone is maximised to its likely region');
  assert.equal(lib.defaultCurrency('en-AQ'), 'USD', 'an unknown region falls back to USD');
  assert.equal(lib.currencyOf({ baseCurrency: 'CHF' }, 'en-GB'), 'CHF');
  assert.equal(lib.currencyOf({}, 'en-GB'), 'GBP');
  assert.equal(lib.currencyOf({ baseCurrency: 'NOPE' }, 'en-GB'), 'GBP');
});

test('"Other" takes any three-letter code this runtime knows as a currency', () => {
  for (const code of ['BRL', 'MXN', 'KRW', 'PLN']) assert.ok(lib.isCurrencyCode(code), code);
  for (const bad of ['XYZ', 'gbp', 'GB', 'GBPX', '', null, 123]) assert.ok(!lib.isCurrencyCode(bad), String(bad));
  assert.equal(lib.COMMON_CURRENCIES.length, 15);
  for (const code of lib.COMMON_CURRENCIES) assert.ok(lib.isCurrencyCode(code), code);
});

test('changing the currency relabels every price and converts nothing', () => {
  const p = starter('Portfolio.md');
  const next = lib.relabelCurrency(p, 'GBP');
  assert.equal(next.baseCurrency, 'GBP');
  assert.equal(lib.totalMarketValue(next), lib.totalMarketValue(p));
  assert.ok(lib.allPositions(next).every((x) => x.position.currentPrice.currency === 'GBP'));
  assert.equal(p.baseCurrency, 'USD', 'the original is untouched');
});

test('an amount can be typed with its symbol and separators, and nothing else', () => {
  assert.equal(lib.parseAmount('£5,000', 'GBP', 'en-GB'), 5000);
  assert.equal(lib.parseAmount('5000.25', 'EUR', 'de-DE'), 5000.25);
  for (const bad of ['', '-3', 'abc', '5 000', '1.2.3']) assert.ok(Number.isNaN(lib.parseAmount(bad, 'GBP', 'en-GB')), bad);
  assert.equal(lib.checkTrade({ ticker: 'VOD', side: 'buy', amount: '' }, 'GBP').errors.amount, 'Enter an amount, in GBP.');
  assert.equal(lib.tradeMessage({ ticker: 'VOD', side: 'sell', amount: 1250.5 }, [], 'GBP', 'en-GB').split('.')[0], 'I want to sell £1,250');
});

test('the starter portfolio is sample data, and the empty notes are valid and not', () => {
  assert.equal(lib.isSample(starter('Portfolio.md')), true);
  assert.equal(lib.isSample(lib.emptyPortfolio('GBP')), false);
  const note = (kind, data) => `---\ninvestment-partner: ${kind}\n---\n\`\`\`json\n${JSON.stringify(data)}\n\`\`\`\n`;
  assert.deepEqual(lib.readNote(note('portfolio', lib.emptyPortfolio('GBP'))).data, { schemaVersion: 2, baseCurrency: 'GBP', accounts: [] });
  assert.equal(lib.readNote(note('decision-journal', lib.emptyJournal())).error, undefined);
  assert.match(lib.readNote(note('portfolio', { accounts: [], baseCurrency: 'pounds' })).error, /three-letter currency code/);
  assert.match(lib.readNote(note('portfolio', { accounts: [], sample: 'yes' })).error, /"sample" must be true or false/);
});

test('account types are suggested for the currency, with Cash and Crypto for all', () => {
  assert.deepEqual(lib.accountTypeSuggestions('GBP'), ['Stocks & Shares ISA', 'Lifetime ISA', 'Cash ISA', 'SIPP', 'Workplace pension', 'General Investment Account', 'Cash', 'Crypto']);
  assert.deepEqual(lib.accountTypeSuggestions('USD'), ['Taxable', 'Roth IRA', 'Traditional IRA', '401(k)', 'HSA', 'Cash', 'Crypto']);
  assert.deepEqual(lib.accountTypeSuggestions('EUR'), ['Cash', 'Crypto']);
});

test('an account needs a unique name and a cash balance of zero or more', () => {
  const p = { accounts: [{ name: 'ISA', positions: [] }, { name: 'SIPP', positions: [] }] };
  assert.equal(lib.checkAccount(p, 1, { name: 'isa' }, 'GBP').errors.name, 'Another account is already called isa.');
  assert.equal(lib.checkAccount(p, 0, { name: 'ISA' }, 'GBP').account.name, 'ISA', 'keeping its own name is fine');
  assert.equal(lib.checkAccount(p, 0, { name: '  ' }, 'GBP').errors.name, 'Give the account a name.');
  assert.ok(lib.checkAccount(p, 0, { name: 'ISA', cash: '-5' }, 'GBP').errors.cash);
  assert.deepEqual(lib.checkAccount(p, 0, { name: ' Main ISA ', type: 'Stocks & Shares ISA', cash: '£1,200' }, 'GBP', 'en-GB').account,
    { name: 'Main ISA', type: 'Stocks & Shares ISA', cash: 1200 });
  assert.equal(lib.newAccountName({ accounts: [{ name: 'New account' }, { name: 'New account 2' }] }), 'New account 3');
});

test('an account holding positions cannot be removed, and says why', () => {
  assert.equal(lib.accountRemoveBlock({ positions: [] }), null);
  assert.equal(lib.accountRemoveBlock({}), null);
  assert.match(lib.accountRemoveBlock({ positions: [{}] }), /^Move or remove its position first/);
  assert.match(lib.accountRemoveBlock({ positions: [{}, {}] }), /^Move or remove its 2 positions first/);
});

test('a new position needs a ticker, an account, a quantity and a price, and starts with editable categories', () => {
  const p = { accounts: [{ name: 'ISA', positions: [] }] };
  assert.deepEqual(Object.keys(lib.checkPosition(p, {}, 'GBP').errors), ['ticker', 'account', 'quantity', 'price']);
  assert.equal(lib.checkPosition(p, { ticker: 'VOD', account: '0', quantity: '100', price: '0' }, 'GBP').errors.price, 'Enter the price of one, in GBP, above zero.');
  const ok = lib.checkPosition(p, { ticker: 'vod', account: '0', quantity: '100', price: '0.72', ...lib.defaultCategories('en-GB') }, 'GBP', 'en-GB');
  assert.equal(ok.account, 0);
  assert.deepEqual({ ...ok.position, currentPrice: { ...ok.position.currentPrice, asOf: 'x' } },
    { ticker: 'VOD', quantity: 100, assetClass: 'Equity', sector: 'Unclassified', geography: 'United Kingdom', currentPrice: { amount: 0.72, currency: 'GBP', asOf: 'x' } });
});

test('the setup interview asks for country, currency, accounts and statements, and names the notes', () => {
  const m = lib.setupMessage(['Investments/Portfolio.md'], 'GBP');
  for (const part of [/country/, /base currency \(I think it is GBP\)/, /accounts I hold/, /statements/, /remove the sample flag/, /My notes: Investments\/Portfolio\.md\.$/]) assert.match(m, part);
  assert.ok(m.length <= 4000);
});

test('a new position marked as a fund or illiquid carries the flag the risk check reads, and only then', () => {
  const p = { accounts: [{ name: 'ISA', positions: [] }] };
  const base = { ticker: 'VWRL', account: '0', quantity: '10', price: '100' };
  const plain = lib.checkPosition(p, base, 'GBP').position;
  assert.equal('fund' in plain || 'illiquid' in plain, false);
  const fund = lib.checkPosition(p, { ...base, fund: true, illiquid: true }, 'GBP').position;
  assert.equal(fund.fund, true);
  assert.equal(fund.illiquid, true);
  // The fund counts toward neither the single-position nor the sector limit.
  const portfolio = { accounts: [{ name: 'ISA', cashBalance: 0, positions: [fund] }] };
  const risk = { constraints: { maximumSinglePositionFraction: 0.1, maximumSectorFraction: 0.1, minimumCashReserveFraction: 0, maximumIlliquidFraction: 1 } };
  assert.deepEqual(lib.breaches(lib.riskChecks(portfolio, risk)), []);
});

test('an amount carries its code only when its symbol could be several currencies', () => {
  assert.equal(lib.currencyNeedsCode('GBP', 'en-GB'), true, '£ on its own');
  assert.equal(lib.currencyNeedsCode('USD', 'en-GB'), false, 'US$ already says so: never "US$399,920 · USD"');
  assert.equal(lib.currencyNeedsCode('USD', 'en-US'), true, '$ on its own');
  assert.equal(lib.currencyNeedsCode('CAD', 'en-US'), false, 'CA$');
  assert.equal(lib.currencyNeedsCode('JPY', 'en-GB'), false, 'JP¥');
  assert.equal(lib.currencyNeedsCode('SEK', 'sv-SE'), true, 'kr is Swedish, Norwegian or Danish');
  assert.equal(lib.currencyNeedsCode('CHF', 'de-CH'), false, 'the symbol is the code');
});

test('the refusals Rundock shows itself are matched by request and exact reason, in one list', () => {
  assert.equal(lib.HOST_SHOWN_REASONS.length, 3);
  for (const reason of lib.HOST_SHOWN_REASONS) {
    for (const of of ['open', 'openExternal', 'ask']) assert.equal(lib.hostShowsRefusal({ of, reason }), true, `${of}: ${reason}`);
    for (const of of ['save', 'change', 'saveSource', 'changeSource']) assert.equal(lib.hostShowsRefusal({ of, reason }), false, `${of} stays the view's`);
  }
  assert.equal(lib.hostShowsRefusal({ of: 'ask', reason: 'there is no agent called x on this team' }), false);
  assert.equal(lib.hostShowsRefusal({ of: 'open', reason: 'Rundock stopped this' }), false, 'a partial match is not a match');
  assert.equal(lib.hostShowsRefusal(null), false);
});
