// app.js — kitchen-sink example entry point.
//
// This is the one file index.html loads. It:
//   1. imports src/index.js once (registers every custom element as a side effect — see that
//      file's own comment on why import order among callers doesn't matter);
//   2. imports the resource modules under ./resources/ for their SimpleAdmin.resource(...) side
//      effects (categories/tags -> "Settings", authors/posts -> "Ecommerce", audit-log ->
//      "Private"). `products` is the one resource NOT here: it's authored directly as HTML markup
//      in index.html instead, because its "Variants" tab needs <sa-form-iterator>'s multi-input
//      row template, which the JS-config materializer doesn't support yet (createInputElement in
//      components/admin.js only accepts a single nested `child`, not a `children` array, for
//      inputs — unlike fields, which do support `children`). Mixing both authoring syntaxes under
//      one <sa-admin> is a fully supported pattern (see examples/mixed).
//   3. wires the dataProvider/authProvider, the sa-function-field render callback, and the theme
//      switcher.

import { navigate } from '../../src/index.js';
import { createKitchenSinkDataProvider } from './data.js';
import { createFakeAuthProvider } from './auth.js';
import './resources/blog.js';
import './resources/catalog.js';
import './resources/audit-log.js';
import { initThemeSwitcher } from './theme-switcher.js';

const admin = document.getElementById('admin');

// Deliberately no admin.requireAuth here: leaving <sa-admin>'s admin-wide require-auth at its
// default `false` is what keeps Ecommerce/Settings public. The authProvider below is still needed
// (for <sa-login> and the "Private" section's own `requireAuth: true` to have something to call)
// — see resources/audit-log.js and doc 02-resources-and-views.md §8.
admin.dataProvider = createKitchenSinkDataProvider();
admin.authProvider = createFakeAuthProvider(); // demo login for the "Private" section: test / test

// With no hash in the URL, the router's default route is the bare "dashboard" placeholder (a
// "Welcome to ..." panel — see core/router.js's `path === '' -> {view:'dashboard'}`), not any real
// resource. That's a weak first impression for a demo whose whole point is showing real content,
// so jump straight to the kitchen-sink resource on a fresh load.
if (!location.hash) navigate('#/products');

// sa-function-field's render callback is JS-only (functions aren't serializable into HTML
// attributes — see 03-fields-and-inputs-reference.md §3.3 "sa-function-field"), so the two
// markup placeholders in index.html (`data-role="stock-status-field"`) get their `.render` wired
// up here, right after upgrade. This works regardless of when data actually loads: the render
// callback is only invoked later, per-row, once a record is available.
document.querySelectorAll('[data-role="stock-status-field"]').forEach((el) => {
  el.render = (record) => (record.in_stock ? '✅ In stock' : '⛔ Out of stock');
});

initThemeSwitcher();
