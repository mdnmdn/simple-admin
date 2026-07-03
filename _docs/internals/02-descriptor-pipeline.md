# 02 — The Descriptor Pipeline (dual-syntax internals)

**Audience:** an engineer extending simple-admin's core. This document explains the
mechanism by which the two author-facing syntaxes — HTML light-DOM markup and JS-config
objects — converge on **identical runtime behaviour**. It is not a how-to; for that see
`_docs/manual/02-resources-and-views.md`. Everything below refers to the real source in
`src/core/descriptor.js`, `src/components/admin.js`, `src/core/registry.js`, and the
concrete field/view components.

---

## 1. The two entry points and the single convergence point

There is exactly one runtime representation of a component's configuration: a plain
**descriptor** object carrying a `kind` discriminator and a bag of scalar/array/function
properties. Both authoring paths produce descriptors; the components themselves never care
which path produced them.

```
HTML markup ──> element in light DOM ──> descriptorFromElement(el, kind) ─┐
                                                                          ├─> descriptor {kind, ...}
JS config   ──> plain object ──> normalizeConfig / factory ──────────────┘
```

The subtle part, and the entire subject of this document, is that the **convergence is not
at the descriptor level** for container views. A `<sa-datagrid>` does not accept a
`columns` array — it reads its own light-DOM `sa-*-field` children. So the JS-config path
has to be pushed *past* the descriptor stage and **materialized into real DOM elements**
before a view ever connects. That materialization step (`materializeView` in
`admin.js`) is what makes "one renderer, two syntaxes" true.

Two coercion boundaries exist and only two:

- `applyAttribute` / `absorbAttributes` — kebab-case DOM attribute → descriptor key (HTML path).
- `normalizeConfig` / registry factories — JS object → descriptor (JS path), essentially a
  pass-through with `kind` stamped and one `validate` DSL convenience.

The header comment in `descriptor.js` states the invariant directly:

```js
// Both author-facing syntaxes normalize to the same descriptor object:
//   - HTML light-DOM element  -> descriptorFromElement(el, kind) / absorbAttributes(desc, el)
//   - JS config object        -> normalizeConfig(config, kind)
//
// The attribute<->descriptor-key coercion is the ONLY transformation between the two paths.
```

---

## 2. The descriptor model (real shapes)

These are the object shapes actually constructed in the codebase, not the earlier design
proposal. Each carries a `kind` discriminator.

### AdminDescriptor — `kind: 'admin'`
Built by `SimpleAdmin.admin(config)` in `src/index.js`:

```js
const descriptor = { kind: 'admin', requireAuth: false, ...config };
```

Consumed by `SaAdmin`'s `set descriptor(d)`, which cherry-picks four keys —
`dataProvider`, `authProvider`, `title`, `requireAuth`. Anything else on the object is
ignored by the admin element. Note `dataProvider`/`authProvider` are **functions/objects**,
which is precisely why the HTML-only example still sets them via JS property assignment —
they cannot be expressed as attributes.

### ResourceDescriptor — `kind: 'resource'`
Built in two places, identically shaped:

- JS path, `SimpleAdmin.resource(name, config)`:
  ```js
  const descriptor = { kind: 'resource', name, ...config };
  ```
- HTML path, `SaResource._buildDescriptor()`:
  ```js
  const descriptor = {
    kind: 'resource',
    name: this.getAttribute('name'),
    icon: this.getAttribute('icon') || undefined,
    recordRepresentation: this.getAttribute('record-representation') || undefined,
  };
  for (const view of VIEWS) {
    const el = this.querySelector(`:scope > sa-${view}`);
    if (el) descriptor[view] = el;
  }
  ```

The crucial divergence in shape: **the `list`/`create`/`edit`/`show` keys hold a real
`HTMLElement` in the HTML path, but a plain ViewDescriptor object in the JS path.** This is
the discriminator `SaAdmin._mountView` branches on:

```js
if (viewSpec instanceof HTMLElement) {
  this._mountAuthoredView(viewSpec);
} else {
  this._mountConfiguredView(route, resourceDescriptor, viewSpec);
}
```

