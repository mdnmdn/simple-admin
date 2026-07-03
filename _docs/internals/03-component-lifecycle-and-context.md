# 03 — Component Lifecycle & the DOM-Ancestry Context System

> Audience: engineers maintaining or extending simple-admin. This is the load-bearing
> internals document for **how custom elements wire themselves up** and **how a descendant
> field/input finds the data it renders** without any framework, virtual DOM, or explicit
> context registry. If you author a new `sa-*` component and get the ordering wrong, the
> symptom is a silent blank render — §7 tells you exactly why. Read that section before
> shipping any new context host.

Everything here is native Custom Elements v1 plus one tiny reactive `signal`/`effect`
primitive (`src/core/signal.js`). There is no React, so react-admin's `useRecordContext()`
/ `useListContext()` / `useResourceContext()` hooks are replaced by two orthogonal
mechanisms:

1. **DOM-ancestry context** (`src/core/context.js`) — a host publishes a context object on
   itself under a well-known property; descendants find the nearest one via `closest()`.
   This is the replacement for React Context.
2. **A module-level provider singleton** (`src/core/registry.js`) — the active
   `dataProvider`/`authProvider`, published once by `<sa-admin>` and read globally. This is
   a deliberate escape hatch from ancestry lookup (see §4).

---

## 1. The lifecycle contract every `sa-*` element follows

Every element in this codebase obeys the same four-phase shape. The rules are not
enforced by any base class — they are a *convention* that BaseField/BaseInput and every
container follow by hand, so a new author must follow it too.

### The four phases

**`constructor()` — metadata only, no DOM.** The constructor initializes instance fields
and *nothing else*. It must never touch `this.children`, `this.innerHTML`, attributes, or
context: at construction time the element may not be in the document, its own attributes
may not be parsed yet, and its children definitely are not present when the parser
upgrades it. Every constructor in the tree carries the same comment. From
`src/fields/baseField.js`:

```js
constructor() {
  super();
  // NO DOM work in the constructor (doc 10 §3.3): metadata only.
  this._descriptor = { kind: 'field' };
  this._recordCtx = null;
  this._dispose = null;
  this._version = signal(0); // bumped to force a re-render on descriptor change
  this._renderScheduled = false;
}
```

And the exact same discipline in `src/components/admin.js`:

```js
constructor() {
  super();
  // NO DOM work in the constructor (doc 10 §3.3): metadata only.
  this._dataProvider = null;
  this._authProvider = null;
  ...
}
```

**`connectedCallback()` — absorb attributes → build descriptor → locate context →
subscribe + render.** This is where all real work happens, and it always runs in that
order. A container publishes *its own* context first, then does its work; a leaf absorbs
attributes, resolves *its ancestor's* context exactly once, then subscribes a render
`effect`. Nearly every connectedCallback is idempotency-guarded with a `_built` flag so a
disconnect/reconnect (e.g. the admin parking a view in a hidden host and re-mounting it)
does not double-build.

**`attributeChangedCallback(name, old, val)` — patch descriptor, schedule a re-render.**
Never re-renders synchronously; it patches the in-memory descriptor and coalesces a
re-render onto a microtask via a `_version` signal bump. From `baseField.js`:

```js
attributeChangedCallback(name, _old, val) {
  this._patchFromAttribute(name, val);
  this._scheduleRender();
}
```

```js
_scheduleRender() {
  if (this._renderScheduled) return;
  this._renderScheduled = true;
  queueMicrotask(() => {
    this._renderScheduled = false;
    this._version.set(this._version.peek() + 1);
  });
}
```

The render `effect` reads `this._version.get()`, so bumping the signal re-runs it. This is
how attribute changes and descriptor mutations both funnel through a single reactive path.

**`disconnectedCallback()` — unsubscribe, abort.** Dispose every `effect` teardown and
unregister from any store. Leaks here are silent memory/subscription leaks that outlive
the element. `baseField.js`:

```js
disconnectedCallback() {
  if (this._dispose) this._dispose();
  this._dispose = null;
  this._recordCtx = null;
}
```

