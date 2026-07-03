# simple-admin — Verification Plan

> Status: static verification is done. A jsdom-based functional pass has also been run (see
> "jsdom functional testing" below) — it exercises real logic (registration, routing, data fetching,
> forms) without needing a real browser, and it found and fixed one genuine bug. **The user has
> also since tested `examples/theme-switcher` in a real browser** (this sandbox still can't launch
> one itself) and reported two more real bugs, both found and fixed — see "Real-browser bugs found
> by the user" below, the first actual real-browser evidence this project has had.

## Real-browser bugs found by the user

Reported via a screenshot of `examples/theme-switcher` showing the posts list: the "Author id"
reference-field column rendered raw numeric ids (not resolved author names) as plain links, and
three stacked, duplicate pagination bars appeared under the table (one showing `0–0 of 0`, two
identical ones showing `1–6 of 6`). Both are real, now-fixed bugs — not test-environment artifacts.

**Bug 1 — reference fields render raw ids: a custom-element registration-order race.**
`src/index.js` registered leaf fields/inputs (`registerField`/`customElements.define` at module
scope) *before* the container components (`<sa-datagrid>`, `<sa-simple-show-layout>`, etc.). Every
static example page defers its `<script type="module">`, so the whole document is already parsed
before any `customElements.define()` call runs — meaning the browser's upgrade algorithm processes
already-parsed elements in **define()-call order across the whole document**, not tree order across
different tag names. Since `<sa-reference-field>` was defined before `<sa-datagrid>`, it upgraded
and ran its own `connectedCallback` (which permanently captures-and-strips its nested
`<sa-text-field>` template into `_templateChildren`, exactly once, ever) *while still nested inside
a not-yet-defined `<sa-datagrid>`* — before the datagrid ever got a chance to detach it as a pristine
column template. Every per-row clone the datagrid later made from that already-stripped template
therefore had zero nested children, so `SaReferenceField._renderResolved()` fell through to its
raw-id fallback for every row.

**First fix attempt (wrong) and the real, order-independent fix.** The first fix reordered
`src/index.js` to register every component before any field/input type, reasoning that containers
should always get first crack at detaching their children. This was tested by the user and made
things *worse*: it flipped which side of the race loses. With components registered first,
`<sa-datagrid>` now upgraded and ran its own `_collectChildren()` — which decides "is this child a
real column?" via `typeof node.toDescriptor === 'function'`, a duck-type check that's only true
once a child's class has actually upgraded it — *before* `<sa-text-field>`/`<sa-reference-field>`
were even defined yet, so every column looked "unknown" and got dropped (an empty datagrid with
only its checkbox column). Reordering `index.js` can only ever pick a side; it can't eliminate the
race, because the race is inherent to processing an already-fully-parsed document in
define()-call order rather than tree order across different tag names.

The actual fix: `SaDatagrid.connectedCallback` (`src/components/datagrid.js`) now defers its
one-time `_collectChildren()`/`_buildTable()` by a single `queueMicrotask()`. Module evaluation and
an importing script's own top-level body run entirely synchronously; nothing in that chain awaits
anything, so by the time any microtask gets a turn, every custom element type in the whole app is
guaranteed defined and every already-parsed instance is guaranteed upgraded — regardless of which
tag happened to be registered first. This eliminates the race outright rather than picking a side,
so the `index.js` reordering was reverted (see the comment above the field-catalog imports there)
since it was never actually load-bearing once this fix exists. The other container-capable
fields/inputs (`<sa-reference-array-field>`, `<sa-array-field>`, `<sa-array-input>`) were checked
and found NOT to need the same fix — they capture their own children unconditionally (no
duck-typing check), so their capture succeeds correctly regardless of upgrade timing; only a
component whose recognition logic depends on a child already being upgraded needs this deferral.

