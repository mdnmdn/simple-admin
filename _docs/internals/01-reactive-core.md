# 01 — The Reactive Core (signals, controllers, no-vdom rendering)

**Audience:** an engineer maintaining or extending simple-admin's core. This document
explains *how the reactivity actually works at runtime* — the dependency-tracking algorithm,
the controllers layered on top, and the way components mutate real DOM without a virtual DOM.
It is not a how-to; for usage see `_docs/manual/`. Everything below refers to the real source
in `src/core/signal.js`, `src/core/store.js`, `src/components/datagrid.js`,
`src/fields/baseField.js`, and `src/inputs/baseInput.js`. Where the earlier design docs and the
shipped code disagree, the code wins and is flagged.

---

## 1. The primitive: `signal` / `computed` / `effect`

The entire reactive layer is 97 lines in `src/core/signal.js`. There are three module-level
pieces of state and three exported factories. Understand the state first:

```js
let currentEffect = null;
const effectStack = [];

let pending = new Set();
let flushScheduled = false;
```

- `currentEffect` is the effect *currently executing its body*. It is the whole
  dependency-tracking mechanism: a signal read consults this global to learn who is reading it.
- `effectStack` supports **nested** effects (an effect whose body constructs another effect, e.g.
  `computed` used inside an effect). On exit, `currentEffect` is restored to the stack top rather
  than blindly nulled.
- `pending` is the batch: the set of effect runners that need to re-run on the next flush.
- `flushScheduled` de-dupes the microtask so N `.set()`s schedule exactly one flush.

### 1.1 A signal is a closure over `value` + a subscriber `Set`

```js
export const signal = (initial) => {
  let value = initial;
  const subscribers = new Set();

  const self = {
    get() {
      if (currentEffect) {
        subscribers.add(currentEffect);
        currentEffect._deps.add(subscribers);
      }
      return value;
    },
    peek() { return value; },
    set(next) {
      if (Object.is(next, value)) return;
      value = next;
      for (const runner of subscribers) pending.add(runner);
      scheduleFlush();
    },
    update(fn) { self.set(fn(value)); },
  };
  return self;
};
```

Three load-bearing details:

1. **`get()` is the tracking point.** If a read happens while some effect is running
   (`currentEffect !== null`), the signal records that effect in its `subscribers`, *and* the
   effect records this signal's subscriber set in its own `_deps`. The relationship is stored on
   **both** sides — the signal knows who to notify, the effect knows which sets to detach from on
   cleanup. Reads outside any effect (`currentEffect === null`) establish no dependency.
2. **`peek()` reads without subscribing.** This is used everywhere a controller needs the current
   value but must *not* create a dependency — see the mutators in `store.js` (`filterValues.peek()`,
   `sort.peek()`), which read-modify-write without making the mutator itself reactive.
3. **`set()` is guarded by `Object.is`.** An idempotent set (same value) is a complete no-op: no
   notify, no flush. This is why passing a fresh object with equal contents *does* re-notify (new
   identity) but re-setting the same primitive does not. It also short-circuits feedback loops
   where an effect writes back the value it just read.

### 1.2 `effect` — the runner, tracking, and dynamic dependencies

```js
export const effect = (fn) => {
  const runner = {
    _deps: new Set(),
    _active: true,
    _run() {
      if (!this._active) return;
      unlink(this);                 // drop last run's dependencies
      currentEffect = this;
      effectStack.push(this);
      try { fn(); }
      finally {
        effectStack.pop();
        currentEffect = effectStack.length ? effectStack[effectStack.length - 1] : null;
      }
    },
  };
  runner._run();                    // run once immediately to collect deps
  return () => {                    // teardown
    if (!runner._active) return;
    runner._active = false;
    unlink(runner);
    pending.delete(runner);
  };
};
```

`unlink(runner)` at the *top* of every run is what makes the dependency graph **dynamic**:

```js
const unlink = (runner) => {
  for (const subscribers of runner._deps) subscribers.delete(runner);
  runner._deps.clear();
};
```

Each run discards the previous run's subscriptions and rebuilds them from scratch based on which
`get()`s actually executed *this* time. So an effect with a branch (`if (a.get()) b.get()`) only
stays subscribed to `b` while the branch is taken. There is no stale-dependency accumulation.

