# simple-admin — Extending Fields, Inputs & Filters (the extension API)

> **Status: binding contract.** The next implementation phase builds `fields/baseField.js` and
> `inputs/baseInput.js` *exactly* to this spec, and every concrete field/input (text, number,
> reference, …) is built on top of them. This document is derived from and must stay consistent with
> `10-simple-admin-architecture.md` — light DOM, `sa-` prefix, signals reactive core, DOM-ancestry
> context via `closest()`, the descriptor model (§2), the lifecycle contract (§3.3), the field/input
> catalog (§10), and the diagnostics message format (§11).
>
> Companion documents: `10-simple-admin-architecture.md`, `11-syntax-reference.md`, `12-open-questions.md`.

---

## 0. What "extending" means here

There are exactly three extension points, and they collapse into two mechanisms:

| You want to add… | Mechanism | You write |
|---|---|---|
| A new **display field** (`sa-*-field`, `f.*()`) | `SimpleAdmin.registerField` | one custom element `extends BaseField(HTMLElement)` |
| A new **form input** (`sa-*-input`, `i.*()`) | `SimpleAdmin.registerInput` | one custom element `extends BaseInput(HTMLElement)` |
| A new **filter** | *nothing new* | any registered input, dropped into `<sa-filters>` / `filters:[…]` |

Filters are **not a third registry** (see §4). A filter is just an input rendered in a filter context.
So this whole document is really "how to author a field" and "how to author an input," plus the rule
that inputs double as filters for free.

The design contract in one sentence: **a concrete field/input author writes rendering + wiring for
their own leaf DOM; everything about `source` resolution, context lookup, labels, the render effect,
form binding, validation, and diagnostics is inherited from the base mixin.**

---

## 1. The registration API

### 1.1 Signatures

```js
// core/registry.js exports these; index.js re-exports them on the SimpleAdmin namespace.

SimpleAdmin.registerField(type, ElementClass);   // ElementClass extends BaseField(HTMLElement)
SimpleAdmin.registerInput(type, ElementClass);   // ElementClass extends BaseInput(HTMLElement)
```

`type` is a **camelCase JS identifier** — the single source of truth for a component's name. From it,
the registry mechanically derives *both* author-facing surfaces, so an author never repeats a name:

| From `type` | Derivation | Result for `type = 'starRating'` |
|---|---|---|
| JS-config key (field) | `f[type]` | `f.starRating({ … })` |
| JS-config key (input) | `i[type]` | `i.starRating({ … })` |
| HTML tag (field) | `sa-` + kebab(type) + `-field` | `<sa-star-rating-field>` |
| HTML tag (input) | `sa-` + kebab(type) + `-input` | `<sa-star-rating-input>` |
| descriptor `type` | `type` verbatim | `{ kind:'field', type:'starRating', … }` |

`kebab(type)` is the standard camelCase→kebab transform used everywhere in doc 10 §2.3
(`referenceArray` → `reference-array`). This is the exact inverse of the `sa-*` → PascalCase mapping
in doc 10 §3.2, so react-admin muscle memory is preserved: `StarRatingField` ↔ `sa-star-rating-field` ↔ `f.starRating`.

### 1.2 What `registerField`/`registerInput` do internally

Registration is the *only* place a name is wired into all three surfaces. It is idempotent-checked
(re-registering the same `type` is a diagnostics warning, not a silent overwrite):

```js
// core/registry.js  (illustrative implementation — this is the contract)
const fieldRegistry = new Map();   // type -> ElementClass
const inputRegistry = new Map();   // type -> ElementClass

const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

function registerField(type, ElementClass) {
  if (fieldRegistry.has(type)) {
    diagnostics.warn('field-reregistered', { type });            // see §6
    return;
  }
  fieldRegistry.set(type, ElementClass);

  // 1. Define the custom element (idempotent; customElements can only define once).
  const tag = `sa-${kebab(type)}-field`;
  if (!customElements.get(tag)) customElements.define(tag, ElementClass);

  // 2. Add the JS-config factory: f.starRating(props) -> FieldDescriptor.
  //    The factory is a thin descriptor-builder; it does NOT construct DOM.
  fields[type] = (props = {}) => ({ kind: 'field', type, ...props });
}

function registerInput(type, ElementClass) {
  if (inputRegistry.has(type)) {
    diagnostics.warn('input-reregistered', { type });
    return;
  }
  inputRegistry.set(type, ElementClass);
  const tag = `sa-${kebab(type)}-input`;
  if (!customElements.get(tag)) customElements.define(tag, ElementClass);
  inputs[type] = (props = {}) => ({ kind: 'input', type, ...props });
}
```

