# simple-admin — Architecture Proposal

> A vanilla-JS, no-build, web-components clone of [react-admin](https://marmelab.com/react-admin/).
> This is a **design proposal only** — no implementation code exists yet. It is derived from the six
> research documents in this folder (`01`–`06`) which describe react-admin's real behavior.
>
> Companion documents:
> - `11-syntax-reference.md` — the react-admin ↔ simple-admin translation cheat-sheet.
> - `12-open-questions.md` — decisions the project owner may want to revisit.

---

## 0. Design goals, restated as constraints

| # | Goal | Hard constraint it imposes |
|---|---|---|
| 1 | No build step, no bundler, no TS transpile, no JSX | Ship `.js` ES modules the browser runs verbatim. Usable via `<script type="module">` from a CDN. |
| 2 | DataProvider "almost" compatible with react-admin | Identical method names, params, and return envelopes (doc `02`). |
| 3 | AuthProvider "almost" compatible with react-admin | Identical method contract, resolve=allow / reject=deny (doc `03`). |
| 4 | Same declarative philosophy | Resources, `source`-bound fields/inputs, children-as-columns, references, filters, bulk actions. |
| 5 | Dual syntax: HTML custom elements **and** JS config, both first-class | Both compile to one internal **descriptor** model. |
| 6 | shadcn / Tailwind-friendly, headless-ish | Light DOM, CSS custom properties, unstyled defaults, utility-class-friendly. |
| 7 | Zero / near-zero deps, from-scratch reactive core | A tiny signals + pub/sub store, no virtual DOM. |
| 8 | Actionable console hints on misconfiguration | A dedicated diagnostics module with exact message formats. |

The north star: **anyone who knows react-admin feels instantly at home**, and the concrete syntax may differ from JSX as long as the *concepts and vocabulary* (`source`, `reference`, `getList`, `checkAuth`, `required()`) are preserved.

---

## 1. High-level architecture

```
                       ┌──────────────────────────────────────────────────────────┐
                       │                    simple-admin runtime                    │
                       │                                                            │
  ┌───────────────┐    │   ┌──────────────────────────────────────────────────┐    │
  │  Author input │    │   │                   CORE ENGINE                     │    │
  │               │    │   │                                                   │    │
  │  (A) HTML     │    │   │  ┌───────────┐  ┌───────────┐  ┌───────────────┐  │    │
  │  <sa-admin>   │────┼──▶│  │  signal   │  │ Resource  │  │  hash Router  │  │    │
  │  <sa-resource>│    │   │  │  store    │  │ Registry  │  │  #/res/:id... │  │    │
  │  <sa-list> …  │    │   │  │(reactive) │  │           │  │               │  │    │
  │               │    │   │  └─────┬─────┘  └─────┬─────┘  └───────┬───────┘  │    │
  │  (B) JS API   │    │   │        │              │                │          │    │
  │  SimpleAdmin  │────┼──▶│  ┌─────┴──────────────┴────────────────┴──────┐   │    │
  │   .resource() │    │   │  │        DESCRIPTOR MODEL (single source)     │   │    │
  │   .admin()    │    │   │  │  admin / resource / view / field / input    │   │    │
  └───────────────┘    │   │  │        (both syntaxes normalize to this)    │   │    │
     both produce      │   │  └───────┬─────────────────────────────┬───────┘   │    │
     the SAME model    │   │          │                             │           │    │
                       │   └──────────┼─────────────────────────────┼───────────┘    │
                       │              │                             │                │
                       │   ┌──────────┴───────────┐     ┌───────────┴────────────┐   │
                       │   │    PROVIDER LAYER     │     │     COMPONENT LAYER    │   │
                       │   │                       │     │                        │   │
                       │   │  dataProvider adapter │     │  Web Components (light │   │
                       │   │  authProvider adapter │     │  DOM) render descriptors│  │
                       │   │  fetchJson + HttpError│     │  List/Datagrid/Form/…  │   │
                       │   │  combine/lifecycle/   │     │  subscribe to store    │   │
                       │   │  refreshAuth wrappers │     │                        │   │
                       │   │  query cache (Map)    │     │  ┌──────────────────┐  │   │
                       │   │  getMany batcher      │     │  │  FIELD CATALOG   │  │   │
                       │   └───────────┬───────────┘     │  │  sa-*-field      │  │   │
                       │               │                 │  ├──────────────────┤  │   │
                       │        ┌──────┴──────┐          │  │  INPUT CATALOG   │  │   │
                       │        │  YOUR API   │          │  │  sa-*-input      │  │   │
                       │        │ REST/GraphQL│          │  └──────────────────┘  │   │
                       │        └─────────────┘          └───────────┬────────────┘   │
                       │                                             │                │
                       │                                 ┌───────────┴───────────┐    │
                       │                                 │     THEMING LAYER     │    │
                       │                                 │  CSS vars + parts +   │    │
                       │                                 │  unstyled base sheet  │    │
                       │                                 └───────────────────────┘    │
                       │                                                              │
                       │  ┌────────────────────────────────────────────────────────┐ │
                       │  │ DIAGNOSTICS (console hints: unknown tag / missing source │ │
                       │  │ / missing dataProvider method / misconfigured resource)  │ │
                       │  └────────────────────────────────────────────────────────┘ │
                       └──────────────────────────────────────────────────────────────┘
```

### Module boundaries

| Layer | Responsibility | Knows about |
|---|---|---|
| **Core engine** | Reactive store (signals), resource registry, hash router, descriptor normalization | Nothing above it; pure JS, no DOM assumptions except router reading `location.hash` |
| **Provider layer** | The `dataProvider`/`authProvider` contracts + adapters + wrappers, a small query cache and a `getMany` batcher | Core store (to publish loading/error/data) |
| **Component layer** | Web Components that read descriptors and render/subscribe to the store | Core + Provider + Field/Input catalogs + Theming |
| **Field/Input catalog** | The `sa-*-field` / `sa-*-input` element definitions and their JS-config equivalents | Core store, RecordContext/FormStore |
| **Theming** | Unstyled base stylesheet, CSS custom-property contract, `::part` names | Nothing; pure CSS |
| **Diagnostics** | Detect misconfiguration, emit actionable `console.warn`/`console.error` | Everything (it is called from everywhere) |

The one rule that keeps this clean: **components never touch the network and providers never touch the DOM.** Everything meets in the middle at the store and the descriptor model — exactly react-admin's "containers fetch, fields render" split.

---

## 2. The dual-syntax design (the heart of the proposal)

Both the HTML custom-element tree and the JS config object are **two syntaxes over one internal model**. Neither is primary. They normalize to the same plain-object **descriptor** graph, and a single renderer consumes descriptors. This means: parse HTML → descriptor, or take JS config → descriptor, then render descriptor. The HTML parser is literally "walk the light-DOM children and build the same objects the JS author would have typed."

### 2.1 The descriptor model

A descriptor is a plain, serializable JS object (JSON-ish; functions allowed for validators/transforms). Every descriptor has a `kind`.

```js
// AdminDescriptor
{ kind: 'admin', dataProvider, authProvider, requireAuth: false,
  title: 'Acme Admin', resources: [ResourceDescriptor, ...], theme: {...} }

// ResourceDescriptor
{ kind: 'resource', name: 'posts', icon: 'book',
  recordRepresentation: 'title' | (record) => string,
  list: ViewDescriptor|null, create: ..., edit: ..., show: ... }

// ViewDescriptor (a list/show/create/edit view)
{ kind: 'view', type: 'list'|'show'|'create'|'edit',
  resource: 'posts',
  // list-only:
  perPage: 10, sort: { field:'id', order:'DESC' },
  filter: {...}, filterDefaultValues: {...}, filters: [InputDescriptor,...],
  rowClick: 'edit'|'show'|false, bulkActions: [ActionDescriptor,...],
  body: { component:'datagrid'|'simple-list', columns: [FieldDescriptor,...] },
  // form-only:
  layout: 'simple'|'tabbed', groups: [...], inputs: [InputDescriptor,...],
  redirect: 'list', transform: fn, mutationMode: 'pessimistic' }

// FieldDescriptor  (a display leaf)
{ kind: 'field', type: 'text'|'number'|'date'|'reference'|..., source: 'title',
  label?: 'Title', sortable?: true, sortBy?: 'x', emptyText?: '-',
  reference?: 'authors', link?: 'edit', children?: [FieldDescriptor,...] }

// InputDescriptor (an editable leaf)
{ kind: 'input', type: 'text'|'select'|'reference'|..., source: 'title',
  label?, validate?: [fn,...], defaultValue?, choices?, optionText?, optionValue?,
  reference?, filter?, sort?, child?: InputDescriptor }
```

That is the *whole* contract between "author-facing syntax" and "renderer." Anything either syntax can express is expressible as one of these objects.

### 2.2 Concrete example — the same List two ways, side by side

**(A) HTML custom elements**

```html
<sa-admin>
  <sa-resource name="posts" record-representation="title">
    <sa-list sort-field="published_at" sort-order="DESC" per-page="25" row-click="edit">
      <sa-filters>
        <sa-search-input source="q" always-on></sa-search-input>
        <sa-text-input source="title" label="Title"></sa-text-input>
      </sa-filters>
      <sa-datagrid>
        <sa-text-field source="id"></sa-text-field>
        <sa-text-field source="title" label="Title"></sa-text-field>
        <sa-reference-field source="author_id" reference="authors" link="show">
          <sa-text-field source="name"></sa-text-field>
        </sa-reference-field>
        <sa-date-field source="published_at"></sa-date-field>
      </sa-datagrid>
      <sa-bulk-delete-button></sa-bulk-delete-button>
    </sa-list>
  </sa-resource>
</sa-admin>
```

**(B) JS config — produces a byte-equivalent descriptor**

```js
import { SimpleAdmin, fields as f, inputs as i } from './simple-admin/index.js';

SimpleAdmin.admin({
  dataProvider,
  resources: [
    SimpleAdmin.resource('posts', {
      recordRepresentation: 'title',
      list: {
        sort: { field: 'published_at', order: 'DESC' },
        perPage: 25,
        rowClick: 'edit',
        filters: [
          i.search({ source: 'q', alwaysOn: true }),
          i.text({ source: 'title', label: 'Title' }),
        ],
        columns: [
          f.text({ source: 'id' }),
          f.text({ source: 'title', label: 'Title' }),
          f.reference({ source: 'author_id', reference: 'authors', link: 'show',
                        child: f.text({ source: 'name' }) }),
          f.date({ source: 'published_at' }),
        ],
        bulkActions: ['delete'],
      },
    }),
  ],
}).mount('#app');
```

**(C) What both compile to — the descriptor (identical)**

```js
{ kind:'view', type:'list', resource:'posts',
  sort:{field:'published_at',order:'DESC'}, perPage:25, rowClick:'edit',
  filters:[
    {kind:'input',type:'search',source:'q',alwaysOn:true},
    {kind:'input',type:'text',source:'title',label:'Title'} ],
  body:{ component:'datagrid', columns:[
    {kind:'field',type:'text',source:'id'},
    {kind:'field',type:'text',source:'title',label:'Title'},
    {kind:'field',type:'reference',source:'author_id',reference:'authors',link:'show',
      children:[{kind:'field',type:'text',source:'name'}]},
    {kind:'field',type:'date',source:'published_at'} ]},
  bulkActions:[{kind:'action',type:'delete'}] }
```

### 2.3 How HTML becomes a descriptor

Each `sa-*` element implements a `toDescriptor()` method. A container element (`<sa-datagrid>`, `<sa-filters>`, `<sa-simple-form>`) in `connectedCallback` walks its **light-DOM** children, calls `child.toDescriptor()` on each recognized `sa-*` child, and assembles the array. Attributes map to descriptor keys via a small, uniform coercion table:

| HTML attribute form | Descriptor key/value |
|---|---|
| `source="title"` | `source: 'title'` |
| `label="Title"` | `label: 'Title'` |
| `always-on` (boolean present) | `alwaysOn: true` |
| `sort-field` + `sort-order` | `sort: { field, order }` |
| `validate="required|minLength:2"` | `validate: [required(), minLength(2)]` (DSL parsed) |
| `choices='[{"id":"a","name":"A"}]'` | `choices: [...]` (JSON parsed) |
| `.choices` JS property | `choices` (used as-is; for dynamic/computed) |
| `row-click="edit"` | `rowClick: 'edit'` |

Attribute names are kebab-case; descriptor keys are camelCase. This is the *only* transformation. Because both paths end at the same object, the renderer, the store wiring, and the diagnostics are written **once**.

**Design rule:** JS config and HTML must produce *behaviorally equivalent* descriptors, and we aim for *structurally identical* ones (same keys, same nesting) so the two syntaxes can be freely mixed and debugged interchangeably. (See open question in `12`.)

### 2.4 Mixing syntaxes

Because HTML elements expose JS properties too, you can drop a `<sa-datagrid>` into a page and later do `document.querySelector('sa-datagrid').columns = [...]` to override columns dynamically — the property setter simply replaces that part of the descriptor and re-renders. Likewise a JS-config admin can mount into an existing `<sa-admin>` element. Neither syntax is a second-class citizen.

---

## 3. Web Components strategy

### 3.1 Decision: **light DOM, not Shadow DOM** (with `::part`-style hooks via plain classes)

This is a deliberate, load-bearing call.

**Why light DOM wins here:**

1. **shadcn/Tailwind compatibility is a stated top-tier requirement.** Shadow DOM's style encapsulation is exactly the feature that *breaks* utility-class theming: Tailwind classes and shadcn CSS variables defined on `:root`/ancestors don't pierce a shadow boundary without extra plumbing (`::part`, adopted stylesheets, or re-declaring variables). Light DOM lets `class="rounded-md border bg-background"` on our rendered nodes Just Work.
2. **Global stylesheets apply naturally.** The user's existing design system (shadcn's `globals.css`, CSS custom properties like `--background`, `--foreground`, `--radius`) cascades into our light-DOM output for free.
3. **No FOUC / SSR-adjacent complexity.** Light DOM renders into normal document flow; no `:defined` flash-of-unstyled-custom-element mitigation needed beyond a tiny base sheet.
4. **Simpler debugging.** Everything is inspectable in the normal DOM tree; no shadow roots to expand.

