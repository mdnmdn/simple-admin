# react-admin: Overview and Architecture

> Research notes on [react-admin](https://marmelab.com/react-admin/documentation.html) (by marmelab), compiled from the official documentation (`documentation.html`, `Admin.html`, `Resource.html`, `DataProviders.html`, `Theming.html`, `Store.html`, `Translation.html`, `Authentication.html`, `CustomRoutes.html`, `Architecture.html`, `Actions.html`, `List.html`, `Edit.html`, `useNotify.html`) and the [GitHub README](https://github.com/marmelab/react-admin). This document exists to inform the design of **simple-admin**, a vanilla-JS/web-components clone.

## 1. What react-admin is

React-admin describes itself as **"a frontend Framework for building single-page applications running in the browser on top of REST/GraphQL APIs, using TypeScript, React and Material Design"** (GitHub README).

In practice it is a large library of React components and hooks that let a developer stand up a full **admin / back-office / B2B CRUD application** — the kind of internal tool used to manage users, orders, products, etc. — by writing a small amount of *declarative* configuration rather than a full custom frontend.

Key positioning points from the docs and README:

- **Backend agnostic.** React-admin never talks to your API directly. It talks to a `dataProvider` — an adapter object with a fixed method interface. There are 45+ community-maintained data providers for REST, GraphQL, Firebase, Supabase, etc., and writing a custom one is a few functions.
- **"Batteries included but removable."** It ships a complete stack out of the box (routing, forms, validation, datagrid, filters, relationships, rich text, i18n, notifications, menus, theming, caching) but every single piece can be swapped for a custom implementation. Nothing is hard-wired.
- **Built on well-known libraries, not reinvented ones.** Under the hood react-admin composes Material UI (design system), react-hook-form (forms), react-router (routing), and TanStack Query / react-query (data fetching & caching), plus TypeScript. It positions itself as *glue and convention* on top of these, not a from-scratch framework.
- **Single-page application model.** The `Architecture` doc frames it explicitly around the SPA paradigm: the browser loads HTML/CSS/JS once, then all data access happens through AJAX/fetch calls mediated by providers. There is no server-rendered admin markup.
- **Composition over configuration objects.** The docs note react-admin exposes "more than 150 components" that are combined via JSX composition (children), and a hooks-first core (`ra-core`) so advanced users can bypass the Material UI layer and build fully custom UI on the same data/state primitives.

### The "convention over configuration" philosophy

React-admin's central productivity trick is **convention over configuration** applied to CRUD interfaces:

- Give a resource a **name** (e.g. `"posts"`) and react-admin *infers*: the REST-ish routes (`/posts`, `/posts/create`, `/posts/:id`, `/posts/:id/show`), the API calls to make (`getList`, `getOne`, `create`, `update`, `delete`), the translation keys to look up (`resources.posts.name`, `resources.posts.fields.*`), and the menu entry to render.
- Every screen (List/Edit/Create/Show) follows the same shape: fetch record(s) → put them in a React Context → render declarative `Field`/`Input` components that each know how to read/write one property (`source="title"`) off that context.
- Because the shape is always the same, an entire CRUD screen can be described as a flat tree of JSX with almost no imperative glue code (no manual `useState`/`useEffect`/fetch wiring in application code).

This is the aspect **simple-admin should imitate most closely**: a small number of composable primitives (`Admin`, `Resource`, `List`, `Edit`, `Create`, `Show`, `Field`, `Input`) whose *default* behavior — routing, fetching, forms, notifications — requires zero configuration beyond naming the resource and pointing at a data provider.

## 2. The `<Admin>` / `<Resource>` component model

### `<Admin>` — the application root

`<Admin>` is the single root component of a react-admin app. It:

- Sets up all the global context providers (data, auth, i18n, theme, store, router).
- Renders the main layout (AppBar, side Menu, content area) and top-level routing.
- Requires a `dataProvider` and at least one `<Resource>` child.

Main props (from `Admin.html`):

| Concern | Props |
|---|---|
| Data & auth | `dataProvider` (required), `authProvider`, `i18nProvider` |
| UI/Layout | `layout`, `theme`, `darkTheme`, `dashboard`, `loginPage` |
| Behavior | `requireAuth`, `store`, `disableTelemetry`, `basename` |

Minimal example (adapted from the docs):

```jsx
import { Admin, Resource } from 'react-admin';
import simpleRestProvider from 'ra-data-simple-rest';
import { PostList } from './posts';

const App = () => (
    <Admin dataProvider={simpleRestProvider('http://api.example.com')}>
        <Resource name="posts" list={PostList} />
    </Admin>
);
```

That is a complete, working admin app: one resource, one list screen, full routing and layout for free.

### `<Resource>` — one CRUD entity

Each `<Resource>` declares a single manageable entity type and has three jobs (from `Resource.html`):

1. **Define CRUD routes** for that entity.
2. **Create a context** so descendant components know "which resource am I in."
3. **Register metadata** (name, icon, label) used by the Menu and elsewhere.

Props:

| Prop | Meaning |
|---|---|
| `name` (required) | Resource identifier; drives both the API path and the URL path |
| `list` | Component for the list/browse screen |
| `create` | Component for the create screen |
| `edit` | Component for the edit screen |
| `show` | Component for the read-only detail screen |
| `icon` | Icon shown in the side menu |
| `recordRepresentation` | How to render "this record" as a string/element elsewhere (breadcrumbs, autocomplete, references) |

```jsx
import { Admin, Resource } from 'react-admin';
import jsonServerProvider from 'ra-data-json-server';
import { PostList, PostCreate, PostEdit, PostShow } from './posts';
import PostIcon from '@mui/icons-material/Book';

const App = () => (
    <Admin dataProvider={jsonServerProvider('https://api.example.com')}>
        <Resource
            name="posts"
            list={PostList}
            create={PostCreate}
            edit={PostEdit}
            show={PostShow}
            icon={PostIcon}
            recordRepresentation={(record) => record.title}
        />
    </Admin>
);
```

Any of `list`/`create`/`edit`/`show` can be omitted — react-admin simply doesn't generate that route/menu affordance. A resource can also be declared with **no** page components purely to register it for reference lookups (e.g. an `authors` resource only ever referenced from `posts`).

## 3. The component tree / composition model

React-admin apps have a very regular, nested composition shape:

```
<Admin>                                  – providers + router + layout shell
  <Resource name="posts">
    list={<PostList>}                    – fetches getList(), builds ListContext
      <DataTable> / <Datagrid>           – iterates records, one row per record
        <TextField source="title" />     – reads record.title from RecordContext
        <ReferenceField reference="authors"> – fetches related record, nests a RecordContext
          <TextField source="name" />
    edit={<PostEdit>}                    – fetches getOne(), builds RecordContext + EditContext
      <SimpleForm>                       – react-hook-form wrapper, handles submit -> update()
        <TextInput source="title" />     – controlled input bound to form + record
        <ReferenceInput source="author_id" reference="authors">
          <AutocompleteInput />
    create={<PostCreate>}                – like Edit, but calls create(), no initial getOne()
    show={<PostShow>}                    – fetches getOne(), read-only Field composition
```

Patterns worth noting:

- **Container components fetch, presentational Field/Input components render one property.** `<List>`, `<Edit>`, `<Create>`, `<Show>` are the only components that talk to the data layer; everything below them just reads from context.
- **Everything communicates through React Context, not props drilling.** `ListContext`, `RecordContext`, `EditContext`/`SaveContext`, `ResourceContext`, etc. This is what lets a `<TextField source="title">` work identically whether it's inside a List row, an Edit form, or a Show page — it just asks "give me the current record" via `useRecordContext()`.
- **`source` is the universal data-binding prop.** Field and Input components take a `source` prop naming the record property they render/edit (dot-paths like `author.name` are supported for nested data).
- **Nesting = relationships.** `<ReferenceField>`/`<ReferenceInput>` fetch a *related* record/list and open a new nested `RecordContext`/choices context for their children, so the same Field/Input vocabulary works recursively for foreign keys.
- **`ra-core` vs `ra-ui-materialui`.** The data/state/routing logic lives in a headless core package; the Material UI components are a (replaceable) rendering layer on top. This separation is what makes "replace any component" realistic in practice.

## 4. Routing conventions

React-admin uses **react-router** under the hood but hides it behind resource-name conventions. For a resource named `posts`, `<Resource>` automatically wires up:

| Route | Screen | Data provider call |
|---|---|---|
| `/posts` | `list` | `getList()` |
| `/posts/create` | `create` | `create()` |
| `/posts/:id` | `edit` | `getOne()`, then `update()` or `delete()` |
| `/posts/:id/show` | `show` | `getOne()` |

The resource's `name` prop is simultaneously: the URL segment, the React context key, and the first argument passed to every `dataProvider` method call. One string drives routing, data fetching, and (via translation conventions) labeling.

For anything that doesn't fit the resource mold, `<CustomRoutes>` lets you drop plain `<Route>` elements (react-router) as siblings of `<Resource>`:

```jsx
import { Admin, CustomRoutes } from 'react-admin';
import { Route } from 'react-router-dom';
import { Settings } from './Settings';

const App = () => (
    <Admin dataProvider={dataProvider}>
        <CustomRoutes>
            <Route path="/settings" element={<Settings />} />
        </CustomRoutes>
    </Admin>
);
```

Custom routes are *not* auto-added to the Menu, and a `noLayout` flag lets a route render outside the standard AppBar/Menu chrome (login-like pages, public forms).

## 5. "Record" and "Identifier" data conventions

React-admin standardizes the shape of data flowing through the app so that generic Field/Input components can work for any resource:

- A **Record** is a plain JS object representing one entity, e.g. `{ id: 123, title: 'Hello', author_id: 5 }`.
- Every record **must have an `id` field** — react-admin calls this the record's **Identifier**. All data provider methods key off this field (you can remap a different primary-key column to `id` in a custom/wrapped provider, but internally react-admin always expects `id`).
- `dataProvider` methods always return data wrapped in an envelope, e.g. `getOne` returns `{ data: record }`, `getList` returns `{ data: records[], total: number }`. This uniform envelope is what lets the same List/Edit/Show container components work against *any* provider.

Example of the minimal contract for one method (`DataProviders.html`):

```js
const dataProvider = {
    getOne: async (resource, params) => {
        const url = `${API_URL}/${resource}/${params.id}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(res.statusText);
        return { data: await res.json() };
    },
    // getList, getMany, getManyReference, create, update, updateMany, delete, deleteMany...
};
```

The full `dataProvider` interface has 9 required methods: `getList`, `getOne`, `getMany`, `getManyReference`, `create`, `update`, `updateMany`, `delete`, `deleteMany`. Because this interface is fixed, react-admin's UI components never need to know whether they're talking to REST, GraphQL, Firebase, or an in-memory mock.

## 6. Theming and layout system

React-admin's UI layer is built on **Material UI (MUI)**:

- Global look-and-feel is controlled by passing a `theme` (and optional `darkTheme`) object to `<Admin>`. React-admin ships several built-in themes (Default, B&W, Nano, Radiant, House) and starts from a neutral default that can be extended:

```jsx
import { Admin, defaultTheme } from 'react-admin';
import indigo from '@mui/material/colors/indigo';

