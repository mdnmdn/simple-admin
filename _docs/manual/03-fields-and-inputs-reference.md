# 3. Fields & Inputs Reference

This is the complete catalog of built-in **fields** (read-only display, used in list/show views) and **inputs** (editable form controls, used in create/edit forms), plus the validator catalog they share.

Every component can be authored in either syntax:

```html
<sa-text-field source="name"></sa-text-field>
```

```js
import { f } from '../../src/index.js';
f.text({ source: 'name' })
```

Both paths normalize to the same internal descriptor object (`{ kind: 'field'|'input', type, ...props }`); an HTML attribute `some-attr="x"` and a JS-config key `someAttr: 'x'` are the same thing (kebab-case ↔ camelCase). This doc gives attribute names in their HTML (kebab-case) form and calls out the JS-config key whenever it differs from the obvious camelCase conversion.

## 3.1 Conventions shared by every field

All fields extend `BaseField` (`src/fields/baseField.js`), which resolves `source` against the nearest `RecordContext` (dot-path aware — `source="author.name"` reads `record.author.name`) and handles the empty-value/label baseline.

| Attribute | JS-config key | Meaning |
|---|---|---|
| `source` | `source` | Dot-path into the current record. Required, **except** on `<sa-function-field>`. |
| `label` | `label` | Column/field heading. Defaults to `source` humanized (`author_id` → "Author id", last dot-path segment only). Pass `label=""` to suppress the label entirely. |
| `empty-text` | `emptyText` | Text rendered when the resolved value is `null`, `undefined`, or `''`. Defaults to `''`. |

A field with no `source` (other than `sa-function-field`) logs a `field-missing-source` diagnostic and renders nothing rather than throwing. A field rendered outside any record context (no list/show/datagrid ancestor) similarly warns and renders nothing.

Every field also gets a `sa-field sa-field--<type>` class on itself (e.g. `sa-field sa-field--text`) for styling hooks.

## 3.2 Conventions shared by every input

All inputs extend `BaseInput` (`src/inputs/baseInput.js`). An input looks up its FormStore via `closest('sa-simple-form, sa-tabbed-form, sa-filters')`, registers `source` against it (seeding `default-value`, compiled validators, and its `format`/`parse` converters), and reactively pushes `format(storeValue)` into its control while pushing `parse(controlValue)` back on `commit()`.

| Attribute | JS-config key | Meaning |
|---|---|---|
| `source` | `source` | Dot-path into the form's value object. Required. |
| `label` | `label` | Control label. Defaults to humanized `source`. A trailing `" *"` is auto-appended whenever a `required` validator is present. |
| `default-value` | `defaultValue` | Value to seed the field with when the form record doesn't already have one (e.g. on create). |
| `disabled` | `disabled` | Boolean-presence attribute. Disables the control outright. |
| `read-only` | `readOnly` | Boolean-presence attribute. Native `<input readonly>` where the DOM supports it; for controls without a native read-only state (checkboxes, `<select>`) it's implemented as `disabled`. |
| `helper-text` | `helperText` | Small hint text rendered under the control at all times. |
| `validate` | `validate` | Validator(s) — see §3.4. Accepts a DSL string (HTML or JS) or an array of validator functions (JS only). |

Every input renders a consistent skeleton: `<label class="sa-input__label">`, the control itself, `<span class="sa-input__helper">`, and `<span class="sa-input__error" role="alert">` for the active validation message (only shown once the field has been touched — i.e. blurred at least once). Every input also gets `sa-input sa-<kebab-type>-input` classes and `data-sa-part="input"`.

## 3.3 Fields catalog

### `sa-text-field` / `f.text(...)`

The default fallback field. Renders `String(value)` as plain text. No extra attributes beyond the §3.1 baseline.

```html
<sa-text-field source="name"></sa-text-field>
```

### `sa-number-field` / `f.number(...)`

Locale-aware number formatting via `Intl.NumberFormat`.

| Attribute | JS key | Notes |
|---|---|---|
| `options` | `options` | JSON literal passed straight through to `new Intl.NumberFormat(undefined, options)`, e.g. `options='{"style":"currency","currency":"USD"}'`. |

```html
<sa-number-field source="price" options='{"style":"currency","currency":"USD"}'></sa-number-field>
```

Non-numeric values fall back to `String(value)` unchanged.

### `sa-boolean-field` / `f.boolean(...)`

Renders a check/cross glyph by default, or custom text.

| Attribute | JS key | Notes |
|---|---|---|
| `true-text` | `trueText` | Text shown when the value is truthy. Default: `✓`. |
| `false-text` | `falseText` | Text shown when the value is falsy. Default: `✗`. |