**Bug 2 — triple pagination: destructive re-render on a legitimate reconnect, with no guard.**
Traced to the `_reconnectAuthoredViews()` fix from the dataProvider-timing bug (above, in this same
doc): whenever `<sa-admin>`'s `dataProvider` is set after it already connected — which is the
*normal* case for every example — every already-mounted view is deliberately detached and
reattached once, so it can rebuild its `ListController`/`FormController` with the now-correct
provider. Several components' `connectedCallback` destructively rebuild DOM (append a table, a
tab-strip, a set of prev/info/next buttons) with **no guard preventing that DOM from being rebuilt
a second time** on this legitimate reconnect — since `disconnectedCallback` never removes that DOM
(it's meant to persist), a second `connectedCallback` run just appended a second copy alongside the
first, rather than replacing it. Confirmed and fixed in four components, all following the same
split — a `_domBuilt` flag (or equivalent) that gates the one-time structural DOM build, while the
data-binding `effect(...)` (which must rebind to the fresh controller on every connect) still reruns
every time:
- `src/components/list.js` — the auto-injected default `<sa-pagination>` (this is the one the
  screenshot's 3 bars trace back to: one bar rendered `0–0 of 0` on the natural first connect
  before `dataProvider` was set, the other two came from `<sa-pagination>`'s *own* separate bug
  below firing on both the first and the reconnect).
- `src/components/pagination.js` — the prev/info/next/select buttons themselves; also disconnected
  and reconnected as a descendant whenever its parent `<sa-list>` reconnects.
- `src/components/datagrid.js` — the rendered `<table>` (this is exactly the mechanism separately
  diagnosed as a jsdom-only false positive earlier in this doc — it turned out to be a real bug
  after all, just one the jsdom investigation correctly identified the *symptom* of
  [connectedCallback → disconnectedCallback → connectedCallback] without yet connecting it to the
  real-browser reconnect trigger).
- `src/components/tabbedForm.js` — the tab-strip `<div>` (latent; not directly visible in the
  reported screenshot, but the same unconditional-insert pattern, found and fixed proactively since
  the new kitchen-sink `products` form uses `<sa-tabbed-form>`).

**Also checked and found safe, no fix needed**: `src/components/show.js` (redundant refetch on
reconnect, but reuses the same child node references rather than duplicating DOM — a minor
inefficiency, not a visible bug) and `src/components/simpleForm.js` (rebuilds a fresh `FormStore`
on reconnect, which is harmless since `_ensureToolbar()` already dedupes correctly).

**One more fix bundled with the above, found separately from the screenshot**:
`src/components/filters.js` had no `disconnectedCallback` at all, so its one-time `_built` guard
never reset — meaning after the same legitimate reconnect, `<sa-filters>` never rebuilt its
`formStore`, staying bound to the *original* (now-disposed) `ListController` forever. Typing into a
filter after a reconnect would silently do nothing, since it wrote into a `filterValues` signal
nothing was still reading. Fixed with the same `_domBuilt`-once/rebind-every-connect split.

This class of bug — something that runs fine on the very first connect but breaks the moment a
component legitimately reconnects — is exactly the kind of thing static reading and even the jsdom
pass under-index on (jsdom flagged the datagrid *symptom* but not the *user-visible* consequence,
and neither testing pass exercised a provider-set-after-connect scenario against a `<sa-tabbed-form>`
or `<sa-filters>` at all). If you add a new component that destructively rebuilds structural DOM in
`connectedCallback`, apply the same split: gate the one-time DOM build behind a flag that is **never**
reset in `disconnectedCallback`, and keep only the data-binding effect(s) rebuilding on every connect.

## What's already been verified (static)

- **Syntax**: every `.js` file under `src/` (65 files) passes `node --check`. Re-run anytime with:
  ```bash
  for f in $(find src -name "*.js"); do node --check "$f" || echo "FAIL: $f"; done
  ```
- **Integration pass** (done by reading the actual code, not by running it) caught and fixed three
  real cross-agent mismatches before they could surface at runtime:
  1. `components/admin.js` set `viewEl.recordId`, but `SaEdit`/`SaShow` read `.id` — fixed to set
     `.id` (which satisfies `SaEdit`'s own accessor and falls through to the native `HTMLElement.id`
     → attribute reflection that `SaShow` reads).
  2. `core/descriptor.js`'s `descriptorFromElement()` only ever read HTML attributes, silently
     discarding a JS-config `.descriptor` object set by `admin.js` before a view element connects —
     fixed by seeding from `el.descriptor` first, then letting attributes override.
  3. JS-config `columns`/`filters`/`fields`/`inputs`/`groups`/`bulkActions` arrays (plain descriptor
     objects) were never converted into the real light-DOM elements that `<sa-datagrid>`/
     `<sa-filters>`/`<sa-simple-form>`/`<sa-tabbed-form>` actually walk — added `materializeView()`
     in `components/admin.js` to do this, so the JS-config path renders identically to hand-authored
     HTML instead of silently producing empty views.
- **Build**: `npm run build` (via `bun run build`, since `npm` segfaults in this environment — see
  below) produces `dist/simple-admin.js` (99.4 KB minified ESM) and `dist/simple-admin.css`
  (8.7 KB), both pass `node --check`/are valid CSS, from `src/index.js` and `src/theme/*.css`.
- **Four example apps** exist and are wired to the mock data provider + demo auth provider:
  `examples/html-only`, `examples/js-config`, `examples/mixed`, `examples/dist-bundle` (the last
  one imports `dist/simple-admin.js` instead of `src/index.js`, to prove the bundle is a true
  drop-in replacement for the source tree).

## jsdom functional testing

Since a real browser can't launch here, `scripts/verify-jsdom.mjs` uses **jsdom** to actually
*execute* simple-admin's logic — custom element registration, `connectedCallback` wiring, the hash
router, the reactive store, real `dataProvider` calls against the mock provider, form
validation/submit — inside plain Node. This is a genuine step up from static reading: it runs the
real code, not a description of it. It is **not** a substitute for `scripts/verify-browser.mjs`
(Playwright): jsdom does no CSS layout, and — as documented below — its custom-elements
implementation has at least one real divergence from spec-compliant browsers that produced false
positives here.

### How to run it

```bash
node scripts/verify-jsdom.mjs
```

Self-contained: it imports `src/index.js` directly (no build/serve step needed) and drives two
scenarios inside a single jsdom `window`/`document`.

### Methodology note: build the DOM bottom-up, not via `innerHTML`

The first attempt assembled the test page with a template-literal `element.innerHTML = "<sa-admin>...</sa-admin>"` string, mirroring how the example HTML files read. That produced spurious
"Unknown element `<sa-text-field>`" and "could not find a record context" warnings that don't
reflect real bugs — jsdom's HTML parser upgrades/connects custom elements as it incrementally
parses the string, so a parent (`<sa-datagrid>`) can connect and run its child-detaching logic
before children later in the same string have even been parsed into existence yet. The fix was to
build every subtree with `document.createElement()`/`appendChild()` bottom-up and connect the
**whole already-assembled tree in one single top-level `appendChild`** — which is how a JS-config
app or any programmatic DOM construction naturally works, and avoids this ordering hazard
entirely. `scripts/verify-jsdom.mjs` does this via a small `el(tag, attrs, children)` helper.
**If you write more jsdom-based tests for this project, build trees this way, not via `innerHTML`.**

### Real bug found and fixed: `<sa-admin>` ignored a `dataProvider` set after connect

**This is a genuine bug, not a test artifact, and it affects every example app in this repo as
originally written.** Confirmed and fixed during this session.

- **The bug**: `SaAdmin.connectedCallback` read `this._dataProvider`/`this._authProvider` exactly
  once, at connect time, and never again. But every example (`examples/html-only`,
  `examples/mixed`, `examples/dist-bundle`) declares `<sa-admin id="admin">` as **static HTML
  markup**, then a *later* `<script type="module">` line does `admin.dataProvider = ...`.
  `<script type="module">` is always deferred (runs after the document finishes parsing), so by
  the time that assignment happens, `customElements.define('sa-admin', ...)` — triggered by the
  `import '.../index.js'` line just above it in the same script — has *already* upgraded the
  already-parsed `<sa-admin>` element and fired `connectedCallback()` once, with no provider yet.
  The subsequent `admin.dataProvider = ...` was a plain property write with no effect on the
  already-published (null) provider or the already-mounted (broken) views. This is standard custom
  elements upgrade timing, not a jsdom quirk — it reproduces in any spec-compliant browser too.
- **How jsdom caught it**: `scripts/verify-jsdom.mjs`'s "Scenario A" reproduces the exact real
  ordering (connect the element first, assign `.dataProvider` afterward) and asserts the list
  actually populates. It failed before the fix (0 rows, stuck on the `no-data-provider` diagnostic
  forever) and passes after.
- **The fix** (`src/components/admin.js`): `dataProvider`/`authProvider`/`descriptor` setters now
  call a new `_rebootProviders()` method whenever they're set on an *already-connected* element —
  it re-publishes to the registry singleton and re-runs the current route. For the JS-config path
  this is sufficient (views are always freshly created on each route mount). For the
  HTML-authoring path, already-connected `<sa-list>`/`<sa-show>`/`<sa-create>`/`<sa-edit>` elements
  had already run their one-shot `connectedCallback` (and, for `<sa-list>`, already issued one
  failed `getList` call) — re-publishing the singleton alone doesn't make them retry. A new
  `_reconnectAuthoredViews()` forces a synchronous detach+reattach of each currently-declared view
  element, which cleanly re-triggers its own `disconnectedCallback`/`connectedCallback` (every view
  component already resets its build state in `disconnectedCallback`, since that pattern already
  existed for other reasons — see `_docs/internals/03-component-lifecycle-and-context.md`).
- **Verified fixed**: `node scripts/verify-jsdom.mjs` Scenario A — "late-connect: missing
  dataProvider is diagnosed, not thrown" and "setting `.dataProvider` AFTER connect still populates
  the list (reboot fix)" both pass.

### A diagnosed (not fixed) jsdom-specific false positive: spurious reconnect on `<sa-datagrid>`

With the `innerHTML`-ordering issue and the dataProvider-timing bug both resolved, Scenario B (a
full posts/authors app, built bottom-up, dataProvider set before connecting) still logs "Unknown
element `<div>`/`<table>` inside `<sa-datagrid>`" warnings. This was investigated to ground truth
with a minimal, instrumented repro (temporarily logging inside `connectedCallback`, reverted
afterward — not left in the source) rather than left as a guess:

```
DATAGRID connectedCallback call, _built=undefined children=SA-TEXT-FIELD
DATAGRID connectedCallback call, _built=false        children=DIV,TABLE
```

**jsdom fires `connectedCallback` → `disconnectedCallback` → `connectedCallback` again on the same
`<sa-datagrid>` element as part of a single bulk subtree-insertion.** `SaDatagrid`'s own
`_built` guard (`src/components/datagrid.js`) is correct and does exactly what it's supposed to:
the *first* call builds the real `<table>` from the real `<sa-text-field>` template; jsdom then
spuriously disconnects the element (resetting `_built` back to `false`, exactly as a legitimate
disconnect should), so the *second* call proceeds again — this time finding its own
just-rendered `<div>`/`<table>` as "current children" and (correctly, given what it sees) warning
that they're not registered fields, then rebuilding a fresh, correct table from the still-held
`_fieldTemplates` reference. **The final rendered state is functionally correct** — this is
believed to be a genuine jsdom implementation quirk in how it processes custom element reactions
for deeply-nested subtrees inserted in one operation, not a bug in the library. This should be
re-confirmed with `scripts/verify-browser.mjs` once real browser testing is available — if the
warning does *not* appear there, that confirms it's jsdom-only noise.

### What jsdom testing did **not** get to confirm this pass

The same Scenario B run also showed `<sa-filters>`/`<sa-search-input>` and `<sa-reference-field>`
symptoms consistent with the same class of jsdom reconnect quirk (a "not inside a form" warning
for an input that *is* inside `<sa-filters>` in the source tree; an empty reference-field text
instead of a resolved author name) — plausible, but **not independently root-caused** the way the
datagrid case was, given time constraints. Likewise, the run stalled/did not finish reaching the
create-form → save → bulk-delete portion of the script in the final pass (no crash was printed; it
either hung or was simply slow — not diagnosed further this session). Treat the following as
**still open, not confirmed either way**, and prioritize them when `scripts/verify-browser.mjs`
becomes runnable:

- Whether `<sa-reference-field>`/`<sa-reference-input>` and `<sa-filters>` are affected by the same
  spurious-reconnect class of issue, or have their own real bug.
- The full create → validate → save → redirect → bulk-delete flow (the sort and initial-list-load
  checks did pass in Scenario B before the run stalled).
- Whether the stall in `scripts/verify-jsdom.mjs` is a jsdom-environment issue (a timer/microtask
  that never resolves in jsdom's event loop) or a genuine hang — `scripts/verify-browser.mjs` in a
  real browser is the more trustworthy way to check this, since it doesn't share jsdom's runtime
  quirks at all.

## Why real-browser verification wasn't run now

Two blockers, both environment-specific to this sandbox, not the code:

1. **`npm` segfaults** (exit code 139) on every invocation, including `npx`. Worked around by using
   `bun` instead (`bun add -D esbuild`, `bun add -D playwright`, `bun run build` all work fine).
2. **Chromium cannot launch** under this sandbox's macOS Seatbelt profile:
   `Check failed: kr == KERN_SUCCESS. bootstrap_check_in ... Permission denied (1100)` — a mach-port
   IPC rendezvous the browser needs during startup is denied at the OS level, independent of
   Playwright's own `--no-sandbox` flag. This reproduced identically whether or not the Bash tool's
   own sandbox was disabled, meaning it's the host's Seatbelt policy, not something to route around
   from inside the session.

Playwright (`^1.61.1`) and a downloaded Chromium build are already installed as devDependencies in
this repo (`node_modules/.bin/playwright`, browser cached under
`~/Library/Caches/ms-playwright/chromium-1228`), so no re-setup should be needed to run this in an
environment that can actually launch a browser (a normal dev machine, CI, etc.).

## How to run it later

```bash
# 1. Build the dist bundle (only needed once, or after any src/ change)
node scripts/build.mjs

# 2. Serve the repo root (any static file server works; python's is dependency-free)
python3 -m http.server 8934 &

# 3. Drive all four examples through the same scripted scenario
node scripts/verify-browser.mjs http://localhost:8934
```

`scripts/verify-browser.mjs` (already written, `node --check`-clean) drives each of the four
examples through:

1. Initial page load — screenshot, collect `console` output and any `pageerror`s.
2. Login with the demo credentials (`admin` / `admin`, from `src/auth/localAuthProvider.js`).
3. Wait for the posts list to render — record the row count.
4. Click a sortable column header — screenshot, confirm no crash/console error.
5. Type into the search filter — wait past the 500ms debounce — record the filtered row count,
   then clear it.
6. Read a `<sa-reference-field>`'s text content — it must show the related author's **name**, not
   the raw `author_id`, proving the `getMany` batching path resolved correctly.
7. Navigate to `#/posts/create`, click Save with empty required fields — confirm a
   `.sa-input__error` message appears (validation pipeline fires) rather than a silent no-op or a
   thrown exception.
8. Fill the required field(s) and Save for real — confirm the URL redirects back to the list
   (`redirect: 'list'` default) and a new row exists.
9. Select a row's checkbox and click the bulk-delete button — confirm the row count drops by one
   and `dataProvider.deleteMany` was exercised.

Output: a screenshot per step per example under `scripts/.verification-output/` (gitignored) and a
combined `report.json` with row counts, the reference-field text, the validation error text, and
any collected console/page errors. **`[simple-admin]` `console.warn`/`console.error` diagnostic
lines are expected and fine** (see `src/core/diagnostics.js`) — what to actually fail the check on
is any `pageerror` (uncaught exception) entry, or a `driverError` field in the report meaning the
script itself couldn't find an expected element.

## Known gaps to specifically look for when this runs

These weren't exercised by static reading and are the most likely place a real bug would surface:

- **Datagrid keyed row reconciliation** under real re-renders (sort/filter/bulk-delete all replace
  `data`) — confirm rows don't duplicate, lose their per-row `RecordContext`, or leak listeners.
  Toggle sort back and forth a few times and watch `rowCount` stays stable.
- **`ReferenceInput`/`ReferenceArrayInput` delegate pattern** (`src/inputs/referenceShared.js`'s
  `patchChildAsDelegate`) — confirm selecting a value in the nested `sa-select-input`/
  `sa-autocomplete-input` actually commits back to the parent `sa-reference-input`'s FormStore
  entry (i.e. the saved record's `author_id` is correct, not `undefined`).
- **`SaSimpleForm`/`SaTabbedForm` connect-ordering assumption** (documented in `simpleForm.js`) —
  confirm inputs declared in markup reliably find `this.formStore` on first connect; if this ever
  breaks it would show up as inputs silently not registering (a value never reaching the FormStore,
  or a `[simple-admin] input-no-form` warning that shouldn't be there).
- **`arrayInput.js`'s full-rebuild-on-length-change** — add/remove a row in an `<sa-array-input>` a
  few times (not exercised by the example apps yet — none of them declare one) and confirm rows
  don't lose in-progress edits unexpectedly.
- **Auth guard redirect loop** — log out, confirm landing on `#/login` and not a redirect loop;
  hit a protected `#/posts` URL directly while logged out, confirm it redirects to login rather than
  flashing the list.
- **`examples/dist-bundle`** specifically — confirm it behaves identically to `examples/html-only`
  (same markup, different script source), since that's the concrete proof the two-file build is a
  true drop-in.

## After this runs

Fold any real bugs found into the source, re-run `node scripts/build.mjs`, and re-run this plan
once clean. At that point this document can be trimmed down to just the "how to run it" recipe for
regression-testing future changes.
