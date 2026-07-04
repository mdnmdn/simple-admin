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

## Real-browser verification pass (Chromium/Playwright) — bugs found and fixed

This pass finally ran the examples in a real Chromium (headless, Playwright), focusing on
`examples/theme-switcher` and then re-verifying with `scripts/verify-jsdom.mjs` (now 13/13) and
the other examples. Every fix below was diagnosed against the running browser (CDP pause for the
freeze; temporary `signal.js` instrumentation for the effect loop), then confirmed fixed in both
Chromium and jsdom.

### 1. Page FROZE on list -> edit transitions (infinite remount loop) — the big one

Navigating between views of the same resource (e.g. `#/products` -> `#/products/1`, exactly what
`row-click="edit"` does) hard-froze the tab: the main thread never yielded again. Root cause: the
`<sa-admin>` route effect ran `_handleRoute()` synchronously inside its own tracking window, so
ANY tracked signal read during view mounting subscribed the ROUTE EFFECT itself. Reference/array
inputs' `renderControl()` reads `formStore.getField()` (a tracked `values.get()`) synchronously at
connect — so the route effect became a subscriber of the form's `values` signal; mounting also
WRITES `values` (`<sa-create>`'s record reset, `default-value` seeding), which re-queued the route
effect -> full remount -> same writes -> infinite microtask flush loop. Resources whose forms had
no reference/array inputs (authors) didn't trigger the read and were immune — products/posts froze.
**Fix**: new `untracked()` primitive in `core/signal.js` (masks `currentEffect` AND the effect
stack, so nested `effect()` creation can't resurrect the outer effect); the route effect now runs
`untracked(() => this._handleRoute(route))` — it depends on the route and nothing else. This also
unblocked `verify-jsdom.mjs`, which was hanging forever in the same loop (its Scenario B filter
interaction), never reaching its last six checks.

### 2. Reference/array fields rendered raw ids in datagrid rows (template lost on clone)

`sa-reference-field`/`sa-reference-array-field`/`sa-array-field` captured their authored child
templates into an instance property (`this._templateChildren`) and DETACHED them. `<sa-datagrid>`
stamps rows with `template.cloneNode(true)` — which copies DOM only, not instance properties — so
every row clone arrived template-less and fell back to rendering the raw id ("1" instead of
"Electronics"). **Fix**: `src/fields/templateChildren.js` — the captured template now lives in an
inert `<template data-sa-template>` CHILD (part of the DOM, deep-cloned with the element); render
passes clear around it and clone from its content.

### 3. Typing into filters did nothing (stale FormStore binding), and `q` wasn't full-text

Two independent halves. (a) `<sa-filters>` rebuilt its adapter `formStore` on every reconnect,
while a child input caches `this._form` at ITS connect — custom-element reaction batches during
boot can interleave so the input's last bind lands between two `<sa-filters>` reconnects, leaving
it committing into the previous, already-disposed ListController. **Fix**: one stable adapter per
element that dereferences `this._listController` at call time. The same stale-binding class was
then applied to `sa-simple-form`/`sa-tabbed-form` (one `FormStore` per element, reused across
reconnects; per-mount record state via `formStore.reset()`), which fixed validateAll seeing an
empty registry in jsdom. (b) `examples/mock-data-provider.js` treated `q` as a literal record
field; it now does react-admin-style full-text matching across string fields.

### 4. Failed submits showed no validation errors

`validateAll()` set errors but never touched fields, and inputs only DISPLAY an error once its
field is touched — so submitting a pristine form with missing required fields showed nothing.
**Fix**: `validateAll()` now marks every registered source touched (react-admin submit semantics).

### 5. Startup console noise (errors + ~40 warnings) on the documented boot pattern

The documented HTML-authoring boot (`admin.dataProvider = ...` after the import that upgrades the
tree) always logged `no-data-provider`, five `provider-method-missing` errors, and dozens of
`field-no-record-context`/`input-no-form` warnings before the reboot fix re-mounted everything.
All were transient false alarms. **Fixes**: one-microtask grace before the `no-data-provider`
diagnostic (admin.js); `runFetch` re-reads the registry provider and retries once before
diagnosing (store.js); fields/inputs retry context lookup once per connect, and never warn for
inert template markup (parked authored host, `display:none` sibling views, datagrid column
templates awaiting capture) or when a form host element exists but hasn't wired yet. A genuinely
misplaced field/input still warns. The theme-switcher example now boots with a fully clean console.

### verify-jsdom.mjs hardening (test-artifact fixes, found while chasing the above)

Document-order `querySelector`s were hitting parked duplicates (first `sa-reference-field` was a
parked template; first checkbox belonged to the hidden authors list), the reference-resolution
check raced its fixed 300ms sleep (now polls), and the bulk-delete check compared rendered row
counts — meaningless when more records than the page size exist (now compares provider totals).
Selectors are now scoped to `.sa-content`. Result: 13/13.

### 6. JS-config datagrids rendered entirely blank cells (cloneNode drops JS descriptors)

A JS-config resource's datagrid rendered the right number of rows with correct headers but EVERY
cell was empty, plus one `field-missing-source` error per column. Root cause is the cloneNode
family again: a JS-config-materialized field carries its `source`/type/etc. ONLY on its
`_descriptor` JS property (admin.js's `createFieldElement` sets `el.descriptor = {...}`, no
reflecting attribute), and `<sa-datagrid>` stamps each row with `cloneNode(true)`, which copies DOM
+ attributes but never JS state. HTML-authored fields were unaffected (their `source="..."`
attribute IS cloned and BaseField rebuilds `_descriptor` from it). **Fix**: `cloneWithDescriptors`
(templateChildren.js) walks the original and clone in lockstep and re-attaches each field's
descriptor; the datagrid uses it for every column clone. Two follow-on issues surfaced and were
fixed: (a) cloned `<template>` content is INERT — custom elements inside are never upgraded, so
setting `.descriptor` on them created a shadowing expando the constructor clobbered on upgrade;
`BaseField`/`BaseInput` now run `upgradeProperty(this, 'descriptor')` in connectedCallback (the
same lazy-property shim already used for `record`/`id`/`resource`) so a descriptor assigned
pre-upgrade survives. (b) The composite fields (reference/reference-array/array) now capture their
child template as a plain DESCRIPTOR TREE on `_descriptor.children` (read from live upgraded
children at connect — works for both syntaxes) and rebuild fresh child elements from it each render,
instead of cloning inert `<template>` content — so a JS-config `<sa-reference-field>`'s nested
display field resolves correctly inside a datagrid row.

### 7. `<sa-show>` was permanently stuck on "Loading…" when deep-linked / refreshed

Opening a detail URL directly (`#/products/1/show`) — or refreshing the page while on one — left the
show view frozen on its "Loading…" placeholder with no fields, in every HTML-authored example. Cause:
`SaShow` re-read `this.childNodes` into `_pending` on EVERY connect and detached them, but the boot
sequence disconnects+reconnects the view (the dataProvider-set reboot's `_reconnectAuthoredViews`,
and the resource host being moved into `.sa-content`). The first connect detached the field template
children; the reconnect then captured an empty child set and could never render them. **Fix**: the
field templates are captured ONCE into a persistent instance array (like `<sa-datagrid>`'s
`_fieldTemplates`) that survives reconnects; each connect re-detaches current content and re-runs the
load, re-appending the preserved templates once the record resolves. Also gave `<sa-show>`/`<sa-edit>`
the same one-microtask provider grace as the list controller so a deep-linked view no longer logs a
transient `getOne is not a function` at boot.

### verify-browser.mjs: made the harness actually pass on the working examples

The Playwright harness reported false failures (login input "not visible" timeouts) for
`html-only`/`mixed`/`dist-bundle`: its `input[type="text"]`/`sa-datagrid-row`/`sa-save-button`
selectors used `.first()` with no visibility scoping, so they matched hidden PARKED view-template
elements (create/edit forms and non-active resource lists stay connected but `display:none`) instead
of the live login form / mounted view. Scoped every interaction selector to the visible `<sa-login>`
form or `.sa-content` (the mounted view) and to `>> visible=true`, and made the validation-error
check take the first NON-EMPTY error span. With this (and the source fixes above) all four examples
drive cleanly: list, sort, filter, reference resolution, create+validation+save, and bulk delete,
with zero `pageerror`s and no unexpected `[simple-admin]` errors.

## After this runs

Fold any real bugs found into the source, re-run `node scripts/build.mjs`, and re-run this plan
once clean. At that point this document can be trimmed down to just the "how to run it" recipe for
regression-testing future changes.