Key facts this pins down:

- **The `factory` is auto-generated.** Authors do **not** pass a factory function — the registry
  builds the `f.type()` / `i.type()` descriptor-builder for them from `type`. This guarantees JS
  config and HTML always produce structurally identical descriptors (doc 12, open question 5) because
  a single normalization owns both. *(If a component needs custom descriptor shorthand — e.g. accepting
  a positional arg — it may pass an optional third `factory` override: `registerField(type, Class,
  (props) => descriptor)`. This is the rare exception, not the norm.)*
- **The descriptor renderer** (doc 10 §2.3) looks up `fieldRegistry.get(descriptor.type)` to know which
  element to instantiate for the JS-config path, and `customElements` already knows the tag for the
  HTML path. One registry, both paths.
- **Unknown types degrade gracefully.** When the renderer or the HTML child-walk meets a `type`/tag not
  in the registry, it does **not** throw — it emits the `unknown-element` diagnostic (doc 10 §11) and
  skips that leaf.

### 1.3 When registration runs

Concrete built-ins call `registerField`/`registerInput` at module load time (side-effect of importing
`fields/textField.js` etc. via `index.js`). Third parties call it after importing the library and
**before** `mount()`/before the `<sa-admin>` connects — anytime earlier is fine because
`customElements.define` upgrades already-parsed matching tags:

```js
import { SimpleAdmin } from './simple-admin/index.js';
import { StarRatingField } from './my-fields/starRatingField.js';

SimpleAdmin.registerField('starRating', StarRatingField);   // now f.starRating & <sa-star-rating-field> exist
```

---

## 2. The `baseField` mixin contract

### 2.1 The mixin-factory pattern (decided)

Every field is `class Xxx extends BaseField(HTMLElement)`. `BaseField` is a **mixin factory**: it takes
a base class and returns a subclass. This is the pattern chosen for the whole library because it
composes cleanly with `HTMLElement`, keeps the real prototype chain (so `customElements.define`,
`connectedCallback`, `attributeChangedCallback` all work natively), and lets a field opt into a
different base later without inheritance gymnastics.

```js
// fields/baseField.js
import { effect } from '../core/signal.js';
import { findRecordContext } from '../core/context.js';
import { humanize, getByPath } from '../core/util.js';
import * as diagnostics from '../core/diagnostics.js';

export const BaseField = (Base = HTMLElement) => class extends Base {
  // Attributes shared by ALL fields. Concrete fields extend this list.
  static get observedAttributes() { return ['source', 'label', 'empty-text']; }

  constructor() {
    super();
    // §10 §3.3: NO DOM work in the constructor. Metadata only.
    this._descriptor = { kind: 'field' };  // filled from attributes/props in connectedCallback
    this._recordCtx = null;                // resolved RecordContext (see §2.2)
    this._dispose = null;                  // teardown for the render effect
  }

  // ---- descriptor plumbing (HTML path). JS path sets .descriptor directly. ----
  toDescriptor() { return this._descriptor; }

  set descriptor(d) { this._descriptor = { kind: 'field', ...d }; this._scheduleRender(); }
  get descriptor()  { return this._descriptor; }

  // convenience typed getters concrete fields read
  get source()    { return this._descriptor.source; }
  get emptyText() { return this._descriptor.emptyText ?? ''; }

  // ---- label derivation: explicit override, else humanized source ----
  get label() {
    if (this._descriptor.label != null) return this._descriptor.label;   // may be '' to suppress
    return this.source ? humanize(this.source) : '';                     // "author_id" -> "Author id"
  }

  // ---- the value the concrete field renders ----
  // Resolves `source` (dot-path aware) against the nearest RecordContext.
  getValue() {
    const record = this._recordCtx?.record;
    if (!record) return undefined;
    return getByPath(record, this.source);      // 'author.name' -> record.author?.name
  }

  connectedCallback() {
    // 1. HTML path: read attributes + children into the descriptor (JS path already set it).
    if (this.isConnected) this._absorbAttributes();

    // 2. Diagnostics: validate own config (see §6).
    if (!this.source && this._descriptor.type !== 'function') {
      diagnostics.error('field-missing-source', { tag: this.localName, ctx: this._contextLabel() });
      return;   // degrade: render nothing, do not throw.
    }

    // 3. Locate the nearest RecordContext by DOM ancestry (doc 10 §3.3).
    this._recordCtx = findRecordContext(this);   // closest('sa-datagrid,sa-simple-show-layout,sa-reference-field,...')
    if (!this._recordCtx) {
      diagnostics.warn('field-no-record-context', { tag: this.localName, source: this.source });
      return;
    }

    // 4. The render effect: re-runs whenever the record signal (or any signal read) changes.
    this._dispose = effect(() => {
      const value = this.getValue();   // reads the record signal -> subscribes this effect
      if (value == null || value === '') {
        this.renderEmpty(this.emptyText);
      } else {
        this.renderValue(value, this._recordCtx.record);
      }
    });
  }

  attributeChangedCallback(name, _old, val) {
    // patch descriptor key (kebab attr -> camel key), mark dirty, microtask-batched re-render.
    this._patchFromAttribute(name, val);
    this._scheduleRender();
  }

  disconnectedCallback() {
    this._dispose?.();        // unsubscribe the render effect (no leaks, doc 10 §3.3)
    this._dispose = null;
    this._recordCtx = null;
  }

  // ---- render seams a concrete field MAY override (defaults provided) ----
  renderValue(value /*, record */) { this.textContent = String(value); }
  renderEmpty(emptyText) { this.textContent = emptyText; }

  // ---- internals (_absorbAttributes, _patchFromAttribute, _scheduleRender,
  //      _contextLabel) provided by the mixin; omitted here for brevity ----
};
```