Other resource keys seen in the wild: `recordRepresentation`, `icon`.

### ViewDescriptor — `kind: 'view'`
Only the JS path builds a standalone view descriptor object; in the HTML path the "view
descriptor" IS the element and is only realized on connect. `_mountConfiguredView` stamps
it:

```js
viewEl.descriptor = { kind: 'view', type: route.view, resource: route.resource, ...viewSpec };
```

Keys actually read downstream (from the JS-config examples and `store.js`
`createListController`):

- **Scalars/objects consumed by the view controller:** `sort: {field, order}`, `perPage`,
  `rowClick`, `redirect`, `filterDefaultValues`, `filter`. `createListController` reads
  `descriptor.sort.field`/`.order`, `descriptor.perPage`, `descriptor.filterDefaultValues`.
- **Array keys that trigger materialization** (never read as arrays by any component):
  `filters`, `columns`, `fields`, `inputs`, `groups`, `bulkActions`, plus a `body`
  sub-object (`{ component: 'simple-list' }`).

### FieldDescriptor / InputDescriptor — `kind: 'field'` / `kind: 'input'`
Built by the registry's auto-generated factories (see §4) or by `BaseField`'s constructor
default `this._descriptor = { kind: 'field' }`. Universal keys: `type` (the registry key,
e.g. `'text'`, `'reference'`), `source`. Common extras: `label`, `sortable`, `emptyText`,
`multiline`, `validate` (an **array of validator functions** after DSL parse, see §3),
`reference`, `link`, `optionText`, `choices`. Nesting is expressed with `child` (singular,
the factory ergonomic) or `children` (array, what `referenceField.js`/`arrayField.js`
actually walk as real light-DOM template children — see §6).

---

## 3. The HTML → descriptor path

A view/field/input element only ever calls `descriptorFromElement(el, kind)` (via
`absorbAttributes`). `SaList.connectedCallback` is representative:

```js
const descriptor = descriptorFromElement(this, 'view');
descriptor.type = 'list';
if (!descriptor.resource) descriptor.resource = this._resolveResource();
if (descriptor.rowClick === undefined) descriptor.rowClick = false;
```

