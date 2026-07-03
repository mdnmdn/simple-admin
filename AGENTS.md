# AGENTS.md

Guidance for AI agents (and humans) working in this repository.

## What this project is

`simple-admin` — a vanilla-JS, no-build, Web Components clone of
[react-admin](https://marmelab.com/react-admin/). It lets you declare an admin CRUD UI as HTML
custom elements, a JS config object, or both mixed together. No bundler, no JSX, no framework
runtime is required to run it: every file under `src/` is a plain ES module that runs as-authored
in a browser. `DataProvider`/`AuthProvider` are plain objects/functions with the same method names
and shapes react-admin uses, so react-admin knowledge transfers directly.

The `dist/` bundle (`simple-admin.js` + `simple-admin.css`) is a pure convenience artifact built by
`npm run build` (esbuild) — it is **not** required for development; `src/index.js` is the real
entry point and is what `package.json#main`/`#exports` point at.

## Repository layout

```
src/
  core/        reactive primitives, descriptor pipeline, context/registry, router, diagnostics
  components/  <sa-admin>, <sa-resource>, list/create/edit/show, datagrid, forms, layout, etc.
  fields/      read-only "sa-*-field" display components (text, number, date, reference, ...)
  inputs/      editable "sa-*-input" form components (text, select, autocomplete, reference, ...)
  providers/   DataProvider/AuthProvider primitives and composition helpers (REST, cache, batching)
  auth/        authGuard + a local/demo AuthProvider
  theme/       base.css + shadcn.css (light-DOM CSS, custom-property driven)
  validators/  form validator functions
  index.js     registers every custom element / factory; the package's public entry point

_docs/
  manual/      end-user guide (getting started, resources/views, fields & inputs reference,
               providers, theming, extending, personalizing controls)
  internals/   contributor-facing architecture: reactive core, descriptor pipeline,
               component lifecycle & context, provider layer internals, build/diagnostics
  react-admin/ original react-admin research + the architecture proposal this was built from
               (transitional, kept for reference — not authoritative on current code)
  verification-plan.md  what's been verified statically/in jsdom, and the real-browser bugs
               found and fixed so far — read this before assuming something works

examples/      four runnable demo apps: html-only, js-config, mixed, dist-bundle, theme-switcher
scripts/
  build.mjs           esbuild bundling for dist/
  verify-jsdom.mjs     jsdom-based functional smoke test (registration, routing, forms, data)
  verify-browser.mjs   Playwright-driven smoke test of the four example apps (not run automatically)
```

## Where to look first

- **Using the library / authoring an admin UI:** `_docs/manual/`. Start with
  `01-getting-started.md`, then `02-resources-and-views.md` and
  `03-fields-and-inputs-reference.md`.
- **Modifying or extending the core:** `_docs/internals/`. These documents describe what the
  shipped code *actually does* (not the original design intent) — where code and older design
  docs disagree, the docs say the code wins. Read the relevant chapter before touching
  `src/core/`, the descriptor pipeline, component lifecycle, or the provider layer.
- **react-admin parity questions:** `_docs/react-admin/10-simple-admin-architecture.md` and
  `11-syntax-reference.md` map react-admin concepts onto this codebase's syntax.
- **Is X actually verified?** `_docs/verification-plan.md`. It documents real bugs found (e.g. a
  custom-element registration-order race, a destructive-rerender pagination bug) and exactly how
  they were diagnosed and fixed — useful precedent for debugging similar symptoms.

## Architecture in one paragraph per subsystem

- **Reactive core** (`src/core/signal.js`, ~100 lines): `signal`/`computed`/`effect` with
  dependency tracking via a global `currentEffect` pointer and a microtask-batched flush queue.
  No virtual DOM — effects mutate real DOM directly.
- **Descriptor pipeline** (`src/core/descriptor.js`): both authoring syntaxes (HTML light-DOM
  markup and JS-config objects) converge on one plain `{kind, ...}` descriptor object before any
  component logic runs. For container views (datagrid, forms), JS-config is first *materialized*
  into real light-DOM elements (`materializeView` in `src/components/admin.js`) — components never
  branch on which syntax produced them.
- **Component lifecycle & context** (`src/core/context.js`, `src/core/registry.js`): every
  `sa-*` custom element follows a strict four-phase convention (constructor = metadata only →
  attribute parsing → `connectedCallback` wiring → teardown). Context is found via DOM-ancestry
  `closest()` lookups (replacing React Context), plus one module-level provider singleton for the
  active `dataProvider`/`authProvider` (replacing a top-level React Context provider).
- **Provider layer** (`src/providers/`, `src/auth/authGuard.js`): `HttpError`/`fetchJson` are the
  base primitives; `saDataSimpleRest`/`saDataJsonServer` are the two built-in REST DataProviders;
  `combineDataProviders`, `withLifecycleCallbacks`, `addRefreshAuthToDataProvider/AuthProvider`,
  `addAuthCheckToDataProvider` are composition wrappers. `createQueryCache`/`createGetManyBatcher`
  are transparent performance add-ons that work on *any* DataProvider, including hand-rolled ones.
- **Build & diagnostics** (`scripts/build.mjs`, `src/core/diagnostics.js`): the build is pure
  convenience (bundles `src/` into two files); diagnostics is a runtime "actionable console hint"
  system every layer calls into on misconfiguration.

## Conventions to follow when writing code here

- No build step, no bundler-only syntax: code in `src/` must run directly in a browser as native
  ES modules (`<script type="module">`). Don't introduce anything that requires transpilation.
- Every custom element's constructor does metadata-only setup — no DOM/attribute/children access
  (see `_docs/internals/03-component-lifecycle-and-context.md` §1 for why, and the exact failure
  mode if this is violated).
- DataProvider/AuthProvider methods reject with `HttpError` (`status` + `body`), matching
  react-admin's contract exactly — this is what auth-error handling and validation-error display
  depend on.
- Theming is light-DOM CSS with `--sa-*` custom properties and a class/part vocabulary — there is
  no Shadow DOM to fight (`_docs/manual/05-theming.md`, `07-personalizing-controls.md`).
- New fields/inputs register via one call that provides both an HTML tag and a JS-config factory
  (`_docs/manual/06-extending.md` §4) — don't hand-roll one path without the other.

## Running / verifying changes

```bash
npm run build              # optional: produces dist/simple-admin.js + .css via esbuild
node scripts/verify-jsdom.mjs   # functional smoke test — registration, routing, data, forms
```

Playwright browser verification (`scripts/verify-browser.mjs`) needs a real Chromium and a static
file server; it is not run automatically in this sandbox (Chromium can't launch here — see
`_docs/verification-plan.md`). If you have a working browser environment, serve the repo root and
run it, or ask the user to spot-check `examples/` in a real browser, especially after touching
custom-element registration order, container/datagrid child-collection logic, or `<sa-admin>`
reconnect behavior — this is exactly where real, jsdom-invisible bugs have been found before.

There are no unit tests beyond the two scripts above (`package.json` has no `test` script).