### 2.2 What a concrete field gets for free vs. must implement

| Concern | Provided by `BaseField` | Concrete field responsibility |
|---|---|---|
| `source` resolution, **dot-path aware** (`getByPath(record, 'author.name')`) | ✅ `getValue()` | — |
| Nearest **RecordContext** lookup via `closest()` DOM ancestry | ✅ `findRecordContext(this)` | — |
| **`label`** — explicit override else `humanize(source)`; `label=""` suppresses | ✅ `get label()` | — |
| **`emptyText`** fallback when value is `null`/`''`/`undefined` | ✅ `renderEmpty()` path | — |
| **Render effect** (subscribe to record signal; re-run on change; teardown on disconnect) | ✅ `connectedCallback`/`disconnectedCallback` | — |
| Descriptor ↔ attribute plumbing, microtask-batched re-render | ✅ | — |
| Missing-`source` diagnostic + graceful degrade | ✅ | — |
| **How a non-empty value looks** | default `textContent` | override `renderValue(value, record)` |
| Extra attributes/props (e.g. `options`, `showTime`) | — | add to `observedAttributes`, read from `this._descriptor` |

A field author overrides **`renderValue`** (and optionally `renderEmpty`, `observedAttributes`).
That is usually the entire job.

### 2.3 Worked example — `StarRatingField`, end to end

Renders an integer `source` (0–5) as filled/empty stars. Note it does **nothing** about `source`
lookup, labels, empty handling wiring, or the effect — all inherited.

```js
// my-fields/starRatingField.js
import { SimpleAdmin } from '../simple-admin/index.js';
import { BaseField } from '../simple-admin/fields/baseField.js';

export class StarRatingField extends BaseField(HTMLElement) {
  // Add our own attribute on top of the inherited source/label/empty-text.
  static get observedAttributes() {
    return [...super.observedAttributes, 'max'];
  }

  get max() { return Number(this._descriptor.max ?? 5); }

  // The ONLY method we must write: how a value looks.
  renderValue(value) {
    const n = Math.max(0, Math.min(this.max, Math.round(Number(value) || 0)));
    this.className = 'sa-field sa-star-rating-field';          // light-DOM `sa-` class hook (doc 10 §3.2)
    this.setAttribute('data-sa-part', 'field');
    this.textContent = '★'.repeat(n) + '☆'.repeat(this.max - n);
    this.setAttribute('aria-label', `${n} out of ${this.max}`);
  }
  // renderEmpty inherited: shows empty-text ('' by default).
}

// One line wires up <sa-star-rating-field>, f.starRating(), and descriptor type 'starRating'.
SimpleAdmin.registerField('starRating', StarRatingField);
```