const customTheme = {
    ...defaultTheme,
    palette: { mode: 'dark', primary: indigo },
    typography: { fontFamily: 'Arial, sans-serif' },
};

const App = () => (
    <Admin theme={customTheme}>{/* resources */}</Admin>
);
```

- Per-component styling uses MUI's `sx` prop (like an inline `style` but supporting pseudo-classes, media queries, nesting).
- The overall page chrome — **AppBar** (top bar), **Menu** (left navigation, auto-populated from `<Resource icon>` entries), **Sidebar** (collapsible container for the menu), error page — is itself a swappable `<Layout>` component. `<Admin layout={CustomLayout}>` replaces the whole shell; more surgically, `<Layout appBar={...} menu={...} sidebar={...} error={...}>` swaps individual pieces while keeping the rest of react-admin's default layout behavior (responsive collapse, loading indicator, notifications slot).
- Non-sidebar layouts exist too (e.g. `<ContainerLayout>` uses a top nav bar instead of a side menu), reinforcing that the sidebar+AppBar arrangement is a default convention, not a hard requirement.

## 7. State management approach: TanStack Query underneath

React-admin's data layer is a thin, opinionated wrapper around **TanStack Query (react-query)** (`Architecture.html`, `Actions.html`):

- High-level hooks like `useGetList`, `useGetOne`, `useCreate`, `useUpdate`, `useDelete` are documented as literally wrapping `useQuery`/`useMutation`, with the `dataProvider` call as the `queryFn`/`mutationFn` and a `queryKey` derived from `[resource, method, params]`.
- This buys automatic request de-duplication, caching, background refetching, cache invalidation, and — notably — it "triggers the loader in the AppBar when a query is running," removing manual loading-state plumbing from application code.
- Query hooks return `{ data, isPending, isFetching, error }`; `isPending` (no data yet) is distinguished from `isFetching` (a request in flight, possibly a background refresh), which lets the UI show stale-while-revalidate data instead of blank loading states.

### Optimistic rendering and undoable mutations

A signature react-admin UX feature is configurable **mutation modes**, chosen per-hook or per-page via a `mutationMode` prop:

| Mode | When dataProvider is called | When UI updates | Undo? |
|---|---|---|---|
| `pessimistic` | Immediately | After server response | No |
| `optimistic` | Immediately | Immediately (before response) | No |
| `undoable` (default for `<Edit>`) | Delayed ~5s | Immediately | Yes |

In `undoable` mode (the default react-admin uses for its own `<Edit>` save button), the mutation is applied to the local cache and the UI re-renders instantly; a notification with an "Undo" button appears; the actual `dataProvider` call is deferred for a few seconds unless the user clicks undo, in which case it's cancelled and the screen reverts. This is presented in the docs as react-admin's default "optimistic rendering strategy," and it's one of the more distinctive interaction patterns of the framework.

```jsx
const [approve, { isPending }] = useUpdate(
    'comments',
    { id: record.id, data: { isApproved: true } },
    {
        mutationMode: 'undoable',
        onSuccess: () => notify('Comment approved', { undoable: true }),
        onError: (error) => notify(`Error: ${error.message}`, { type: 'error' }),
    }
);
```

## 8. Internationalization (i18n)

Translations are delegated to an **`i18nProvider`**, a small object interface (`Translation.html`):

- `translate(key, options)` — resolve a key to localized text
- `changeLocale(locale)` — switch active language
- `getLocale()` — read current locale
- `getLocales()` — optional, lists available locales

Components consume it via the `useTranslate()` hook (e.g. `translate('myroot.hello.world')`). The `ra-i18n-polyglot` package provides a ready-made provider backed by Polyglot.js and plain JSON dictionaries.

Translation keys follow the same **naming-convention-driven** approach as everything else: framework chrome uses `ra.*` keys, while resource/field labels are looked up by convention at `resources.<resourceName>.name` and `resources.<resourceName>.fields.<fieldName>` — meaning a translated label is available automatically the moment a translator fills in the dictionary, with zero extra wiring in components.

## 9. Store: user preferences

The **Store** is a small key-value persistence layer (`Store.html`) distinct from the data layer:

- Purpose: remember *UI preferences* across page loads/sessions (not domain data) — sidebar open/closed, selected theme, selected locale, which columns/rows are expanded, saved list filters, etc.
- Default implementation: browser `localStorage`, falling back to in-memory storage when unavailable; automatically cleared on logout for privacy.
- Accessed via the `useStore(key, defaultValue)` hook — same ergonomics as `useState`, but persisted.
- Internal react-admin components (`<ToggleThemeButton>`, `<LocalesMenuButton>`, the Sidebar, Datagrid row-selection) already use it, and application code can reuse the exact same hook for custom preferences.
- Testing guidance: use `memoryStore()` to isolate tests from persisted state, and prefer storing scalar values (not whole objects) since stored shapes can drift from code across app versions.

## 10. Notifications

React-admin funnels all user feedback (success/error/info toasts) through a single **notification queue**, rendered by a `<Notification>` component mounted once in the layout:

- `useNotify()` returns a callback `notify(message, options)` — `message` can be plain text or a translation key; `options` include `type` (`info`/`success`/`warning`/`error`), `autoHideDuration`, `messageArgs` (translation interpolation), `multiLine`, and `undoable` (adds an Undo action, tying into the undoable-mutation flow described above).
- The `<Notification>` component manages a **queue**: it pulls one notification at a time, displays it, and only shows the next queued one once the current one is dismissed/expired — so multiple rapid `notify()` calls don't stack chaotically.
- Default position is bottom-center (`anchorOrigin: { vertical: 'bottom', horizontal: 'center' }`), customizable per call.
- Mutation hooks (`useUpdate`, `useCreate`, etc.) accept `onSuccess`/`onError` callbacks where calling `notify(...)` is the idiomatic way to surface a result — again, all "batteries included," but nothing forces you to use it.

## 11. Authentication and authorization

Similar shape to `dataProvider`: an **`authProvider`** object implementing a fixed method contract (`Authentication.html`):

- `login()` — send credentials, store token
- `logout()` — clear local credentials, optionally notify server
- `checkAuth()` — verify the current session is still valid (called on navigation)
- `checkError()` — inspect an API error to decide if it means "not authenticated" (triggers logout/redirect)
- `getIdentity()` — fetch current user profile
- `canAccess()` — optional, fine-grained permission checks

Setting `<Admin requireAuth>` makes the whole app wait on `authProvider.checkAuth()` before rendering any layout, hiding all UI from unauthenticated users by default (except `<CustomRoutes noLayout>` pages such as registration/password-reset). As with everything else, this is opt-in behavior driven by supplying/omitting a provider and a boolean prop — not by writing guard logic in every page.

## 12. The "declarative, not imperative" development model

Pulling the above together, building a react-admin app in the common case means:

1. Write one or more **provider objects** (`dataProvider`, optionally `authProvider`, `i18nProvider`) that adapt your real backend to react-admin's fixed method contracts.
2. Declare `<Resource name="..." list=... edit=... create=... show=... icon=... />` per entity.
3. Inside each screen, compose **Field**/**Input** components with a `source` prop — no manual fetch calls, no manual form state, no manual route definitions.
4. Reach for hooks (`useNotify`, `useStore`, `useTranslate`, `useRecordContext`, `useGetList`, etc.) only when stepping outside the default composition, and swap individual components (`layout`, `appBar`, `menu`, custom Field/Input) only where the defaults don't fit.

This is the "vanilla config" mode the docs are optimized for: most of an app is JSX-as-configuration (props and children), state/data/routing/notifications/i18n all fall out of conventions tied to a resource's `name`, and imperative code is the escape hatch, not the default path.

## Key conventions worth cloning into simple-admin

- **One root component that takes a data adapter + declares resources as children** (`<Admin dataProvider>` + `<Resource name>`), with routing, menu entries, and API calls all derived from a resource's `name` — no separate route config file.
- **A fixed, small data-provider interface** (list/one/many/create/update/delete style methods returning a uniform envelope) so the UI layer is 100% backend-agnostic and swappable.
- **A single `id`/Identifier convention** for every record, so generic list/edit/show/field components never need per-resource logic.
- **Convention-based routing**: `/resource`, `/resource/create`, `/resource/:id`, `/resource/:id/show` generated automatically from the resource name.
- **Declarative Field/Input primitives bound by a `source` (property-path) attribute**, composed inside List/Edit/Create/Show containers, with relationships handled by nesting (reference field/input opens a new nested record context).
- **Context-based data flow instead of prop drilling** — "current record," "current resource," "current list state" available to any descendant via a lookup, not passed down manually.
- **A pluggable escape hatch at every layer** — layout, individual chrome pieces (AppBar/Menu/Sidebar), theme, auth, i18n, and even the whole rendering layer (headless core vs. UI kit) can be replaced without forking the framework.
- **Optimistic/undoable mutations and a shared notification queue as default UX**, not bolted-on afterthoughts — mutations, feedback, and undo are part of the core interaction model, driven by a simple mode flag.
- **A dedicated, separate "preferences store"** (distinct from domain data) for persisting UI state like sidebar/theme/locale/filters across sessions, exposed through one simple hook.
- **Convention-based i18n keys** (`resources.<name>.fields.<field>`) so translation coverage tracks the same `name`/`source` strings used for data binding, requiring no per-component translation wiring.