`baseInput.js` adds store cleanup on top of the same shape — it also unregisters its
`source` from the FormStore:

```js
disconnectedCallback() {
  if (this._dispose) this._dispose();
  if (this._form && typeof this._form.unregister === 'function') {
    this._form.unregister(this.source);
  }
  this._form = null;
  this._dispose = null;
}
```

Containers follow the identical shape: `SaList.disconnectedCallback()` disposes its
status effect and calls `this._controller.dispose()`; `SaAdmin.disconnectedCallback()`
disposes its route `effect`.

### The one-shot context resolution rule

The single most important consequence of this contract: **a field/input resolves its
ancestor context exactly once, synchronously, inside its own `connectedCallback`, and
never re-reads it.** In `baseField.js`:

```js
this._recordCtx = findRecordContext(this);
if (!this._recordCtx) {
  diagnostics.warn('field-no-record-context', { tag: this.localName, source: this.source });
  return;
}
this._dispose = effect(() => {
  this._version.get();
  const value = this.getValue();
  ...
});
```

`this._recordCtx` is captured *before* the render effect and is closed over for the life
of the element. If the field connects while its ancestor has not yet published a record
context, `findRecordContext` returns `null`, the field warns and bails, and it stays blank
**forever** — reconnecting is the only recovery. `baseInput.js` does the same with its
FormStore lookup. This one-shot rule is the entire reason the detach-then-reattach pattern
in §3 exists.

---

## 2. DOM-ancestry context in detail

### The algorithm

All ancestry lookups go through one private helper in `src/core/context.js`:

```js
const findContext = (el, selector, prop) => {
  if (!el || typeof el.closest !== 'function') return null;
  let node = el;
  while (node) {
    const host = node.closest(selector);
    if (!host) return null;
    if (host[prop] != null) return host[prop];
    node = host.parentElement;
  }
  return null;
};
```

Read it carefully — the loop is not a plain `closest()`. `closest(selector)` finds the
nearest ancestor-or-self matching one of the host tags. If that host **has already
published** a context under the well-known property (`host[prop] != null`), we return it.
If it matched the selector but has **not yet published** (property is still `null`/absent),
we do **not** stop — we resume climbing from `host.parentElement` and look for the next
matching host further up. This is the "keep climbing past a host that hasn't published a
context yet" logic, and it exists for two real cases:

- **Pass-through hosts that deliberately never publish.** `SaSimpleShowLayout` is one of
  `RECORD_HOST_TAGS` (so `closest` matches it) but it intentionally never sets
  `__recordContext`, so lookups skip it and resolve the enclosing `<sa-show>`. Its own
  source comment says so:

  ```js
  // Thin record-context pass-through: it deliberately does NOT publish its own
  // __recordContext, so findRecordContext keeps climbing to the nearest ancestor that has
  // (typically <sa-show>).
  ```

- **A host mid-build.** A matching host that has connected but not yet reached the line
  where it assigns its context property should be transparent, not a dead end. The
  climb-past logic makes an unpublished host invisible rather than a null-returning wall.

The four public lookups are thin wrappers binding a selector to a property name:

```js
export const findRecordContext   = (el) => findContext(el, RECORD_HOST_TAGS,   '__recordContext');
export const findListContext     = (el) => findContext(el, LIST_HOST_TAGS,     '__listContext');
export const findFormContext     = (el) => findContext(el, FORM_HOST_TAGS,     '__formContext');
export const findResourceContext = (el) => findContext(el, RESOURCE_HOST_TAGS, '__resourceContext');
```

### The host-tag lists (the authoritative set)

```js
export const RECORD_HOST_TAGS =
  'sa-datagrid-row, sa-datagrid, sa-simple-show-layout, sa-tabbed-show-layout, ' +
  'sa-reference-field, sa-reference-array-field, sa-array-field, sa-reference-array-item, ' +
  'sa-array-field-row, sa-show, sa-edit, sa-create';

export const LIST_HOST_TAGS = 'sa-list';
export const FORM_HOST_TAGS = 'sa-simple-form, sa-tabbed-form, sa-filters';
export const RESOURCE_HOST_TAGS = 'sa-resource';
```

