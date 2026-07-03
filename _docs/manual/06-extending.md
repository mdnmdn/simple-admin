# 6. Extending: custom fields, inputs & filters

simple-admin ships a catalog of fields (`<sa-text-field>`, `f.text()`, ...) and inputs
(`<sa-text-input>`, `i.text()`, ...) — see
[03-fields-and-inputs-reference.md](./03-fields-and-inputs-reference.md). When the catalog doesn't
cover what you need, there are exactly two ways to extend it, and a third option that isn't really
an extension at all:

| You want to... | Reach for... | You write |
|---|---|---|
| Render something one-off in a single column/panel, read-only, no reuse needed | `<sa-function-field>` / `f.fn({ render })` | a `render(record, source)` callback |
| Add a reusable, source-bound **display field** (`sa-*-field` tag + `f.*()` factory) | `SimpleAdmin.registerField` | one custom element extending `BaseField` |
| Add a reusable, source-bound **form control** (`sa-*-input` tag + `i.*()` factory, also usable as a filter) | `SimpleAdmin.registerInput` | one custom element extending `BaseInput` |

There is no separate "filter" registry or base class. A filter is just a registered input dropped
inside `<sa-filters>` (see §5 below) — so once you've registered an input, you already have a filter.

The design contract in one sentence: **you write rendering + event wiring for your own leaf DOM;
`source` resolution, record/form lookup, labels, the render effect, validation, and diagnostics are
all inherited from the base mixin.**

## 1. The quick escape hatch: `sa-function-field`

If you just need to render a value or a small chunk of markup differently in one place — no new
tag, no registration, nothing reusable — use the function field. It requires no `source` (it's
exempt from the "missing source" check) and hands your callback the whole record:

```html
<sa-datagrid>
  <sa-text-field source="name"></sa-text-field>
  <sa-function-field label="Full name"></sa-function-field>
  <!-- set .render from JS after grabbing the element, or use the JS-config form below -->
</sa-datagrid>
```

In JS-config syntax this is more natural, since `render` is a function and can't be expressed as an
HTML attribute:

```js
import { f } from '../../src/index.js';

f.fn({
  label: 'Full name',
  render: (record) => `${record.firstName} ${record.lastName}`,
});
```

`render(record, source)` may return a string, or a DOM `Node` (appended as-is), or `null`/`''` (in
which case the field falls back to its `renderEmpty`/`empty-text` behavior, exactly like any other
field with no value). If you *do* pass `source`, the field reads `getValue()` normally, but `render`
still gets the whole `record` so you can combine several properties.