The returned teardown is the only leak-prevention mechanism in the system: it flips `_active`
(so a queued `_run()` becomes a no-op), unlinks all subscriptions, and removes the runner from any
in-flight `pending` batch. Every long-lived consumer — controllers, `BaseField`, `BaseInput`,
`SaDatagrid` — stores this teardown and calls it on disconnect. Failing to call it is the classic
leak (see §6).

### 1.3 The flush: microtask batching

```js
const scheduleFlush = () => {
  if (flushScheduled) return;
  flushScheduled = true;
  queueMicrotask(flush);
};

const flush = () => {
  flushScheduled = false;
  const toRun = pending;
  pending = new Set();
  for (const runner of toRun) runner._run();
};
```

`flush` **swaps the batch out** (`toRun = pending; pending = new Set()`) before iterating, so any
`.set()` triggered *by* a re-running effect accumulates into a *fresh* `pending` for a *subsequent*
flush rather than mutating the set being iterated. This is the mechanism behind the computed lag in
§2 — keep it in mind.

Iteration order is `Set` insertion order, which is the order runners were `pending.add()`ed, which
is the order they appear in each signal's `subscribers` set, which is *read/subscription order*.
It is deterministic but incidental — do not write code that depends on two independent effects
running in a particular order.

### 1.4 Step-by-step: what one `.set()` does

Given `count.set(5)` while `count` currently holds `4` and two effects `A`, `B` subscribe to it:

1. `Object.is(5, 4)` is false → proceed.
2. `value = 5`.
3. For each subscriber (`A`, `B`) → `pending.add(runner)`. `pending = {A, B}`.
4. `scheduleFlush()` → `flushScheduled` was false → set true, `queueMicrotask(flush)`.
5. If more sets happen this same synchronous tick (`count.set(6)`, `other.set(...)`), they add to
   the *same* `pending` set and `scheduleFlush()` early-returns because `flushScheduled` is already
   true. **N synchronous sets = 1 flush.**
6. The tick ends; the microtask runs. `flush` grabs `toRun = {A, B}`, resets `pending` and
   `flushScheduled`, then runs `A._run()` and `B._run()` — each of which unlinks, re-tracks, and
   re-executes its body with `value === 5` (or `6`, whatever the last set was — intermediate values
   never render).

The practical guarantee for the rest of the codebase: **state settles synchronously, DOM settles on
the next microtask, and only the final value of each signal is ever observed by an effect.**

---

## 2. Known characteristic: `computed` propagates one microtask behind its source

The foundation-layer implementer flagged that a `computed` can lag its source by one microtask.
This is **still true in the shipped code**, and it is a direct consequence of `computed` being
built *out of* an `effect` + a `signal` rather than being a first-class primitive:

```js
export const computed = (fn) => {
  const cell = signal(undefined);
  effect(() => { cell.set(fn()); });   // recompute-and-store on every source change
  return { get: () => cell.get(), peek: () => cell.peek() };
};
```