**What we give up, and how we compensate:**

- *Style leakage* (page CSS can accidentally hit our internals). We mitigate with a consistent, namespaced class prefix `sa-` on every rendered node (`sa-datagrid`, `sa-datagrid__row`, `sa-field`, `sa-input`) — BEM-ish, collision-resistant, and greppable. This doubles as the styling hook.
- *`::part()`* only works with Shadow DOM, so instead of shadow parts we expose **`data-sa-part="row|cell|header|toolbar|..."`** attributes on key nodes. Themers can target `[data-sa-part="row"]` or the `sa-*` classes interchangeably. (We keep the *word* "part" from react-admin's mental model even though the mechanism differs.)

So: **custom elements are used as *declaration and lifecycle* hosts, but they render their UI into their own light-DOM children**, styled by global CSS + our thin base sheet + CSS variables. This is the sweet spot for utility-CSS ecosystems.

### 3.2 Naming convention

- All elements are prefixed **`sa-`** (simple-admin). Required by the Custom Elements spec anyway (must contain a hyphen), and mirrors react-admin's PascalCase names 1:1: `TextField` → `sa-text-field`, `ReferenceInput` → `sa-reference-input`, `SimpleForm` → `sa-simple-form`.
- Rendered (non-custom) nodes use `sa-` class prefix with BEM: `.sa-datagrid`, `.sa-datagrid__head`, `.sa-datagrid__row`, `.sa-datagrid__cell`, `.sa-btn`, `.sa-btn--primary`.
- Structural landmarks additionally carry `data-sa-part="…"` for theming.

### 3.3 Lifecycle wiring

Every `sa-*` element follows the same lifecycle contract:

```
constructor()           – no DOM work (spec requirement). Set up field metadata only.
connectedCallback()     – 1. read attributes + light-DOM children → build/extend descriptor
                          2. locate the nearest context (admin/resource/list/record) by walking
                             up the DOM (element.closest('sa-list') etc.) or via a context registry
                          3. subscribe to the relevant store slice; do initial render into light DOM
                          4. register with diagnostics (validate own config; warn if broken)
attributeChangedCallback(name, old, new)
                        – patch the corresponding descriptor key, mark dirty, schedule a re-render
                          (microtask-batched so setting several attributes = one render)
disconnectedCallback()  – unsubscribe from store, cancel in-flight fetches (AbortController),
                          remove event listeners, release context references (no leaks)
```

**Context propagation without React Context:** we use DOM ancestry. A `<sa-text-field>` finds its record via `this.closest('sa-datagrid, sa-simple-show-layout, sa-reference-field')` and reads that host's current `RecordContext` (a small object the host publishes on itself, e.g. `host.__recordContext`). For per-row records inside a datagrid, the row host owns the record context. This is the DOM-native equivalent of `useRecordContext()`, and it means the same `<sa-text-field source="title">` works in a list cell, a show layout, or a reference field — identical to react-admin.

For the **JS-config path** (no real elements yet), the renderer creates the same elements programmatically and sets their descriptor properties directly, skipping attribute parsing. Same components, same lifecycle.

### 3.4 Theming / shadcn-compatibility, concretely

Three coordinated mechanisms:

1. **Unstyled-ish base sheet** (`theme/base.css`) — structural CSS only (display, grid, spacing scaffolding), no colors/borders opinions beyond referencing variables. Optional; the library works without it.
2. **CSS custom-property contract** — we read design tokens, defaulting to shadcn's names so a shadcn app themes us for free:

   ```css
   .sa-btn        { background: var(--sa-primary, var(--primary, #18181b));
                    color: var(--sa-primary-foreground, var(--primary-foreground, #fff));
                    border-radius: var(--sa-radius, var(--radius, 0.5rem)); }
   .sa-datagrid   { border-color: var(--sa-border, var(--border, #e5e7eb)); }
   ```

   Every `--sa-*` token falls back to the shadcn token, then to a hardcoded default. Users override at any level.
3. **Class hooks + slots for full control** — utility-class users can pass `class-name` attributes that get merged onto rendered nodes (`<sa-datagrid class-name="rounded-xl border">`), and structural slots (`<sa-list>` accepts a light-DOM `<div slot="actions">`) let authors inject arbitrary markup. Because it's light DOM, `slot`-like behavior is implemented as "named child projection" without Shadow DOM slots.

Net effect: a shadcn/Tailwind app gets a native-looking admin by doing nothing; a fully custom look is achievable by overriding `--sa-*` variables and/or passing utility classes.

---

## 4. Reactive core (no framework, no virtual DOM)

### 4.1 Decision: **fine-grained signals + targeted DOM patching**, backed by a small pub/sub store

react-admin gets reactivity from React + react-query. We have neither and want neither. The research (`02 §8.2`) explicitly calls out that we need our own lightweight async-state primitive and cache. We build:

**(a) `signal(initial)`** — a minimal observable cell:

```js
const s = signal(0);
s.get();                 // read (tracks dependency if inside an effect)
s.set(1);                // write (notifies subscribers)
effect(() => render(s.get())); // re-runs when any signal read inside it changes
computed(() => s.get()*2);     // derived, cached signal
```

Implemented in ~60 lines: a current-effect stack for automatic dependency tracking, a `Set` of subscribers per signal, microtask-batched flush so multiple `.set()`s in a tick cause one re-render.

**(b) A `ListController` / `FormController` store per view** — these hold the view's reactive state as signals:

```js
// ListController state (mirrors react-admin's ListContext)
{ data: signal([]), total: signal(0), isPending: signal(true), error: signal(null),
  page: signal(1), perPage: signal(25), sort: signal({field,order}),
  filterValues: signal({}), selectedIds: signal([]) }
```

When `page`/`sort`/`filterValues` change, an `effect` re-issues `dataProvider.getList(...)` (debounced 500ms for filters, matching react-admin's default), and writes results back into `data`/`total`/`isPending`. Components subscribe to just the slices they render.

**(c) Targeted DOM patching, no VDOM.** Each component's render effect updates only the DOM it owns:

- A `<sa-text-field>`'s effect writes `this.textContent = format(record[source])` — one text node.
- A `<sa-datagrid>`'s effect diffs `data` by `id` (keyed reconciliation of `<tr>`s: add/remove/reorder rows by id, reuse existing row elements), then lets each cell's own signal update itself.
- Pagination/loading indicators subscribe to `page`/`isPending` and toggle attributes/classes.

This gives us fine-grained updates (only the changed cell re-renders) without a diffing library. It's more code than "re-render everything with innerHTML," but it avoids losing focus/scroll/selection state in forms and grids — which a naive innerHTML approach would destroy.

**Why this over alternatives:**
- *innerHTML re-render*: simplest, but destroys input focus and is O(everything) — unacceptable for forms.
- *A real VDOM (preact-like)*: violates "no build, keep it simple," adds a dependency, and is overkill for a fixed set of known components.
- *Signals + targeted patching*: no dependency, no build, fine-grained, and each component's update logic is local and obvious. **Chosen.**

### 4.2 Data flow example (a List)

```
user types in filter input
  → input writes to FormStore(filters)
  → ListController.filterValues.set({...})              (signal write)
  → debounced effect fires dataProvider.getList(...)     (provider layer)
  → isPending.set(true)  → loading indicator's effect shows spinner
  → promise resolves → data.set(rows); total.set(n); isPending.set(false)
  → datagrid's effect reconciles <tr> rows by id
  → each cell's own effect updates its text/format
  → pagination's effect updates "1–25 of n"
```

No component polls; no manual `re-render()` calls in app code. This is the react-admin developer experience reproduced with ~200 lines of core.

### 4.3 Query cache & getMany batcher

- A tiny **cache** keyed by `resource + serialized params` (a `Map`), so a `getOne` after a `getList` can reuse data, and repeated identical `getList`s dedupe. Invalidated explicitly after `create`/`update`/`delete` on that resource (research `02 §8.2` says we must do this manually — we will).
- A **getMany batcher**: `ReferenceField`s register their needed ids into a per-microtask bucket keyed by `reference`; at end-of-tick we flush one `dataProvider.getMany(reference, { ids: dedupe(all) })`. This reproduces react-admin's N+1 avoidance (`06 §6`) without react-query.

---

## 5. Routing

### 5.1 Decision: **hash routing** (`#/resource/...`) for v1

Justification for a no-build library:

- **Zero server config.** History-API routing (`/posts/123`) requires the server to serve `index.html` for every deep path (SPA fallback). A drop-a-script-tag-on-any-page library cannot assume that. Hash routing works when opened as a `file://`, from a CDN demo, inside a CMS page, or on GitHub Pages — no server rewrite rules.
- **It's what "no bundler-driven history setup" implies.** The research (`task`) explicitly flags this. Hash routing is the safe default for embeddable, buildless tools.
- react-admin itself defaults to `HashRouter` in several of its own tutorials/CodeSandbox demos for exactly this reason.

We expose a `basename`/route-mode option so an advanced app *can* opt into History API (`SimpleAdmin.admin({ routing: 'history', basename: '/admin' })`) when it controls the server — but the default is hash.

### 5.2 Route table (mirrors react-admin exactly)

| Hash route | View | dataProvider call |
|---|---|---|
| `#/posts` | list | `getList` |
| `#/posts/create` | create | `create` |
| `#/posts/:id` | edit | `getOne` → `update`/`delete` |
| `#/posts/:id/show` | show | `getOne` |
| `#/` | dashboard (optional) | — |
| `#/login` | login page | `authProvider.login` |
| `#/access-denied` | access-denied page | — |

The router is a ~80-line module: parse `location.hash`, match against the resource registry, resolve `{ resource, view, id }`, and set a `currentRoute` signal. `<sa-admin>` has an effect that mounts the matching view component when `currentRoute` changes, running `checkAuth`/`canAccess` first (see §7). Navigation is `location.hash = '#/posts/5'`; links are plain `<a href="#/posts/5">`.

---

## 6. DataProvider contract (formal)

simple-admin requires an object with these methods. **This is intentionally identical to react-admin's contract (doc `02`)** — same names, same params, same return envelopes.

```ts
interface DataProvider {
  getList(resource, { pagination:{page,perPage}, sort:{field,order}, filter, meta?, signal? })
      → Promise<{ data: Record[], total?: number, pageInfo?: {hasNextPage,hasPreviousPage}, meta? }>
  getOne(resource, { id, meta?, signal? })                → Promise<{ data: Record }>
  getMany(resource, { ids, meta?, signal? })              → Promise<{ data: Record[] }>
  getManyReference(resource, { target, id, pagination, sort, filter, meta?, signal? })
                                                          → Promise<{ data: Record[], total?|pageInfo? }>
  create(resource, { data, meta? })                       → Promise<{ data: Record }>  // with new id
  update(resource, { id, data, previousData, meta? })     → Promise<{ data: Record }>
  updateMany(resource, { ids, data, meta? })              → Promise<{ data: Identifier[] }>
  delete(resource, { id, previousData?, meta? })          → Promise<{ data: Record }>
  deleteMany(resource, { ids, meta? })                    → Promise<{ data: Identifier[] }>
  supportAbortSignal?: boolean
  [custom: string]: any            // extra methods allowed, called via getDataProvider()
}
```

- Every record MUST have an `id` (string|number). Same identity rule as react-admin.
- Errors: reject with an **`HttpError`** (`{ message, status, body }`) — we ship the identical class. `status` 401/403 feeds `authProvider.checkError` (§7).
- We ship `fetchJson` (auto-JSON, `HttpError`-on-non-2xx), `combineDataProviders`, `withLifecycleCallbacks`, and `addRefreshAuthToDataProvider` as **pure functions copied near-verbatim** from `ra-core` (research `02 §8.1` confirms they have no React dependency).

### 6.1 Deliberate deviations (small and explicit)

| Area | react-admin | simple-admin v1 | Why |
|---|---|---|---|
| Mutation modes | `pessimistic`/`optimistic`/`undoable`, undoable default for Edit | **`pessimistic` only** in v0.1 (optimistic/undoable in v0.3) | Undoable needs a delayed-commit queue + cache rollback tied to react-query; deferring is the sanctioned simplification (`02 §8.2`). |
| Cache | react-query automatic dependency invalidation | Explicit `Map` cache with manual invalidation after writes | No react-query; we invalidate by resource on mutation. |
| Abort-on-unmount | Automatic via react-query | We pass `signal` and abort in `disconnectedCallback` | Wired to our lifecycle, not free. |

None of these change the **provider's** interface — they're runtime behaviors around it. A provider written for react-admin doesn't care which mutation mode calls it.

### 6.2 "Almost compatible" — the precise answer

**Can you pass `ra-data-simple-rest` or `ra-data-json-server` into simple-admin unmodified?**

**Yes, with one caveat about packaging, not contract.** Those packages implement the 9 methods purely in terms of `fetch`, `query-string`, and `fetchUtils.fetchJson` — none of which is React-specific (`02 §8.1` confirms this explicitly). The *object they return* satisfies our contract byte-for-byte. The only friction is **module delivery**:

- `ra-data-simple-rest` imports `fetchUtils` from `'react-admin'` and `stringify` from `'query-string'`. In a no-build, no-npm context those bare-specifier imports won't resolve in the browser.
- **Two clean paths:** (a) use an import-map or a CDN (`esm.sh`/`skypack`) that resolves `react-admin`'s `fetchUtils` and `query-string` as ESM — then the package works untouched; or (b) we ship a drop-in `saDataSimpleRest(apiUrl)` / `saDataJsonServer(apiUrl)` that is a near-verbatim copy of those providers but imports our own `fetchJson` and uses `URLSearchParams` instead of `query-string`. The wire format is identical, so the backend can't tell the difference.

So: **the *contract* is 100% compatible; the *npm package as published* needs either an import map or our provided twin.** We will ship the twins (they're ~50 lines each, per `02 §3.4`) so users need zero npm install to start, and document the import-map route for those who want the literal `ra-data-*` package.

---

## 7. AuthProvider contract (formal)

Identical to react-admin (doc `03`). Resolve = allow, reject/throw = deny — the single most important convention, preserved exactly.

```ts
interface AuthProvider {
  // required
  login(params): Promise<void | { redirectTo?: string|boolean }>
  logout(params?): Promise<void | string | false>
  checkAuth(params?): Promise<void>     // reject → logout() + redirect to #/login
  checkError(error): Promise<void>      // reject → logout() + redirect
  // optional (feature-detected; absent → permissive)
  getIdentity?(): Promise<{ id, fullName?, avatar?, [k]:any }>
  getPermissions?(): Promise<any>       // opaque, app-interpreted
  canAccess?({ action, resource, record? }): Promise<boolean>
  handleCallback?(): Promise<...>       // OAuth; v0.3+
  [custom]: any
}
```

Wiring simple-admin guarantees (matching `03 §7`):

- `checkAuth` runs on **every protected view mount** (before `getList`/`getOne`). Reject → `logout()` → `#/login`.
- `checkError` runs on **every dataProvider rejection**. A global wrapper around all provider calls inspects `error.status`; 401/403 → `checkError` → maybe logout. Thrown-error extras honored: `redirectTo`, `logoutUser:false`, `message:false`.
- `canAccess` (if present) is called before rendering List/Create/Edit/Show with `{ action, resource }`; false → `#/access-denied`. Exposed as a `<sa-can-access action resource>` guard element and a `canAccess()` helper so buttons/menu items self-hide (mirrors `useCanAccess`/`<CanAccess>`).
- `getIdentity` feeds the AppBar user menu (`{ id, fullName, avatar }` field names preserved).
- `getPermissions` stays opaque; we pass it through untouched.

**Compatibility answer:** an existing react-admin `authProvider` object is a **drop-in** — the methods are plain async functions with no React dependency. The only piece a react-admin auth provider might reference that we don't provide is `handleCallback` OAuth routing (deferred to v0.3). Classic username/password providers (the doc's MVP template) work unchanged.

---

## 8. Resource / List / Datagrid / Filter / Show model

### 8.1 Descriptor schema (list view)

```js
{ kind:'view', type:'list', resource:'posts',
  perPage: 10,
  sort: { field:'id', order:'DESC' },        // initial/default sort
  filter: { is_published:true },              // permanent, hidden, always applied
  filterDefaultValues: { status:'open' },     // seeded, user-editable
  filters: [ InputDescriptor, ... ],          // the filter form (alwaysOn per-input)
  rowClick: 'edit'|'show'|'expand'|false|fn,
  body: { component:'datagrid'|'simple-list',
          columns:[ FieldDescriptor, ... ] },  // datagrid children-as-columns
  bulkActions: ['delete','export', ActionDescriptor],
  pagination: { rowsPerPageOptions:[10,25,50] },
  empty: 'default'|false|elementRef,
  storeKey: 'posts-list'|false }              // persist filter/sort/perPage
```

### 8.2 HTML tag equivalents

| Descriptor concept | HTML |
|---|---|
| list view | `<sa-list sort-field="published_at" sort-order="DESC" per-page="25" row-click="edit" filter='{"is_published":true}'>` |
| datagrid | `<sa-datagrid>` with field children |
| a column | `<sa-text-field source="title" label="Title" sortable sort-by="title">` |
| filters | `<sa-filters>` wrapping input elements; `always-on` attr per input |
| permanent filter | `filter='{...}'` attribute on `<sa-list>` |
| default filter values | `filter-default-values='{...}'` |
| bulk actions | `<sa-bulk-delete-button>`, `<sa-bulk-export-button>`, or `bulk-actions="delete,export"` |
| row click | `row-click="edit|show|expand|none"` |
| expand panel | `<sa-datagrid expand>` + a `<template slot="expand">` |
| pagination options | `rows-per-page="10,25,50"` |

Column behaviors covered: `sortable`/`sort-by`/`sort-by-order`, `label`, `empty-text`, per-row selection (checkbox column auto-added unless `bulk-actions="none"`), `is-row-selectable` (JS predicate property). Sorting toggles by clicking headers; selection lives in `ListController.selectedIds` and is readable anywhere in the list, matching react-admin.

### 8.3 Show model

```html
<sa-show>
  <sa-simple-show-layout>
    <sa-text-field source="title"></sa-text-field>
    <sa-date-field source="published_at"></sa-date-field>
    <sa-reference-field source="author_id" reference="authors">
      <sa-text-field source="name"></sa-text-field>
    </sa-reference-field>
  </sa-simple-show-layout>
</sa-show>
```

`<sa-tabbed-show-layout>` + `<sa-show-tab label="...">` for tabs. Same `source`/`label` fields-as-children convention as datagrid — one field vocabulary reused across list columns, show rows, and (as inputs) forms, exactly as react-admin does (`04 §10`).

---

## 9. Form / Input model

### 9.1 Descriptor schema (create/edit view)

```js
{ kind:'view', type:'create'|'edit', resource:'posts',
  layout:'simple'|'tabbed',
  groups:[ { label:'Summary', inputs:[InputDescriptor,...] }, ... ], // tabbed only
  inputs:[ InputDescriptor, ... ],           // simple layout
  defaultValues:{ nb_views:0 },
  redirect:'list'|'edit'|'show'|false|fn,
  transform: (data, ctx?) => data,
  mutationMode:'pessimistic',
  sanitizeEmptyValues:true,
  warnWhenUnsavedChanges:true,
  toolbar:'default'|'none'|elementRef,
  validate?: (values) => errorsObject }       // form-level (mutually exclusive w/ input-level)
```

```js
// InputDescriptor
{ kind:'input', type:'text'|'number'|'select'|'reference'|..., source:'title',
  label?, defaultValue?, disabled?, readOnly?, helperText?, fullWidth?,
  validate?: [ (value, allValues, meta) => undefined|string|{message,args} ],
  format?, parse?,                             // named or fn converters
  choices?, optionText?, optionValue?, translateChoice?,   // choice inputs
  reference?, filter?, sort?, perPage?,        // reference inputs
  child?: InputDescriptor }                    // reference wraps one selector child
```

### 9.2 Centralized FormStore (the `useInput` equivalent)

Per `05 §5`/`§8`, inputs are **dumb, `source`-tagged views over one centralized form-state object**, not self-owned state. Each `<sa-simple-form>` owns a `FormStore`:

```js
FormStore = {
  values: signal({...}),          // keyed by source path (dot-path + array index aware)
  errors: signal({}),             // keyed by source path
  touched: signal({}),
  dirty: computed(...),
  isValid: computed(...),
  getField(source), setField(source, value), validateField(source), validateAll()
}
```

An input in `connectedCallback` registers against the nearest `FormStore` (via `this.closest('sa-simple-form,sa-tabbed-form')`), renders the value from the store, and on `input`/`change` writes back. Validation, defaults, format/parse, dirty-tracking, and submit are all handled by the form container — never the input. This is the direct translation of react-admin centralizing state in react-hook-form.

### 9.3 Validation — built-in validators mirroring react-admin

We ship factories with the same names/semantics (`05 §4.1`):

`required(msg?)`, `minLength(n,msg?)`, `maxLength(n,msg?)`, `minValue(n,msg?)`, `maxValue(n,msg?)`, `number(msg?)`, `email(msg?)`, `regex(pattern,msg?)`, `choices(list,msg?)`.

Each is `(...args) => (value, allValues, meta) => undefined | string | {message,args}`. Validators run in order, first failure wins. Two authoring styles:

- **JS:** `validate: [required(), minLength(2), maxLength(15)]`
- **HTML DSL:** `validate="required|minLength:2|maxLength:15"` — parsed into the same pipeline. Custom/async validators use the `.validate` JS property (array of functions), since a string DSL can't express arbitrary logic.

`required()` in the pipeline flips the field's `isRequired`, which auto-appends a `*` to the label — same trick as react-admin. Form-level `validate` (whole-values → error object) is supported and, per RHF's constraint, is mutually exclusive with input-level validators on the same form (we warn if both are present — see §11). Server-side errors use the same `{ errors: { field: message|{message,args} } }` shape mapped back onto the FormStore.

### 9.4 Defaults, transform, submit flow

Order of operations preserved from `05 §7`: `defaultValues`/seed record → user edits (live validation) → submit runs `validateAll()` → on success `transform(data)` (async-capable; edit form also gets `{previousData}`) → `sanitizeEmptyValues` strips empty strings → `dataProvider.create/update` → redirect per `redirect`. `<sa-save-button>` triggers submit; `<sa-form-toolbar>` holds save/delete; `warn-when-unsaved-changes` wires a `beforeunload` + in-app nav guard against the FormStore dirty flag.

### 9.5 ReferenceInput / ReferenceArrayInput

```html
<sa-reference-input source="author_id" reference="authors" filter='{"active":true}' per-page="50">
  <sa-select-input option-text="name"></sa-select-input>
</sa-reference-input>

<sa-reference-array-input source="tag_ids" reference="tags">
  <sa-select-array-input></sa-select-array-input>
</sa-reference-array-input>
```

Data flow matches `06 §4.4–4.5`: `getMany()` to hydrate the current value(s), `getList()` (narrowed by search text) for choices. Validation/format live on the **child** selector; `optionValue` forced to `id`, `translateChoice` forced to `false` when nested in a reference input. Default child = `sa-autocomplete-input` (single) / `sa-autocomplete-array-input` (multi) if none supplied.

---

## 10. Field / Input catalog for the MVP

### 10.1 Fields (`sa-*-field`)

| Element | JS config | Key attributes / props | Notes |
|---|---|---|---|
| `sa-text-field` | `f.text()` | `source`, `label`, `empty-text` | default fallback field |
| `sa-number-field` | `f.number()` | `source`, `options` (Intl), `text-align` | locale number, right-aligned |
| `sa-boolean-field` | `f.boolean()` | `source`, `true-text`, `false-text` | check/cross |
| `sa-date-field` | `f.date()` | `source`, `options`, `show-time` | locale date |
| `sa-email-field` | `f.email()` | `source` | `mailto:` link |
| `sa-url-field` | `f.url()` | `source` | `<a href>` |
| `sa-select-field` | `f.select()` | `source`, `choices`, `option-text`, `option-value` | resolves value→label |
| `sa-reference-field` | `f.reference()` | `source`, `reference`, `link`, children | many-to-one; batched getMany |
| `sa-reference-array-field` | `f.referenceArray()` | `source`, `reference`, children | many-to-many; getMany |
| `sa-array-field` | `f.array()` | `source`, children | repeatable groups over an array-valued source |
| `sa-function-field` | `f.fn()` | `.render` (fn) | escape hatch |

`sa-reference-many-field` (reverse FK via `getManyReference`, `target` attr) is included if time allows in v0.1, else v0.2.

### 10.2 Inputs (`sa-*-input`)

| Element | JS config | Key attributes / props | Notes |
|---|---|---|---|
| `sa-text-input` | `i.text()` | `source`, `validate`, `multiline`, `default-value` | |
| `sa-number-input` | `i.number()` | `source`, `step`, `min`, `max` | |
| `sa-boolean-input` | `i.boolean()` | `source` | switch/checkbox |
| `sa-date-input` | `i.date()` | `source` | `type=date` |
| `sa-email-input` | `i.email()` | `source` | `type=email` + `email()` validator hint |
| `sa-url-input` | `i.url()` | `source` | `type=url` |
| `sa-select-input` | `i.select()` | `source`, `choices`, `option-text`, `option-value` | single select |
| `sa-select-array-input` | `i.selectArray()` | `source`, `choices` | multi `<select>` |
| `sa-checkbox-group-input` | `i.checkboxGroup()` | `source`, `choices` | multi via checkboxes |
| `sa-autocomplete-input` | `i.autocomplete()` | `source`, `choices`, `filter-to-query` | searchable single |
| `sa-autocomplete-array-input` | `i.autocompleteArray()` | `source`, `choices` | searchable multi/tags |
| `sa-reference-input` | `i.reference()` | `source`, `reference`, `filter`, `sort`, `per-page`, child | single FK picker |
| `sa-reference-array-input` | `i.referenceArray()` | `source`, `reference`, child | multi FK picker |
| `sa-array-input` | `i.array()` | `source`, `<sa-form-iterator>` child | repeatable object rows |
| `sa-search-input` | `i.search()` | `source`, `always-on` | filter-only text w/ icon |

Every input shares the baseline contract (`source` required, `validate`, `label`, `default-value`, `format`/`parse`, `disabled`/`read-only`, `helper-text`). Choice inputs share `choices`/`option-text`/`option-value`/`translate-choice` (`06 §5`). This is the exact MVP breadth the task specifies.

---

## 11. Diagnostics — the "unknown field/input/config hint" feature

A dedicated `core/diagnostics.js` module exposes `warn(code, detail)` / `error(code, detail)`. Every message: (1) is prefixed `[simple-admin]`, (2) names the exact element/resource/source at fault, (3) states the likely cause, (4) states the fix. It **degrades gracefully** — an unknown field renders nothing (or raw value) and logs, rather than throwing and killing the page.

### Trigger table with exact message strings

| Situation | Level | Exact console message |
|---|---|---|
| Unregistered `sa-*` tag used inside a datagrid/form | `warn` | `[simple-admin] Unknown element <sa-fancy-field> inside <sa-datagrid resource="posts">. This tag is not a registered field/input. Did you mean <sa-text-field>? Register it with SimpleAdmin.registerField('fancy', …) or remove it. Skipping this column.` |
| Field/input missing `source` | `error` | `[simple-admin] <sa-text-field> is missing the required "source" attribute (inside resource "posts", list view). Add source="fieldName" so it knows which record property to display. Skipping.` |
| dataProvider missing a method needed for an attempted op | `error` | `[simple-admin] dataProvider.getManyReference is not a function, but resource "comments" tried a reference-many lookup (target="post_id"). Add getManyReference(resource, params) to your dataProvider. See _docs/react-admin/02-data-provider.md.` |
| Resource declared with no list/edit/create/show | `warn` | `[simple-admin] Resource "authors" was declared without any of list/edit/create/show views. It will register for reference lookups only and show no menu entry. If that is intentional, ignore this hint.` |
| Reference points at an undeclared resource | `warn` | `[simple-admin] <sa-reference-field reference="publishers"> in resource "posts" points to resource "publishers", which is not declared in <sa-admin>. Declare <sa-resource name="publishers"> (even with no views) so its records can be fetched. Rendering the raw id for now.` |
| Navigating to a view a resource doesn't define | `warn` | `[simple-admin] Route #/posts/5 requested the "edit" view, but resource "posts" has no edit view configured. Redirecting to the list. Add <sa-edit> or an edit:{} config to enable it.` |
| Both input-level and form-level `validate` present | `warn` | `[simple-admin] Form for "posts" has both form-level validate and input-level validate on <sa-text-input source="title">. Like react-admin/react-hook-form, these are mutually exclusive — the form-level validator will be ignored for that field. Pick one.` |
| `always-on` filter also has `default-value` | `warn` | `[simple-admin] Filter <sa-text-input source="title"> has both always-on and default-value, which react-admin disallows. Use filter-default-values on <sa-list> for a default the user can change. Ignoring default-value.` |
| Unknown validator name in DSL | `error` | `[simple-admin] Unknown validator "minLenght" in validate="required|minLenght:2" on <sa-text-input source="title">. Valid names: required, minLength, maxLength, minValue, maxValue, number, email, regex, choices. Skipping the unknown one.` |
| No dataProvider passed to `<sa-admin>` | `error` | `[simple-admin] <sa-admin> was mounted without a dataProvider. Nothing can load. Pass one via SimpleAdmin.admin({ dataProvider }) or the .dataProvider property. See 02-data-provider.md.` |
| authProvider missing but requireAuth set | `error` | `[simple-admin] requireAuth is set but no authProvider was provided to <sa-admin>. Either remove requireAuth or supply an authProvider with checkAuth/login. See 03-auth-provider.md.` |
| Record missing `id` | `warn` | `[simple-admin] A record returned by dataProvider.getList("posts") has no "id" field: {title:"…"}. Every record must have a unique id (string|number). Rows may not update or select correctly.` |

All hints are **debounced/deduped** so a 100-row grid with the same misconfigured column logs once, not 100 times. A global `SimpleAdmin.setLogLevel('silent'|'error'|'warn'|'verbose')` lets teams dial it down in production.

---

## 12. File / module layout

```
simple-admin/
├── index.js                      # public entry: exports SimpleAdmin, fields (f), inputs (i), providers
├── core/
│   ├── signal.js                 # signal/computed/effect reactive primitive (~60 lines)
│   ├── store.js                  # ListController & FormController factories
│   ├── registry.js               # resource registry + custom-element registration map
│   ├── descriptor.js             # descriptor normalization (HTML→desc, JS→desc, shared)
│   ├── router.js                 # hash router (+ optional history mode), route table
│   ├── context.js                # DOM-ancestry context lookup (record/list/form/resource)
│   └── diagnostics.js            # console hint system (§11)
├── providers/
│   ├── httpError.js              # HttpError class (verbatim from ra)
│   ├── fetchJson.js              # fetch wrapper: auto-JSON, HttpError on non-2xx
│   ├── simpleRest.js             # saDataSimpleRest(apiUrl) — twin of ra-data-simple-rest
│   ├── jsonServer.js             # saDataJsonServer(apiUrl) — twin of ra-data-json-server
│   ├── combine.js                # combineDataProviders (verbatim)
│   ├── lifecycle.js              # withLifecycleCallbacks (verbatim)
│   ├── refreshAuth.js            # addRefreshAuthTo{Data,Auth}Provider (verbatim)
│   ├── cache.js                  # Map-based query cache + invalidation
│   └── batcher.js                # per-tick getMany id batcher (N+1 avoidance)
├── auth/
│   ├── authGuard.js              # checkAuth/checkError/canAccess wiring
│   └── localAuthProvider.js      # sample username/password provider (localStorage)
├── components/
│   ├── admin.js                  # <sa-admin> root: providers, router mount, layout shell
│   ├── resource.js               # <sa-resource> registration
│   ├── layout.js                 # AppBar + Menu + content (light DOM, themeable)
│   ├── list.js                   # <sa-list> controller
│   ├── datagrid.js               # <sa-datagrid> keyed-row table
│   ├── simpleList.js             # <sa-simple-list> mobile layout
│   ├── filters.js                # <sa-filters> filter form/dropdown
│   ├── pagination.js             # <sa-pagination>
│   ├── show.js                   # <sa-show> + simple/tabbed show layouts
│   ├── create.js                 # <sa-create>
│   ├── edit.js                   # <sa-edit>
│   ├── simpleForm.js             # <sa-simple-form> + FormStore
│   ├── tabbedForm.js             # <sa-tabbed-form> + <sa-form-tab>
│   ├── toolbar.js                # <sa-form-toolbar>, <sa-save-button>, <sa-delete-button>
│   ├── bulkActions.js            # <sa-bulk-delete-button>, <sa-bulk-export-button>
│   ├── login.js                  # <sa-login> page
│   └── canAccess.js              # <sa-can-access> guard
├── fields/
│   ├── baseField.js              # shared field mixin (source resolution, label, empty-text)
│   ├── textField.js  numberField.js  booleanField.js  dateField.js
│   ├── emailField.js  urlField.js  selectField.js  functionField.js
│   ├── referenceField.js  referenceArrayField.js  referenceManyField.js
│   └── arrayField.js
├── inputs/
│   ├── baseInput.js              # shared input mixin (FormStore binding, validate, format/parse)
│   ├── textInput.js  numberInput.js  booleanInput.js  dateInput.js
│   ├── emailInput.js  urlInput.js  searchInput.js
│   ├── selectInput.js  selectArrayInput.js  checkboxGroupInput.js
│   ├── autocompleteInput.js  autocompleteArrayInput.js
│   ├── referenceInput.js  referenceArrayInput.js
│   └── arrayInput.js             # + <sa-form-iterator>
├── validators/
│   └── index.js                  # required/minLength/.../choices + DSL parser
├── theme/
│   ├── base.css                  # structural, unstyled-ish base sheet
│   └── shadcn.css                # optional preset mapping --sa-* → shadcn tokens
├── examples/
│   ├── html-only/index.html      # pure custom-element admin, CDN script tags
│   ├── js-config/index.html      # pure JS-config admin
│   ├── mixed/index.html          # both syntaxes in one app
│   └── mock-data-provider.js      # in-memory provider for demos/tests
└── README.md
```

---

## 13. Non-goals / out of scope for v1

Decisions made and justified:

| Excluded | Verdict | Why |
|---|---|---|
| **Rich text / Markdown inputs** | Out | Heavy, needs a WYSIWYG dependency; against zero-deps. A plain `multiline` textarea covers the 80% case. Add as an opt-in module later. |
| **Optimistic & undoable mutations** | Out (v0.1); **v0.3** | Needs cache-snapshot rollback + delayed-commit queue tightly coupled to react-query in ra. v1 is `pessimistic` only (`02 §8.2` blesses this). |
| **i18n framework** | **Minimal only** | We ship the *humanize `source` → label* convention and allow a `label` override, plus a single `translate(key)` seam so a provider can be added. No full Polyglot dictionary system in v1. Reasoning: the label convention is 90% of the value; a full i18n layer is a lot of surface for an MVP. |
| **SSR / server rendering** | Out | Explicitly an SPA (`01 §1`); hash routing + client fetch. No SSR story. |
| **File / image upload inputs** | Out (v0.1); **v0.2** | The `rawFile → URL` provider transform is portable (`02 §7`) but the input UI + preview is nontrivial. Defer. |
| **Saved queries / configurable columns** | Out (v0.1); **v0.2** | Nice-to-have store features; not core CRUD. |
| **CSV export** | Minimal | A default `bulk-export-button` that JSON→CSV-serializes selected rows; no pluggable `exporter` pipeline in v1. |
| **Guessers (EditGuesser/ListGuesser)** | Out; **v0.3** | Scaffolding convenience, not core. |
| **Expand panels, tree/calendar list layouts** | Out | Table + simple-list cover the MVP. |
| **GraphQL data provider** | Out (but supported by contract) | The contract is transport-agnostic; anyone can write one. We only ship REST twins. |

---

## 14. Phased roadmap

### v0.1 — MVP ("a working CRUD admin from a script tag")
- Core: signals, ListController/FormController, descriptor model, hash router, DOM-context, diagnostics.
- Providers: contract + `HttpError`, `fetchJson`, `saDataSimpleRest`, `saDataJsonServer`, mock provider, `Map` cache, getMany batcher. **Pessimistic mutations only.**
- Auth: contract + `checkAuth`/`checkError` wiring, `localAuthProvider`, `<sa-login>`, `<sa-can-access>`.
- Components: `sa-admin`, `sa-resource`, layout/appbar/menu, `sa-list`, `sa-datagrid`, `sa-filters`, `sa-pagination`, `sa-show` (+simple show layout), `sa-create`, `sa-edit`, `sa-simple-form`, toolbar, `sa-bulk-delete-button`.
- Fields: text, number, boolean, date, email, url, select, reference, reference-array, function.
- Inputs: text, number, boolean, date, email, url, select, select-array, checkbox-group, autocomplete (single), reference, reference-array, search.
- Validators: full built-in set + DSL.
- Both syntaxes (HTML + JS config), theme base sheet + shadcn preset.
- Examples: html-only, js-config, mixed.

### v0.2 — depth
- `sa-simple-list`, `sa-tabbed-form`/`sa-tabbed-show-layout`, `sa-array-input`/`sa-array-field` (+ iterator), `sa-reference-many-field`, autocomplete-array.
- File/Image inputs (+ base64 & multipart provider recipes).
- Saved queries + configurable/selectable columns (store-backed).
- CSV export button, expand panels.
- History-API routing mode + `basename`.

### v0.3 — parity polish
- Optimistic + undoable mutation modes (snapshot/rollback + delayed-commit queue + undo notification).
- Guessers (`ListGuesser`/`EditGuesser`) for scaffolding.
- OAuth `handleCallback` + `#/auth-callback`.
- Minimal i18n provider (Polyglot-style) + `resources.<name>.fields.<field>` key convention.
- Preferences store (sidebar/theme/locale persistence) mirroring react-admin's `useStore`.
```