Reach for a real registered field/input instead of `f.fn`/`sa-function-field` as soon as you find
yourself copy-pasting the same `render` callback across resources, or you need the value to be
editable (function fields are display-only — there's no function-input equivalent).

## 2. Authoring a custom field

Every field is `class MyField extends BaseField(HTMLElement)`. `BaseField` (in
`src/fields/baseField.js`) gives you, for free:

- **`source` resolution** — `this.getValue()` resolves `this.source` (dot-path aware) against the
  nearest record context (`<sa-datagrid>` row, `<sa-simple-show-layout>`, `<sa-reference-field>`, ...).
- **Label derivation** — `this.label` is the explicit `label` attribute/descriptor key, or a
  humanized version of `source` (`publishedAt` → "Published at"), or `''` if `label=""` was set
  explicitly to suppress it.
- **The render effect** — `connectedCallback()` sets up a reactive effect that re-runs whenever the
  record (or the field's own descriptor) changes, and calls either `renderEmpty(emptyText)` (value is
  `null`/`undefined`/`''`) or `renderValue(value, record)` (otherwise). It also tears the effect down
  in `disconnectedCallback()`.
- **The missing-source / missing-context diagnostics** — if you forget `source` (and your field isn't
  the `function` type), or the field isn't inside a record context, `BaseField` logs a
  `[simple-admin] ...` warning and renders nothing. You never have to check for these yourself.
- **Attribute → descriptor plumbing** — `source`, `label`, `empty-text` are absorbed automatically.
  If your field needs extra attributes, extend `observedAttributes` (see the worked example below).

**What you must implement:**

- `renderValue(value, record)` — required. Build your field's DOM/text here.
- `renderEmpty(emptyText)` — optional; the default (`this.textContent = emptyText`) is usually fine.

### Worked example: a real, minimal field (`SaBooleanField`)

Here is the actual, complete implementation of the built-in boolean field
(`src/fields/booleanField.js`), used verbatim as a template:

```js
import { BaseField } from '../fields/baseField.js';
import { registerField } from '../core/registry.js';

export class SaBooleanField extends BaseField(HTMLElement) {
  // Extend the inherited list — don't replace it, or you lose source/label/empty-text.
  static get observedAttributes() {
    return [...super.observedAttributes, 'true-text', 'false-text'];
  }

  get trueText() {
    return this._descriptor.trueText;
  }
  get falseText() {
    return this._descriptor.falseText;
  }

  renderValue(value) {
    this.classList.add('sa-field', 'sa-field--boolean');
    const isTrue = !!value;
    this.textContent = isTrue
      ? this.trueText != null ? this.trueText : '✓'
      : this.falseText != null ? this.falseText : '✗';
    this.setAttribute('aria-label', String(isTrue));
  }
}

registerField('boolean', SaBooleanField);

export default SaBooleanField;
```

Walking through it:

1. `extends BaseField(HTMLElement)` — the mixin factory pattern; `HTMLElement` is the base class
   being mixed into (this is also how you'd stack it on top of another base class, if you ever needed
   to).
2. `observedAttributes` adds `true-text`/`false-text` on top of `super.observedAttributes` (which is
   `['source', 'label', 'empty-text']`). Because `applyAttribute` kebab→camelCases attribute names
   into descriptor keys automatically (`src/core/descriptor.js`), `true-text="Yes"` becomes
   `this._descriptor.trueText === 'Yes'` with no extra code — the getters above just read it back.
3. `renderValue(value)` is the only rendering seam this field needs. It's called with the resolved,
   non-empty value; `record` (the second argument) is available too but unused here.
4. `registerField('boolean', SaBooleanField)` at module scope — registration happens once, as a
   side effect of importing the file (see `src/index.js`'s block of
   `import './fields/booleanField.js'`-style imports).

A field with no extra attributes at all is even shorter — the full `src/fields/emailField.js`:

```js
import { BaseField } from './baseField.js';
import { registerField } from '../core/registry.js';

export class SaEmailField extends BaseField(HTMLElement) {
  renderValue(value) {
    this.classList.add('sa-field', 'sa-field--email');
    this.textContent = '';
    const a = document.createElement('a');
    a.href = `mailto:${value}`;
    a.textContent = String(value);
    this.appendChild(a);
  }
}

registerField('email', SaEmailField);
export default SaEmailField;
```

That's the whole pattern: no `constructor`, no `connectedCallback`, no manual attribute handling —
just `renderValue`.

## 3. Authoring a custom input

Every input is `class MyInput extends BaseInput(HTMLElement)`. `BaseInput` (in
`src/inputs/baseInput.js`) gives you, for free:

- **FormStore binding** — on connect, it walks up to the nearest
  `sa-simple-form`/`sa-tabbed-form`/`sa-filters` ancestor, reads its `.formStore`, and calls
  `this._form.register(this.source, { defaultValue, validators, parse, format })`. If there's no
  ancestor form, it logs `input-no-form` and stops (degrade, don't throw).
- **The missing-source diagnostic** — same idea as fields: no `source` → `input-missing-source`
  warning, render nothing.
- **Validation** — `validate` (attribute DSL string, or an array of validator functions in JS-config)
  is compiled once via `compileValidators`; `this.isRequired` flips true if a `required()` validator is
  present, which appends `" *"` to `this.label` automatically.
- **format/parse** — `this.format(storeValue)` converts a stored value to what the control should
  display; `this.parse(controlValue)` converts what the control produced back to a stored value.
  Both default to identity (`format` defaults to `v ?? ''`). Override either as plain methods when
  your control's native value type isn't the store's value type (see the boolean example below).
- **The reactive update effect** — re-runs on every store/version change, calling
  `this.updateControl(this.format(value))`, then `this.renderError(...)` and `this.renderHelper(...)`
  (both look for `.sa-input__error` / `.sa-input__helper` elements in your control's markup — include
  them if you want error/helper text to show up for free).
- **`disabled` / `readOnly` / `helperText`** getters, and label derivation identical to fields (plus
  the required-`*` suffix).

**What you must implement:**

- `renderControl()` — required. Build your control's DOM once (called once, right after form
  registration). This is where you read `this.label`/`this.disabled`/`this.readOnly` and wire your
  control's native events.
- `updateControl(formattedValue)` — required. Push a store value (already passed through `format`)
  into your control's DOM.
- Your control's event listeners must call `this.commit(controlValue)` (on input/change — it runs
  `controlValue` through `parse()` and writes it to the form store) and `this.markTouched()` (on
  blur — marks the field touched so validation errors start showing).

