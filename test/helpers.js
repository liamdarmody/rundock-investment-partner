'use strict';
// A frame the way Rundock builds one, in jsdom: Rundock UI installed first
// from a real Rundock checkout, then this package's entry, then messages
// from "Rundock" with the frame's parent as their source.
//
// Rundock UI ships inside Rundock, never in an extension, so the view tests
// need a checkout to read it from:
//
//   RUNDOCK_UI=/path/to/rundock/public/rundock-ui.js npm test
//
// Without it (or without jsdom installed) those tests are skipped, and say so.
const fs = require('node:fs');
const path = require('node:path');

const LIBRARY = process.env.RUNDOCK_UI;
let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (e) { /* optional */ }
const skip = !LIBRARY ? 'set RUNDOCK_UI to a Rundock checkout\'s public/rundock-ui.js to run this'
  : !JSDOM ? 'npm install to get jsdom' : false;

const ROOT = path.join(__dirname, '..');
const ENTRY = fs.readFileSync(path.join(ROOT, 'ui', 'index.js'), 'utf8');
const starter = (name) => fs.readFileSync(path.join(ROOT, 'starter', 'Investments', name), 'utf8');
const DASHBOARD = 'Investments/Investment Dashboard.md';
const SOURCES = ['Portfolio.md', 'Risk Profile.md', 'Decision Journal.md']
  .map((name) => ({ path: `Investments/${name}`, content: starter(name) }));

// Every window a test mounts is closed when the file's tests end, which
// clears the view's timers (undo lines, "Updated just now") so the run ends.
const windows = [];
require('node:test').after(() => { for (const w of windows) w.close(); });

// A stand-in for Rundock.viewState, which Rundock's frame bootstrap installs
// before Rundock UI: the view's own state, kept here across mounts the way
// Rundock keeps it across a reload. `kept` is what Rundock would store.
function viewStateStore(initial = {}) {
  const kept = JSON.parse(JSON.stringify(initial));
  return {
    kept,
    get: (k) => (Object.prototype.hasOwnProperty.call(kept, k) ? JSON.parse(JSON.stringify(kept[k])) : undefined),
    set: (k, v) => { if (v === undefined) delete kept[k]; else kept[k] = JSON.parse(JSON.stringify(v)); },
  };
}

async function mount({ withUi = true, viewState = null } = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { runScripts: 'outside-only', pretendToBeVisual: true });
  const win = dom.window;
  windows.push(win);
  const sent = [];
  // A top-level jsdom window is its own parent, so the view's host is this
  // window: capture what it posts, and speak to it with this window as the
  // event source, which is the check the view makes.
  win.postMessage = (message) => sent.push(JSON.parse(JSON.stringify(message)));
  if (viewState) {
    const api = Object.freeze({ get: viewState.get, set: viewState.set });
    Object.defineProperty(win, 'Rundock', { value: { viewState: api }, enumerable: true });
  }
  if (withUi) {
    const { installRundockUi } = await import(path.resolve(LIBRARY));
    win.eval(`(${installRundockUi.toString()})(window);`);
  }
  win.eval(ENTRY);
  const send = (data, source = win) => win.dispatchEvent(new win.MessageEvent('message', { data, source }));
  const doc = win.document;
  return {
    win, doc, sent, send,
    $: (sel) => doc.querySelector(sel),
    $$: (sel) => [...doc.querySelectorAll(sel)],
    last: (type) => sent.filter((m) => m.type === type).pop(),
    all: (type) => sent.filter((m) => m.type === type),
    init: (content, p, sources) => send({ type: 'init', path: p, content, theme: 'dark', ...(sources === undefined ? {} : { sources }) }),
    dashboard: (sources = SOURCES) => send({ type: 'init', path: DASHBOARD, content: starter('Investment Dashboard.md'), theme: 'dark', sources }),
    key: (el, key) => el.dispatchEvent(new win.KeyboardEvent('keydown', { key, bubbles: true })),
    slide: (el, value) => { el.value = String(value); el.dispatchEvent(new win.Event('input', { bubbles: true })); },
    type: (el, value) => { el.value = String(value); el.dispatchEvent(new win.Event('input', { bubbles: true })); },
  };
}

module.exports = { mount, skip, starter, viewStateStore, SOURCES, DASHBOARD, ENTRY, ROOT };