`descriptorFromElement` (ignore the `seed` half for now, that's §5) reduces to
`absorbAttributes({ kind }, el)`, which walks every attribute through `applyAttribute`:

```js
export const absorbAttributes = (descriptor, el) => {
  let validateDSL = null;
  for (const attr of Array.from(el.attributes || [])) {
    if (attr.name === 'validate') { validateDSL = attr.value; continue; }
    applyAttribute(descriptor, attr.name, attr.value);
  }
  if (validateDSL != null) {
    descriptor.validate = parseValidatorDSL(validateDSL, {
      tag: el.localName, source: descriptor.source,
    });
  }
  return descriptor;
};
```

`validate` is pulled out of the loop and handled last on purpose: `parseValidatorDSL` needs
the already-resolved `descriptor.source` for its diagnostics context, so the loop must
finish (populating `source`) before it runs.

### `applyAttribute` — the coercion table in action

`applyAttribute` is a small dispatch keyed off four sets (`BOOLEAN_ATTRS`, `JSON_ATTRS`,
`NUMERIC_ATTRS`, `IGNORED_ATTRS`). Three concrete cases worth internalizing:

**(a) `sort-field` + `sort-order` collapse into a nested `sort` object.** These are the only
two attributes handled *before* the kebab→camel conversion, precisely because they map two
flat attributes onto one nested key:

```js
if (name === 'sort-field') {
  descriptor.sort = { ...(descriptor.sort || {}), field: value };
  return descriptor;
}
if (name === 'sort-order') {
  descriptor.sort = { ...(descriptor.sort || {}), order: value };
  return descriptor;
}
```

So `<sa-list sort-field="published_at" sort-order="DESC">` yields
`descriptor.sort === { field: 'published_at', order: 'DESC' }` — byte-identical to the
JS-config `sort: { field: 'published_at', order: 'DESC' }`.

**(b) JSON attributes parse via `safeJsonParse`.** `choices`, `filter`,
`filter-default-values`, `options`:

```js
if (JSON_ATTRS.has(name)) { descriptor[key] = safeJsonParse(value); return descriptor; }
```

`safeJsonParse` swallows parse errors and returns the raw string, so a malformed
`choices='[...'` degrades to a string rather than throwing during element connect (the
system's general "degrade, never throw" stance).

**(c) `validate` DSL parse.** Not in any set — special-cased in `absorbAttributes` as
above. `validate="required|email"` becomes an **array of validator functions**, structurally
the same value the JS path produces (see §4). This is why a descriptor's `validate` is never
a string at runtime regardless of syntax.

Boolean-presence attributes (`sortable`, `always-on`, `multiline`, `required`, …) set the
camelCased key to `true` on mere presence, `false` only for the literal string `"false"`:

```js
if (BOOLEAN_ATTRS.has(name)) { descriptor[key] = value !== 'false'; return descriptor; }
```

The `value == null` branch above it handles `attributeChangedCallback(name, old, null)`
(attribute removal): booleans flip to `false`, everything else is `delete`d. Numeric
attributes (`per-page`, `page`, `min`, `max`, `step`) coerce through `Number`, falling back
to the raw string on `NaN`. `IGNORED_ATTRS` (`class`, `style`, `id`, `slot`) are dropped —
DOM plumbing, not descriptor data. Everything else is copied verbatim under its camelCased
key via `camelCase` (`empty-text`→`emptyText`, `read-only`→`readOnly`).

Note that fields/inputs run this same machinery incrementally: `BaseField._patchFromAttribute`
routes single attribute changes back through `applyAttribute` (and `validate` through
`parseValidatorDSL`), so the descriptor stays live across `attributeChangedCallback`.

---

## 4. The JS-config → descriptor path

### Factories

`registerField`/`registerInput` auto-generate a JS-config factory when the registrant does
not supply one:

```js
fields[type] = factory || ((props = {}) => ({ kind: 'field', type, ...props }));
```

So `f.text({ source: 'title', sortable: true })` is literally
`{ kind: 'field', type: 'text', source: 'title', sortable: true }` — a plain object, no DOM,
no coercion. The factory map is re-exported as `f`/`i` from `index.js`. `f.email`, `i.select`,
etc. exist because their modules called `registerField('email', …)` / `registerInput('select', …)`
at import time; the `type` string closes over the factory. `f.reference({ child: f.text(...) })`
nests a child descriptor object directly.

### Resource / admin builders

`SimpleAdmin.resource(name, config)` and `SimpleAdmin.admin(config)` are trivial object
constructors (shown in §2) — they stamp `kind` and register. There is deliberately no
attribute coercion here because there are no attributes; JS values are already in
"descriptor space."

`normalizeConfig` exists for structural parity and is the JS-side analogue of `absorbAttributes`:

```js
export const normalizeConfig = (config = {}, kind) => {
  const descriptor = { kind, ...config };
  if (typeof descriptor.validate === 'string') {
    descriptor.validate = parseValidatorDSL(descriptor.validate, { source: descriptor.source });
  }
  return descriptor;
};
```

Its one real transform: a `validate` **string** in JS config gets DSL-parsed to a function
array, exactly as the HTML path does. That is why `i.text({ validate: 'required' })` and
`<sa-text-input validate="required">` end up with identical `validate` arrays.

### `materializeView` — the load-bearing step

A ViewDescriptor's `columns`/`filters`/`fields`/`inputs`/`groups` are arrays of plain
descriptor objects. No component reads those arrays. `<sa-datagrid>`, `<sa-filters>`,
`<sa-simple-form>`/`<sa-tabbed-form>` and `<sa-simple-show-layout>` **only look at their
light-DOM children** — the same path the HTML syntax populates by hand. So before a
JS-config view element connects, `_mountConfiguredView` calls `materializeView(viewEl, viewSpec)`
to build those children. Each ViewDescriptor array key maps to exactly one container tag:

| ViewDescriptor key | container element created | child factory | notes |
|---|---|---|---|
| `filters` (non-empty array) | `sa-filters` | `createInputElement` | |
| `columns` (non-empty array) | `sa-datagrid`, or `sa-simple-list` if `body.component === 'simple-list'` | `createFieldElement` | also materializes `bulkActions` into `sa-bulk-delete-button` children |
| `fields` (non-empty array) | `sa-simple-show-layout` | `createFieldElement` | the Show view layout |
| `groups` (non-empty array) | `sa-tabbed-form` (with `sa-form-tab` per group) | `createInputElement` | takes precedence over `inputs` |
| `inputs` (non-empty array) | `sa-simple-form` | `createInputElement` | **`else if` after `groups`** |

The `groups`/`inputs` relationship is an `else if`, not two independent `if`s — a view
with both `groups` and `inputs` uses `groups` and ignores `inputs`:

```js
if (Array.isArray(viewSpec.groups) && viewSpec.groups.length) {
  const formEl = document.createElement('sa-tabbed-form');
  ...
} else if (Array.isArray(viewSpec.inputs) && viewSpec.inputs.length) {
  const formEl = document.createElement('sa-simple-form');
  ...
}
```

`bulkActions` is materialized as a *sibling under the datagrid body*, mirroring the HTML
syntax where `<sa-bulk-delete-button>` is written by hand. The datagrid never reads the
`bulkActions` array:

```js
for (const action of viewSpec.bulkActions || []) {
  const name = typeof action === 'string' ? action : action.type;
  if (name === 'delete') bodyEl.appendChild(document.createElement('sa-bulk-delete-button'));
}
```

### `createFieldElement` / `createInputElement` and the unknown-type fallback

Each plain descriptor becomes a real `sa-<kebab-type>-field`/`-input` element (tag derived
via `fieldTag`/`inputTag` from the registry) with its `.descriptor` **pre-set** — this is
the JS-side equivalent of the seed used by the HTML path:

```js
const createFieldElement = (fieldDescriptor = {}) => {
  const type = getFieldClass(fieldDescriptor.type) ? fieldDescriptor.type : 'text';
  if (type !== fieldDescriptor.type) {
    diagnostics.warn('unknown-element', { message: /* … falling back to a text field */ });
  }
  const el = document.createElement(fieldTag(type));
  el.descriptor = { kind: 'field', ...fieldDescriptor, type };
  const kids = fieldDescriptor.children || (fieldDescriptor.child ? [fieldDescriptor.child] : []);
  for (const child of kids) el.appendChild(createFieldElement(child));
  return el;
};
```

Three things to note:

1. **Unknown-type diagnostic fallback.** If `getFieldClass(type)` returns nothing, `type`
   silently becomes `'text'` and a `diagnostics.warn('unknown-element', …)` fires with a
   message telling the author to `registerField(...)`. The element is still created (as a
   text field) — never a throw. `createInputElement` mirrors this with `'text'` input.
   Note the fallback rewrites the stored `.descriptor.type` too (`...fieldDescriptor, type`),
   so downstream sees a coherent text descriptor.
2. **`child` vs `children`.** The factory ergonomic is singular `child`
   (`f.reference({ child: f.text(...) })`); the general/HTML-authored form is a `children`
   array. `createFieldElement` accepts both and recurses. `createInputElement` accepts only
   `child` (singular) — inputs never carry a `children` array in this codebase.
3. **Recursion builds real nested light DOM.** `f.reference({ child: f.text({source:'name'}) })`
   becomes `<sa-reference-field><sa-text-field></sa-text-field></sa-reference-field>` with
   both descriptors pre-set — which is exactly the shape `referenceField.js` expects (§6).

---

## 5. The `.descriptor` seed mechanism in `descriptorFromElement`

This is the integration fix that makes the JS-config view path actually work, and it is
easy to remove by accident. Here is the whole function:

```js
export const descriptorFromElement = (el, kind) => {
  const seed = el && el.descriptor && typeof el.descriptor === 'object' ? el.descriptor : null;
  return absorbAttributes({ kind, ...seed }, el);
};
```

### Why it is necessary

View elements (`<sa-list>`, `<sa-edit>`, …) **only** obtain their descriptor by calling
`descriptorFromElement(this, 'view')` on connect — look again at `SaList.connectedCallback`.
But in the JS-config path, `_mountConfiguredView` sets the view's scalar configuration as a
plain property *before append*:

```js
viewEl.descriptor = { kind: 'view', type: route.view, resource: route.resource, ...viewSpec };
if (route.id != null) viewEl.id = route.id;
materializeView(viewEl, viewSpec);
resourceHostEl.appendChild(viewEl);   // <-- only now does connectedCallback fire
```

That `.descriptor` object holds `sort`, `perPage`, `rowClick`, `redirect`,
`filterDefaultValues` — none of which are DOM attributes on the element. Without the seed,
`descriptorFromElement` would rebuild the descriptor purely from attributes (`{ kind }` plus
whatever attrs exist — for a JS-config view, essentially none but `id`), and **every
JS-config scalar would be silently discarded.** A JS `perPage: 10` / `rowClick: 'edit'`
list would come up with defaults, no error. The seed step reads the pre-set `.descriptor`
back in as the base object so those scalars survive.

The comment in the source spells this out:

```js
// ...view components like <sa-list>/<sa-edit> only ever call this
// function, so without this seed step JS-config scalar values — sort/perPage/rowClick/redirect/
// etc. — would be silently discarded in favor of an attribute-only rebuild).
```

### Precedence: attributes win over the seed

`absorbAttributes({ kind, ...seed }, el)` spreads the seed first, then runs the attribute
loop, which **overwrites** any key it touches. So when the same key is present both as a
seeded property and as a DOM attribute, the attribute wins. The rationale (also in the
source comment): an element that started with a JS-config base but later had an attribute
set reflects the "most recent author intent" via that attribute. In practice the two are
mutually exclusive per key — a JS-config view has no such attributes — so the merge is
additive, but the ordering is deliberate and correct for the mixed case.

Note the analogous, separate guard on `SaResource`: it must *not* rebuild its descriptor
from attributes once `_mountConfiguredView` has stamped `.descriptor` on it. It uses an
`_ownsDescriptor` flag rather than a seed merge, because a resource host synthesized for the
JS path only gets a `name` attribute stamped for debugging and must keep the real object.

---

## 6. Children-as-columns: a component reading its own light DOM

`referenceField.js` is the concrete proof that materialization into real elements (not a
descriptor array) is what components consume. `SaReferenceField` snapshots its light-DOM
field children on first connect and replays them against the fetched related record:

```js
connectedCallback() {
  if (!this._templateChildren) {
    this._templateChildren = [...this.children];
    for (const child of this._templateChildren) child.remove();
  }
  super.connectedCallback();
}
```

```js
_renderResolved(related) {
  this.__recordContext = { record: related };
  this.textContent = '';
  let content;
  if (this._templateChildren.length) {
    content = document.createDocumentFragment();
    for (const child of this._templateChildren) content.appendChild(child);
  } else {
    content = document.createTextNode(String(related.id));
  }
  this.appendChild(this._maybeLink(content, related.id));
}
```

It never inspects a descriptor's `children` array — it reads `this.children`. For the HTML
path those children are authored markup; for the JS path they are the elements
`createFieldElement` recursively built from the `child`/`children` descriptors. Both arrive
as identical light DOM, so this component is written exactly once. (`arrayField.js` does the
same with `cloneNode(true)` per array item.)

---

## 7. Worked walkthrough: the `posts` list view

Take the `posts` list from both examples and trace to the object present by the time
`<sa-list>.connectedCallback` runs.

### HTML (`examples/html-only/index.html`)

```html
<sa-list sort-field="published_at" sort-order="DESC" per-page="10" row-click="edit">
  <sa-filters> … </sa-filters>
  <sa-datagrid> … <sa-bulk-delete-button></sa-datagrid>
  <sa-bulk-delete-button></sa-bulk-delete-button>
</sa-list>
```

At connect, `<sa-list>` has no `.descriptor` property, so `seed` is `null`.
`absorbAttributes({ kind:'view' }, el)` walks the four attributes:

- `sort-field="published_at"` → `sort.field`
- `sort-order="DESC"` → `sort.order`
- `per-page="10"` → NUMERIC → `perPage: 10` (number)
- `row-click="edit"` → passthrough → `rowClick: "edit"`

Then `SaList` stamps `type: 'list'`, resolves `resource: 'posts'` from the ambient
`<sa-resource>`, and (since `rowClick` is defined) leaves it. Result:

```js
{ kind:'view', type:'list', resource:'posts',
  sort:{ field:'published_at', order:'DESC' }, perPage:10, rowClick:'edit' }
```

The filters/columns are already real child elements in markup; nothing to materialize.

### JS config (`examples/js-config/index.html`)

```js
list: {
  sort: { field: 'published_at', order: 'DESC' },
  perPage: 10,
  rowClick: 'edit',
  filters: [ … ],
  columns: [ … ],
  bulkActions: ['delete'],
}
```

`_mountConfiguredView` sets
`viewEl.descriptor = { kind:'view', type:'list', resource:'posts', sort:{…}, perPage:10, rowClick:'edit', filters:[…], columns:[…], bulkActions:['delete'] }`,
then `materializeView` appends a `<sa-filters>` (2 input children), a `<sa-datagrid>` (5 field
children + a `<sa-bulk-delete-button>` from `bulkActions`), then appends the element. On
connect, `descriptorFromElement` seeds from that `.descriptor`; there are no attributes
except possibly `id` (absent for a list), so nothing overrides. `SaList` re-stamps
`type:'list'` (already `'list'`) and keeps the seeded `resource`/`rowClick`. Result:

```js
{ kind:'view', type:'list', resource:'posts',
  sort:{ field:'published_at', order:'DESC' }, perPage:10, rowClick:'edit',
  filters:[…], columns:[…], bulkActions:['delete'] }
```

### Convergence — and where it is *not* byte-identical

The two descriptors are **behaviourally identical** but **not byte-identical objects**, and
a contributor should know exactly why:

- The JS descriptor retains the raw `filters`/`columns`/`bulkActions` arrays as dead
  properties (nothing reads them post-materialization). The HTML descriptor never had them.
- Both produce the **same live light DOM** (`sa-filters` + `sa-datagrid` + bulk button with
  the same field/input descriptors), which is all any renderer consumes. `createListController`
  only reads `sort`, `perPage`, `filterDefaultValues`, `filter`, `resource` — all identical.
- Every field/input descriptor converges exactly: `f.text({source:'title', label:'Title',
  sortable:true})` → `{kind:'field', type:'text', source:'title', label:'Title', sortable:true}`
  equals the datagrid's `<sa-text-field source="title" label="Title" sortable>` after
  `absorbAttributes` (`sortable` boolean-presence → `true`).

One genuine content divergence exists between these two specific example files (authoring
drift, not a pipeline artifact): the HTML `create`/`edit` inputs use
`validate="required|minLength:3"` for `title`, while the JS config uses `validate: 'required'`.
After DSL parse these are different validator arrays. That is a difference in what was
authored, not in how the pipeline treats identical input.

---

## 8. Design rationale: why materialize into real elements

The alternative would be to have `<sa-datagrid>`/`<sa-simple-form>` accept a descriptor
array property and render from it. Materialization was chosen instead. What it buys:

- **One renderer, one code path.** Container components read `this.children` (or
  `querySelector(':scope > …')`) and nothing else. The HTML path and the JS path feed the
  same input. There is no second "render from descriptor array" branch to keep in sync — a
  class of dual-syntax drift bugs simply cannot occur.
- **"Children as columns" reuse everywhere.** `referenceField`, `arrayField`,
  `referenceArrayField`, datagrid, forms — all use the identical light-DOM-children template
  pattern (§6). Because JS config materializes to real children, every one of those
  components works under both syntaxes with zero syntax-awareness.
- **Context wiring for free.** Materialized elements live in the real DOM tree, so
  `findRecordContext`/`findResourceContext`/`findListContext` ancestor walks work without a
  parallel descriptor tree. That is also why `_mountConfiguredView` wraps the view in a
  synthesized `<sa-resource>` host — so descendant fields still find their ambient resource.

What it costs:

- **An extra DOM materialization pass** on every JS-config view mount (`materializeView` plus
  recursive `createFieldElement`/`createInputElement`). JS-config views are discarded and
  rebuilt on every navigation to them (HTML views are parked in a hidden host and reused), so
  this cost recurs.
- **Unknown-type fallback complexity.** Because a JS `type` string is resolved against the
  registry at materialization time (not authoring time), an unregistered type cannot fail
  loudly at definition; the pipeline must degrade to `text` with a diagnostic. That logic
  lives in two near-duplicate functions (`createFieldElement`/`createInputElement`).
- **Dead descriptor keys.** The raw `columns`/`filters`/etc. arrays linger on the view
  descriptor after materialization (§7), a minor foot-gun for anyone who assumes reading them
  back reflects runtime state.

---

## 9. Gotchas for a future contributor

**Adding a new ViewDescriptor array key that needs materialization.** Suppose you add a
hypothetical `expandPanel: [ … ]` to the list ViewDescriptor, meant to render an expandable
row panel. To make it work under *both* syntaxes you must:

1. **Touch `materializeView` in `src/components/admin.js`.** Add an
   `if (Array.isArray(viewSpec.expandPanel) && viewSpec.expandPanel.length)` branch that
   creates the real container element and appends `createFieldElement`/`createInputElement`
   children — exactly like the existing `columns`/`fields` branches. This is the *only* place
   JS-config arrays become DOM.
2. **Make the consuming component read light-DOM children**, not the array, so the HTML path
   (which never calls `materializeView`) and the JS path converge.

What silently breaks if you forget step 1: the JS-config author writes
`list: { expandPanel: [...] }`, it is spread onto `viewEl.descriptor`, `descriptorFromElement`
faithfully seeds it back in — and **no element is ever created**. The HTML-only example works
(real markup), the JS-config example renders an empty panel, and there is **no error and no
diagnostic** because a stray descriptor key is not an error. This is the single most likely
dual-syntax regression, and it is invisible to `node --check` and to the HTML example.

Other traps in the same area:

- **New field/input types must be registered before mount.** Materialization resolves
  `type` via `getFieldClass`/`getInputClass`. An unregistered type does not throw — it
  degrades to `text` with an `unknown-element` warning. If you register lazily (after the
  admin mounts), early-mounted JS-config views will have already fallen back to text.
- **Boolean and JSON attribute parity.** If your new type has an attribute that must behave
  as boolean-presence, numeric, or JSON, add it to `BOOLEAN_ATTRS`/`NUMERIC_ATTRS`/`JSON_ATTRS`
  in `descriptor.js`. Otherwise the HTML path stores it as a raw string while the JS path
  stores the native value, and the two syntaxes silently diverge for that one prop.
- **Don't strip the `.descriptor` seed in `descriptorFromElement`.** Any view element gets its
  JS-config scalars exclusively through that seed. Reverting it to `absorbAttributes({ kind }, el)`
  passes every HTML test and every unit test that constructs elements with attributes, while
  breaking *all* JS-config scalar configuration (§5) with no error.
- **`groups` shadows `inputs`.** In `materializeView` these are an `if/else if`. A JS-config
  form view that specifies both will silently ignore `inputs`. Preserve that ordering (or make
  the shadowing explicit) if you extend the form branch.
- **`validate` is never a string at runtime.** Both paths DSL-parse it (HTML in
  `absorbAttributes`, JS in `normalizeConfig`/`BaseField._patchFromAttribute`). Code consuming
  a descriptor's `validate` should assume an array of functions, not a string.