### Worked example: a real, minimal input (`SaDateInput`)

The actual, complete implementation of the built-in date input (`src/inputs/dateInput.js`):

```js
import { BaseInput } from '../inputs/baseInput.js';
import { registerInput } from '../core/registry.js';

export class SaDateInput extends BaseInput(HTMLElement) {
  renderControl() {
    this.classList.add('sa-input', 'sa-date-input');
    this.setAttribute('data-sa-part', 'input');
    this.innerHTML = `
      <label class="sa-input__label"></label>
      <input class="sa-input__control" type="date" />
      <span class="sa-input__helper"></span>
      <span class="sa-input__error" role="alert"></span>`;

    this._control = this.querySelector('.sa-input__control');
    this.querySelector('.sa-input__label').textContent = this.label;
    this._control.disabled = this.disabled;
    if (this.readOnly) this._control.setAttribute('readonly', '');

    this._control.addEventListener('input', () => this.commit(this._control.value));
    this._control.addEventListener('blur', () => this.markTouched());
  }

  updateControl(value) {
    if (this._control && this._control.value !== value) this._control.value = value ?? '';
  }
}

registerInput('date', SaDateInput);
export default SaDateInput;
```

Walking through it:

1. `renderControl()` builds the markup once via `innerHTML`, grabs a reference to the native
   `<input type="date">`, applies `this.label`/`this.disabled`/`this.readOnly`, and wires two native
   events straight to the two methods `BaseInput` gives you: `commit()` on `input`, `markTouched()`
   on `blur`. It doesn't read from the store here — that's `updateControl`'s job.
2. `updateControl(value)` is called reactively with the *formatted* store value; it only touches the
   DOM if the value actually changed, avoiding needless cursor jumps in the native control.
3. No `format`/`parse` overrides are needed because a date-as-`'YYYY-MM-DD'`-string round-trips
   through the default identity converters unchanged.

When your control's native value type differs from what you want stored (e.g. a checkbox's
`.checked` boolean vs. a text input's string), override `format`/`parse` as plain methods, as the
real `src/inputs/booleanInput.js` does:

```js
import { BaseInput } from './baseInput.js';
import { registerInput } from '../core/registry.js';

export class SaBooleanInput extends BaseInput(HTMLElement) {
  renderControl() {
    this.classList.add('sa-input', 'sa-boolean-input');
    this.setAttribute('data-sa-part', 'input');
    this.innerHTML = `
      <label class="sa-input__label sa-boolean-input__label">
        <input class="sa-input__control" type="checkbox" />
        <span class="sa-boolean-input__label-text"></span>
      </label>
      <span class="sa-input__helper"></span>
      <span class="sa-input__error" role="alert"></span>`;

    this._control = this.querySelector('.sa-input__control');
    this.querySelector('.sa-boolean-input__label-text').textContent = this.label;
    this._control.disabled = this.disabled;
    if (this.readOnly) this._control.setAttribute('disabled', ''); // checkboxes have no readonly

    this._control.addEventListener('change', () => this.commit(this._control.checked));
    this._control.addEventListener('blur', () => this.markTouched());
  }

  format(storeValue) {
    return !!storeValue;
  }
  parse(controlValue) {
    return !!controlValue;
  }

  updateControl(value) {
    if (this._control) this._control.checked = !!value;
  }
}

registerInput('boolean', SaBooleanInput);
export default SaBooleanInput;
```

Note the `<span class="sa-input__error" role="alert">` and `<span class="sa-input__helper">` markup
in both examples — include those two elements (with those exact class names) in your control's
`innerHTML` if you want `renderError`/`renderHelper` (inherited, no override needed) to display
validation errors and helper text without any extra work on your part.

## 4. Registration: one call gets you an HTML tag *and* a JS-config factory

```js
// core/registry.js
export const registerField = (type, ElementClass, factory) => { ... };
export const registerInput = (type, ElementClass, factory) => { ... };
```

Call `registerField('myType', MyFieldClass)` / `registerInput('myType', MyInputClass)` once, at
module scope (so it runs as an import side effect, same as every built-in). `type` is a camelCase
identifier and is the single source of truth — the registry derives everything else from it:

- **The custom-element tag**, via `` `sa-${kebab(type)}-field` `` / `` `sa-${kebab(type)}-input` ``.
  `kebab()` (`src/core/util.js`) turns `referenceArray` into `reference-array`, so
  `registerField('referenceArray', ...)` gives you `<sa-reference-array-field>`, and
  `registerField('myType', ...)` gives you `<sa-my-type-field>`. The tag is only defined once (via
  `customElements.define`) — registering the same `type` twice logs a `field-reregistered` /
  `input-reregistered` warning and the second registration is ignored.