Notes that matter when extending:

- **Record hosts are the busiest set.** They include per-item wrapper tags —
  `sa-reference-array-item` and `sa-array-field-row` — which are *plain, undefined*
  custom-element tags created at render time (one per iterated item) purely so `closest()`
  can resolve a **distinct per-item** record context. They are never `customElements.define`d;
  tag-name selector matching works on any element regardless of whether it is an upgraded
  custom element. If you add an iterating field, follow this: emit a distinct wrapper tag
  per item and set `wrapper.__recordContext = { record: item }` on it. `src/fields/arrayField.js`
  does exactly `row.__recordContext = { record: item }`.
- **Record context objects are always `{ record: <obj> }`**, never the bare record — every
  publisher wraps it, so `findRecordContext(el).record` is the record. `baseField.getValue()`
  relies on this: `const record = this._recordCtx && this._recordCtx.record`.
- **Form context** covers `sa-filters` too — a filter bar is just a form over the list's
  filter values, so filter inputs reuse the exact BaseInput FormStore-lookup path.

### Why ancestry lookup and not an explicit context registry

react-admin uses React Context (a provider/consumer registry keyed off the render tree).
The DOM-native analogue would be a JS map keyed by some context id, with consumers
subscribing. simple-admin deliberately does **not** do that. The tradeoff, taken
knowingly:

- **Simplicity wins.** The DOM tree *is* the context tree. There is no separate
  registration/deregistration bookkeeping, no id allocation, no subscription list to leak.
  Publishing is a single property assignment; consuming is one `closest()` walk. The whole
  system is ~60 lines.
- **The cost is portaling/teleporting robustness.** Because lookup is strictly by DOM
  ancestry, a consumer that is physically moved out of its provider's subtree (a "portal"
  in React terms) loses the context. There is no way to consume a context whose provider
  is not a DOM ancestor. In v1 nothing portals, so this cost is never paid — but if you
  ever add a component that renders detached (a floating dialog appended to `<body>`, say),
  it will **not** see the record/form/list context of wherever it was logically declared.
  That is the known limitation this design accepts in exchange for having no registry.

The provider singleton in §4 exists precisely because one piece of "context" — the
dataProvider — *does* need to be reachable from anywhere regardless of ancestry, so it was
carved out of this DOM-only model.

---

## 3. The detach-then-reattach pattern

### Why it is necessary

Restating §1's one-shot rule from the container's side: a field/input reads its ancestor
context **once, synchronously, in its own `connectedCallback`**, then never again. So a
container that fetches or builds its context asynchronously (or even just later in its own
connect body) has a race:

- If the container's `sa-*-field`/`sa-*-input` children are allowed to connect **before**
  the container publishes a real `__recordContext` / `formStore` / `__listContext`, each
  child captures `null` (or a stale value) permanently and renders nothing.

The platform's insertion algorithm connects a subtree **pre-order**: the parent's
`connectedCallback` runs, then each child's. That is *helpful* for the synchronous case
(the parent can publish before its markup children connect) but *fatal* for the async case
(`<sa-show>`/`<sa-edit>` must `await dataProvider.getOne` before a record exists). The fix
is uniform: **on connect, synchronously detach all light-DOM children before any of them
can connect; do the async fetch / build the store / publish the context; only then
re-append the children** so their now-running `connectedCallback` resolves a real context.

### Excerpt A — `<sa-show>` (async fetch)

`src/components/show.js` detaches everything up front, fetches, publishes, re-appends:

```js
connectedCallback() {
  if (this._built) return;
  this._built = true;
  this.classList.add('sa-show');

  // Detach every child before it gets a chance to connect with no record context yet.
  this._pending = Array.from(this.childNodes);
  for (const node of this._pending) node.remove();
  ...
  this._load();
}
```

