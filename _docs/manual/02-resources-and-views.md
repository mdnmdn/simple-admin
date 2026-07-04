# 2. Resources and Views

This chapter covers the building blocks you use to describe an admin: the `<sa-admin>` shell, `<sa-resource>` declarations, the hash routing table, and the four standard views — List, Show, Create, and Edit — including filters, pagination, bulk actions, and forms.

Every example below is shown in both authoring syntaxes side by side. Both compile down to the exact same DOM at runtime (see [§9](#9-a-note-on-js-config-materialization) at the end of this chapter), so pick whichever fits your project, or mix them per-resource.

## 1. `<sa-admin>` — the app shell

`<sa-admin>` is the root element. It owns the hash router, the auth guard, the app bar, and the resource menu, and it publishes the `dataProvider`/`authProvider` pair that every other component reads from.

| Property/attribute | Type | Default | Notes |
|---|---|---|---|
| `dataProvider` | property only | — | Required. Functions can't be expressed as HTML attributes, so this is always set via JS, even in the "HTML-only" syntax. |
| `authProvider` | property only | — | Optional. If set, `require-auth`/`requireAuth` guards views and `<sa-login>` is wired up automatically. |
| `title` / `title` attribute | string | `'Admin'` | Shown in the app bar, and used as the dashboard's welcome text (`#/`). |
| `require-auth` (attribute) / `requireAuth` (property) | boolean | `false` | When true, every list/create/edit/show route runs `guardView()` before mounting (see [§8](#8-auth)). A resource can also opt itself in individually via `<sa-resource require-auth>` (§2) without turning this on admin-wide — the two combine with OR. |

Because `dataProvider`/`authProvider` are functions/objects, not strings, you always set them via JS — via properties on the element (HTML-authoring path) or via the config object passed to `SimpleAdmin.admin({...})` (JS-config path). Both routes end up calling the exact same property setters on the same `SaAdmin` instance.

### HTML authoring

```html
<sa-admin id="admin" title="Blog Admin" require-auth>
  <!-- <sa-resource> children go here -->
</sa-admin>

<script type="module">
  import '../../src/index.js';
  import { createMockDataProvider, defaultSeedData } from '../mock-data-provider.js';
  import { createLocalAuthProvider } from '../../src/auth/localAuthProvider.js';

  const admin = document.getElementById('admin');
  admin.dataProvider = createMockDataProvider(defaultSeedData);
  admin.authProvider = createLocalAuthProvider();
</script>
```

### JS config

`SimpleAdmin.admin({...}).mount(target)` creates a real `<sa-admin>` element, assigns your config object to its `.descriptor` property in one shot (which internally sets `dataProvider`/`authProvider`/`title`/`requireAuth`), and appends it into `target` (a CSS selector string or an `Element`).

```html
<div id="app"></div>

<script type="module">
  import SimpleAdmin from '../../src/index.js';
  import { createMockDataProvider, defaultSeedData } from '../mock-data-provider.js';
  import { createLocalAuthProvider } from '../../src/auth/localAuthProvider.js';

  SimpleAdmin.admin({
    title: 'Blog Admin (JS config)',
    dataProvider: createMockDataProvider(defaultSeedData),
    authProvider: createLocalAuthProvider(),
    requireAuth: true,
  }).mount('#app');
</script>
```

`target`'s existing children are left alone — `mount()` only ever appends its own `<sa-admin>` subtree, it never clears the container.

## 2. `<sa-resource>` — declaring a resource

A resource is a name plus up to four views: `list`, `create`, `edit`, `show`. `<sa-resource>` registers itself (or the JS-config descriptor registers directly) so the router and menu can find it by name.

| Attribute/config key | Notes |
|---|---|
| `name` | Required. Used in routes (`#/posts`), the menu, and as the resource key passed to every `dataProvider` call. |
| `icon` | Optional; free-form value read by the menu renderer. |
| `record-representation` / `recordRepresentation` | How a single record of this resource is rendered as a short label (e.g. inside a `sa-reference-field`/`sa-reference-input`). Typically a source name (e.g. `"name"`, `"title"`). |
| `group` | Optional. Buckets this resource under a labeled section in the side menu (`renderMenu()`, `components/layout.js`). Resources with no `group` render as a flat list above any grouped sections; grouped sections render in first-seen registration order. Purely a menu-presentation concern — it has no effect on routing. |
| `require-auth` (attribute) / `requireAuth` (property) | Boolean, default `false`. Optional per-resource override: gates this resource's list/create/edit/show routes through `guardView()` even when `<sa-admin>` itself has `require-auth="false"` — the rest of the app stays public while this resource still redirects to `#/login` when unauthenticated. See [§8](#8-auth). |

If none of `list`/`create`/`edit`/`show` is present, a `resource-no-views` diagnostic warning is logged — a resource with no views can never be routed to.

### HTML authoring

The list/create/edit/show views are just real `<sa-list>`/`<sa-create>`/`<sa-edit>`/`<sa-show>` elements found as direct children:

```html
<sa-resource name="authors" record-representation="name">
  <sa-list>...</sa-list>
  <sa-create>...</sa-create>
  <sa-edit>...</sa-edit>
  <sa-show>...</sa-show>
</sa-resource>
```

### JS config

`SimpleAdmin.resource(name, config)` registers a plain descriptor object directly — no `<sa-resource>` element needs to exist in the DOM at all. `<sa-admin>` creates one on demand (with the JS-config descriptor pre-attached) the moment a route needs it.

```js
SimpleAdmin.resource('authors', {
  recordRepresentation: 'name',
  list: { /* ... */ },
  create: { /* ... */ },
  edit: { /* ... */ },
  show: { /* ... */ },
});
```

## 3. Routing table

`<sa-admin>` runs a plain hash router (`src/core/router.js`). This is the complete route table — nothing else is recognized:

| Hash | Resolves to | Notes |
|---|---|---|
| `#/` | dashboard | Renders a "Welcome to `{title}`" placeholder panel. |
| `#/login` | login | Renders `<sa-login>` standalone; the app-bar/menu shell is hidden. |
| `#/access-denied` | access-denied | Placeholder "Access denied." panel — reached only via a failed `canAccess()` check. |
| `#/:resource` | list | e.g. `#/posts` |
| `#/:resource/create` | create | e.g. `#/posts/create` |
| `#/:resource/:id` | edit | e.g. `#/posts/42` |
| `#/:resource/:id/show` | show | e.g. `#/posts/42/show` |

Navigate programmatically with the exported `navigate(hash)` helper (accepts either `'#/posts'` or `'posts'` — the leading `#` is added if missing); it's what `rowClick`, form `redirect`, and the login redirect all use internally.

## 4. `<sa-list>` + `<sa-datagrid>`

`<sa-list>` owns the `ListController` (pagination, sorting, filters, selection) and is the ambient context every `<sa-datagrid>`, `<sa-filters>`, and `<sa-pagination>` descendant looks up. Columns are declared as light-DOM children of `<sa-datagrid>`.

### `<sa-list>` attributes

| Attribute | Config key | Type | Default | Notes |
|---|---|---|---|---|
| `sort-field` / `sort-order` | `sort: { field, order }` | string | `{ field: 'id', order: 'DESC' }` | Initial sort. |
| `per-page` | `perPage` | number | `10` | Initial page size. |
| `row-click` | `rowClick` | `'edit'` \| `'show'` \| `'expand'` \| `false` \| function | `false` | Clicking a row (outside of inputs/links/buttons) navigates to the edit or show route for that record. `'expand'` is accepted but not implemented in this version. A function receives `(id, resource, record)` and returns a hash to navigate to (or a falsy value to do nothing). |
| `filter` | `filter` | JSON object | — | A **static** filter always merged into every `getList` call (in addition to whatever `<sa-filters>` produces). |
| `filter-default-values` | `filterDefaultValues` | JSON object | `{}` | Seeds the list's filter values on first load (before the user touches any filter input). |

`resource` is normally inferred from the ancestor `<sa-resource>`; you only need to set it explicitly if `<sa-list>` isn't nested inside one.

### `<sa-datagrid>` — columns as children

Any light-DOM child of `<sa-datagrid>` that exposes `.toDescriptor()` — i.e. any `sa-*-field` element — becomes a column, in declaration order. Fields use the same vocabulary described for `<sa-simple-show-layout>` in [§6](#6-sa-show--sa-simple-show-layout). A column is sortable (clicking its header calls `listController.setSort(...)`, toggling ASC/DESC) whenever its descriptor has a `source` and `sortable` isn't explicitly `false` — add the `sortable` boolean attribute (or `sortable: true` in JS config) to opt in explicitly for fields whose sortability isn't already implied.

`<sa-datagrid>` attributes:

| Attribute | Config key | Notes |
|---|---|---|
| `bulk-actions="none"` | `bulkActions: []` | Disables the selection checkbox column and bulk-action toolbar entirely. Any other value (or omission) leaves selection enabled — the actual buttons shown come from light-DOM bulk-button children (see below), not from this attribute's value. |

### Row selection + bulk actions

When bulk actions are enabled (the default), every row gets a checkbox, plus a "select all" checkbox in the header. Declare bulk-action buttons as children of `<sa-datagrid>` — currently the only built-in one is `<sa-bulk-delete-button>`, which calls `dataProvider.deleteMany(resource, { ids })`, clears the selection, and refetches the list. It renders hidden/disabled whenever nothing is selected.

### Pagination

`<sa-list>` auto-injects a `<sa-pagination>` if you don't declare one yourself. It shows a "1–10 of 42" info string plus Prev/Next buttons (disabled at the boundaries), and an optional page-size `<select>` if you set `rows-per-page`:

```html
<sa-pagination rows-per-page="5,10,25,50"></sa-pagination>
```

### Side-by-side example

```html
<sa-list sort-field="published_at" sort-order="DESC" per-page="10" row-click="edit">
  <sa-filters>
    <sa-search-input source="q" always-on></sa-search-input>
    <sa-boolean-input source="is_published" label="Published"></sa-boolean-input>
  </sa-filters>
  <sa-datagrid>
    <sa-text-field source="id"></sa-text-field>
    <sa-text-field source="title" label="Title" sortable></sa-text-field>
    <sa-boolean-field source="is_published" label="Published"></sa-boolean-field>
    <sa-date-field source="published_at" sortable></sa-date-field>
  </sa-datagrid>
  <sa-bulk-delete-button></sa-bulk-delete-button>
</sa-list>
```

```js
list: {
  sort: { field: 'published_at', order: 'DESC' },
  perPage: 10,
  rowClick: 'edit',
  filters: [
    i.search({ source: 'q', alwaysOn: true }),
    i.boolean({ source: 'is_published', label: 'Published' }),
  ],
  columns: [
    f.text({ source: 'id' }),
    f.text({ source: 'title', label: 'Title', sortable: true }),
    f.boolean({ source: 'is_published', label: 'Published' }),
    f.date({ source: 'published_at', sortable: true }),
  ],
  bulkActions: ['delete'],
}
```

Note `<sa-bulk-delete-button>` (HTML) vs. `bulkActions: ['delete']` (JS config) — both produce the exact same `<sa-bulk-delete-button>` child inside `<sa-datagrid>`.

## 5. Filters

`<sa-filters>` is a light-DOM container of `sa-*-input` elements. It does **not** have its own values store — every input writes straight through to the ambient `ListController.filterValues` signal, which is what keeps filtering and the datagrid's data in sync.

- Any input marked `always-on` (attribute) / `alwaysOn: true` (JS config) is shown permanently in a row above the rest.
- Inputs without `always-on` are hidden behind an "Add filter" toggle button (only rendered if there's at least one such input).
- `always-on` and `default-value` are mutually exclusive on the same input — combining them logs a `filter-alwayson-defaultvalue` diagnostic warning and the `default-value` is dropped. Use `<sa-list filter-default-values="...">` (or `filterDefaultValues` in JS config) instead to seed initial values for always-on filters.
- Every filter change is **debounced 500ms** before triggering a refetch (matching react-admin), and resets the list back to page 1. Sort/page/per-page changes, by contrast, refetch immediately.

```html
<sa-filters>
  <sa-search-input source="q" always-on></sa-search-input>
  <sa-boolean-input source="is_published" label="Published"></sa-boolean-input>
</sa-filters>
```

```js
filters: [
  i.search({ source: 'q', alwaysOn: true }),
  i.boolean({ source: 'is_published', label: 'Published' }),
]
```

## 6. `<sa-show>` + `<sa-simple-show-layout>`

`<sa-show>` fetches a single record (`dataProvider.getOne(resource, { id })`, `id` taken from the `id` attribute or, failing that, the current route) and publishes it as the record context for its descendants. Its light-DOM children are detached and re-appended only once the record has actually arrived, so `sa-*-field` children never see a null record.

`<sa-simple-show-layout>` is a thin, purely-visual wrapper — it doesn't publish its own record context, so its `sa-*-field` children resolve up to `<sa-show>`. Fields here use the **same vocabulary** as Datagrid columns (`sa-text-field`, `sa-email-field`, `sa-boolean-field`, `sa-date-field`, `sa-reference-field`, ...).

```html
<sa-show>
  <sa-simple-show-layout>
    <sa-text-field source="title"></sa-text-field>
    <sa-text-field source="body"></sa-text-field>
    <sa-reference-field source="author_id" reference="authors" link="edit">
      <sa-text-field source="name"></sa-text-field>
    </sa-reference-field>
    <sa-boolean-field source="is_published" label="Published"></sa-boolean-field>
    <sa-date-field source="published_at"></sa-date-field>
  </sa-simple-show-layout>
</sa-show>
```

```js
show: {
  fields: [
    f.text({ source: 'title' }),
    f.text({ source: 'body' }),
    f.reference({ source: 'author_id', reference: 'authors', link: 'edit', child: f.text({ source: 'name' }) }),
    f.boolean({ source: 'is_published', label: 'Published' }),
    f.date({ source: 'published_at' }),
  ],
}
```

(Field-by-field reference for every built-in `sa-*-field`/`f.*()` type is in a later chapter — this section only covers the show *layout*.)

## 7. `<sa-create>` / `<sa-edit>` + forms

`<sa-create>` and `<sa-edit>` are the page-level controllers: they own the resource/id, fetch (Edit only) or seed (Create: an empty `{}`) the record, and configure their light-DOM `<sa-simple-form>`/`<sa-tabbed-form>` child by assigning `.resource`/`.record` properties on it.

### Shared attributes/config

| Attribute | Config key | Type | Default | Applies to | Notes |
|---|---|---|---|---|---|
| `redirect` | `redirect` | `'list'` \| `'edit'` \| `'show'` \| `false` \| function | `'list'` | Create, Edit | Where to navigate after a successful save. A function receives `(resource, id, record)` and returns a hash. |
| `transform` | `transform` | `(data) => data` (Create) / `(data, { previousData }) => data` (Edit) | — | Create, Edit | Runs on the submitted values just before the `dataProvider.create`/`update` call; may be async. |
| `sanitize-empty-values` | `sanitizeEmptyValues` | boolean | `false` | Edit only | Strips any key whose value is `''` from the submitted data before calling `update`. |
| `warn-when-unsaved-changes` | `warnWhenUnsavedChanges` | boolean | `false` | Edit only | Wires a `beforeunload` guard that prompts when the form is dirty (`formStore.dirty`). |

### The `sa-submit` event contract

`<sa-simple-form>`/`<sa-tabbed-form>` never call the dataProvider themselves. Their `.save()` method (invoked by `<sa-save-button>`) runs `formStore.validateAll()` and, only if it passes, dispatches a bubbling, composed `sa-submit` CustomEvent with `detail: { values, resource, record }`. The nearest `<sa-create>`/`<sa-edit>` ancestor listens for that event and does the actual `dataProvider.create`/`update` call, applies `transform`, and redirects. This is why `transform`/`redirect`/`sanitize-empty-values` live on `<sa-create>`/`<sa-edit>`, not on the form.

### Toolbar / save / delete buttons

`<sa-simple-form>` and `<sa-tabbed-form>` both auto-inject a `<sa-form-toolbar>` if you don't declare one. The toolbar in turn auto-injects `<sa-save-button>` always, and `<sa-delete-button>` only when it's inside an `<sa-edit>` (never inside `<sa-create>` — there's nothing to delete yet).

- `<sa-save-button>` finds the nearest `sa-simple-form`/`sa-tabbed-form` ancestor and calls `.save()` on it.
- `<sa-delete-button>` reads `resource`/`id`/`record` straight off the nearest `<sa-edit>` ancestor, calls `dataProvider.delete(resource, { id, previousData: record })`, then navigates to `#/:resource`.

You rarely need to declare either explicitly — just don't add your own `<sa-form-toolbar>` unless you want to customize which buttons appear.

### `<sa-simple-form>` — single column of inputs

```html
<sa-create redirect="list">
  <sa-simple-form>
    <sa-text-input source="title" validate="required|minLength:3"></sa-text-input>
    <sa-text-input source="body" multiline></sa-text-input>
    <sa-boolean-input source="is_published" label="Published"></sa-boolean-input>
    <sa-date-input source="published_at" validate="required"></sa-date-input>
  </sa-simple-form>
</sa-create>
```

```js
create: {
  redirect: 'list',
  inputs: [
    i.text({ source: 'title', validate: 'required|minLength:3' }),
    i.text({ source: 'body', multiline: true }),
    i.boolean({ source: 'is_published', label: 'Published' }),
    i.date({ source: 'published_at', validate: 'required' }),
  ],
}
```

### `<sa-tabbed-form>` — grouped tabs

Light-DOM children are `<sa-form-tab label="...">` wrappers, each holding its own `sa-*-input` children. Only the active tab's panel is visible; a tab's label is flagged (`data-sa-error`) whenever any input inside it currently has a validation error.

```html
<sa-edit redirect="list">
  <sa-tabbed-form>
    <sa-form-tab label="General">
      <sa-text-input source="title" validate="required"></sa-text-input>
    </sa-form-tab>
    <sa-form-tab label="Publishing">
      <sa-boolean-input source="is_published" label="Published"></sa-boolean-input>
      <sa-date-input source="published_at"></sa-date-input>
    </sa-form-tab>
  </sa-tabbed-form>
</sa-edit>
```

```js
edit: {
  redirect: 'list',
  groups: [
    { label: 'General', inputs: [i.text({ source: 'title', validate: 'required' })] },
    {
      label: 'Publishing',
      inputs: [
        i.boolean({ source: 'is_published', label: 'Published' }),
        i.date({ source: 'published_at' }),
      ],
    },
  ],
}
```

(`groups` materializes into `<sa-tabbed-form>`; a plain `inputs` array — no `groups` — materializes into `<sa-simple-form>` instead. Don't specify both on the same view.)

## 8. Auth

- **`<sa-login>`** — a plain username/password form. It reads the active `authProvider` from the registry (no prop needed) and calls `authProvider.login({ username, password })`. On success it navigates to `result.redirectTo` (default `#/`, or stays put if `redirectTo === false`); on failure it shows the thrown error's `message` inline. `<sa-admin>` mounts it standalone (app bar/menu hidden) whenever the current route is `#/login`.
- **`require-auth` / `requireAuth: true`** — when set on `<sa-admin>`, every list/create/edit/show route runs `guardView(authProvider, { action, resource })` before mounting: first `checkAuth()`, then `canAccess()`. A failed `checkAuth()` logs the user out (if `authProvider.logout` exists) and redirects to `#/login` (or wherever the thrown error's `redirectTo` says). A failed `canAccess()` redirects to `#/access-denied` instead — the view simply never mounts. A route is guarded whenever *either* `<sa-admin require-auth>` is set *or* the route's resource itself declares `<sa-resource require-auth>` — so you can leave the admin-wide default off and mark only specific resources as login-gated, keeping the rest of the app public with the same `authProvider` (`components/admin.js`'s `_handleRoute`). This only runs at all when an `authProvider` is present; with no `authProvider`, nothing is ever gated regardless of `require-auth`.
- **`<sa-can-access action="..." resource="...">`** — wraps arbitrary light-DOM content (e.g. a button) and hides it (`display: none`) when `canAccess({ action, resource })` resolves false. This check runs once on connect; it does not react to identity changes later.

```html
<sa-can-access action="delete" resource="posts">
  <sa-delete-button></sa-delete-button>
</sa-can-access>
```

If `authProvider.canAccess` isn't implemented at all, every check is permissive (defaults to allowed) — `require-auth` only enforces *authentication*, not *authorization*, unless `canAccess` is actually provided.

## 9. A note on JS-config materialization

Every snippet above showed the HTML and JS-config forms side by side because they really do produce identical behavior. When a JS-config resource's view runs (`components/admin.js`'s `_mountConfiguredView`/`materializeView`), its `columns`/`filters`/`fields`/`inputs`/`groups`/`bulkActions` arrays of plain descriptor objects (e.g. `{ kind: 'field', type: 'text', source: 'title' }`) are turned into real `sa-*-field`/`sa-*-input`/`<sa-filters>`/`<sa-datagrid>`/`<sa-tabbed-form>`/`<sa-bulk-delete-button>` elements and appended as light-DOM children — the exact same elements the HTML syntax declares by hand — before the view is ever connected to the page. `<sa-datagrid>`, `<sa-filters>`, `<sa-simple-form>`, and `<sa-tabbed-form>` only ever look at their light-DOM children, so there is only one rendering code path underneath both syntaxes. An unrecognized `type` falls back to a text field/input with a console warning rather than throwing.