- **The JS-config factory**, exposed on `SimpleAdmin.fields`/`f` or `SimpleAdmin.inputs`/`i`. By
  default it's the mechanical `(props = {}) => ({ kind: 'field', type, ...props })` — so
  `registerField('myType', MyFieldClass)` gives you `f.myType({ source: '...', ... })` for free. Pass
  a third `factory` argument to `registerField`/`registerInput` if you want a different call
  signature (this is a rare escape hatch — the built-in function field uses it only to alias
  `fields.fn = fields.function`, so `f.fn(...)` reads better than the mechanical `f.function(...)`
  that `type: 'function'` would otherwise produce).

So, concretely, after:

```js
import { BaseField } from 'simple-admin'; // or '../../src/fields/baseField.js' from source
import { registerField } from 'simple-admin'; // or '../../src/core/registry.js'

class SaRatingField extends BaseField(HTMLElement) {
  renderValue(value) {
    this.textContent = '★'.repeat(Math.round(value));
  }
}
registerField('rating', SaRatingField);
```

you can immediately use, interchangeably:

```html
<sa-rating-field source="score"></sa-rating-field>
```

```js
f.rating({ source: 'score' })
```

The same derivation applies to `registerInput`/`i`.

## 5. Filters are just inputs

There is no separate filter registry, filter base class, or filter-specific tag namespace. Anything
you `registerInput` — built-in or your own — already works inside `<sa-filters>` / a `filters: [...]`
array, because `<sa-filters>` (`src/components/filters.js`) publishes a `formStore`-shaped adapter
that every `sa-*-input` looks up the exact same way it looks up `<sa-simple-form>`/`<sa-tabbed-form>`
(`this.closest('sa-simple-form, sa-tabbed-form, sa-filters').formStore`) — `BaseInput` doesn't know
or care which of the three it landed in.

```html
<sa-filters>
  <sa-text-input source="q" label="Search" always-on></sa-text-input>
  <sa-my-type-input source="score"></sa-my-type-input>
</sa-filters>
```

The one filter-specific behavior lives in `<sa-filters>` itself, not in the input: the `always-on`
attribute (a plain boolean descriptor flag, checked by `<sa-filters>` when laying out its children,
not by the input) pins a filter into the always-visible row instead of the collapsible "Add filter"
list. `always-on` and `default-value` are mutually exclusive — combining them logs a
`filter-alwayson-defaultvalue` warning and the `default-value` is dropped (use `filter-default-values`
on `<sa-list>` instead for a default the user can still change).

## 6. Graceful degradation, and how to be a good citizen

simple-admin's rule throughout is **warn, don't throw**: misconfiguration degrades to "render
nothing" plus one deduped console message, never an uncaught exception. If you reference a tag that
was never registered — a typo, or a custom field/input file that wasn't imported —
`<sa-datagrid>` (and `<sa-admin>`'s resource/view scanner) detect it by duck-typing: any light-DOM
child that doesn't expose a `.toDescriptor()` function (which only `BaseField`/`BaseInput` instances
have) is treated as unknown, logged via `diagnostics.warn('unknown-element', { tag, parentTag,
resource })`, and skipped — the rest of the grid/view still renders.

Every diagnostic (`src/core/diagnostics.js`) follows the same shape: prefixed `[simple-admin]`,
names the offending element/resource/source, states the likely cause, and states the fix, e.g.:

```
[simple-admin] Unknown element <sa-rateing-field> inside <sa-datagrid resource="products">.
This tag is not a registered field/input. Register it with
SimpleAdmin.registerField('rateing', …) or remove it. Skipping this column.
```

Messages are deduped (the same text only logs once) and gated by `setLogLevel('silent' | 'error' |
'warn' | 'verbose')` (default `'warn'`).

If your custom field/input needs to warn about its *own* bad configuration (an unknown option value,
say), reuse the same module instead of hand-rolling `console.warn`:

```js
import * as diagnostics from '../core/diagnostics.js'; // or wherever it's importable from in your setup

diagnostics.warn('my-custom-code', {
  message: `[simple-admin] <sa-rating-field> got max="${max}", which isn't a number. Falling back to 5.`,
});
```

Passing an explicit `message` string in the detail object is what `format()` uses verbatim (it takes
priority over any built-in template), so you get the same `[simple-admin] ...` convention, the same
dedup behavior, and the same log-level gating as every built-in diagnostic — without needing to add
your code to the shared `TEMPLATES` table.