Both authoring surfaces now work, producing structurally identical descriptors:

```html
<!-- HTML -->
<sa-datagrid>
  <sa-star-rating-field source="rating" max="5" label="Score"></sa-star-rating-field>
</sa-datagrid>
```

```js
// JS config — byte-equivalent descriptor { kind:'field', type:'starRating', source:'rating', max:5, label:'Score' }
import { fields as f } from './simple-admin/index.js';
list.columns = [ f.starRating({ source: 'rating', max: 5, label: 'Score' }) ];
```

It works unchanged in a datagrid cell, a `<sa-simple-show-layout>` row, and inside a
`<sa-reference-field>` — because `findRecordContext` resolves whichever record host is nearest,
exactly like react-admin's `useRecordContext()` (doc 10 §3.3).

---

## 3. The `baseInput` mixin contract

Inputs are **dumb, `source`-tagged views over one centralized FormStore** (doc 10 §9.2). `BaseInput`
handles all form binding; the concrete input only renders a control and reports user edits.

### 3.1 `fields/baseInput.js`

```js
// inputs/baseInput.js
import { effect } from '../core/signal.js';
import { humanize } from '../core/util.js';
import { compileValidators } from '../validators/index.js';   // fn[] | DSL string -> fn[]
import * as diagnostics from '../core/diagnostics.js';

export const BaseInput = (Base = HTMLElement) => class extends Base {
  static get observedAttributes() {
    return ['source', 'label', 'default-value', 'disabled', 'read-only', 'helper-text', 'validate'];
  }

  constructor() {
    super();
    this._descriptor = { kind: 'input' };
    this._form = null;         // the FormStore this input binds to
    this._dispose = null;
  }

  toDescriptor() { return this._descriptor; }
  set descriptor(d) { this._descriptor = { kind: 'input', ...d }; this._scheduleRender(); }
  get descriptor()  { return this._descriptor; }

  get source()     { return this._descriptor.source; }
  get disabled()   { return !!this._descriptor.disabled; }
  get readOnly()   { return !!this._descriptor.readOnly; }
  get helperText() { return this._descriptor.helperText ?? ''; }

  get label() {
    let base = this._descriptor.label != null ? this._descriptor.label
                                              : (this.source ? humanize(this.source) : '');
    return base + (this.isRequired && base ? ' *' : '');   // required() auto-appends '*' (doc 10 §9.3)
  }
  get isRequired() { return this._validators.some(v => v.isRequired); }

  // ---- format / parse converters (store value <-> control value) ----
  format(storeValue) { return (this._descriptor.format ?? ((v) => v ?? ''))(storeValue); }
  parse(controlValue) { return (this._descriptor.parse ?? ((v) => v))(controlValue); }

  connectedCallback() {
    if (this.isConnected) this._absorbAttributes();

    if (!this.source) {
      diagnostics.error('input-missing-source', { tag: this.localName, ctx: this._contextLabel() });
      return;   // degrade, do not throw.
    }

    // Compile validators once (array of fns, or the DSL string). required() flips isRequired.
    this._validators = compileValidators(this._descriptor.validate, { tag: this.localName, source: this.source });

    // Locate the FormStore by DOM ancestry (doc 10 §9.2). Filters use the same lookup (see §4).
    this._form = this.closest('sa-simple-form, sa-tabbed-form, sa-filters')?.formStore;
    if (!this._form) {
      diagnostics.warn('input-no-form', { tag: this.localName, source: this.source });
      return;
    }

    // Register this source with the form: seed defaultValue, validators, dirty/touched slots.
    this._form.register(this.source, {
      defaultValue: this._descriptor.defaultValue,
      validators: this._validators,
      parse: (v) => this.parse(v),
      format: (v) => this.format(v),
    });

    this.renderControl();   // concrete input builds its control DOM once.

    // Reactive read: control reflects store value + error + touched.
    this._dispose = effect(() => {
      const value = this._form.getField(this.source);       // subscribes to values signal
      const error = this._form.getError(this.source);       // subscribes to errors signal
      const touched = this._form.isTouched(this.source);
      this.updateControl(this.format(value));
      this.renderError(touched ? error : undefined);
      this.renderHelper(this.helperText);
    });
  }

  // Concrete inputs call this from their control's 'input'/'change' listener.
  commit(controlValue) {
    this._form.setField(this.source, this.parse(controlValue));   // write -> validate -> mark dirty
  }
  markTouched() { this._form.touch(this.source); }                 // call on blur

  attributeChangedCallback(name, _old, val) { this._patchFromAttribute(name, val); this._scheduleRender(); }

  disconnectedCallback() {
    this._dispose?.();
    this._form?.unregister?.(this.source);   // release validators/slots (no leaks)
    this._form = null; this._dispose = null;
  }

  // ---- seams a concrete input implements/overrides ----
  renderControl() { /* build control DOM once; MUST be implemented by concrete input */ }
  updateControl(_formattedValue) { /* push store value into the control; MUST be implemented */ }
  renderError(_message) { /* default: toggle a .sa-input__error node; overridable */ }
  renderHelper(_text)  { /* default: render helper text node; overridable */ }
};
```