Also sets `aria-label="true"`/`"false"` on itself. Note this field never hits the "empty" path for `false`/`0` (they're falsy but not `null`/`undefined`/`''`), so it always renders one glyph or the other for any resolved boolean-ish value.

### `sa-date-field` / `f.date(...)`

Locale-aware date/time formatting via `Intl.DateTimeFormat`. Accepts a `Date`, or anything `new Date(value)` can parse (ISO strings, timestamps).

| Attribute | JS key | Notes |
|---|---|---|
| `options` | `options` | JSON literal passed to `new Intl.DateTimeFormat(undefined, options)`. Takes precedence over `show-time` if both are set. |
| `show-time` | `showTime` | Boolean-presence attribute. When set (and `options` is absent), uses `{ dateStyle: 'medium', timeStyle: 'short' }` instead of the default `{ dateStyle: 'medium' }`. |

```html
<sa-date-field source="createdAt" show-time></sa-date-field>
<sa-date-field source="createdAt" options='{"dateStyle":"full"}'></sa-date-field>
```

Unparseable values fall back to `String(value)`.

### `sa-email-field` / `f.email(...)`

Wraps the value in a `mailto:` link: `<a href="mailto:{value}">{value}</a>`. No extra attributes.

### `sa-url-field` / `f.url(...)`

Wraps the value in a plain link: `<a href="{value}">{value}</a>`. No extra attributes.

### `sa-select-field` / `f.select(...)`

Resolves a raw stored value (e.g. an enum code) to its human label via a `choices` list — the display counterpart to `sa-select-input`.

| Attribute | JS key | Notes |
|---|---|---|
| `choices` | `choices` | JSON array of choice objects (or plain strings/numbers — see §3.5). |
| `option-text` | `optionText` | Field name to read the label from, or (JS-config only) a `(choice) => label` function. Default: `'name'`. |
| `option-value` | `optionValue` | Field name holding the stored value to match against. Default: `'id'`. |

```html
<sa-select-field source="status"
  choices='[{"id":"draft","name":"Draft"},{"id":"published","name":"Published"}]'>
</sa-select-field>
```

If no choice matches the value, the raw value is rendered as-is.

### `sa-function-field` / `f.fn(...)`

The escape hatch for arbitrary render logic. `source` is **optional** — omitting it means "always has a value," so `render()` is invoked unconditionally with the whole record rather than being skipped as "empty." Note the JS-config factory is `f.fn(...)`, not `f.function(...)` (aliased for readability; the underlying descriptor `type` is still `'function'`, and the custom element tag is still `sa-function-field`).

| Attribute | JS key | Notes |
|---|---|---|
| — (no HTML equivalent) | `render` | `(record, source) => string \| Node \| null/undefined`. JS-config only — a render callback can't be expressed as an HTML attribute. |

```js
f.fn({
  label: 'Full name',
  render: (record) => `${record.firstName} ${record.lastName}`,
})
```

```js
f.fn({
  render: (record) => {
    const span = document.createElement('span');
    span.textContent = record.active ? 'Active' : 'Inactive';
    span.style.color = record.active ? 'green' : 'red';
    return span;
  },
})
```

Returning `null`/`undefined`/`''` renders `emptyText` (as usual); returning a DOM `Node` appends it directly; anything else is stringified.

### `sa-reference-field` / `f.reference(...)`

Many-to-one / one-to-one display: reads a foreign-key id at `source`, fetches the related record from `reference`, and renders it. Fetches across multiple `sa-reference-field`/`sa-reference-array-field` instances pointing at the same `reference` resource in the same tick are coalesced into a single batched `dataProvider.getMany()` call.

| Attribute | JS key | Notes |
|---|---|---|
| `reference` | `reference` | Name of the related resource (must be declared via `<sa-resource name="...">` / `SimpleAdmin.resource(...)`, even with no views, or a `reference-undeclared` diagnostic fires and the raw id is shown). |
| `link` | `link` | `"edit"` (default meaning when merely present) or `"show"` — wraps the rendered content in a link to `#/{reference}/{id}` (or `.../show`). Omit the attribute, or set it to `false`, to render plain (non-linked) text. |

Nest a field template inside to control how the related record renders; with no children, it falls back to the related record's raw `id`:

```html
<sa-reference-field source="authorId" reference="authors" link="show">
  <sa-text-field source="name"></sa-text-field>
</sa-reference-field>
```

If the id doesn't resolve to a record (not found, or `reference` isn't a declared resource), the raw id is rendered instead (optionally still linked).

