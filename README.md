# simple-admin

A vanilla-JS, no-build, web-components clone of [react-admin](https://marmelab.com/react-admin/).
Declare an admin CRUD UI as HTML custom elements, a JS config object, or both mixed together — no
bundler, no JSX, no framework runtime. `DataProvider`/`AuthProvider` are plain objects/functions
with the same method names and shapes react-admin uses, so the concepts transfer directly.

## Quick start

Reference the two built files directly — zero install:

```html
<link rel="stylesheet" href="dist/simple-admin.css" />
<script type="module" src="dist/simple-admin.js"></script>
```

Or import the source tree directly during development (no build step required):

```html
<script type="module">
  import SimpleAdmin from './src/index.js';
</script>
```

See `_docs/manual/01-getting-started.md` for a full walkthrough, and `examples/` for four complete,
runnable apps (`html-only`, `js-config`, `mixed`, `dist-bundle`).

## Documentation

- `_docs/manual/` — end-user guide: getting started, resources/views, the full field/input
  reference, providers, theming, and extending simple-admin with custom fields/inputs.
- `_docs/internals/` — contributor-facing architecture: the reactive core, the dual-syntax
  descriptor pipeline, component lifecycle/context, the provider layer, and the build/diagnostics
  systems.
- `_docs/react-admin/` — the original react-admin research and the simple-admin architecture
  proposal this project was built from (transitional; kept for reference).
- `_docs/verification-plan.md` — what's been verified statically, and the scripted browser test
  plan to run once a real browser is available in the build environment.

## Development

```bash
npm run build   # produces dist/simple-admin.js + dist/simple-admin.css via esbuild (dev-only)
```

No build step is required to run the source (`src/`) directly — it's plain ES modules.