### 3.2 What a concrete input gets for free vs. must implement

| Concern | Provided by `BaseInput` | Concrete input responsibility |
|---|---|---|
| **FormStore lookup** via `closest('sa-simple-form,sa-tabbed-form,sa-filters')` | ✅ | — |
| **Read/write `source`-keyed value** (dot-path/array aware, in FormStore) | ✅ `getField`/`setField` through `commit()` | call `commit(controlValue)` on edit |
| **Validation pipeline** — compile `validate` (fn[] **or** DSL string), run on change, first-fail wins | ✅ `compileValidators` + FormStore | pass `validate` through descriptor (author does) |
| **`format` / `parse`** converters (store ↔ control) | ✅ `format()`/`parse()` | override only for exotic types |
| **`label`** (humanize + `*` when required), **`helperText`**, **`disabled`/`readOnly`** baseline | ✅ | reflect `disabled`/`readOnly` onto the control element |
| **Dirty / touched** tracking | ✅ FormStore | call `markTouched()` on blur |
| Missing-`source` diagnostic + graceful degrade | ✅ | — |
| **The control DOM** (`<input>`, `<select>`, custom widget) | — | implement `renderControl()` + `updateControl()` |

A concrete input implements **`renderControl()`** (build once) and **`updateControl(value)`** (reflect
store→control), and wires its control events to `commit()` / `markTouched()`. Nothing else.

### 3.3 Worked example — `ColorPickerInput`, end to end

Wraps a native `<input type="color">`, but everything (form binding, validation, label with `*`,
dirty/touched, error display) is inherited.

```js
// my-inputs/colorPickerInput.js
import { SimpleAdmin } from '../simple-admin/index.js';
import { BaseInput } from '../simple-admin/inputs/baseInput.js';

export class ColorPickerInput extends BaseInput(HTMLElement) {
  renderControl() {
    this.className = 'sa-input sa-color-picker-input';
    this.setAttribute('data-sa-part', 'input');
    this.innerHTML = `
      <label class="sa-input__label"></label>
      <input class="sa-input__control" type="color" />
      <span class="sa-input__helper"></span>
      <span class="sa-input__error" role="alert"></span>`;

    this._control = this.querySelector('.sa-input__control');
    this.querySelector('.sa-input__label').textContent = this.label;
    this._control.disabled = this.disabled;
    if (this.readOnly) this._control.setAttribute('readonly', '');

    // Report edits to the FormStore via the base contract.
    this._control.addEventListener('input', () => this.commit(this._control.value));
    this._control.addEventListener('blur', () => this.markTouched());
  }

  // Reflect the store value into the control (format() already applied by base).
  updateControl(value) {
    if (this._control && this._control.value !== value) {
      this._control.value = value || '#000000';
    }
  }
  // renderError / renderHelper inherited (toggle .sa-input__error / .sa-input__helper).
}

// Wires <sa-color-picker-input>, i.colorPicker(), and descriptor type 'colorPicker'.
SimpleAdmin.registerInput('colorPicker', ColorPickerInput);
```

Both surfaces, structurally identical descriptors:

```html
<sa-simple-form>
  <sa-color-picker-input source="brand_color" label="Brand color"
                         validate="required"></sa-color-picker-input>
</sa-simple-form>
```

```js
import { inputs as i } from './simple-admin/index.js';
import { required } from './simple-admin/validators/index.js';

form.inputs = [ i.colorPicker({ source: 'brand_color', label: 'Brand color', validate: [required()] }) ];
```

