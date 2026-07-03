# 1. Getting Started

## What is simple-admin?

simple-admin is a vanilla-JS, no-build, web-components clone of [react-admin](https://marmelab.com/react-admin/). It gives you the same building blocks — resources, list/create/edit/show views, fields, inputs, a `dataProvider`/`authProvider` contract — but as real custom elements (`<sa-admin>`, `<sa-resource>`, `<sa-list>`, ...) with zero framework and zero build step required.

Every admin can be authored in either of two equivalent syntaxes: pure HTML markup, or a JS config object built from the same primitives. Pick whichever fits your project — they render identical UIs and share the same `dataProvider`/`authProvider` contract, so if you know react-admin you already know most of simple-admin.

## Getting the library

You don't need a package manager or a bundler to use simple-admin. Pick one of these two paths.

### Option A — reference the built files directly (zero install)

Run the build once (see below) and you get two static files: `dist/simple-admin.js` and `dist/simple-admin.css`. Drop them on any static host or CDN and reference them from a plain HTML page:

```html
<link rel="stylesheet" href="/path/to/dist/simple-admin.css" />
<script type="module" src="/path/to/dist/simple-admin.js"></script>
```

This is the simplest way to ship an admin panel: two files, no dependencies, no build step for the *consuming* app.

### Option B — use the source tree directly (development, no build step)

The library has **zero runtime dependencies** and is plain ES modules, so you can import straight from `src/index.js` (or, once installed, from the `simple-admin` package specifier) without running a bundler at all:

```js
import SimpleAdmin, { f, i } from '../../src/index.js';
```

If you're consuming simple-admin from another project, install it the normal way for your package manager:

```bash
npm install simple-admin
```

and import it as `simple-admin` / `simple-admin/theme/*` — `package.json`'s `exports` map points `"."` at `src/index.js`, so consumers get the raw source with no build step either. (Any standard package manager — npm, pnpm, yarn — works fine here; nothing about the library requires a specific one.)

For the theme CSS, load `src/theme/base.css` and `src/theme/shadcn.css` (or the combined `dist/simple-admin.css` once built):

```html
<link rel="stylesheet" href="../../src/theme/base.css" />
<link rel="stylesheet" href="../../src/theme/shadcn.css" />
```

## A minimal first example

Below is the same tiny admin — one `authors` resource with a list, backed by an in-memory data provider — written both ways. Both need a `dataProvider` (here, the demo `createMockDataProvider` from `examples/mock-data-provider.js`; a trivial hand-rolled object with `getList`/`getOne`/etc. works too) and an `authProvider` (here, the built-in `createLocalAuthProvider`).

### HTML-authoring syntax

Every resource/view/field/input is a real element in the light DOM. The only thing JS still has to do is hand over the `dataProvider`/`authProvider` — functions can't be expressed as HTML attributes.

```html
<sa-admin id="admin" title="Blog Admin" require-auth>
  <sa-resource name="authors" record-representation="name">
    <sa-list sort-field="name" sort-order="ASC" per-page="10" row-click="edit">
      <sa-datagrid>
        <sa-text-field source="id"></sa-text-field>
        <sa-text-field source="name" sortable></sa-text-field>
        <sa-email-field source="email"></sa-email-field>
      </sa-datagrid>
    </sa-list>
  </sa-resource>
</sa-admin>

<script type="module">
  import '../../src/index.js';
  import { createMockDataProvider, defaultSeedData } from '../mock-data-provider.js';
  import { createLocalAuthProvider } from '../../src/auth/localAuthProvider.js';

  const admin = document.getElementById('admin');
  admin.dataProvider = createMockDataProvider(defaultSeedData);
  admin.authProvider = createLocalAuthProvider(); // demo login: admin / admin
</script>
```

### JS-config syntax

No `<sa-*>` markup at all — `SimpleAdmin.resource()` registers the resource, and `SimpleAdmin.admin({...}).mount(target)` builds and appends the whole `<sa-admin>` subtree for you.

```html
<div id="app"></div>

<script type="module">
  import SimpleAdmin, { f } from '../../src/index.js';
  import { createMockDataProvider, defaultSeedData } from '../mock-data-provider.js';
  import { createLocalAuthProvider } from '../../src/auth/localAuthProvider.js';

  const dataProvider = createMockDataProvider(defaultSeedData);
  const authProvider = createLocalAuthProvider(); // demo login: admin / admin

  SimpleAdmin.resource('authors', {
    recordRepresentation: 'name',
    list: {
      sort: { field: 'name', order: 'ASC' },
      perPage: 10,
      rowClick: 'edit',
      columns: [
        f.text({ source: 'id' }),
        f.text({ source: 'name', sortable: true }),
        f.email({ source: 'email' }),
      ],
    },
  });

  SimpleAdmin.admin({
    title: 'Blog Admin (JS config)',
    dataProvider,
    authProvider,
    requireAuth: true,
  }).mount('#app');
</script>
```

Both snippets produce the same sortable, paginated author list guarded behind a login screen. Mix the two freely in one page — see `examples/mixed/index.html` for a resource that's declared in HTML while another is configured in JS.

## Running it locally

simple-admin ships as plain static files, so for source-based development you don't need a build step at all — just serve the project root and open one of the example pages:

```bash
python3 -m http.server
# then open http://localhost:8000/examples/html-only/index.html
#                or http://localhost:8000/examples/js-config/index.html
```

Any static file server works (`npx serve`, VS Code's Live Server, etc.) — the only requirement is serving over `http://` rather than `file://`, since ES modules need a real origin to resolve imports.

You only need to run a build when you want the two-file `dist/` bundle for production use (e.g. to hand a consuming app a single `<script>`/`<link>` pair instead of the whole `src/` tree, as in `examples/dist-bundle/`):

```bash
npm install   # installs esbuild, the only build-time devDependency
npm run build # writes dist/simple-admin.js + dist/simple-admin.css
```

`scripts/build.mjs` bundles `src/index.js` and everything it imports into `dist/simple-admin.js` (minified ESM), and concatenates `src/theme/base.css` + `src/theme/shadcn.css` into `dist/simple-admin.css`. The library itself has no runtime dependencies — esbuild is dev-only tooling, never imported by the library.

## Core concepts, in one sentence each

- **Resources** — a named entity (`authors`, `posts`, ...) with up to four views (list/create/edit/show), declared via `<sa-resource>` or `SimpleAdmin.resource(name, config)`; see [02-resources-and-views.md](./02-resources-and-views.md).
- **List / Create / Edit / Show views** — the four standard screens simple-admin renders per resource, each composed from fields (read-only display) or inputs (editable form controls); see [02-resources-and-views.md](./02-resources-and-views.md).
- **Fields vs. inputs** — fields (`<sa-text-field>`, `f.text()`, ...) render a value for display in list/show views; inputs (`<sa-text-input>`, `i.text()`, ...) render an editable control for create/edit forms; see [03-fields-and-inputs-reference.md](./03-fields-and-inputs-reference.md).
- **dataProvider** — the single object your admin calls for all CRUD (`getList`, `getOne`, `create`, `update`, `delete`, ...), matching react-admin's data provider contract in spirit; see [04-providers.md](./04-providers.md).
- **authProvider** — the object handling `login`/`logout`/`checkAuth`/`checkError`/`getIdentity`/`getPermissions`, wired to `<sa-admin require-auth>` or `admin({ requireAuth: true })`; see [04-providers.md](./04-providers.md).

For theming and design-token customization, see [05-theming.md](./05-theming.md); for writing your own fields/inputs/providers, see [06-extending.md](./06-extending.md).

## Trying the examples

The bundled examples (`examples/html-only`, `examples/js-config`, `examples/mixed`, `examples/dist-bundle`) all use `createLocalAuthProvider()` for demo login. Sign in with:

```
username: admin
password: admin
```

This is a localStorage-backed demo provider — fine for trying things out, not for production auth.