```js
async _load() {
  ...
  const result = await dataProvider.getOne(this._resource, { id: this._id });
  if (!this.isConnected) return;
  // Publish before re-appending children, so their connectedCallback resolves it.
  this.__recordContext = { record: result.data };
  this._status.remove();
  for (const node of this._pending) this.appendChild(node);
}
```

Two subtleties worth copying: the `if (!this.isConnected) return` guard after every
`await` (the user may have navigated away mid-fetch — abort rather than publish onto a
detached element), and publishing `__recordContext` *before* the re-append loop.

### Excerpt B — `<sa-datagrid>` (per-row cloning)

`src/components/datagrid.js` is the same pattern with a twist: the original field children
are detached and kept only as **clone templates**; they never connect directly. One clone
per row is appended to a `<sa-datagrid-row>` *after* the row's `.record` (and therefore
`__recordContext`) is set:

```js
_collectChildren() {
  for (const node of Array.from(this.childNodes)) {
    node.remove();
    if (node.nodeType !== 1) continue;
    const tag = node.localName;
    if (BULK_BUTTON_RE.test(tag)) {
      this._bulkButtons.push(node);
    } else if (typeof node.toDescriptor === 'function') {
      this._fieldTemplates.push(node);   // clone-only template, never connects itself
    } else { ...diagnostics.warn('unknown-element', ...) }
  }
}
```

```js
_createRow(record) {
  const row = document.createElement('sa-datagrid-row');
  ...
  row.record = record; // publish __recordContext before any cell/field connects
  ...
  for (const template of this._fieldTemplates) {
    const td = document.createElement('td');
    td.appendChild(template.cloneNode(true));  // clone connects AFTER record is set
    row.appendChild(td);
  }
  return row;
}
```

The publish happens inside `SaDatagridRow`'s `record` setter, which is why setting
`row.record` before appending clones is sufficient:

```js
set record(value) {
  this._record = value;
  this.__recordContext = { record: value };
}
```

Note that a cloned field is a **detached fragment** at `cloneNode` time and only connects
when its `<td>` is appended into the already-record-bearing `row` — so `findRecordContext`
climbs from the clone, hits `sa-datagrid-row`, finds a published `__recordContext`, and
resolves. This is the pattern's cleanest expression.

### Other instances (same shape, worth knowing)

- **`<sa-simple-form>`** builds its FormStore as the *first* thing in `connectedCallback`
  (before any child input connects) and publishes both `this.formStore` and
  `this.__formContext`. Its markup inputs connect after and find the store via
  `closest('sa-simple-form, sa-tabbed-form, sa-filters').formStore`. (Full trace in §6.)
- **`<sa-edit>` / `<sa-create>`** publish `__recordContext` and hand `resource`/`record`
  to their form child by property assignment — covered in §5 and §6.
- **`<sa-list>`** publishes `this.__listContext = this._controller` synchronously before
  rendering any chrome, so `<sa-datagrid>`/`<sa-filters>`/`<sa-pagination>` resolve it.

---

## 4. The global provider registry — a deliberate escape hatch

`src/core/registry.js` holds two module-level singletons:

```js
let activeDataProvider = null;
let activeAuthProvider = null;

export const setDataProvider = (dp) => { activeDataProvider = dp || null; };
export const getDataProvider = () => activeDataProvider;
export const setAuthProvider = (ap) => { activeAuthProvider = ap || null; };
export const getAuthProvider = () => activeAuthProvider;
```

`<sa-admin>` publishes into them at the very top of its `connectedCallback`, *before*
anything below it renders:

```js
let publishedDataProvider = this._dataProvider;
if (this._authProvider) {
  publishedDataProvider = addAuthCheckToDataProvider(this._dataProvider, this._authProvider);
  setAuthProvider(this._authProvider);
}
setDataProvider(publishedDataProvider);
```

### Which mechanism does which component use

There is a clean split, and it is intentional:

| Kind of dependency | Mechanism | Consumers |
| --- | --- | --- |
| The record being displayed | `findRecordContext` (`__recordContext`) | every display field (BaseField) |
| The FormStore being edited | `closest(FORM_HOST_TAGS).formStore` / `findFormContext` | every input (BaseInput), filters |
| The active list controller | `findListContext` (`__listContext`) | datagrid, pagination, filters |
| The ambient resource name | `findResourceContext` (`__resourceContext`) | list/create/edit/show, reference fields |
| **The dataProvider / authProvider** | **`getDataProvider()` / `getAuthProvider()` singleton** | reference fields/inputs, `<sa-list>`, `<sa-show>`, `<sa-edit>`, `<sa-create>`, auth guards |

Notice the pattern: **the four ancestry contexts are all things that vary by position in
the tree** — different rows have different records, different forms have different stores.
They *must* be resolved by ancestry because their value depends on where you are. The
**dataProvider does not vary by position** — in v1 there is exactly one per page — so
plumbing it through the DOM would be pure overhead.

The registry comment states the concrete reason it was added:

```js
// A single <sa-admin> per page is the common case (v1). Rather than have every field/input
// walk the DOM to find the nearest <sa-admin>, the admin component publishes its
// dataProvider/authProvider here on mount, and anything (reference fields/inputs, auth
// guards, examples) reads them back with getDataProvider()/getAuthProvider() instead of
// coupling to the DOM tree.
```

The sharpest motivating case is **reference fields/inputs**. A `<sa-reference-field>` needs
the dataProvider to fetch the *related* record (`referenceField.js` calls `getDataProvider()`
directly), but it can sit at arbitrary nesting depth — inside a datagrid cell, inside a
show layout, inside another reference field's template. There is no DOM ancestor it can
rely on being `<sa-admin>` at a fixed depth, and `<sa-admin>` is not even in
`RECORD_HOST_TAGS`/`RESOURCE_HOST_TAGS`. Walking up to find it would be fragile and would
couple every reference component to the shell. The singleton removes that coupling: the
component asks a module function, not the DOM. `admin.js`'s own comment frames it the same
way — providers are published "so every field/input/guard in the tree can read them
without DOM plumbing."

(`findResourceContext` is still used by reference components — but for the *resource name*,
which genuinely is ancestry-dependent — not for the provider.)

---

## 5. The `upgradeProperty()` shim

The identical helper appears in `create.js`, `edit.js`, and `simpleForm.js`:

```js
const upgradeProperty = (el, prop) => {
  if (Object.prototype.hasOwnProperty.call(el, prop)) {
    const value = el[prop];
    delete el[prop];
    el[prop] = value;
  }
};
```

### The exact timing problem it solves