The `required()` validator flows through `compileValidators`, flips `isRequired`, and the inherited
`label` getter appends the `*`. `format`/`parse` default to identity; a hex-normalizing input could
override them via the descriptor (`i.colorPicker({ parse: v => v.toUpperCase() })`).

---

## 4. Filters are not a separate concept

Per doc 10 §8 (list model) and §10.2 (`sa-search-input` is "filter-only text w/ icon" — just an
input), **a filter is any registered Input rendered inside `<sa-filters>` / the `filters:[…]` array.**
There is no `registerFilter`, no `BaseFilter`, no filter descriptor `kind`. A filter descriptor *is* an
`InputDescriptor` (doc 10 §2.1) — it merely lives in the view's `filters` array instead of a form's
`inputs` array.

The one difference is the **context** the input binds to. `BaseInput.connectedCallback` already looks
up `closest('sa-simple-form, sa-tabbed-form, sa-filters')`. Inside `<sa-filters>`, the `.formStore` it
finds is the filter FormStore, whose values are wired to `ListController.filterValues` (doc 10 §4.2)
instead of a create/edit submit. **The input code is identical either way** — that is the whole point.

So the `ColorPickerInput` from §3.3 is *already* a working filter with zero extra code:

```html
<sa-list>
  <sa-filters>
    <sa-color-picker-input source="brand_color" always-on></sa-color-picker-input>
  </sa-filters>
  …
</sa-list>
```

```js
list.filters = [ i.colorPicker({ source: 'brand_color', alwaysOn: true }) ];
```

### 4.1 The `alwaysOn` flag and the one interaction rule

`alwaysOn` (attribute `always-on`, descriptor key `alwaysOn`) means the filter is always visible rather
than living behind the "Add filter" dropdown. It is read by `<sa-filters>`, not by the input — the
input neither knows nor cares whether it is `alwaysOn`.

The **one established interaction rule** (doc 10 §11 diagnostics table): `alwaysOn` **+** `defaultValue`
together is a misconfiguration, matching react-admin. When both are present, `<sa-filters>` emits the
`filter-alwayson-defaultvalue` warning and ignores `defaultValue`; authors must use
`filterDefaultValues` on `<sa-list>` for a user-changeable default. A custom input author gets this for
free — the check lives in `<sa-filters>`, not in each input.

---

## 5. Row/cell-level customization without writing a class

Sometimes you need one-off render logic and a whole registered field is overkill. The escape hatch is
the built-in **`sa-function-field` / `f.fn({ render })`** (doc 10 §10.1). It is itself a `BaseField`
subclass whose `renderValue` delegates to the author's callback.

### 5.1 Signature

```js
render(record, source) => string | Node
```

- `record` — the full current record from the nearest RecordContext (not just the `source` value), so
  you can combine several properties.
- `source` — the field's `source` if one was provided (may be `undefined`; `sa-function-field` is the
  only field exempt from the missing-`source` error, see the guard in §2.1).
- Return a **string** (set as `textContent`, safely) or a **DOM Node** (appended). Returning `null`/`''`
  triggers the inherited `emptyText` path.

```html
<sa-function-field label="Full name"
  .render="${(record) => `${record.first_name} ${record.last_name}`}"></sa-function-field>
```

```js
f.fn({
  label: 'Full name',
  render: (record) => `${record.first_name} ${record.last_name}`,
});

// Returning a Node for richer output:
f.fn({
  label: 'Status',
  render: (record) => {
    const el = document.createElement('span');
    el.className = `sa-badge sa-badge--${record.status}`;
    el.textContent = record.status;
    return el;
  },
});
```

### 5.2 When to use which

| Use `f.fn({ render })` when… | Register a real field when… |
|---|---|
| Logic is view-specific and used once | The field is reused across resources/views |
| You just need to combine a couple of record props into text/markup | You need configurable attributes/props (e.g. `max`, `options`) |
| No new attributes, no reuse | You want an HTML tag (`<sa-…-field>`) and a `f.type()` factory |
| Prototyping | It belongs in a shared design system / third-party package |

Rule of thumb: **reach for `f.fn` for a leaf you'd otherwise copy-paste twice; register a field the
third time.**

---

## 6. Diagnostics integration

