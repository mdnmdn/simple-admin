# react-admin: Field Components & Relationship/Reference Handling

Source pages consulted: `Fields.html`, `ReferenceField.html`, `ReferenceManyField.html`,
`ReferenceArrayField.html`, `ReferenceInput.html`, `ReferenceArrayInput.html`,
`SelectInput.html` (for `optionText`/`optionValue` conventions), all under
`https://marmelab.com/react-admin/documentation.html`.

This document is a reference for designing a vanilla-JS "simple-admin" equivalent. It focuses on
(1) the read-only **Field** component catalog, and (2) the **Reference/Relationship** component
family (both read-only display and form-editing variants), including the conventions that let
react-admin avoid N+1 queries.

---

## 1. Field components — general model

Field components are **read-only display** components used in `<List>`/`Datagrid`/`DataTable`
columns and in `<Show>` layouts (`<SimpleShowLayout>`, `<TabbedShowLayout>`). They read the
current record from React context (`RecordContext`) rather than receiving it as a prop directly,
which is what lets the same `<TextField source="title" />` be reused in a grid cell, a show page,
or standalone.

### Common props shared by (almost) every Field

| Prop | Purpose |
|---|---|
| `source` | Name of the property on the record to display. Supports dot-path notation for nested data, e.g. `source="author.name"`. |
| `label` | Column header / row label. Auto-humanized from `source` if omitted (e.g. `published_at` → "Published at"). Pass `false` to hide the label entirely. |
| `record` | Explicit record to use instead of pulling from `RecordContext` (for use outside a List/Show). |
| `sortable` | Whether clicking the column header sorts by this field (Datagrid/DataTable only). Defaults to `true`; reference-derived columns typically set this to `false` because the underlying data isn't sortable by the API without a `sortBy` override. |
| `sortBy` / `sortByOrder` | Override which field name / direction is actually used for sorting when it differs from `source` (e.g. sort by `user_id` even though the column displays the user's name via a `ReferenceField`). |
| `emptyText` | Text/placeholder shown when the value is empty/null. |
| `textAlign` | e.g. `"right"` — `NumberField` sets this automatically. |
| `className` / `sx` | Styling hooks (MUI). |

Fields with **no children and no special data need** (`TextField`, `EmailField`, `NumberField`,
`DateField`, etc.) are essentially "read `source`, format it, render it." Fields that model
**relationships** (`ReferenceField`, `ReferenceManyField`, `ReferenceArrayField`) instead fetch
external data based on `source`/`reference`/`target` and expose a nested `RecordContext` /
`ListContext` to their children.

### Custom field authoring pattern

A custom field is just a component that calls `useRecordContext()`:

```jsx
import { useRecordContext } from 'react-admin';

const FullNameField = (props) => {
  const record = useRecordContext(props);
  return record ? <span>{record.firstName} {record.lastName}</span> : null;
};
```

For dot-path `source` resolution, react-admin uses an internal `useFieldValue` hook rather than
raw property access, so nested/computed sources work consistently across all built-ins.

---

## 2. Catalog of built-in Field components

### Text / string display
- **`TextField`** — renders a string/number as plain text (Typography). `source`, `label`, `emptyText`. The default fallback field type when no better match exists.
- **`EmailField`** — like `TextField` but wraps value in a `mailto:` link with semantic markup.
- **`UrlField`** — renders the value as a clickable `<a href>` link.
- **`RichTextField`** — renders HTML content (sanitized) — used for WYSIWYG-authored body content.

### Numeric
- **`NumberField`** — locale-aware number formatting (`Intl.NumberFormat` under the hood: options for currency, decimal places, etc.). Automatically right-aligns (`textAlign: 'right'`).

### Date / time
- **`DateField`** — locale-aware date/time formatting. Commonly paired with `sortByOrder="DESC"` for "most recent first" columns.

### Boolean
- **`BooleanField`** — renders a check/cross icon (or custom text) for `true`/`false`/`null`.

### Choice / enum
- **`SelectField`** — resolves a raw value against a `choices` array (same `choices`/`optionText`/`optionValue` convention as the Input family — see §5) and displays the matching label instead of the raw id.
- **`ChipField`** — renders the value as a Material UI "chip" (pill/badge). Frequently used as the default child of list-style contexts (e.g. default rendering inside `ReferenceArrayField`'s `SingleFieldList`).

### Collections
- **`ArrayField`** — wraps an array-valued `source` and exposes a `ListContext` to its children (typically a nested `<Datagrid>`/`<SingleFieldList>`), so each array item can be rendered as a row/chip. Does **not** support `emptyText` since "empty" is just an empty list.

### Media
- **`ImageField`** — renders `source` (a URL, or `source` pointing at an object with a `src` sub-field for arrays of images) as an `<img>`.
- **`FileField`** — renders `source` as a downloadable file link (`<a href download>`).

### Custom / composition
- **`FunctionField`** — escape hatch: takes a `render`/`render`-style function `(record) => ReactNode` and renders arbitrary content computed from the record. No fixed `source` requirement.
  ```jsx
  <FunctionField render={record => `${record.first} ${record.last}`} />
  ```
- **`WrapperField`** — groups several child fields under a single column header/label without each child creating its own column. Useful for combining multiple values into one Datagrid cell while still supporting the common field props (`label`, `sortBy`) at the wrapper level.

### Relationship-aware fields (detailed in §3–4)
- **`ReferenceField`** — many-to-one / one-to-one display.
- **`ReferenceManyField`** / **`ReferenceManyCount`** — one-to-many (reverse foreign key) display.
- **`ReferenceArrayField`** — many-to-many display via an array of foreign-key ids.
- **`ReferenceOneField`** — one-to-many relationship where only a single related record should be shown (variant of `ReferenceManyField` for the "1:1 via reverse FK" case).

### Newer `render` prop pattern

Recent react-admin versions add a `render` prop to many components (`ReferenceField`,
`ReferenceManyField`, `ReferenceArrayField`, and the `FunctionField`-style fields) as an
alternative to passing `children`. `render` receives a context object (e.g.
`{ error, isPending, data }`) and lets you write inline conditional/loading/error UI without
declaring a separate child component:

```jsx
<ReferenceArrayField
  source="tag_ids"
  reference="tags"
  render={({ data }) => (
    <ul>{data?.map(tag => <li key={tag.id}>{tag.name}</li>)}</ul>
  )}
/>
```

---

## 3. Usage contexts: Datagrid/DataTable columns vs. Show layouts

- **In `<Datagrid>` / `<DataTable>` (List views):** each Field becomes one column. The field's
  `source` doubles as the sort key (unless `sortBy` overrides it) and its `label` becomes the
  column header (auto-humanized from `source` if not given). The newer `<DataTable>` API moves
  some of this configuration onto a `<DataTable.Col source="..." field={SomeField} />` wrapper
  rather than nesting the Field component directly, but the same props vocabulary (`source`,
  `label`, `sortable`, `field`) still applies.
- **In `<Show>` layouts (`<SimpleShowLayout>`, `<TabbedShowLayout>`):** Fields are read-only
  value displays, typically laid out as label/value pairs, sitting alongside (or replacing) Input
  components used in the corresponding `<Edit>`/`<Create>` form. Fields used outside a List/Show
  RecordContext need an explicit `record` prop, or should be wrapped in `<Labeled>` if they need
  a rendered label without the surrounding show-layout machinery.

---

## 4. Relationship / Reference components

react-admin models three relationship shapes, each with a **display (Field)** component and a
**form-editing (Input)** counterpart:

| Relationship | Display component | Form-editing component |
|---|---|---|
| many-to-one / one-to-one (FK on *this* record) | `ReferenceField` | `ReferenceInput` |
| one-to-many (FK on the *other* record, reverse lookup) | `ReferenceManyField` (+ `ReferenceManyCount`) | *(usually edited via nested `ReferenceManyField` + inline create/edit dialogs, not a single Input)* |
| many-to-many (array of FK ids on *this* record) | `ReferenceArrayField` | `ReferenceArrayInput` |

### 4.1 `ReferenceField` — many-to-one / one-to-one display

Fetches **one related record per row** based on a foreign-key id stored on the current record,
and renders it (by default using the related resource's `recordRepresentation`, or via child
Field components you supply).

Key props:
- `source` — the property on the *current* record holding the foreign-key id (e.g. `user_id`).
- `reference` — the name of the *related* resource to fetch from (e.g. `"users"`).
- `link` — navigation target when the rendered value is clicked: `"edit"` (default), `"show"`,
  `false` (no link), or a custom function.
- `queryOptions` — passed through to the underlying `dataProvider.getMany()` call (react-query options).
- `sortBy` — since the display value comes from a *different* resource, Datagrid sorting must be
  told which field the API can actually sort by (often the raw FK column, or disabled with
  `sortable={false}`).
- `empty` — content to show if the referenced record is missing / id is null.
- `render` — inline alternative to `children`, receiving `{ error, isPending, referenceRecord }`-like context.
- `children` — Field component(s) used to render the fetched related record (e.g. `<TextField source="name" />`); if omitted, react-admin displays the resource's configured `recordRepresentation`.

Example (Show):
```jsx
<ReferenceField source="user_id" reference="users" label="Author">
  <TextField source="name" />
</ReferenceField>
```

Example (Datagrid/DataTable):
```jsx
<DataTable.Col source="user_id">
  <ReferenceField source="user_id" reference="users" />
</DataTable.Col>
```

### 4.2 `ReferenceManyField` / `ReferenceManyCount` — one-to-many display

Used when the foreign key lives on the **other** resource (reverse lookup): e.g. an Author
record's book list, where each `books` row has an `author_id`. `ReferenceManyField` fetches
`dataProvider.getManyReference()` with the current record's id matched against `target` on the
related resource, and exposes a `ListContext` to its children.

Key props:
- `reference` — related resource to query (e.g. `"books"`).
- `target` — the foreign-key field *on the related resource* that points back at the current record (e.g. `"author_id"`).
- `source` — field on the *current* record used as the lookup value; defaults to `"id"`.
- `sort` — `{ field, order }`, defaults to `{ field: 'id', order: 'DESC' }`.
- `filter` — permanent filter merged into the query.
- `perPage` / `pagination` — page size and pagination UI.
- `children` / `render` — anything that consumes `ListContext`: `<DataTable>`, `<Datagrid>`, `<SingleFieldList>`, `<SimpleList>`, `<EditableDatagrid>`, `<Calendar>`, etc.
- `debounce`, `queryOptions`, `storeKey`, `empty`, `error`, `loading`, `offline` — supporting states.

`ReferenceManyCount` is the "just show the count" sibling — it renders the number of related
records (e.g. "12 books") without fetching/rendering the full list, useful for summary badges.

Example:
```jsx
<ReferenceManyField label="Books" reference="books" target="author_id">
  <DataTable>
    <DataTable.Col source="title" />
    <DataTable.Col source="published_at" field={DateField} />
  </DataTable>
</ReferenceManyField>
```

For the "exactly one related record" flavor of a reverse-FK relationship, react-admin offers
`ReferenceOneField` instead of forcing a list UI for a single row.

### 4.3 `ReferenceArrayField` — many-to-many display

Used when the current record stores an **array of foreign-key ids** (e.g. `tag_ids: [1, 2, 3]`
on a post). Fetches all matching records in one `dataProvider.getMany()` call and exposes them
via `ListContext`.

Key props: `source` (the array field, e.g. `"tag_ids"`), `reference` (e.g. `"tags"`), plus the
same supporting props as `ReferenceManyField` (`filter`, `sort`, `perPage` — default 1000,
`pagination`, `queryOptions`, `children`/`render`, `empty`/`error`/`loading`/`offline`).

Default rendering (no children) is a `<SingleFieldList>` of `<ChipField>`s showing each related
record's `recordRepresentation` — this is why `ChipField` is described above as the default
child of list-style reference contexts.

```jsx
<ReferenceArrayField label="Tags" reference="tags" source="tag_ids" />

<!-- custom rendering -->
<ReferenceArrayField label="Tags" reference="tags" source="tag_ids">
  <DataTable>
    <DataTable.Col source="name" />
  </DataTable>
</ReferenceArrayField>
```

### 4.4 `ReferenceInput` — single relation picker (forms)

The form-editing counterpart of `ReferenceField`. Lets a user pick one related record for a
foreign-key field, e.g. choosing a `company_id` when editing a contact.

Key props: `source` (FK field on the edited record), `reference` (resource to pick from),
`filter` / `sort` / `perPage` (control the choices query — `sort` defaults to
`{ field: 'id', order: 'DESC' }`, `perPage` defaults to 25), `queryOptions`,
`enableGetChoices` (gate/lazy-load fetching of choices), `page`, `offline`.

Data flow: it fetches the **current value's record** via `dataProvider.getMany()` (so the
already-selected item displays correctly) and the **list of selectable choices** via
`dataProvider.getList()`.

Default child (if none given): `AutocompleteInput` — a searchable combobox, filtering choices
server-side as the user types (`filter: { q: [searchTerm] }` by default), merged with any
permanent `filter`.

Overridable with alternative pickers as children: `SelectInput` (plain dropdown),
`RadioButtonGroupInput`, `DataTableInput` (tabular choice picker).

```jsx
<ReferenceInput source="company_id" reference="companies">
  <SelectInput />
</ReferenceInput>
```

Important convention: validation/formatting props (`validate`, `format`, `parse`) belong on the
**child** Input, not on `ReferenceInput` itself, since `ReferenceInput` is purely a data-fetching
wrapper. Also, when a `SelectInput`/`AutocompleteInput` is used as a child of `ReferenceInput`,
`optionValue` is forced to `"id"` and `translateChoice` is forced to `false` (see §5).

### 4.5 `ReferenceArrayInput` — multi-select relation picker (forms)

The form-editing counterpart of `ReferenceArrayField`, for many-to-many editing (e.g. selecting
multiple `tag_ids` on a post).

Required props: `source` (array FK field), `reference` (resource to pick from). Optional props
mirror `ReferenceInput`: `filter`, `perPage` (default 25), `sort`, `enableGetChoices`,
`queryOptions`, `offline`, `page`.

Same two-part data flow as `ReferenceInput`: `getMany()` for the currently-selected ids, plus
`getList()` for the browsable choice set (narrowed by user search text).

Default child: `AutocompleteArrayInput` (multi-select combobox). Overridable with:
`SelectArrayInput` (multi-select dropdown), `CheckboxGroupInput` (checkbox list),
`DualListInput` (dual-pane picker), `DataTableInput` (tabular multi-select).

```jsx
<ReferenceArrayInput source="tag_ids" reference="tags">
  <SelectArrayInput />
</ReferenceArrayInput>
```

Same conventions as `ReferenceInput`: validation lives on the child; the `label` prop on
`ReferenceArrayInput` itself only affects filter-form usage, not Edit/Create display (use the
child's `label` there); customize the search query shape via the child's `filterToQuery` prop.

---

## 5. `choices` / `optionText` / `optionValue` conventions

These conventions are shared across every choice-based component — `SelectInput`,
`AutocompleteInput`, `SelectArrayInput`, `AutocompleteArrayInput`, `CheckboxGroupInput`,
`RadioButtonGroupInput`, and the read-only `SelectField` — whether the choices come from a static
`choices` array or are populated dynamically by `ReferenceInput`/`ReferenceArrayInput`.

- **`choices`** — array of option objects. Default shape is `{ id, name }`:
  ```jsx
  const choices = [
    { id: 'tech', name: 'Tech' },
    { id: 'lifestyle', name: 'Lifestyle' },
  ];
  <SelectInput source="category" choices={choices} />
  ```
  An array of plain strings is also accepted and auto-normalized to `{ id, name }`.

- **`optionText`** — controls what's displayed as the option label. Three forms:
  - a string naming an alternate field: `optionText="label"`
  - a function: `optionText={choice => \`${choice.first_name} ${choice.last_name}\`}`
  - a React element, rendered inside a `RecordContext` where the choice is the "record":
    `optionText={<FullNameField />}`

- **`optionValue`** — the field used as the underlying stored value, default `"id"`. Only
  honored when `choices` is supplied directly; when the same Select/Autocomplete component is
  nested inside `ReferenceInput`/`ReferenceArrayInput`, `optionValue` is **forced to `"id"`**
  because the reference machinery always keys on the related resource's primary key.

- **`translateChoice`** — whether option labels run through the i18n translation layer.
  Defaults to `true` for standalone `choices`, but is **forced to `false`** when the component is
  a child of `ReferenceInput`/`ReferenceArrayInput` (translation doesn't make sense for
  dynamically fetched record labels).

`SelectField` (read-only) uses the identical `choices` + `optionText` + `optionValue`
contract to resolve a raw stored value back into a human label for display — i.e. the
input-side and field-side "enum/choice" components are two faces of the same convention.

---

## 6. Avoiding N+1 queries: batching & caching

react-admin's reference components are explicitly designed so that rendering N rows, each with a
`ReferenceField`/`ReferenceArrayField` pointing at the same or different related resources, never
results in N separate network requests:

- **`ReferenceField`** — instead of one `dataProvider.getOne()` per row, all `ReferenceField`
  instances rendered together **accumulate and deduplicate** the foreign-key ids they need, then
  issue a single batched `dataProvider.getMany(reference, { ids })` call for the entire
  list/page. E.g. five posts referencing three distinct users triggers one request for those
  three user ids, not five requests.
- **`ReferenceArrayField`** — similarly resolves its whole `source` array (and, across multiple
  rows/records, deduplicates ids again) via one `getMany()` call.
- **`ReferenceManyField`** (and `ReferenceManyCount`) — uses `dataProvider.getManyReference()`,
  which is the batched "get all related-resource rows whose `target` field matches this id"
  query — again one call per distinct parent id set, not one call per row.
- **`ReferenceInput` / `ReferenceArrayInput`** — split fetching into two batched calls: `getMany()`
  for "hydrate the already-selected value(s) so they render correctly" and `getList()` for "the
  browsable choice set," both debounced/deduplicated as the user interacts with the form.
- Multiple `ReferenceField`s across different columns pointing at the **same** `reference`
  resource share/dedupe their underlying fetch automatically — react-admin's data-fetching layer
  (built on react-query) caches by resource+ids, so repeated references to the same related
  record across the page reuse the cached result instead of re-fetching.

The net effect: relationship rendering scales with the number of *distinct* related ids on a
page, not the number of rows or reference fields.

---

## 7. Declarative syntax to replicate

For a vanilla-JS/web-components "simple-admin" clone, the most valuable vocabulary to reuse
verbatim (since it is already a well-tested, intuitive convention) is:

- **`source`** — attribute naming the property to read off the current record (supports dot-path
  for nested values). Used identically on every field/input, reference or not.
- **`label`** — optional override for the auto-humanized column/row label; a `false`/absent
  value hides it.
- **`reference`** — attribute naming the *related resource/collection* to fetch from. Present on
  every relationship component (`reference-field`, `reference-many-field`, `reference-array-field`,
  `reference-input`, `reference-array-input`).
- **`target`** — attribute naming the *foreign key field on the related resource* for reverse
  (one-to-many) lookups — distinguishes `reference-many-field` from `reference-field`.
- **`link`** — `"edit" | "show" | "false"` navigation behavior when a rendered reference value is
  clicked.
- **`sortable`** / **`sort-by`** — decouple "is this column clickable to sort" from "what field
  does the API actually sort on," important because reference-derived columns can't sort on the
  display value directly.
- **`empty-text`** / **`empty`** — fallback content slot for missing values or empty relationship
  results.
- **`choices`** + **`option-text`** + **`option-value`** — the enum/select contract, reusable
  both for static dropdowns and (with `option-value` pinned to `"id"`) for reference pickers.
- **`filter`**, **`sort`**, **`per-page`** — attributes/props for scoping and paging the
  candidate list fetched by any reference-picker component.
- A **children-as-renderer** slot convention (react-admin's `children`/`render` prop): a
  `<reference-field>` / `<reference-many-field>` should accept nested field elements (or a
  render callback/slot) to control how the fetched related record(s) are displayed, defaulting
  to a sensible "record representation" (e.g. a configured display field or `id`) when no
  children are given.
- Batching semantics worth replicating in the data layer: any "reference-*" element should
  register its needed id(s) with a shared per-page/per-request batcher that dedupes and issues
  one `getMany`/`getManyReference`-equivalent call rather than one fetch per element instance.