### `sa-reference-array-field` / `f.referenceArray(...)`

Many-to-many display: reads an array of foreign-key ids at `source`, resolves them all via the same batcher used by `sa-reference-field`, and renders one "chip" (`<span class="sa-field__chip">`) per resolved record.

| Attribute | JS key | Notes |
|---|---|---|
| `reference` | `reference` | Name of the related resource, same rules as `sa-reference-field`. |

```html
<sa-reference-array-field source="tagIds" reference="tags">
  <sa-text-field source="label"></sa-text-field>
</sa-reference-array-field>
```

With no child field template, each chip shows the related record's raw `id`. Unresolved ids fall back to a chip with the raw id. An empty array renders `emptyText`.

### `sa-array-field` / `f.array(...)`

Renders a nested field template once per item of an array-valued `source`. Purely local — no fetching. Per react-admin convention, an empty array is simply an empty render (`empty-text` is **not** applied here).

```html
<sa-array-field source="lineItems">
  <sa-text-field source="sku"></sa-text-field>
  <sa-number-field source="qty"></sa-number-field>
</sa-array-field>
```

Each item gets its own `sa-array-field-row` wrapper element and its own `RecordContext` set to that item, so nested field `source`s resolve against the item, not the parent record.

## 3.4 Inputs catalog

### `sa-text-input` / `i.text(...)`

`<input type="text">`, or a `<textarea>` when `multiline` is present.

| Attribute | JS key | Notes |
|---|---|---|
| `multiline` | `multiline` | Boolean-presence attribute. Renders a `<textarea>` instead of `<input type="text">`. |

```html
<sa-text-input source="bio" multiline validate="maxLength:500"></sa-text-input>
```

### `sa-number-input` / `i.number(...)`

`<input type="number">`. Store value is always a `Number` (or `undefined` for an empty control) — `parse()` converts the control's string to a number.

| Attribute | JS key | Notes |
|---|---|---|
| `step` | `step` | Native `step`. |
| `min` | `min` | Native `min`. Numeric-coerced. |
| `max` | `max` | Native `max`. Numeric-coerced. |

```html
<sa-number-input source="price" step="0.01" min="0" validate="required|number"></sa-number-input>
```

### `sa-boolean-input` / `i.boolean(...)`

`<input type="checkbox">` wrapped in its own label. `format`/`parse` both coerce to a strict boolean. No extra attributes.

### `sa-date-input` / `i.date(...)`

`<input type="date">`. No extra attributes.

### `sa-email-input` / `i.email(...)`