A well-behaved custom field/input must **degrade gracefully and log actionably**, matching doc 10 §11:
every message (1) is prefixed `[simple-admin]`, (2) names the exact element/resource/source at fault,
(3) states the cause, (4) states the fix. Never throw on bad config — render nothing (or raw value) and
log once (messages are deduped by the diagnostics module).

The base mixins already emit the two most important ones for you. Authors reuse the same
`core/diagnostics.js` API (`warn(code, detail)` / `error(code, detail)`) for their own component-specific
checks.

| Situation | Who emits | Level | Exact message |
|---|---|---|---|
| Field missing `source` | `BaseField` (inherited) | `error` | `[simple-admin] <sa-star-rating-field> is missing the required "source" attribute (inside resource "posts", list view). Add source="fieldName" so it knows which record property to display. Skipping.` |
| Input missing `source` | `BaseInput` (inherited) | `error` | `[simple-admin] <sa-color-picker-input> is missing the required "source" attribute (inside resource "posts", edit view). Add source="fieldName" so it knows which record property to bind. Skipping.` |
| Input not inside a form/filters | `BaseInput` (inherited) | `warn` | `[simple-admin] <sa-color-picker-input source="brand_color"> is not inside a <sa-simple-form>, <sa-tabbed-form>, or <sa-filters>. It has no FormStore to bind to and will not save. Move it inside a form.` |
| Re-registering a `type` | `registerField`/`Input` | `warn` | `[simple-admin] A field type "starRating" is already registered. Ignoring the second SimpleAdmin.registerField('starRating', …). Use a distinct type name.` |
| Component-specific bad prop (author-written) | your field/input | `warn`/`error` | *follow the same 4-part shape — see below* |

For your own checks, call diagnostics with a code and detail, and phrase the message to the same
template. Example inside `StarRatingField` when `max` is nonsensical:

```js
// inside renderValue, before using this.max
if (!Number.isInteger(this.max) || this.max < 1) {
  diagnostics.warn('star-rating-bad-max', {
    tag: this.localName, source: this.source, value: this._descriptor.max,
    // The diagnostics module formats codes to strings; a custom code may pass a `message`:
    message: `[simple-admin] <${this.localName} source="${this.source}"> has an invalid max=`
      + `"${this._descriptor.max}". max must be a positive integer (e.g. max="5"). Falling back to 5.`,
  });
}
```

Baseline expectations for any custom component:

- **Missing/invalid required config → log + degrade**, never throw. (Missing `source` is already handled
  by the base; anything *you* add as required, you check yourself.)
- **Name the element** (`this.localName`) and, where you can, the `source` and context (the base exposes
  `this._contextLabel()` → `resource "posts", edit view`).
- **State cause and fix** in the same sentence pair as the table above.
- **Respect `SimpleAdmin.setLogLevel`** by routing through `core/diagnostics.js` (do not call
  `console.warn` directly) so teams can silence you in production and dedupe across a 100-row grid.

---

## 7. Worked example — a custom filter-only input, reused as form input and filter

Filter-only in intent, but because filters are just inputs (§4) it is registered **once** and works in
both places. A `DateRangeInput` stores a `{ gte, lte }` object under one `source`.

```js
// my-inputs/dateRangeInput.js
import { SimpleAdmin } from '../simple-admin/index.js';
import { BaseInput } from '../simple-admin/inputs/baseInput.js';

export class DateRangeInput extends BaseInput(HTMLElement) {
  // Store shape is an object; format/parse bridge it to two <input type=date> controls.
  format(storeValue) { return storeValue ?? { gte: '', lte: '' }; }
  parse(controlValue) {
    // strip empties so the filter param stays clean ({} means "no filter")
    const out = {};
    if (controlValue.gte) out.gte = controlValue.gte;
    if (controlValue.lte) out.lte = controlValue.lte;
    return Object.keys(out).length ? out : undefined;
  }

  renderControl() {
    this.className = 'sa-input sa-date-range-input';
    this.setAttribute('data-sa-part', 'input');
    this.innerHTML = `
      <label class="sa-input__label"></label>
      <span class="sa-date-range-input__row">
        <input class="sa-input__control" data-k="gte" type="date" aria-label="from" />
        <span aria-hidden="true">–</span>
        <input class="sa-input__control" data-k="lte" type="date" aria-label="to" />
      </span>
      <span class="sa-input__helper"></span>
      <span class="sa-input__error" role="alert"></span>`;

    this.querySelector('.sa-input__label').textContent = this.label;
    this._gte = this.querySelector('[data-k="gte"]');
    this._lte = this.querySelector('[data-k="lte"]');

    const onEdit = () => this.commit({ gte: this._gte.value, lte: this._lte.value });
    this._gte.addEventListener('input', onEdit);
    this._lte.addEventListener('input', onEdit);
    this._lte.addEventListener('blur', () => this.markTouched());

    for (const c of [this._gte, this._lte]) {
      c.disabled = this.disabled;
      if (this.readOnly) c.setAttribute('readonly', '');
    }
  }

  updateControl(value) {
    const v = value ?? { gte: '', lte: '' };
    if (this._gte && this._gte.value !== (v.gte ?? '')) this._gte.value = v.gte ?? '';
    if (this._lte && this._lte.value !== (v.lte ?? '')) this._lte.value = v.lte ?? '';
  }
}

SimpleAdmin.registerInput('dateRange', DateRangeInput);   // <sa-date-range-input>, i.dateRange()
```