Custom elements have a "lazy upgrade" window. An element can exist in the DOM (parsed from
HTML, or `createElement`'d) **before** its class definition has been registered/applied —
its constructor and prototype accessors do not exist yet; it is just a generic
`HTMLElement`. If code sets a property during that window:

```js
formEl.record = { ... };   // formEl not yet upgraded to SaSimpleForm
```

...then because there is no `record` setter on the prototype yet, JS creates a **plain own
data property** named `record` directly on the instance. Later, when the browser upgrades
the element and runs `customElements.define`, the prototype gains a `record` *accessor* —
but the instance's own data property now **shadows** it. Reads and writes hit the dead own
property; the setter (which, for `<sa-simple-form>`, reseeds the FormStore via
`formStore.reset(value)`) never fires. The value is stranded.

This is a real hazard here because the `<sa-create>`/`<sa-edit>` → `<sa-simple-form>`
contract is *property assignment across a parent/child boundary*, and the platform does
not guarantee upgrade/connection order between a parent and its light-DOM child — it
depends on how the subtree was built (streamed HTML parse vs. built-off-document-then-
appended). `create.js`'s `_configureForm()` even sets `formEl.record` from the parent's
connect, which can easily land before the child is upgraded.

### Walking the shim

`upgradeProperty(el, prop)` runs at the **top of the element's own `connectedCallback`**,
by which point the class *is* defined and the accessor *does* exist on the prototype:

1. `hasOwnProperty(el, prop)` — is there a stranded own data property shadowing the
   accessor? If not, nothing to do.
2. `const value = el[prop]` — read the stranded value off the own property.
3. `delete el[prop]` — remove the own property, un-shadowing the prototype accessor.
4. `el[prop] = value` — assign again; **this now goes through the prototype setter**,
   running its side effects (for `<sa-simple-form>.record`, seeding/resetting the FormStore).

`simpleForm.js` calls it for both `resource` and `record` first thing in connect:

```js
connectedCallback() {
  upgradeProperty(this, 'resource');
  upgradeProperty(this, 'record');
  ...
}
```

`edit.js` calls it for `resource` and `id`; `create.js` for `resource`. Combined with the
`.record` setter's "reseed if store already exists" branch, this makes property assignment
**order-independent**: set before OR after the child's connect and it works — a pre-connect
assignment is picked up by `upgradeProperty` when connect runs; a post-connect assignment
goes straight through the live setter and reseeds. Rule of thumb: **any custom element with
a property that a parent may set before upgrade must `upgradeProperty` it in connect.**

---

## 6. End-to-end trace: admin mount → route change → edit → form → input

A concrete `#/posts/42` (edit) navigation, naming every handoff in order.

1. **`<sa-admin>.connectedCallback` (`admin.js`).** Publishes providers to the singleton
   *first*: `setAuthProvider(...)` then `setDataProvider(publishedDataProvider)`. Then it
   moves author-declared `<sa-resource>` children into a hidden host
   (`this._authoredHost`), builds the shell, calls `startRouter()`, and installs the route
   `effect`:
   ```js
   this._dispose = effect(() => {
     const route = currentRoute.get();
     this._handleRoute(route);
   });
   ```
2. **Route resolves** to `{ view: 'edit', resource: 'posts', id: '42' }`. `_handleRoute`
   runs the auth gate (`guardView`) if an authProvider exists, then `_renderShell()` and
   `_mountView(route)`.
3. **`_mountView`** parks the previous authored view back in `_authoredHost`, clears
   `.sa-content`, looks up `getResource('posts')` from the registry, reads
   `resourceDescriptor.edit`. HTML-authoring path: it is a real `<sa-edit>` element, so
   `_mountAuthoredView` moves the whole enclosing `<sa-resource>` host into `.sa-content`
   and toggles sibling views' `display`. (JS-config path: `_mountConfiguredView` synthesizes
   a `<sa-resource>` host, `createElement('sa-edit')`, sets `.descriptor` and `.id`,
   `materializeView`s children, then appends — so `findResourceContext` still works.)
4. **`<sa-resource>` connect (`resource.js`).** Publishes
   `this.__resourceContext = { kind: 'resource', name: 'posts', ... }` (or keeps a pre-set
   one) — the ambient resource for everything below.
5. **`<sa-edit>.connectedCallback` (`edit.js`).** Runs `upgradeProperty(this,'resource')`
   / `upgradeProperty(this,'id')`. Resolves resource via `findResourceContext(this).name`
   (→ `'posts'`) and `id` from the `id` attribute or `currentRoute.peek().id` (→ `'42'`).
   Adds its `sa-submit` listener. Calls `_fetchRecord()`.
6. **`_fetchRecord` (async).** `getDataProvider()` (the singleton from step 1) →
   `await dataProvider.getOne('posts', { id: '42' })`. On resolve:
   ```js
   this.record = (result && result.data) || {};
   this.__recordContext = { record: this.record };   // publish record context
   this._configureForm();
   ```
   Publishing `__recordContext` makes `<sa-edit>` a live RECORD_HOST for any nested
   show-style field.
7. **`_configureForm`** finds the light-DOM `<sa-simple-form>` child and hands it the data
   by property assignment (with a `queueMicrotask` retry if it is not parsed yet):
   ```js
   formEl.resource = this._resource;   // → SaSimpleForm.set resource
   formEl.record   = this.record;      // → SaSimpleForm.set record
   ```
