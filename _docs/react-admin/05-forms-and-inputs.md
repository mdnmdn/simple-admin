# React-Admin: Forms, Inputs & Validation Conventions

Source: https://marmelab.com/react-admin/documentation.html — pages `Create`, `Edit`, `SimpleForm`, `TabbedForm`, `Inputs`, `Validation`, `ArrayInput`, `ReferenceInput`, `Toolbar` (fetched 2026-07-02).

This document catalogs how react-admin structures Create/Edit pages, declares form inputs, wires validation, and submits data. It is written as an input to designing a vanilla-JS "simple-admin" clone with declarative (HTML-attribute-driven) forms.

---

## 1. `<Create>` and `<Edit>` page components

Both are **page-level controller + view** components: they fetch/initialize a record, expose it via React Context, provide a `save` callback wired to the data provider, and render a title/toolbar shell. The actual field UI is delegated entirely to a child **Form** component (`SimpleForm`, `TabbedForm`, etc.) — `<Create>`/`<Edit>` know nothing about individual fields.

### `<Create>`

- Initializes `RecordContext` with an **empty object** (or the `record` prop, for prefilling).
- `save` callback invokes `dataProvider.create(resource, { data })`.
- Default mutation mode: **pessimistic** (wait for server confirmation before redirect/notify).

| Prop | Type | Default | Purpose |
|---|---|---|---|
| `children` / `render` | ReactNode / function | — | Form content; `render` receives the CreateContext |
| `resource` | string | inferred from URL | Target resource name |
| `title` | string / node / `false` | translated default | Page title override |
| `redirect` | `'edit'` \| `'list'` \| `'show'` \| `false` \| `(resource, id, data) => string` | `'edit'` | Where to navigate after save |
| `transform` | `(data) => data \| Promise<data>` | — | Mutate the payload right before `dataProvider.create()` |
| `mutationMode` | `'pessimistic'` \| `'optimistic'` \| `'undoable'` | `'pessimistic'` | When UI reflects the change vs. server confirmation |
| `mutationOptions` | object (react-query options: `onSuccess`, `onError`, `onSettled`, `meta`) | — | Hook into the save mutation lifecycle |
| `record` | object | `{}` | Pre-populate the empty form |
| `component` | elementType | `Card` | Root wrapper element |
| `actions` | node | default toolbar | Replace header actions |
| `aside` | node | — | Secondary sidebar panel |
| `disableAuthentication` | boolean | `false` | Skip auth check (public create pages) |
| `sx` / `className` | — | — | Styling hooks |

### `<Edit>`

- Calls `dataProvider.getOne(resource, { id })` using the `id` from the URL (or the `id` prop).
- `save` callback invokes `dataProvider.update(resource, { id, data, previousData })`.
- Default mutation mode: **undoable** (optimistic UI + 5s undo window, then commits or reverts).
- `redirect` defaults to `'list'` (vs. `'edit'` for Create).
- `transform` signature is `(data, { previousData }) => data`, so diffs against the original record are possible.
- Additional `queryOptions` prop configures the `getOne` fetch (separate from `mutationOptions`, which configures the `update`).

Both components: enforce login unless `disableAuthentication`; check resource-level permissions (`{ action: 'create'|'edit', resource }`) when the auth provider supports access control; support headless variants (`<CreateBase>`/`<EditBase>` + `useCreateController`/`useEditController`) for fully custom layouts; and a "Guesser" variant (`<EditGuesser>`) that infers a form from the API shape for scaffolding.

**Mutation modes** (shared concept, different defaults per page type):
- `pessimistic` — submit → wait for server → then notify/redirect. Safest, slowest perceived UX.
- `optimistic` — UI updates immediately; the page refreshes with an error notification on failure.
- `undoable` — UI updates immediately with a 5s "Undo" snackbar; the real request fires after the window closes (or is cancelled by Undo).

---

## 2. Form layout components: `SimpleForm`, `TabbedForm`, `AccordionForm`

