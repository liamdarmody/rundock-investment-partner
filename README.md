# Investment Partner for Rundock

An investment dashboard on one note you pin: your portfolio and its allocation, a risk control panel, and a decision board, with a risk check across all of them, and three agents that research and stress-test positions against your limits. One package, installed from one link.

This is the Investment Partner Hub reference plugin from [rundock#199](https://github.com/liamdarmody/rundock/issues/199), rebuilt on what Rundock ships in 0.15.0. [CHANGES.md](CHANGES.md) lists every change from the original and the rule that required it.

## What you get

| Part | What it is | Where it lands |
|---|---|---|
| The extension | Draws the dashboard, and each note on its own | Rundock's managed extensions list, removable with Uninstall |
| Four notes | The dashboard, your portfolio, risk profile and decision journal, with sample data | `Investments/`, only where you have nothing at that path |
| Lead Partner | Coordinates a review, checks trades against your limits, keeps the notes current | Team, under whoever leads your workspace |
| Equity Analyst | Business model and unit economics research | Team, under Lead Partner |
| Risk Manager | The bear case and three measurable invalidation metrics | Team, under Lead Partner |
| Investment Review | The review sequence, the limit check and the data conventions | Skills |
| Investment Reset | Puts back a missing note, empty and valid, or starts you empty in place of the sample data; never overwrites your own | Skills |

The notes, agents and skills become ordinary files in your workspace, yours to read and change. Uninstalling the extension leaves them where they are.

## Needs

[Rundock](https://github.com/liamdarmody/rundock) 0.15.0 or later: the dashboard is built from Rundock UI (the component library Rundock injects into every extension frame), named sources (a note hands its view the files it lists) and ask (a click in the view drafts a message to an agent). The install refuses the extension on a Rundock that does not provide the Rundock UI `1.0` it was built against.

## Install

In Rundock, open **Settings**, then **Packages**, and paste the repository link. Rundock shows what the package holds before anything is written:

- the view, and the notes it draws (only those marked `investment-partner`);
- that it can change the notes it draws, and read the notes a dashboard note lists under `sources:`, and nothing else;
- that when you click inside it, it can start a new conversation with Lead Partner with a message in the box, and nothing is sent until you send it;
- the three agents, two skills and four starter notes.

Install the extension, then accept the agents, skills and starter notes on the next screen. Then open `Investments/Investment Dashboard.md` and pin it.

## The dashboard

| Section | What it does |
|---|---|
| Sample data banner | On first run, says the numbers are invented and offers Set up with Lead Partner (a short interview) or Start empty in your currency, with Undo |
| Stat tiles | Total value, with a small currency label beside it that opens the currency picker (relabelling, never converting), total cash, the active strategy regime, and Propose a trade |
| Propose a trade | A small form beneath the tiles (ticker, buy or sell, amount) that drafts a message asking Lead Partner to check the trade against your limits and propose it for your journal. It never sends, writes or places anything |
| Risk alert | Every allocation outside your limits, in a sentence each, with Ask Lead Partner (in the header instead when nothing is over) |
| Accounts | In Account breakdown: click a name to rename it or change its type and cash; + Add account; remove one with Undo once it holds no positions |
| Positions | Below the Decision board: every position, in columns sized to their contents that you can resize (Rundock keeps the widths for the note, never in it), with quantity and price read as text and opened in place when selected, a menu per row to move it to another account or remove it (with Undo), and + Add position |
| Portfolio and allocation | Asset class, sector, geography or account type as a donut; each account against your single-account limit; cash against your minimum reserve |
| Risk control panel | Five limits, two tax preferences and your strategy regime |
| Decision board | Every decision by status; move one with its menu or drag it |

Every change saves as you make it. There are no Save buttons. Rundock writes once your edits pause, and never over a note that changed elsewhere since you opened it.

## The notes

The dashboard note holds no data. It lists the three notes it draws, as exact paths:

```markdown
---
investment-partner: dashboard
sources:
  - Investments/Portfolio.md
  - Investments/Risk Profile.md
  - Investments/Decision Journal.md
---
```

Rundock hands the view exactly those files. Move or rename one and update its line. The view recognises each by its marker, so the names are yours to choose.

Each data note is ordinary markdown: a marker in the frontmatter (`portfolio`, `risk-profile` or `decision-journal`) and the data in the first `json` block. Anything you write outside the block is yours; a save never touches it. Open one on its own and it draws its own part of the dashboard; the portfolio note adds a table where you edit quantities and prices.

The portfolio has one currency, `baseCurrency` (for example `"GBP"`), and every amount in it is in that currency; nothing is converted. It starts with `"sample": true`, which the first edit removes.

When Lead Partner or anything else changes a note while the dashboard is open, the dashboard redraws and says "Updated just now".

Fractions are decimals from 0 to 1, so `0.08` is 8%. A position marked `"fund": true` (an index or bond fund) counts toward neither the single-position nor the sector limit, because it is many positions; one marked `"illiquid": true` counts toward the illiquid limit. The Investment Review skill has the full rule for every limit.

## What the view can and cannot do

Rundock runs the view in a sandboxed frame with no network and no access to the rest of your workspace. It can:

- change the notes the dashboard lists, and the note it is opened on, through Rundock's guarded save;
- ask Rundock to open a note, or to start a conversation with Lead Partner with a message in the box, each only after a click inside it.

It cannot read a file the dashboard does not list, change which files it lists, or see a conversation. So there is no live Agent Debate panel: a view is never shown a conversation or its reply.

## Develop

```
npm install
RUNDOCK_UI=/path/to/rundock/public/rundock-ui.js npm test
```

`ui/index.js` is the whole view, UMD-shaped: under Node the note format, the math, the risk check and the message adapter load for the tests; in the frame the view boots. Rundock UI ships inside Rundock, never in an extension, so the view tests read it from a Rundock checkout and are skipped, saying so, without `RUNDOCK_UI`. The rest run anywhere.

To see the view in a real engine, in both themes and at phone width:

```
RUNDOCK=/path/to/rundock node tools/preview.mjs
```

It builds the frame with that checkout's own frame builder and plays Rundock's side, handing the starter notes over as named sources, and writes screenshots to `scratch/screenshots/`.

To check that Positions keeps its widths through Rundock's view state on a real mount:

```
RUNDOCK=/path/to/rundock node tools/view-state-check.mjs
```

Before tagging a release, check the tag against the manifest's version:

```
node scripts/check-version.js v1.0.0
```

## Credits

Designed and first built by @dougseven as the Investment Partner Hub ([rundock#199](https://github.com/liamdarmody/rundock/issues/199)): the agents, the review sequence, the portfolio math, the data shapes and the dashboard this package draws. Rebuilt for Rundock's shipped contract with him as co-author.

## Licence

MIT, copyright @liamdarmody and @dougseven. See `LICENSE`.