`<input type="email">`. No extra attributes — pair with `validate="email"` for actual format validation (the browser's native email UI hinting is cosmetic only).

### `sa-url-input` / `i.url(...)`

`<input type="url">`. No extra attributes.

### `sa-search-input` / `i.search(...)`

`<input type="search">` with a leading magnifying-glass icon; intended for filter bars (`<sa-filters>`), not record forms.

| Attribute | JS key | Notes |
|---|---|---|
| `always-on` | `alwaysOn` | Boolean-presence attribute. Not read by the input itself — it's a plain descriptor flag `<sa-filters>` reads to decide whether this filter is always visible (vs. hidden behind an "add filter" affordance). |

```html
<sa-filters>
  <sa-search-input source="q" always-on></sa-search-input>
</sa-filters>
```

### Choice-based inputs

`sa-select-input`, `sa-select-array-input`, `sa-checkbox-group-input`, `sa-autocomplete-input`, and `sa-autocomplete-array-input` all share the same `choices` / `option-text` / `option-value` convention described in §3.5.

#### `sa-select-input` / `i.select(...)`

A native `<select>`, single choice. Always renders one blank leading `<option value="">`.

| Attribute | JS key | Notes |
|---|---|---|
| `choices` | `choices` | JSON array of choice objects (or strings/numbers). |
| `option-text` | `optionText` | Label field name (or JS-only function). Default `'name'`. |
| `option-value` | `optionValue` | Stored-value field name. Default `'id'`. |

```html
<sa-select-input source="status" choices='[
  {"id":"draft","name":"Draft"},
  {"id":"published","name":"Published"}
]' validate="required"></sa-select-input>
```

`parse()` resolves the `<select>`'s string value back to the matching choice's actual (possibly non-string, e.g. numeric) stored value.

#### `sa-select-array-input` / `i.selectArray(...)`

`<select multiple>` — value is an array. Same `choices`/`option-text`/`option-value` attributes as `sa-select-input`.

```html
<sa-select-array-input source="tagIds" choices='[
  {"id":1,"name":"Tech"},{"id":2,"name":"News"}
]'></sa-select-array-input>
```

#### `sa-checkbox-group-input` / `i.checkboxGroup(...)`

A `<fieldset>` of checkboxes, one per choice; value is an array of the checked choices' stored values. Same `choices`/`option-text`/`option-value` attributes.

```html
<sa-checkbox-group-input source="permissions" choices='["read","write","admin"]'></sa-checkbox-group-input>
```

#### `sa-autocomplete-input` / `i.autocomplete(...)`

A searchable single-select: a text `<input role="combobox">` plus a dropdown `<ul>` of choices, filtered client-side (case-insensitive substring match on the label) by default. Same `choices`/`option-text`/`option-value` attributes.

```html
<sa-autocomplete-input source="authorId" choices='[
  {"id":1,"name":"Ada Lovelace"},{"id":2,"name":"Alan Turing"}
]'></sa-autocomplete-input>
```

Selecting an option commits its `option-value`; typing without selecting does not commit a value (the control keeps the typed text visually, but the store value only updates on selection).

#### `sa-autocomplete-array-input` / `i.autocompleteArray(...)`

Same as `sa-autocomplete-input` but multi-select: selected choices render as removable "×" chips above the text input, and already-selected choices are excluded from the dropdown. Same `choices`/`option-text`/`option-value` attributes.

### Reference inputs

`sa-reference-input` and `sa-reference-array-input` pick a related record (or records) by id, backed by `dataProvider.getList()` for the browsable choice set. Unlike other inputs, they don't render their own choice UI directly — they delegate rendering to a nested choice-input (declared by you, or a sensible default), while remaining the *only* element actually registered against the FormStore for that `source` (this avoids a double-registration/race between a "real" nested input and the reference wrapper).

#### `sa-reference-input` / `i.reference(...)`

| Attribute | JS key | Notes |
|---|---|---|
| `reference` | `reference` | Related resource name. Must be a declared resource, or a `reference-undeclared` diagnostic fires and the field falls back to a disabled, read-only text box showing the raw id. |
| `filter` | `filter` | JSON literal — extra filter passed to `dataProvider.getList()`'s `filter`. |
| `sort` | — | JS-config only: `{ field, order }`. In HTML use `sort-field`/`sort-order` instead (see below); together they compose into the same `sort` descriptor key. |
| `sort-field` / `sort-order` | `sort.field` / `sort.order` | HTML-only pair that composes into `sort: { field, order }`. Default: `{ field: 'id', order: 'ASC' }`. |
| `per-page` | `perPage` | Page size for the choice list fetch. Default `25`. |

By default, renders as an `sa-autocomplete-input`. To use a different choice UI, declare an `sa-select-input` (or `sa-autocomplete-input`) as a direct child — it's detached and reused as the rendering delegate, with `option-value` forced to `'id'`:

```html
<sa-reference-input source="authorId" reference="authors" sort-field="name" sort-order="ASC">
  <sa-select-input option-text="name"></sa-select-input>
</sa-reference-input>
```

The currently-selected id is hydrated (via a batched `getMany()`) even if it isn't on the first page of choices, so its label still displays correctly.

#### `sa-reference-array-input` / `i.referenceArray(...)`

Same attributes as `sa-reference-input` (`reference`, `filter`, `sort-field`/`sort-order` or JS `sort`, `per-page`); `source` holds an array of ids instead of a single id.

Defaults to `sa-autocomplete-array-input`. Declare `sa-select-array-input`, `sa-autocomplete-array-input`, or `sa-checkbox-group-input` as a direct child to pick a different choice UI:

```html
<sa-reference-array-input source="tagIds" reference="tags">
  <sa-checkbox-group-input option-text="label"></sa-checkbox-group-input>
</sa-reference-array-input>
```

### `sa-array-input` / `i.array(...)`

Repeatable object rows over an array-valued `source`. Declare the row "shape" as a light-DOM template of input elements inside a nested `<sa-form-iterator>`:

```html
<sa-array-input source="lineItems">
  <sa-form-iterator>
    <sa-text-input source="sku" label="SKU"></sa-text-input>
    <sa-number-input source="qty" label="Qty"></sa-number-input>
  </sa-form-iterator>
</sa-array-input>
```

One row is rendered per array item; each row is a real clone of the template inputs with `source` rewritten to be index-scoped (`lineItems.0.sku`, `lineItems.1.sku`, ...) — dot-path resolution handles the numeric segment like any other path. Each row input is independently registered with the same FormStore and commits directly; `sa-array-input` itself only owns the "Add"/"Remove" buttons (push/splice the array) and re-renders rows when the array's *length* changes (editing a value inside a row does not tear down/rebuild the rows).

If the `<sa-form-iterator>` wrapper is omitted, all direct children of `sa-array-input` are used as the row template instead.

## 3.5 The choices / optionText / optionValue convention

Every choice-based component (`sa-select-field`, `sa-select-input`, `sa-select-array-input`, `sa-checkbox-group-input`, `sa-autocomplete-input`, `sa-autocomplete-array-input`, and the nested delegate of `sa-reference-input`/`sa-reference-array-input`) shares the same shape:

- **`choices`** — an array of choice objects. A plain string or number in the array is auto-normalized to `{ id: value, name: String(value) }`, so `choices='["draft","published"]'` and `choices='[{"id":"draft","name":"Draft"}]'` both work.
- **`option-text`** (`optionText`) — the field name to read the visible label from. Default `'name'`. In JS config only, this can instead be a function `(choice) => label`.
- **`option-value`** (`optionValue`) — the field name to read/write the stored value from. Default `'id'`.

Resolving a control-side value back to a choice's real stored value is done by comparing `String(value)` against `String(choice[optionValue])`, so numeric ids round-trip correctly even though HTML form controls only ever produce strings.

Reference inputs force `option-value` to `'id'` on their nested delegate (since the choices come from `dataProvider.getList()`, whose records always key on `id`).

## 3.6 Validators

Import the validator factories from the `validators` namespace (`SimpleAdmin`'s `f`/`i` don't re-export them separately — use `import { validators } from '../../src/index.js'` or `import * as validators from '../../src/validators/index.js'`).

A validator is a function `(value, allValues, meta) => undefined | string` — it returns an error message string on failure, or `undefined` on success. Validators run in order; the first failure wins.

| Factory | Signature | Fails when | Default message |
|---|---|---|---|
| `required` | `required(message = 'Required')` | Value is `null`/`undefined`/`''`/empty array. | `Required` |
| `minLength` | `minLength(min, message?)` | `String(value).length < min` (skipped if empty). | `Must be {min} characters at least` |
| `maxLength` | `maxLength(max, message?)` | `String(value).length > max` (skipped if empty). | `Must be {max} characters or fewer` |
| `minValue` | `minValue(min, message?)` | `Number(value) < min` (skipped if empty). | `Must be at least {min}` |
| `maxValue` | `maxValue(max, message?)` | `Number(value) > max` (skipped if empty). | `Must be {max} or less` |
| `number` | `number(message = 'Must be a number')` | `Number(value)` is `NaN` (skipped if empty). | `Must be a number` |
| `email` | `email(message = 'Must be a valid email')` | Value doesn't match a basic `x@y.z` shape (skipped if empty). | `Must be a valid email` |
| `regex` | `regex(pattern, message = 'Invalid format')` | `pattern` (a `RegExp`, or a string compiled into one) doesn't match `String(value)` (skipped if empty). | `Invalid format` |
| `choices` | `choices(list, message = 'Invalid choice')` | Value (or, for arrays, every element) isn't in `list` (skipped if empty). | `Invalid choice` |

`required()`'s returned function carries an `isRequired` flag, which is how `BaseInput` knows to append `" *"` to the label — this only works for `required` supplied this way (either via the DSL or by calling `validators.required()` directly), not via an arbitrary custom function.

"Empty" for validator purposes (all validators except `required` skip an empty value) means `null`, `undefined`, `''`, or an empty array — the same `isEmpty` check `required` uses.

### Three equivalent ways to specify `validate`

**1. HTML DSL string** — pipe-separated `name` or `name:arg1,arg2`:

```html
<sa-text-input source="title" validate="required|minLength:2|maxLength:80"></sa-text-input>
```

Arguments are comma-split and auto-coerced: `"true"`/`"false"` become booleans, anything else parseable as a number becomes a `Number`, otherwise stays a string. Unknown validator names log an `unknown-validator` diagnostic and are skipped (not thrown).

**2. JS-config DSL string** — the exact same string works in JS config too (parsed identically):

```js
i.text({ source: 'title', validate: 'required|minLength:2|maxLength:80' })
```

**3. JS-config array of validator functions** — call the factories yourself for custom messages, `regex`/`choices` args that don't fit the DSL's comma-splitting, or your own validator functions:

```js
import { validators } from '../../src/index.js';

i.text({
  source: 'title',
  validate: [
    validators.required('Title is required'),
    validators.minLength(2),
    validators.regex(/^[A-Z]/, 'Must start with a capital letter'),
  ],
})
```

A single function (not wrapped in an array) is also accepted as shorthand for a one-validator array.