Reused unchanged in a **list filter** and in an **edit form**:

```html
<!-- as a filter -->
<sa-list>
  <sa-filters>
    <sa-date-range-input source="published_at" always-on label="Published"></sa-date-range-input>
  </sa-filters>
</sa-list>

<!-- as a form input -->
<sa-edit>
  <sa-simple-form>
    <sa-date-range-input source="active_period" label="Active period"></sa-date-range-input>
  </sa-simple-form>
</sa-edit>
```

```js
// JS config — same descriptor kind:'input', type:'dateRange' in both arrays.
list.filters = [ i.dateRange({ source: 'published_at', alwaysOn: true, label: 'Published' }) ];
form.inputs  = [ i.dateRange({ source: 'active_period', label: 'Active period' }) ];
```

In the filter context the parsed `{ gte, lte }` object flows into `ListController.filterValues` (and out
to `dataProvider.getList({ filter: { published_at: { gte, lte } } })`); in the form context the same
object is submitted via the FormStore. One class, two contexts, zero branching — the filter/input unity
of §4 in action. And because it is a normal input, the `alwaysOn` + `defaultValue` rule (§4.1) applies
automatically if misconfigured.

---

## 8. Checklist — your custom field/input is done when…

**Custom field (`extends BaseField(HTMLElement)`):**

- [ ] Implements **`renderValue(value, record)`** (and optionally `renderEmpty`) — the only required method.
- [ ] Adds any extra attributes to **`observedAttributes`** via `[...super.observedAttributes, …]` and reads them from `this._descriptor`.
- [ ] Applies a **`sa-` class** and (for landmarks) `data-sa-part` on its light-DOM output — never Shadow DOM.
- [ ] Does **no DOM work in the constructor**; all rendering happens through the inherited effect.
- [ ] Registered **once** with `SimpleAdmin.registerField('camelType', Class)` — gives `<sa-…-field>`, `f.camelType()`, and descriptor `type` for free.
- [ ] **Degrades gracefully** on bad config (renders nothing/raw, logs via `core/diagnostics.js`, never throws). Missing `source` is handled by the base.

**Custom input (`extends BaseInput(HTMLElement)`):**

- [ ] Implements **`renderControl()`** (build control DOM once) and **`updateControl(value)`** (reflect store→control).
- [ ] Calls **`commit(controlValue)`** on edit and **`markTouched()`** on blur — never manages its own value state.
- [ ] Passes `validate` through the descriptor untouched (base compiles fn[] **or** DSL string); reflects `disabled`/`readOnly`/`helperText` onto the control.
- [ ] Overrides **`format`/`parse`** only if the store shape differs from the control's raw value.
- [ ] Registered **once** with `SimpleAdmin.registerInput('camelType', Class)` — gives `<sa-…-input>`, `i.camelType()`, and descriptor `type`.
- [ ] **Works as a filter with no extra code** (binds to `sa-filters`' FormStore via the inherited `closest()` lookup); respects the `alwaysOn` + `defaultValue` rule enforced by `<sa-filters>`.
- [ ] **Degrades gracefully** on bad config (logs via `core/diagnostics.js`, never throws). Missing `source` and missing-form are handled by the base.

**Reaching for the escape hatch instead:** if there are no new attributes and no reuse, skip the class
and use **`f.fn({ render: (record, source) => string|Node })`** (§5).
