'use strict';
// The note format: a marker in the frontmatter picks the panel, the first
// ```json block is the data, and a write touches that block and nothing else.
const test = require('node:test');
const assert = require('node:assert/strict');

const lib = require('../ui/index.js');

const PORTFOLIO = [
  '---',
  'investment-partner: portfolio',
  'tags: [money]',
  '---',
  '',
  '# Portfolio',
  '',
  'My own notes, which a save must never touch.',
  '',
  '```json',
  '{ "schemaVersion": 1, "accounts": [] }',
  '```',
  '',
  'More prose after the block.',
  '',
].join('\n');

test('the marker value picks the kind', () => {
  assert.equal(lib.kindOf(PORTFOLIO), 'portfolio');
  assert.equal(lib.kindOf('---\ninvestment-partner: "risk-profile"\n---\n'), 'risk-profile');
  assert.equal(lib.kindOf('# no frontmatter'), null);
  assert.equal(lib.kindOf('---\nother: x\n---\n'), null);
});

test('a well-formed note reads as its kind and data', () => {
  const read = lib.readNote(PORTFOLIO);
  assert.equal(read.kind, 'portfolio');
  assert.deepEqual(read.data, { schemaVersion: 1, accounts: [] });
});

test('each way a note can be wrong is named, never drawn', () => {
  assert.match(lib.readNote('# plain').error, /no investment-partner marker/);
  assert.match(lib.readNote('---\ninvestment-partner: taxes\n---\n```json\n{}\n```').error, /says "taxes"/);
  assert.match(lib.readNote('---\ninvestment-partner: portfolio\n---\nno block').error, /no ```json block/);
  assert.match(lib.readNote('---\ninvestment-partner: portfolio\n---\n```json\n{ nope\n```').error, /not valid JSON/);
  assert.match(lib.readNote('---\ninvestment-partner: portfolio\n---\n```json\n{}\n```').error, /"accounts" list/);
  assert.match(lib.readNote('---\ninvestment-partner: risk-profile\n---\n```json\n{"constraints":{"maximumSinglePositionFraction":2,"maximumSectorFraction":0.3,"minimumCashReserveFraction":0.05}}\n```').error, /from 0 to 1/);
  assert.match(lib.readNote('---\ninvestment-partner: decision-journal\n---\n```json\n{"entries":{}}\n```').error, /"entries" list/);
  assert.match(lib.readNote(undefined).error, /no note text/);
});

test('a write replaces the data block and leaves every other byte alone', () => {
  const next = lib.writeNote(PORTFOLIO, { schemaVersion: 1, accounts: [{ name: 'Brokerage', cashBalance: 10 }] });
  const block = lib.dataBlock(PORTFOLIO);
  const nextBlock = lib.dataBlock(next);
  assert.equal(next.slice(0, nextBlock.start), PORTFOLIO.slice(0, block.start));
  assert.equal(next.slice(nextBlock.end), PORTFOLIO.slice(block.end));
  assert.deepEqual(lib.readNote(next).data.accounts[0], { name: 'Brokerage', cashBalance: 10 });
});

test('a write keeps a note with CRLF line endings in CRLF', () => {
  const crlf = PORTFOLIO.replace(/\n/g, '\r\n');
  const next = lib.writeNote(crlf, { accounts: [{ name: 'A' }] });
  assert.equal(next.replace(/\r\n/g, '').indexOf('\n'), -1);
  assert.deepEqual(lib.readNote(next).data, { accounts: [{ name: 'A' }] });
});

test('a json fence inside the frontmatter is not mistaken for the data', () => {
  const tricky = '---\ninvestment-partner: decision-journal\nnote: "```json"\n---\n```json\n{"entries":[]}\n```\n';
  assert.deepEqual(lib.readNote(tricky).data, { entries: [] });
});

// The math is the original's, so these pin its numbers rather than rederive them.
const SAMPLE = {
  accounts: [
    { name: 'Taxable', cashBalance: 1000, positions: [
      { ticker: 'AAA', quantity: 10, sector: 'Tech', assetClass: 'Equity', currentPrice: { amount: 100, asOf: '2026-09-22T00:00:00Z' } },
      { ticker: 'BBB', quantity: 5, sector: 'Health', assetClass: 'Equity', currentPrice: { amount: 200, asOf: '2026-09-01T00:00:00Z' } },
    ] },
    { name: 'Retirement', cashBalance: 0, positions: [
      { ticker: 'CCC', quantity: 20, sector: 'Tech', assetClass: 'Bond', currentPrice: { amount: 50, asOf: '2026-09-22T00:00:00Z' } },
    ] },
  ],
};

test('totals, concentration and reserve', () => {
  const total = lib.totalMarketValue(SAMPLE);
  assert.equal(total, 4000);
  assert.equal(lib.largestSinglePositionFraction(SAMPLE, total), 0.25);
  assert.equal(lib.largestSectorFraction(SAMPLE, total), 0.5);
  assert.equal(lib.cashReserveFraction(SAMPLE, total), 0.25);
  assert.deepEqual(lib.groupSum(SAMPLE, (p) => p.position.assetClass), { Equity: 2000, Bond: 1000 });
});

test('a price older than a day is stale', () => {
  const now = new Date('2026-09-22T12:00:00Z').getTime();
  const flat = lib.allPositions(SAMPLE).map((p) => lib.isStale(p.position, now));
  assert.deepEqual(flat, [false, true, false]);
});

test('an empty portfolio has no fractions to divide by', () => {
  assert.equal(lib.largestSinglePositionFraction({ accounts: [] }, 0), 0);
  assert.equal(lib.cashReserveFraction({ accounts: [] }, 0), 0);
});

test('with CRLF endings, a json fence inside the frontmatter is still not the data', () => {
  const tricky = '---\r\ninvestment-partner: decision-journal\r\na: 1\r\nb: 2\r\nnote: "```json"\r\n---\r\n```json\r\n{"entries":[]}\r\n```\r\n';
  assert.deepEqual(lib.readNote(tricky).data, { entries: [] });
});