All three are **children-are-inputs** components: their `children` are literally the Input components (`TextInput`, `NumberInput`, ...), each tagged with a `source` prop. The form component itself doesn't know field semantics — it just lays children out, wires them to `react-hook-form`, and renders a toolbar.

### `<SimpleForm>`

Single-column list of inputs inside a Material UI `<Stack>`, one input per row, followed by a `<Toolbar>`.

```jsx
<Create>
  <SimpleForm defaultValues={{ nb_views: 0 }} warnWhenUnsavedChanges sanitizeEmptyValues>
    <TextInput source="title" isRequired />
    <TextInput source="body" />
    <NumberInput source="nb_views" />
  </SimpleForm>
</Create>
```

Key props: `defaultValues` (object or function — initial values for new records), `validate` (form-level validator), `warnWhenUnsavedChanges` (confirm-on-navigate-away), `toolbar` (swap or hide with `false`), `sanitizeEmptyValues` (strip empty strings before submit), `noValidate` (disable native HTML5 validation), `mode`/`reValidateMode` (passed straight through to RHF's `useForm`, e.g. `"onBlur"`), `onSubmit`, `component` (wrapper element, default `CardContent`).

### `<TabbedForm>`

Same input-children model, but groups them under `<TabbedForm.Tab label="...">` sections; only one tab's inputs are visible at a time. Useful once a form has "too many fields for one screen."

```jsx
<Edit>
  <TabbedForm>
    <TabbedForm.Tab label="summary">
      <TextInput source="title" validate={required()} />
    </TabbedForm.Tab>
    <TabbedForm.Tab label="details">
      <RichTextInput source="body" />
    </TabbedForm.Tab>
  </TabbedForm>
</Edit>
```

Extra props vs. SimpleForm: `syncWithLocation` (keep active tab in the URL, default `true`), and per-tab `path`, `count` (badge), `sx`. Tabs containing validation errors are **auto-highlighted**, which is a UX convention worth replicating (mark the tab, not just the field).

### `<AccordionForm>` (ra-enterprise / newer core)

Same declarative-children pattern, but each section is an `<AccordionForm.Panel label="...">` that expands/collapses vertically instead of switching tabs — useful for long single-page forms that still want grouped, collapsible sections. Conceptually a hybrid of SimpleForm's "one column" layout and TabbedForm's "grouped fields" layout.

**Common thread across all three:** the form component owns `react-hook-form`'s `useForm()` call and wraps children in a `FormProvider`; child Input components never manage their own state — they subscribe to the shared RHF form via `source`.

---

## 3. Catalog of built-in Input components

Every Input shares this baseline prop contract:

| Prop | Purpose |
|---|---|
| `source` (**required**) | Dot-path to the record property this input reads/writes (supports nested paths like `author.name`) |
| `validate` | A validator function or array of validators (see §4) |
| `label` | Display label; defaults to a humanized version of `source` |
| `defaultValue` | Value used when the record lacks this property (Create mostly) |
| `format` / `parse` | `format(recordValue) => inputValue` and `parse(inputValue) => recordValue` — convert between stored and displayed representations |
| `disabled` / `readOnly` | Disabled fields are excluded from submission; read-only fields are submitted but not editable |
| `helperText` | Text below the field |
| `fullWidth` | Defaults `true` |

### Text / content
- **TextInput** — free text; `multiline` for textarea behavior.
- **PasswordInput** — masked text field (often with a show/hide toggle).
- **RichTextInput** — WYSIWYG HTML editor (separate `ra-input-rich-text` package).
- **MarkdownInput** — markdown editor/preview.

### Numeric / boolean
- **NumberInput** — numeric field; browser `type=number` semantics, `step` for decimals.
- **BooleanInput** — a switch/checkbox for a strict true/false value.
- **NullableBooleanInput** — tri-state (true / false / null) via a select.

### Date / time
- **DateInput** — `YYYY-MM-DD` date picker.
- **TimeInput** — `HH:MM:SS`.
- **DateTimeInput** — full ISO datetime.

### Choice / enum (single)
- **SelectInput** — native-style `<select>` dropdown. Props: `choices` (array of `{id, name}` by default), `optionText` (string field name, function, or custom element), `optionValue` (defaults `id`), `translateChoice`.
- **AutocompleteInput** — searchable single-select with filtering, default child for `ReferenceInput`. Same `choices`/`optionText`/`optionValue` contract, plus `filterToQuery`, `createLabel`/`onCreate` (inline "add new option").
- **RadioButtonGroupInput** — radio buttons, same `choices` contract.

### Choice / enum (multiple / arrays)
- **AutocompleteArrayInput** — multi-select with search/tags.
- **SelectArrayInput** — multi-select `<select>`.
- **CheckboxGroupInput** — a list of checkboxes rather than radio buttons, one per choice, for multi-value fields.
- **DualListInput** — two-pane "available / selected" picker for arrays.

All of the above `choices`-based inputs share the trio `choices` / `optionText` / `optionValue`, and can accept `choices` as a static array or receive them dynamically via a wrapping `ReferenceInput`/`ReferenceArrayInput`.

### Structured / repeatable
- **ArrayInput** — edits an array of objects embedded in the record (e.g. order line items). Wraps a `<SimpleFormIterator>`.
- **SimpleFormIterator** (child of ArrayInput, not a standalone Input) — renders one repeatable "row" per array item with add/remove/reorder controls; nested inputs inside it use `source` **relative to the array item** (e.g. `<TextInput source="name" />` inside `<ArrayInput source="items">` maps to `items[i].name`). Supports `inline` (compact row layout) and `disabled`.

```jsx
<ArrayInput source="items">
  <SimpleFormIterator inline>
    <TextInput source="name" helperText={false} />
    <NumberInput source="price" helperText={false} />
    <NumberInput source="quantity" helperText={false} />
  </SimpleFormIterator>
</ArrayInput>
```

### File / media
- **FileInput** — drag-and-drop / browse file uploader; renders previews of already-attached files via children (e.g. `<FileField>`).
- **ImageInput** — same as FileInput specialized for images (thumbnail previews).

### Reference (foreign key) inputs
- **ReferenceInput** — fetches related records from another resource and exposes them to a nested selector; it does **not** render UI itself. Props: `source` (local FK field), `reference` (target resource name), `filter` (permanent filter for the candidate list), `sort` (default `{ field: 'id', order: 'DESC' }`), `perPage` (default 25), `queryOptions`. Must wrap a selector child — `AutocompleteInput` (default), `SelectInput`, or `RadioButtonGroupInput` — which owns label/validation/parsing.

```jsx
<ReferenceInput source="company_id" reference="companies" filter={{ is_published: true }} perPage={50}>
  <SelectInput label="Employer" />
</ReferenceInput>
```

- **ReferenceArrayInput** — same idea for a to-many FK array (e.g. `tag_ids`), wraps `AutocompleteArrayInput`/`SelectArrayInput`/`CheckboxGroupInput`.
- **ReferenceManyInput / ReferenceManyToManyInput / ReferenceOneInput** — variants for reverse/join-table relationships, used less often directly inside forms.

### Misc
- **SearchInput** — filter-only text input (list filters, not really record editing).
- **TranslatableInputs** — wraps a set of inputs per-locale for i18n fields, with a locale tab switcher.
- **TreeInput** — hierarchical/tree-structured choice picker.

---

## 4. Validation conventions

React-admin validation sits entirely on top of `react-hook-form`'s validation resolvers; react-admin adds convenience validators and a couple of composition rules.

### 4.1 Input-level `validate`

Each Input accepts `validate={fn}` or `validate={[fn1, fn2, ...]}`. Validators run in order; the first failure wins. A validator signature is:

```js
(value, allValues, meta) => undefined | string | { message, args }
```

Returning `undefined` means valid.

**Built-in validators** (imported from `react-admin`):

| Validator | Signature | Checks |
|---|---|---|
| `required(message?)` | | value is present / non-empty; also flags the label with an asterisk |
| `minLength(min, message?)` | strings | length ≥ min |
| `maxLength(max, message?)` | strings | length ≤ max |
| `minValue(min, message?)` | numbers | value ≥ min |
| `maxValue(max, message?)` | numbers | value ≤ max |
| `number(message?)` | | value is numeric |
| `email(message?)` | | value matches email format |
| `regex(pattern, message?)` | | value matches a custom RegExp |
| `choices(list, message?)` | | value is one of an allowed set |

```jsx
const validateFirstName = [required(), minLength(2), maxLength(15)];

<TextInput source="firstName" validate={validateFirstName} />
<TextInput source="email" validate={email()} />
```

Custom validators can be async (return a `Promise`) — e.g. checking uniqueness against the server — and are composed into the same array alongside built-ins:

```js
const validateEmailUnicity = async (value) => {
  const isUnique = await checkEmailIsUnique(value);
  return isUnique ? undefined : 'Email already in use';
};
const emailValidators = [required(), validateEmailUnicity];
```

**Important constraint:** input-level `validate` and form-level `validate` (below) are mutually exclusive on the same form — this is an upstream `react-hook-form` limitation, not a react-admin choice. Define validators outside the component render (module scope) to avoid re-creating functions every render (which would cause unnecessary re-validation/re-renders).

### 4.2 Form-level `validate`

Passed to `<SimpleForm validate={...}>` / `<TabbedForm validate={...}>` instead of per-input validators. Receives the whole values object, returns an error object keyed by field name (dot-path for nested/array fields):

```jsx
const validateUserCreation = (values) => {
  const errors = {};
  if (!values.firstName) errors.firstName = 'First name required';
  if (!values.age || values.age < 18) {
    errors.age = { message: 'ra.validation.minValue', args: { min: 18 } };
  }
  return errors;
};

<SimpleForm validate={validateUserCreation}>
  <TextInput source="firstName" />
  <TextInput source="age" />
</SimpleForm>
```

Useful for cross-field rules (e.g. "endDate must be after startDate"). Can also return a Promise for async form-wide checks.

### 4.3 Schema-based validation

A `resolver` prop (react-hook-form's resolver API — e.g. `yupResolver`, `zodResolver`) can be passed to the form component as an alternative to `validate`, for schema-driven validation (Yup/Zod/Joi).

### 4.4 Server-side / async validation

On submit, if `dataProvider.create/update` rejects with an error containing an `errors` object, react-admin maps it back onto the form:

```json
{
  "errors": {
    "root": { "serverError": "Overall form error message" },
    "fieldName": "Field-specific error",
    "anotherField": { "message": "translation.key", "args": { "param": "value" } }
  }
}
```

Keys must match input `source` paths; react-admin displays them next to the corresponding field automatically (same rendering path as client-side errors).

### 4.5 Error display & i18n

- Validators may return a plain string message **or** `{ message: 'translation.key', args: {...} }` for i18n-aware messages resolved through the `<Translate>`/`useTranslate` mechanism.
- Errors surface inline under the offending input (via MUI's `error`/`helperText` styling — red text + red border), and `isRequired`/`required()` also adds a visual asterisk to the label.
- In `TabbedForm`, a tab containing an invalid field is visually flagged, so users don't have to hunt across tabs.
- Validation timing is controlled by RHF's `mode`/`reValidateMode` (default: validate `onSubmit`, re-validate `onChange` after first submit attempt).

---

## 5. Underlying form library: react-hook-form + `useInput`

React-admin's form components are thin wrappers around **react-hook-form (RHF)**:

- `SimpleForm`/`TabbedForm`/`AccordionForm` call RHF's `useForm()` internally and wrap children in RHF's `<FormProvider>`. This means any descendant can call `useFormContext()`/`useFormState()` directly for advanced needs (conditional fields, watch-based logic, etc.).
- Individual Input components are not raw `<input>` elements — they are built on **`useInput()`**, react-admin's bridge hook around RHF's `useController()`. `useInput(props)` returns:
  - `field` — props to spread onto the underlying form control (`value`, `onChange`, `onBlur`, `name`, `ref`)
  - `fieldState` — `{ invalid, error, isTouched, isDirty }`
  - `isRequired` — boolean, derived by inspecting whether `required()` is present in the `validate` array/fn, used to auto-decorate the label
  
  ```js
  const CustomInput = (props) => {
    const { field, fieldState: { invalid, error }, isRequired } = useInput(props);
    return <input {...field} required={isRequired} />;
  };
  ```

  `useInput` also handles: normalizing `validate` (function or array) into an RHF-compatible rule, applying `format`/`parse` conversions between stored record values and displayed input values, and reading the current record from `RecordContext` to compute defaults.

This is the key architectural takeaway: **every Input is a declarative `source`-tagged wrapper around a shared, centralized form state** (RHF), not an independently-controlled component. A vanilla-JS clone should likewise centralize form state (e.g., one JS object per form keyed by `source` path) rather than letting each custom element own its own state.

---

## 6. Save / submit flow

- **`<SaveButton>`** — the default submit trigger, usually rendered inside the toolbar; triggers RHF's `handleSubmit`, which runs validation, then calls the `save` callback exposed by `<Create>`/`<Edit>` context (which itself calls `dataProvider.create`/`update`, subject to `transform` and `mutationMode`).
- **`<Toolbar>`** — rendered at the bottom of `SimpleForm`/`TabbedForm` (sticky on mobile). Default contents: `<SaveButton>` always, `<DeleteButton>` on Edit only. Fully replaceable via the `toolbar` prop:

  ```jsx
  const MyToolbar = () => (
    <Toolbar>
      <SaveButton label="Save" />
    </Toolbar>
  );
  <SimpleForm toolbar={<MyToolbar />}>...</SimpleForm>
  ```

  Multiple `<SaveButton>`s with different `type`/`mutationOptions` are a documented pattern (e.g. "Save" vs "Save and add another" vs "Save and continue editing" — each customizing `redirect`/`onSuccess` independently). `toolbar={false}` hides it entirely (headless/custom submit UI).
- **`warnWhenUnsavedChanges`** (form prop) — when true, intercepts in-app navigation (and browser tab close) while the form is dirty and prompts the user to confirm discarding changes. Pure UX guard, not a validation mechanism.

---

## 7. Default values, `transform`, and submit-time shaping

Two distinct data-shaping stages exist, deliberately kept separate:

1. **`defaultValues`** (on the form component) — populates the form **before the user starts editing**, for Create pages or to backfill missing fields (`<SimpleForm defaultValues={{ nb_views: 0 }}>`). Can be a static object or a function (evaluated once). This only affects the *initial* form state, not what gets submitted.
2. **`record` prop** (on `<Create>`) — an alternate way to seed the whole record (e.g. duplicating an existing record when creating a new one, or prefilling from a `CreateButton`'s `state`/query params).
3. **`transform`** (on `<Create>`/`<Edit>`) — runs **at submit time**, right before the data provider call, and can be async. Used to: compute derived fields, drop UI-only fields, or sanitize empty strings:

   ```js
   const transform = (data) => ({ ...data, fullName: `${data.firstName} ${data.lastName}` });
   ```

   On `<Edit>`, transform additionally receives `{ previousData }` for diffing.
4. **`sanitizeEmptyValues`** (form prop) — a narrower, built-in convenience that strips empty-string fields from the payload without writing a custom `transform`.

Order of operations: `defaultValues`/`record` seed the form → user edits (validated live via `validate`) → submit triggers RHF validation → on success, `transform` mutates the payload → `dataProvider.create/update` is called → success/error handled per `mutationMode` → redirect per `redirect` prop.

---

## 8. Declarative syntax to replicate

Design target: a vanilla-JS "simple-admin" where forms are declared in markup/config, not imperative code, mirroring react-admin's `source` / `validate` / `choices` conventions.

| React-admin concept | Proposed vanilla-JS / HTML mapping |
|---|---|
| `<Create>` / `<Edit>` page wrapper | A `<simple-form-page resource="posts" mode="create\|edit" redirect="list">` custom element that fetches the record (edit) and owns the submit handler |
| `<SimpleForm>` (flat list) | `<simple-form>` — direct children are input elements laid out top-to-bottom |
| `<TabbedForm>` + `Tab` | `<tabbed-form>` containing `<form-tab label="Summary">...</form-tab>` sections |
| `<AccordionForm>` + `Panel` | `<accordion-form>` containing `<form-panel label="...">...</form-panel>` |
| Input `source` prop | `source="title"` attribute on every custom input element (support dot-path `source="author.name"` and array index `source="items[].name"` inside a repeater) |
| `choices` / `optionText` / `optionValue` | `<select-input source="status" choices='[{"id":"draft","name":"Draft"}]' option-text="name" option-value="id">` — or a `choices` property set via JS for dynamic lists; `option-text` can also name a formatter function registered globally |
| `validate` (function or array) | `validate="required|minLength:2|maxLength:15"` — a small DSL string parsed into a validator pipeline, or `validate` set as a JS property to an array of functions for custom/async cases |
| Built-in validators | Ship equivalents: `required`, `minLength`, `maxLength`, `minValue`, `maxValue`, `number`, `email`, `regex`, `choices` — each a factory `(args, message?) => (value, allValues) => error|undefined` |
| Form-level `validate` | `<simple-form validate="myApp.validateUser">` referencing a globally-registered function, or a `.validate` JS property set imperatively |
| `required()` → asterisk on label | Central validator pipeline exposes `isRequired` per field so the label-rendering code can append `*` automatically, without duplicating the rule |
| `ArrayInput` + `SimpleFormIterator` | `<array-input source="items"><form-iterator><text-input source="name">...</form-iterator></array-input>` — nested `source` resolved relative to the array item, with add/remove row controls built in |
| `ReferenceInput` | `<reference-input source="company_id" reference="companies" filter='{"is_published":true}'><select-input option-text="name"/></reference-input>` — fetches choices, passes them down to its single child selector |
| `format` / `parse` | `format`/`parse` attributes referencing named converter functions (registered globally) for value ↔ display transforms |
| `useInput` bridge | A single shared `FormStore` (per `<simple-form>`/`<tabbed-form>` instance) keyed by `source` path; every custom input element registers itself against the store on connect, reads current value + error via store subscription, and writes back on `input`/`change` events — i.e., centralized state, not per-element local state |
| `defaultValues` | `<simple-form>` accepts a `default-values` JSON attribute or a `.defaultValues` JS property, applied before render for create mode |
| `transform` | `<simple-form-page transform="myApp.transformPost">` referencing a registered `(data) => data` function invoked at submit time before the API call |
| `sanitizeEmptyValues` | Boolean attribute `sanitize-empty-values` on the page/form element |
| `redirect` | `redirect="list|edit|show|false"` attribute, or a registered function name for custom logic |
| `mutationMode` | `mutation-mode="pessimistic|optimistic|undoable"` attribute controlling save/notify/redirect timing |
| `<Toolbar>` / `<SaveButton>` | `<form-toolbar>` default slot with `<save-button>`/`<delete-button>`; fully replaceable by providing custom light-DOM children, or hidden via `toolbar="none"` |
| `warnWhenUnsavedChanges` | Boolean attribute wired to a `beforeunload` listener + an in-app navigation guard checking the FormStore's dirty flag |
| Server-side validation errors | Standardize on the same `{ errors: { field: message|{message,args} } }` shape returned by the mock/data layer, mapped back onto the FormStore after a failed submit |
| Tab/panel error highlighting | FormStore exposes per-`source` validity; the tab/panel container subscribes and toggles an `has-error` class on the relevant tab header |

**Core architectural principle to carry over:** inputs are dumb, declarative, `source`-tagged views over one centralized form-state object per form; validation, defaults, formatting, and submission are all cross-cutting concerns handled by the form container, not by individual input elements.