8. **`<sa-simple-form>` connect (`simpleForm.js`).** (Ran when it was inserted.)
   `upgradeProperty(this,'resource'/'record')` reconciles any pre-upgrade assignments.
   Then, as its very first real work, it builds and publishes the FormStore:
   ```js
   this.formStore = createFormController(this._descriptor, {
     dataProvider: getDataProvider(),
     record: this._record || {},
   });
   this.__formContext = { formStore: this.formStore, resource: this._resource };
   ```
   If `record` is (re)assigned *after* this via step 7's late setter, the setter's
   `if (this.formStore) this.formStore.reset(value)` branch reseeds the existing store in
   place — no rebuild, registered inputs keep working.
9. **`<sa-text-input>` connect (`baseInput.js`).** Absorbs attributes, compiles
   validators, then resolves the form by ancestry — the crucial handoff:
   ```js
   const host = this.closest('sa-simple-form, sa-tabbed-form, sa-filters');
   this._form = host ? host.formStore : null;   // ← finds the FormStore from step 8
   ```
   It then `this._form.register(this.source, {...})`, renders its control, and subscribes an
   `effect` that reflects `getField`/`getError`/`isTouched` into the control. The input is
   now bound.
10. **Save.** The toolbar/save button calls the form's `.save()`, which
    `formStore.validateAll()`s and dispatches a bubbling, composed `sa-submit`
    CustomEvent `{ detail: { values, resource, record } }`. `<sa-edit>`'s listener from
    step 5 catches it, applies `transform`/`sanitizeEmptyValues`, calls
    `dataProvider.update('posts', { id, data, previousData })`, and `_redirect()`s.

Handoff summary, in order: **singleton dataProvider** (1) → `__resourceContext` (4) →
`findResourceContext` (5) → **singleton getOne** (6) → `__recordContext` (6) →
`resource`/`record` property assignment + `upgradeProperty` (7–8) → `formStore` +
`__formContext` (8) → `closest().formStore` (9) → `sa-submit` event (10).

---

## 7. Gotchas for a future contributor

**The one thing that breaks silently: publishing context AFTER appending children instead
of BEFORE.** Because a field/input resolves its context exactly once in its own
`connectedCallback` and the platform connects subtrees pre-order (parent connect → then
children connect), if your new container appends/re-appends its light-DOM children and only
*then* sets `this.__recordContext` / `this.__listContext` / `this.formStore`, every child
will have already run its connectedCallback, resolved `null`, warned once to diagnostics
(`field-no-record-context` / `input-no-form`), and bailed. There is no error, no exception,
no retry — just a blank field. The reactive `effect` never even gets created, so later
setting the context does nothing. Correct order is always: **detach children (if they were
authored into your light DOM) → build/fetch/publish context → (re-)append children.**

Concrete rules that fall out of this, for any new context host:

- **Publish before you append.** `<sa-list>` sets `__listContext` before `_renderChrome`;
  `SaDatagridRow.set record` publishes before the row's clones are appended;
  `<sa-simple-form>` builds `formStore` as its first act. Match that.
- **If context arrives async, detach first.** Follow `<sa-show>`/`<sa-edit>`: snapshot
  `Array.from(this.childNodes)`, `remove()` each, `await`, publish, re-append. Never let
  authored children connect against a not-yet-fetched context.
- **Guard every `await` with `if (!this.isConnected) return`.** The user can navigate away
  mid-fetch; publishing onto a detached element is a leak and a bug.
- **Publish `{ record }`, not the bare record.** Consumers read `.record` off the context
  object. A bare record silently mis-resolves.
- **A pass-through host must leave its property `null`.** If you add a layout wrapper to a
  `*_HOST_TAGS` list but do not want it to shadow the real context, never assign the
  property — the climb-past logic (§2) will skip it. Assigning `null`/leaving it unset both
  work; assigning a half-built object does not.
- **`upgradeProperty` any property a parent may set pre-upgrade** (§5), and make the setter
  tolerate late (re)assignment (reseed rather than rebuild), so cross-boundary property
  handoffs are order-independent.
- **Dispose in `disconnectedCallback`.** Every `effect(...)` returns a teardown; store it
  and call it. Unregister from any store (BaseInput unregisters its `source`). Missed
  teardowns are silent subscription leaks that survive re-mounts.
