# react-admin — List, Datagrid, Filters & Show conventions

Source material: [List](https://marmelab.com/react-admin/List.html), [Datagrid](https://marmelab.com/react-admin/Datagrid.html),
[FilteringTutorial](https://marmelab.com/react-admin/FilteringTutorial.html), [FilterButton](https://marmelab.com/react-admin/FilterButton.html),
[Pagination](https://marmelab.com/react-admin/Pagination.html), [SimpleList](https://marmelab.com/react-admin/SimpleList.html),
[DatagridConfigurable](https://marmelab.com/react-admin/DatagridConfigurable.html) (& [SelectColumnsButton](https://marmelab.com/react-admin/SelectColumnsButton.html)),
[Show](https://marmelab.com/react-admin/Show.html).

This note captures the conventions react-admin (marmelab) uses for its List view stack, as background for designing an
equivalent "simple-admin" vanilla-JS system.

---

## 1. `<List>` — the root list page

`<List>` is the page-level component for a resource's list route. It is responsible for:

1. Fetching data via `dataProvider.getList(resource, { pagination, sort, filter, meta })`.
2. Populating a `ListContext` (records, `total`, `isPending`/`isLoading`, `error`, current `filter`/`sort`/`page`/`perPage`,
   and the callback functions to change them).
3. Rendering the standard page chrome (title, toolbar/actions, filter form, pagination) around whatever is passed as
   `children` (or `render`).
4. Syncing filter/sort/page state with the URL query string and (optionally) `localStorage`, so a list view is
   bookmarkable/shareable and remembers user preferences across visits.

It does **not** render columns itself — that's delegated entirely to its child (typically `<Datagrid>` / `<DataTable>`
or `<SimpleList>`).

### Key props

| Prop | Purpose |
|---|---|
| `resource` | Which resource to query; defaults to the `ResourceContext` (i.e. inferred from the route). |
| `sort` | Initial sort order: `{ field: 'published_at', order: 'DESC' }`. |
| `perPage` | Records per page (default `10`). |
| `filter` | **Permanent** filter, always applied, merged into every request, and *not editable by the user* (not shown in the filter form). Used for e.g. scoping a list to `{ is_published: true }`. |
| `filterDefaultValues` | Initial values for filter inputs that the user *can* see and change. Only applied on first load — once the user changes filters, defaults are gone. |
| `filters` | Array of input elements (e.g. `<TextInput>`, `<SearchInput>`) that define the filter form / filter dropdown (see §3). |
| `children` / `render` | Required: what renders the actual list of records — `<Datagrid>`, `<DataTable>`, `<SimpleList>`, or a render-prop function receiving the `ListContext`. |
| `pagination` | Custom pagination element (default: `<Pagination>`). |
| `actions` | Custom toolbar (buttons like Create/Export/Filter) replacing the default one. |
| `exporter` | Function `(records, fetchRelatedRecords, dataProvider) => void` controlling CSV export content; `false` disables the Export button. |
| `bulkActionButtons` | (Historically set here, now more commonly on `<Datagrid>`) which bulk-action buttons show up once rows are selected; `false` disables bulk actions/selection entirely. |
| `empty` | Component rendered instead of the list when there are zero records and no active filter (see §8). `false` renders the normal empty grid instead of the "create your first record" page. |
| `title` | Page title: string, element, or `false` to hide. |
| `aside` | Secondary panel rendered next to the list (often used for sidebar filters, see §3.5). |
| `component` | Root wrapper element/tag (default a `<Card>`). |
| `disableSyncWithLocation` | Opt out of URL query-string syncing — needed when rendering multiple `<List>`s on one page. |
| `storeKey` | Key used to persist filter/sort/perPage/columns to the store (`false` disables persistence). |
| `debounce` | Delay (ms, default 500) before filter/sort changes trigger a new fetch. |
| `queryOptions` | Passed through to the underlying data-fetching hook (React Query style: `onSuccess`, `onError`, `enabled`, etc.). |
| `loading` / `error` / `offline` | Components shown for the respective request states. |

### Minimal example

```jsx
export const PostList = () => (
    <List>
        <DataTable>
            <DataTable.Col source="id" />
            <DataTable.Col source="title" />
            <DataTable.Col source="published_at" field={DateField} />
        </DataTable>
    </List>
);
```

### `useListContext()`

Any descendant of `<List>` can pull `{ data, total, isPending, filterValues, setFilters, sort, setSort, page, setPage,
perPage, setPerPage, selectedIds, onSelect, onToggleItem, onUnselectItems, ... }` via `useListContext()`. This is the
mechanism that lets Datagrid, Pagination, FilterForm, and custom "aside" panels all stay in sync without prop drilling.

There is also a headless `<ListBase>` for building fully custom list layouts while still getting the data-fetching /
context-provider behavior.

---

## 2. `<Datagrid>` — declarative "children = columns" table

The defining convention: **each child of `<Datagrid>` is a Field component, and each Field becomes one column.**
There is no separate "columns" config array — the column list *is* the JSX children list, evaluated in order.

```jsx
<Datagrid>
    <TextField source="id" />
    <TextField source="title" />
    <DateField source="published_at" />
    <EditButton />
</Datagrid>
```

- **Column header**: derived from the field's `label` prop if given, otherwise humanized from `source` (e.g.
  `published_at` → "Published at"), with i18n key lookup support.
- **Column cell**: each Field component reads the current row's record from a `RecordContext` (Datagrid provides one
  row-record-context per `<tr>`) and renders `record[source]` appropriately formatted (`TextField` = raw string,
  `DateField` = formatted date, `ReferenceField` = resolved related record, etc.).
- Non-Field children are allowed too (e.g. `<EditButton>`, `<ShowButton>`) — Datagrid just renders whatever the child
  renders inside a cell; it isn't rendering literal "data" for those, just its own record-scoped context.

A newer `<DataTable>` component (react-admin ≥ v5) offers a more explicit column API — `<DataTable.Col source="title"
field={DateField} label="Title" />` — but the mental model is identical: children declare columns, each with a `source`
and optional `label`/`field`.

### Row click behavior (`rowClick`)

Controls what happens when a user clicks anywhere on a row (outside of interactive children like buttons/checkboxes):

- `"edit"` — navigate to the Edit view for that record (default when an edit route exists).
- `"show"` — navigate to the Show view.
- `"expand"` — toggle the row's expand panel (see below).
- `"toggleSelection"` — toggle the row checkbox.
- `false` — no-op, plain non-interactive row.
- a custom function `(id, resource, record) => path`.

### Row selection & bulk actions

- Datagrid renders a checkbox column automatically whenever bulk actions are enabled (this is implicit — not a
  declared child column, but derived from `bulkActionButtons` not being `false`).
- `bulkActionButtons` (element or array) — determines what buttons appear in the toolbar once ≥1 row is checked.
  Defaults to `<BulkDeleteButton>`. Other built-ins: `<BulkExportButton>`, `<BulkUpdateButton>`,
  `<BulkUpdateFormButton>`. Custom bulk actions are just components that call `useListContext()` for `selectedIds` and
  invoke a data-provider mutation.
  - `bulkActionButtons={false}` removes the whole selection column + toolbar.
- `isRowSelectable={record => record.id > 300}` — predicate to disable the checkbox on specific rows.
- Selection state (`selectedIds`) lives in `ListContext` / the store, so it's available outside Datagrid too (e.g. a
  custom bulk-action toolbar rendered elsewhere).

### Expand panels

- `expand={<PostPanel />}` — renders an extra collapsible row beneath each row, showing arbitrary detail content, with
  its own `RecordContext` for that row's record.
- `isRowExpandable={record => ...}` — restrict which rows can expand.
- `expandSingle` — only one row expanded at a time (accordion behavior).

### Sorting via column headers

- Column headers are clickable and toggle `ListContext.sort` (ascending/descending) for that field by default.
- Per-column overrides: `sortable={false}` (disable sorting on that column), `sortBy="otherField"` (sort a different
  underlying attribute than what's displayed, e.g. sort `<ReferenceField>` by the FK id), `sortByOrder="DESC"`
  (initial direction when first clicked).
- `<List sort={{ field, order }}>` sets the *initial* overall sort (equivalent to a "defaultSort").

### Row styling & misc

- `rowSx={(record, index) => ({...})}` — dynamic per-row inline styling (MUI `sx`).
- `size` — `"small"` | `"medium"` row density.
- `optimized` — memoization fast-path for very large lists; incompatible with children that conditionally
  render/hide based on permissions (children must be static across rows).

---

## 3. Filters

### 3.1 The "filter form" pattern

Filters are declared as **an array of input elements**, structurally similar to how Datagrid columns are declared as
children — but passed as a prop (`filters`) rather than as children, since `<List>`'s children slot is reserved for
the record-display component.

```jsx
const postFilters = [
    <SearchInput source="q" alwaysOn />,
    <TextInput label="Title" source="title" defaultValue="Hello, World!" />,
];

export const PostList = () => (
    <List filters={postFilters}>
        <Datagrid>...</Datagrid>
    </List>
);
```

- Each element is a normal Input component (`TextInput`, `SelectInput`, `DateInput`, etc.) with a `source` — the same
  Input components used in Create/Edit forms. `label` overrides the auto-generated one.
- `alwaysOn` — filter is always visible in the filter bar. Filters *without* `alwaysOn` start hidden and are added
  on-demand via the "add filter" dropdown (`<FilterButton>`), which lists their labels as menu items.
- **Constraint**: an input cannot have both `defaultValue` and `alwaysOn` — react-admin explicitly rejects that
  combination. Reason: `alwaysOn` filters are meant to be optional/user-driven; for a *permanent* default that's
  always applied, use `filterDefaultValues` on `<List>` (or `filter` for a truly locked-down value the user can't see
  or edit at all).
- `<SearchInput>` — a specialized `TextInput` styled with a magnifier icon, resettable, generally bound to a generic
  full-text `q` param that the API interprets as "search all fields."

### 3.2 `<FilterButton>` / filter dropdown & saved queries

`<FilterButton>` is the component that renders the "add filter" dropdown whenever `<List filters>` is used (it's
wired up automatically by `<List>`, but can be used standalone when building a fully custom list toolbar/layout
together with `<FilterForm>`).

- Clicking it shows a menu of the *non-alwaysOn* filters (by label) that aren't currently active; picking one adds it
  to the visible filter form.
- **Saved queries**: by default, users can save the current combination of filters+sort as a named "saved query" for
  quick reuse later (persisted in the store). Disable with `disableSaveQuery`.

### 3.3 Quick filters

A lighter-weight alternative to full inputs: small non-editable toggle controls (often rendered as chips/buttons) that
each represent a fixed `{ source, defaultValue }` pair a user can turn on/off with one click (e.g. "Published only").
Implemented as simple custom components reading/writing `filterValues` via `useListContext()`, good for mobile where
typing into inputs is awkward.

### 3.4 Permanent vs default filters

| Prop | Editable by user? | Visible in filter form? | Use case |
|---|---|---|---|
| `filter` (on `<List>`) | No | No | Hard scoping, e.g. multi-tenant `{ accountId }`, or a "deleted" sub-list. |
| `filterDefaultValues` (on `<List>`) | Yes | Yes (once shown) | Sensible starting filter state, e.g. `{ status: 'open' }`, that the user can clear/change. |
| `alwaysOn` input in `filters` | Yes | Yes, always | A filter control that should never be hidden behind the dropdown. |

### 3.5 Sidebar filters (`aside`)

An alternative UI to the top filter form: pass a component to `<List aside={...}>` that renders in the same
`ListContext`, typically containing:
- `<FilterLiveSearch>` — instant-search text box writing into `filterValues` as you type.
- `<FilterList>` / `<FilterListItem>` — e-commerce-style faceted filter groups with fixed value/label pairs (category
  chips, boolean toggles), good for finite categorical filters as opposed to free-text inputs.

### 3.6 Filter persistence

Active filters (and sort/page/perPage) serialize into the URL as a `filter` query param (JSON), enabling shareable/
bookmarkable filtered views and programmatic navigation (`navigate('/posts?filter={"commentable":true}')`).

---

## 4. Pagination

- `<Pagination>` is the default pagination control passed implicitly to `<List>`; swap in a custom one via
  `<List pagination={<CustomPagination />}>`.
- `rowsPerPageOptions` — array driving the "rows per page" dropdown, e.g. `[10, 25, 50, 100]`; pass `[]` to hide that
  selector entirely.
- Pagination reads/writes `page` and `perPage` from `ListContext`, so any custom pagination UI just needs
  `useListContext()` to get `page`, `total`, `perPage`, `setPage`, `setPerPage`.
- For infinite-scroll UX (common on mobile), react-admin offers `<InfiniteList>` + `<InfinitePagination>` instead of
  page-number controls.

---

## 5. Sorting conventions summary

- Initial/default sort: `<List sort={{ field: 'published_at', order: 'DESC' }}>`.
- Interactive sort: clicking a Datagrid column header toggles sort on that column's `source` (or `sortBy` override);
  clicking again reverses direction.
- Per-column opt-out: `sortable={false}`.

---

## 6. Bulk action buttons & row selection — summary

- Row checkboxes appear automatically once bulk actions are enabled; selection state lives in shared list state
  (`selectedIds`), readable via `useListContext()` anywhere within the list page.
- Built-in bulk buttons: `BulkDeleteButton` (default), `BulkExportButton`, `BulkUpdateButton`, `BulkUpdateFormButton`.
- Custom bulk actions are ordinary components using `selectedIds` + a data-provider mutation (e.g. `useUpdateMany`,
  `useDeleteMany`).
- `isRowSelectable` restricts which individual rows are selectable.
- `bulkActionButtons={false}` fully disables selection UI (no checkbox column at all).

---

## 7. Alternative list body layouts

`<List>`'s children slot is pluggable — the "columns as children" convention is specific to `<Datagrid>`/`<DataTable>`,
but other layouts follow their own per-record declarative patterns:

- **`<SimpleList>`** — mobile-friendly single-column list (MUI `List`/`ListItem`), not tabular. Declares per-row
  content via prop functions rather than children-as-columns: `primaryText`, `secondaryText`, `tertiaryText`
  (each a `record => string | ReactNode` or a translatable string), plus `leftAvatar`/`rightAvatar`/`leftIcon`/
  `rightIcon` (each `record => ReactNode`). `rowClick` behaves like Datagrid's. Falls back to the resource's
  `recordRepresentation` if `primaryText` is omitted. A common pattern: render `<SimpleList>` on small screens and
  `<Datagrid>`/`<DataTable>` on larger ones via `useMediaQuery`.
- **`<DatagridConfigurable>`** — drop-in replacement for `<Datagrid>` (same props/children convention: still
  "children = candidate columns") that additionally lets *end users* toggle column visibility at runtime through a
  `<SelectColumnsButton>`, persisting the chosen set to the store/localStorage. The developer still declares the full
  set of possible Field children; the user's runtime choice is just a visibility filter over that declared set —
  useful precedent for a "declare all possible columns, let user pick a subset" feature.
- Other List children exist for non-tabular data (`<SingleFieldList>` for compact reference lists, `<Tree>`,
  `<Calendar>` in Enterprise Edition, etc.), but the two above are the ones most relevant to a table-centric clone.

---

## 8. Empty / loading / error state conventions

- **Empty**: if the query returns zero records *and* there's no active filter *and* the resource has a create route,
  react-admin shows a built-in "no records yet — create your first one" page (with a Create button). Override via
  `<List empty={<CustomEmpty />}>`; the custom component can call `useListContext()` for full context. Pass
  `empty={false}` to bypass this special page and just render the normal (empty) Datagrid/SimpleList instead — useful
  when there *is* an active filter and you'd rather show "no results" inline in the table.
  - At the row-list-component level (`<DataTable>`/`<SimpleList>` used standalone, outside `<List>`'s own empty
    handling), an `empty` prop is similarly supported; `<SimpleList>` falls back to a translated "no results" string
    (`ra.navigation.no_results`) if nothing else handles it.
- **Loading**: `<List loading={<CustomLoading />}>` (also `emptyWhileLoading` to simply render nothing/null until data
  arrives, avoiding a flash of the empty page before the first fetch resolves).
- **Error**: `<List error={<CustomError />}>` for fetch failures.
- **Offline**: `<List offline={<CustomOffline />}>` for no-connectivity scenarios (newer versions).

---

## 9. `<Show>` — read-only detail view

Structurally the sibling of `<List>` for single-record display: fetches one record (`dataProvider.getOne`), populates
a `ShowContext`/`RecordContext`, renders page chrome, and delegates actual field rendering to a **layout** child.

### Props

| Prop | Purpose |
|---|---|
| `children` / `render` | Layout component (`SimpleShowLayout`, `TabbedShowLayout`, or a render function receiving `{ record, isPending, error }`). |
| `id` | Record id (defaults to the one from the URL). |
| `resource` | Resource name (defaults to context). |
| `actions` | Custom toolbar (defaults to an Edit button if applicable). |
| `aside` | Sidebar rendered in the same `RecordContext`, so it can call `useRecordContext()`. |
| `title` | Page title. |
| `loading` / `error` | State components. |
| `emptyWhileLoading` | Delay rendering children until the record is loaded. |
| `disableAuthentication` | Anonymous access. |

### Layouts — again "fields as children"

```jsx
<Show>
    <SimpleShowLayout>
        <TextField source="title" />
        <DateField source="published_at" />
        <RichTextField source="body" />
    </SimpleShowLayout>
</Show>
```

`<SimpleShowLayout>` renders its Field children stacked vertically, each with an auto-derived label — same
`source`/`label` convention as Datagrid columns, just laid out as label+value rows instead of table columns.

`<TabbedShowLayout>` groups Field children into tabs:

```jsx
<Show>
    <TabbedShowLayout>
        <TabbedShowLayout.Tab label="Main">
            <TextField source="title" />
        </TabbedShowLayout.Tab>
        <TabbedShowLayout.Tab label="Body">
            <RichTextField source="body" />
        </TabbedShowLayout.Tab>
    </TabbedShowLayout>
</Show>
```

This confirms the same declarative primitive (a Field component with `source`/`label`) is reused across List columns,
Show fields, and (in Create/Edit) form inputs — only the *container* (`Datagrid` vs `SimpleShowLayout` vs
`TabbedShowLayout` vs a `<Form>`) changes how that declared list of `source`-bound components is laid out.

---

## 10. Declarative syntax to replicate

The recurring react-admin primitive across List/Show/Filters is: **"a flat/grouped list of `source`(+`label`)-bound
leaf components, interpreted by a container that decides layout."** The container (Datagrid → table columns,
SimpleShowLayout → stacked rows, TabbedShowLayout → tabs, filters array → filter form/dropdown) never needs to know
*what* each leaf renders, only that it can bind to `record[source]`.

For a vanilla-JS "simple-admin" clone, two syntaxes could express the same primitive, and both should probably resolve
to the same internal column/field descriptor list so a single renderer handles both:

- **HTML custom elements** (declarative, markup-first, good for static/CMS-like usage):
  ```html
  <sa-datagrid resource="posts" row-click="edit">
    <sa-text-field source="id"></sa-text-field>
    <sa-text-field source="title" label="Title"></sa-text-field>
    <sa-date-field source="published_at"></sa-date-field>
  </sa-datagrid>

  <sa-list resource="posts">
    <sa-filters>
      <sa-search-input source="q" always-on></sa-search-input>
      <sa-text-input source="title"></sa-text-input>
    </sa-filters>
    <sa-datagrid> ... </sa-datagrid>
  </sa-list>
  ```
  Each `<sa-*-field>`/`<sa-*-input>` child is parsed for its `source`/`label`/attrs, mirroring the Field-as-child
  convention 1:1; the parent custom element (`<sa-datagrid>`, `<sa-simple-show-layout>`, `<sa-filters>`) collects its
  children into a descriptor array at connect-time.

- **JS config array** (imperative/programmatic, good for dynamic/computed columns):
  ```js
  saDatagrid('#posts', {
    resource: 'posts',
    rowClick: 'edit',
    columns: [
      { type: 'text', source: 'id' },
      { type: 'text', source: 'title', label: 'Title' },
      { type: 'date', source: 'published_at' },
    ],
  });
  ```

Both forms would need to support the same set of container-level concerns documented above (row click, selection/bulk
actions, expand panels, sort per column, filters array with `alwaysOn`/permanent vs default distinction, pagination,
empty/loading/error slots). The actual choice between (or coexistence of) these two syntaxes is a separate
architecture decision, not made here.