A `computed` is therefore a *two-hop* node: `source signal → (effect) → cell signal → downstream`.
Walk the timing when a source `S` changes and both a plain effect `E1` (reads `S`) and a downstream
effect `E2` (reads the computed's `cell`) exist:

1. `S.set(x)` queues `S`'s subscribers into `pending`. Those subscribers are `E1` and the
   computed's internal recompute-effect `Cr` — **not** `E2` (E2 subscribes to `cell`, not `S`).
2. **Flush #1** runs `E1` (sees the new value) and `Cr`. `Cr` calls `cell.set(fn())`. Because we are
   *inside* `flush`, `cell.set` adds `cell`'s subscriber `E2` to the freshly-swapped `pending` and
   calls `scheduleFlush()` — which queues a **second** microtask.
3. **Flush #2** (next microtask) runs `E2` with the updated computed value.

So an effect reading a raw signal updates in flush #1, while an effect reading a computed derived
from that same signal updates in flush #2 — one microtask later.

**When it actually bites:** only when a *single* effect reads **both** a raw signal *and* a computed
derived from it, and needs them mutually consistent within one render. Such an effect runs in flush
#1 seeing `new raw value + stale computed`, then re-runs in flush #2 with the computed caught up —
a one-frame visual glitch and a redundant render.

**Why it is benign in this codebase as written:** the derived values are `dirty` and `isValid` in
`createFormController` (§3.2). No single effect reads both `values`/`errors` *and* their derived
`dirty`/`isValid` — inputs read the raw signals; form-level chrome reads the computeds. The two
never mix in one effect, so the lag is never observable. The system is also *eventually consistent*
regardless: everything converges within one extra microtask, and `Object.is` guards suppress
redundant downstream work if the computed's value did not actually change.

**Mitigation for a future contributor:** if you add an effect that must see a signal and its
computed atomically, don't read the `computed` — read (or `peek()`) the underlying source and derive
inline, or hoist the derivation into the same effect. Do **not** try to "fix" `computed` to be
synchronous without understanding that its glitch-freedom and its lag are the same property.

A second characteristic worth knowing: `computed` is **eager, not lazy**. Its recompute-effect runs
on *every* source change whether or not anyone reads the result, and it **has no teardown** — the
factory returns only `{ get, peek }`, so the internal effect subscribes to its sources for the life
of the process. For controller-scoped computeds (form lifetime) this is fine; creating computeds
dynamically in a hot path would leak (see §6).

---

## 3. The controllers: `ListController` and `FormController`

`src/core/store.js` builds two per-view controllers entirely out of the primitive above. It imports
`signal, computed, effect` and nothing from the provider layer — an important boundary (see §3.3).

### 3.1 `createListController` — signals and refetch triggers

The controller holds these signals (all in `store.js`):

`data`, `total`, `pageInfo`, `isPending`, `error`, `page`, `perPage`, `sort`, `filterValues`,
`selectedIds`. Plus three non-reactive locals: `currentAbort`, `debounceTimer`, `disposed`.

Refetching is driven by **two effects with different scheduling policies**:

```js
let started = false;
const disposePaging = effect(() => {
  page.get(); perPage.get(); sort.get();
  if (started) scheduleFetch(false);      // immediate
});
const disposeFilters = effect(() => {
  filterValues.get();
  if (started) scheduleFetch(true);       // debounced
});
started = true;
runFetch();                                // exactly one initial fetch
```

The `started` flag is the trick that avoids a fetch storm on construction: both effects run once
immediately (that's how `effect` collects dependencies), but while `started` is false they only
*subscribe* and skip `scheduleFetch`. After both are wired, `started` flips true and a single
explicit `runFetch()` performs the one initial load. From then on:

- Changing `page`, `perPage`, or `sort` → `scheduleFetch(false)` → **immediate** `runFetch()`.
- Changing `filterValues` → `scheduleFetch(true)` → `runFetch` deferred behind a `setTimeout` of
  `FILTER_DEBOUNCE_MS = 500`. This value is deliberate: it matches react-admin's default filter
  debounce so typing in a filter box coalesces keystrokes into one request 500 ms after the user
  stops. `scheduleFetch` clears any prior timer first, so each keystroke resets the window.

Note the mutators encode react-admin's UX conventions: `setPerPage` and `setFilters`/`setFilterValue`
all reset `page` to 1 (changing page count/filters while on page 7 would otherwise 404 you into an
empty page); `setSort` toggles ASC/DESC when you click the already-sorted column.

Because `page.set(1)` fires alongside `filterValues.set(...)` in `setFilterValue`, both the paging
effect and the filter effect are queued. The paging effect would schedule an *immediate* fetch and
the filter effect a *debounced* one — but `scheduleFetch` clears the pending timer on each call, and
both effects run in the same flush; the net observable behaviour is one debounced fetch when the page
was already 1, and an immediate fetch (from the paging effect) plus a cleared debounce otherwise.
When maintaining this, remember both effects fire on a combined filter+page change and reason about
`scheduleFetch`'s clear-then-set as the coordination point.

### 3.1.1 Abort-on-refetch

Every `runFetch` supersedes the one before it:

```js
if (currentAbort) currentAbort.abort();
const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
currentAbort = ac;
...
const result = await dataProvider.getList(resource, { ..., signal: ac ? ac.signal : undefined });
if (disposed || (ac && ac.signal.aborted)) return;   // stale response guard
```

The `signal` is threaded into the provider call so a well-behaved provider actually cancels the HTTP
request. Independently, the post-await guard (`disposed || ac.signal.aborted`) drops any response —
success *or* error — that belongs to a superseded fetch, so late responses never clobber `data`.
`AbortController` is feature-detected (`typeof ... !== 'undefined'`) so the controller degrades in
environments without it (the guard then relies only on `disposed`). `dispose()` aborts the in-flight
request, clears the debounce timer, and tears down both effects.

### 3.2 `createFormController` — the centralized FormStore

The form is *not* per-input state; it is one store that every `<sa-*-input>` reads from and writes to
by `source` string. Signals: `values`, `errors`, `touched`, `initial`. Plus a plain `Map` `registry`
(`source → { defaultValue, validators, parse, format }`) — the registry is intentionally **not**
reactive; it is structural metadata, changed only on input connect/disconnect.

- **Read/write:** `getField(source)` does a reactive `getByPath(values.get(), source)` (dot-path
  aware); `setField` does `values.set(setByPath(values.peek(), source, value))` then immediately
  `validateField(source)`. Writes use `peek()` (not `get()`) so the mutator isn't itself reactive,
  and produce a **new** `values` object each time so the `Object.is` identity guard passes and
  subscribers re-run.
- **Validation model:** `validateField` pulls the source's validators from the registry, runs them
  in order against `(value, allValues, { source })`, stops at the first that returns something, and
  writes a new `errors` object (adding or deleting the one key). Validators are eager per-field on
  every `setField`. `validateAll` iterates the whole registry and returns a boolean — used on submit.
- **Dirty / valid tracking** are the codebase's only two `computed`s:

  ```js
  const dirty = computed(() => stableStringify(values.get()) !== stableStringify(initial.get()));
  const isValid = computed(() => Object.keys(errors.get()).length === 0);
  ```

  `dirty` compares a stable serialization of `values` against `initial` (the seed captured at
  construction and re-captured on `reset`), so key ordering doesn't produce false positives. Note the
  §2 lag applies here: `dirty`/`isValid` settle one microtask after `values`/`errors`. That is why
  submit logic calls `validateAll()` (synchronous, returns a boolean) rather than reading `isValid`.
- **Registration:** `register(source, opts)` records metadata and, only if the field has a
  `defaultValue` and `values` has no value at that path yet, seeds *both* `values` and `initial`
  (so a defaulted-but-untouched field is not counted dirty). `unregister` just drops the registry
  entry — it does **not** delete the value from `values` (a removed input keeps its data, matching
  react-admin's unmount behaviour).

### 3.3 Cache and batcher: available vs. wired

This is a common source of confusion, so it is stated plainly. `store.js` imports **nothing** from
`src/providers/`. Neither the query cache nor the getMany batcher participates in `ListController`
or `FormController`.

- **`createQueryCache` (`providers/cache.js`)** is a `Map`-based, manually-invalidated query cache.
  It is *exported publicly* (`src/index.js` re-exports it) so an application's dataProvider can wrap
  itself with it, but **nothing in the framework internals references it** (`grep` for
  `createQueryCache` finds only its definition and the public re-export). It is a provided building
  block, not an active layer.
- **`createGetManyBatcher` (`providers/batcher.js`)** *is* actively wired — but at the **field/input**
  layer, not in the controllers. `src/fields/referenceField.js` and `src/inputs/referenceShared.js`
  each keep a lazily-created batcher *per reference resource* (`batchersByReference` map) so that
  multiple `<sa-reference-field>`s pointing at the same resource in the same tick coalesce into one
  `dataProvider.getMany(reference, { ids })`. The batcher's own `queueMicrotask`-based flush
  (`buckets` keyed by reference, one `getMany` per bucket at end-of-tick) is the N+1 avoidance that
  react-admin gets from react-query. If you are tracing a reference lookup, look in the reference
  field/input, not in `store.js`.

---

## 4. The no-vdom rendering model in practice

There is no virtual DOM, no diffing of trees, no `innerHTML` re-render of containers. Instead every
piece of DOM that depends on state sits inside an `effect`, and the effect body performs the
**minimal imperative mutation** to bring that one node into line. Reactivity granularity is chosen
per component. Three granularities coexist:

### 4.1 A single node: `<sa-text-field>` via `BaseField`

`BaseField` (`src/fields/baseField.js`) gives every field a render effect established in
`connectedCallback`:

```js
this._recordCtx = findRecordContext(this);
...
this._dispose = effect(() => {
  this._version.get();                       // dependency: descriptor version
  const value = this.getValue();             // getByPath(record, source)
  if (value == null || value === '') this.renderEmpty(this.emptyText);
  else this.renderValue(value, this._recordCtx.record);
});
```

For a plain text field, `renderValue` is just `this.textContent = String(value)`. The effect's *only*
reactive dependency is `this._version` — a `signal(0)` bumped (via `_scheduleRender`) whenever the
descriptor changes through an attribute or the `.descriptor` setter. Crucially, **`getValue()` reads
a plain record object, not a signal** — `findRecordContext` returns `{ record }`, an ordinary object.
So a field re-renders on *descriptor* changes but is **not** independently reactive to record content
changes; reactivity to data lives one level up (§4.2). This is the single most surprising fact about
the field layer and it drives the gotcha in §6.

`_scheduleRender` itself is a two-microtask affair: it debounces multiple attribute writes into one
`_version.set(+1)` on the next microtask, and that set schedules the effect flush on the microtask
after — so a batch of attribute changes produces exactly one re-render.

### 4.2 Keyed rows: `<sa-datagrid>` reconciliation

The datagrid (`src/components/datagrid.js`) is where "targeted patching without a vdom" is most
visible. It wires **two** effects (`_wireEffects`), each with a distinct concern:

```js
this._disposeData = effect(() => {
  const rows = this._listController.data.get();   // dep: list data
  this._reconcileRows(rows);
});
this._disposeSelection = effect(() => {
  const selected = this._listController.selectedIds.get();  // dep: selection
  this._toolbar.hidden = selected.length === 0;
  for (const [id, row] of this._rowMap) { row.classList.toggle('...--selected', ...); ... }
});
```

Data changes and selection changes are **orthogonal** — a selection toggle never touches row DOM
structure, and a data refetch never rebuilds the toolbar. Splitting them into two effects means each
does the least work and neither invalidates the other.

`_reconcileRows` is a keyed diff against a `Map` (`_rowMap: id → <sa-datagrid-row>`):

```js
const nextIds = new Set(rows.map((r) => r.id));
for (const [id, row] of Array.from(this._rowMap)) {          // 1. remove stale
  if (!nextIds.has(id)) { row.remove(); this._rowMap.delete(id); }
}
let cursor = this._tbody.firstChild;                          // 2. reuse/move/insert
for (const record of rows) {
  let row = this._rowMap.get(record.id);
  if (!row) { row = this._createRow(record); this._rowMap.set(record.id, row); }
  else { row.record = record; }
  if (cursor !== row) this._tbody.insertBefore(row, cursor);
  else cursor = cursor.nextSibling;
}
```

New ids get a fresh `<sa-datagrid-row>`; departed ids are removed; surviving ids are moved into the
right position with `insertBefore` (and skipped when already in place). No row is destroyed and
recreated just because its neighbours changed — this preserves per-row DOM state (checkboxes, focus)
across sort/filter.

Each `<sa-datagrid-row>` publishes `__recordContext = { record }` **before** its cloned field cells
connect (the `record` setter runs in `_createRow` prior to `appendChild`), so when a cloned
`<sa-text-field>` fires *its* `connectedCallback`, `findRecordContext` walks up to the row and
resolves the correct per-row record. The field's own render effect (§4.1) then renders that cell —
independently of, and with no coordination with, the reconciliation effect. Row reconciliation owns
row identity and order; each field owns its cell's content. They compose because they operate on
disjoint DOM and read disjoint signals.

### 4.3 Per-input independent effects: `<sa-simple-form>`

Every `<sa-*-input>` (via `BaseInput`, `src/inputs/baseInput.js`) locates the shared FormStore by
ancestry (`this.closest('sa-simple-form, sa-tabbed-form, sa-filters').formStore`), registers its
`source`, builds its control DOM once (`renderControl`), then wires one effect:

```js
this._dispose = effect(() => {
  this._version.get();
  const value  = this._form.getField(this.source);   // dep: values
  const error  = this._form.getError(this.source);   // dep: errors
  const touched= this._form.isTouched(this.source);  // dep: touched
  this.updateControl(this.format(value));
  this.renderError(touched ? error : undefined);
  this.renderHelper(this.helperText);
});
```

Because `getField`/`getError`/`isTouched` read `values.get()`/`errors.get()`/`touched.get()`, this
one input's effect subscribes to exactly those three form signals. Ten inputs = ten effects, each
subscribed to the same three signals but each re-rendering only its own control. Writes flow the
other way: the control's `input` listener calls `commit(value)` → `form.setField(source, parse(value))`,
which produces new `values`/`errors` objects, which re-run **every** input effect on the next
microtask. That is intended — cross-field validators mean any field's value can change another
field's error — but each effect still only mutates its own control node, so there is no wasted DOM
work beyond the reads.

### 4.4 End-to-end: one filter keystroke to updated rows

Tracing a single keystroke in a filter input on a list view, citing real functions:

1. User types. The filter input's control `input` listener calls `BaseInput.commit(value)` →
   the filter's FormStore `setField` → the filters host relays it to
   `ListController.setFilterValue(key, value)` (or `setFilters`).
2. `setFilterValue` does `filterValues.set({ ...peek(), [key]: value })` and `page.set(1)`. Two
   signals change synchronously → their subscribed effects (`disposeFilters`, `disposePaging`) are
   queued into one `pending` batch → one microtask scheduled.
3. Microtask flush runs both effects. `disposeFilters` calls `scheduleFetch(true)` → sets a 500 ms
   timer. `disposePaging` calls `scheduleFetch(false)`, which first *clears* that timer, then (page
   already 1) runs. (The exact immediate/debounced interplay is described in §3.1; the point is
   `scheduleFetch`'s clear-then-(re)arm is the single coordination point.)
4. When `runFetch` resolves, it aborts nothing new here, then `data.set(rows)` (and `total`,
   `isPending`) fire.
5. `data`'s change queues the datagrid's `_disposeData` effect. Next microtask, `_reconcileRows`
   runs: stale ids removed, surviving rows moved, new ids get `_createRow`. New rows' cloned fields
   connect, resolve their row's `__recordContext`, and their own effects render each cell's
   `textContent`. `isPending.set(false)` separately re-runs whatever effect renders the loading
   state. The DOM is now consistent, having touched only the nodes that actually changed.

---

## 5. Why this design over the alternatives

The choice is legible directly in the line counts and the shape of the code:

- **vs. `innerHTML` re-render of containers.** The datagrid could have been
  `tbody.innerHTML = rows.map(rowHtml).join('')` on every `data` change. That is fewer lines than
  `_reconcileRows`, but it destroys and recreates every row on every change — losing checkbox state,
  scroll position, focus, and any transient DOM state, and thrashing the custom-element lifecycle
  (every cloned field would disconnect+reconnect each keystroke). The ~25 lines of keyed reconciliation
  buy stable identity: only genuinely new/removed/moved rows touch the DOM. For inputs it would be
  worse — re-serializing a form's HTML on every keystroke would blow away caret position.
- **vs. a real vdom library (React/lit-html/etc.).** A vdom trades a runtime diff of a whole tree for
  the convenience of declarative re-render. simple-admin's whole reactive core is 97 lines with **no**
  tree diffing — the "diff" is replaced by (a) fine-grained subscriptions, so only effects whose
  actual dependencies changed run, and (b) hand-written minimal mutations inside those effects. There
  is no reconciler to ship, no keys-warnings, no synthetic event system, and — the project's premise —
  **no build step**. The cost is paid in authoring discipline: each component author writes the
  imperative patch (`renderValue`, `updateControl`, `_reconcileRows`) by hand instead of describing a
  view. The framework absorbs that cost once per component type; there are a bounded number of them.
- **The specific tradeoff accepted.** Fine-grained-but-manual means the framework has *no* automatic
  guarantee that a rendered node reflects current state — correctness depends on the author having read
  the right signals inside the effect. §4.1's field layer is a concrete example of that tradeoff biting:
  a field deliberately does *not* subscribe to record content, so cell updates rely on the reconciler
  recreating rows rather than on reactivity. A vdom would have re-rendered the cell "for free"; here it
  is a design decision with a documented edge (§6).

---

## 6. Gotchas for a future contributor

These are the things that are invisible in any single file and only surface when components interact.

**(a) `disconnectedCallback` is the *only* thing preventing effect leaks — and it is correct where it
exists.** `BaseField`, `BaseInput`, and `SaDatagrid` all store their effect teardown(s) and call them
on disconnect (`this._dispose()`, `_disposeData()`, `_disposeSelection()`; `BaseInput` also
`unregister`s from the form). An effect whose teardown is *not* called stays in its signals' subscriber
sets forever: the removed DOM node is kept alive by those sets, and the effect keeps re-running on every
state change, mutating a detached node. If you write a new component that opens an `effect` in
`connectedCallback`, you **must** capture the teardown and call it in `disconnectedCallback`. There is no
finalizer, no WeakRef safety net.

**(b) `computed` has no teardown at all.** As noted in §2, `computed` returns only `{ get, peek }`; its
internal recompute-effect lives forever. The two existing computeds (`dirty`, `isValid`) are
form-lifetime and fine. Do **not** create a `computed` per row, per keystroke, or inside a
`connectedCallback` — you will leak an effect with no way to dispose it. If you need a disposable derived
value, build it by hand: `const cell = signal(...); const dispose = effect(() => cell.set(fn()));` and
own the `dispose`.

**(c) Datagrid cells are not reactive to record *content* — only to row identity.** This is the
non-obvious interaction between `datagrid.js` and `baseField.js`. A field captures
`this._recordCtx = findRecordContext(this)` **once** at connect, and its render effect depends only on
`this._version`, never on a record signal. Meanwhile `SaDatagridRow`'s `record` setter reassigns
`this.__recordContext = { record: value }` to a **new object** on every reconcile. Consequences:
  - For a row whose `id` is **new**, `_createRow` builds fresh cells that connect and render correctly.
  - For a **reused** row (same `id` present before and after a refetch), reconciliation calls
    `row.record = newRecord`, but the already-connected cells still hold the *old* `_recordCtx` object
    reference and never re-run their effect — **the cell keeps rendering the old value.**
  This is invisible for sort/reorder (same records, just moved) but means an inline edit or a refetch
  that returns *changed data under an existing id* will not visually update that cell until the row is
  destroyed and recreated (e.g. the id leaves and re-enters the page). If you need live cell updates for
  persistent ids, that is the seam to change — either have the row setter mutate the existing context
  object in place *and* bump each child field's `_version`, or make `findRecordContext` return a signal.
  Do not assume the current code repaints cells on data change; it does not.

**(d) Ordering between effects is insertion-ordered, not priority-ordered.** Flush order follows
subscription order (§1.3). If two effects both react to the same signal and one logically depends on the
other's side effect, that is a latent bug — the primitive gives no ordering guarantee you can rely on.
The `ListController` avoids this by funnelling all fetch scheduling through the single `scheduleFetch`
clear-then-arm gate rather than depending on which of `disposePaging`/`disposeFilters` runs first.

**(e) There is no cycle detection.** An effect that writes a signal it also reads will re-queue itself
every flush and loop across microtasks — *unless* the `Object.is` guard in `set()` makes the write a
no-op once the value stabilizes. `setField → validateField → errors.set` does not loop because inputs
read `errors` but write `values`, and validation writes `errors` only when the message actually changes
(guarded delete/add). If you introduce an effect that writes back into its own dependency, ensure it
reaches a fixed point that `Object.is` recognizes, or you will spin the event loop.

**(f) `peek()` vs `get()` is a correctness decision, not a style choice.** Reading with `get()` inside a
mutator, controller setup, or event handler that you did *not* intend to be reactive will silently
subscribe it and cause surprise re-runs; reading with `peek()` inside a render effect will silently make
that render *non*-reactive to the value. When editing controllers or bases, match the existing intent:
`get()` in render effects and dependency-collecting setup, `peek()` in mutators/handlers.
