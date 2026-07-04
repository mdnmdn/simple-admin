// jsdom-based functional smoke test for simple-admin.
//
// Why this exists: a real browser (Playwright/chromium) cannot launch in the sandbox this project
// was built in (see _docs/verification-plan.md — macOS Seatbelt denies Chromium's mach-port IPC
// regardless of --no-sandbox). jsdom implements enough of the DOM/Custom Elements v1 spec to
// actually execute simple-admin's real logic — registration, connectedCallback wiring, the hash
// router, the reactive store, dataProvider calls, form validation/submit — without needing real
// CSS layout or GPU rendering. It does NOT verify visual appearance/CSS; scripts/verify-browser.mjs
// (Playwright) is still the right tool for that once a real browser is available.
//
// DOM construction note: build subtrees with document.createElement()/appendChild() and connect
// the whole assembled tree in one shot (a single top-level appendChild), NOT a bulk
// `element.innerHTML = "<big string>"` assignment. jsdom's incremental HTML-parser can fire a
// custom element's connectedCallback before later sibling/child elements in the same markup
// string have been parsed and upgraded yet (a real, observed divergence from spec-compliant
// browsers, which fully parse a fragment before connecting any of it) — see
// _docs/verification-plan.md for the concrete failure this caused on first attempt.
//
// Usage: node scripts/verify-jsdom.mjs

import { JSDOM } from 'jsdom';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (label, pass, detail) => {
  results.push({ label, pass: !!pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
};

// Build an element with attributes and already-constructed children, all in one call, so nothing
// is ever connected until the caller explicitly appends the finished subtree.
const el = (tag, attrs = {}, children = []) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === true) node.setAttribute(k, '');
    else if (v !== false && v != null) node.setAttribute(k, String(v));
  }
  for (const child of children) node.appendChild(child);
  return node;
};

async function main() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
    runScripts: 'outside-only',
  });
  const { window } = dom;

  global.window = window;
  global.document = window.document;
  global.HTMLElement = window.HTMLElement;
  global.customElements = window.customElements;
  global.CustomEvent = window.CustomEvent;
  global.Event = window.Event;
  global.location = window.location;
  global.localStorage = window.localStorage;
  // Node 24 already has a built-in read-only global `navigator` getter; leave it alone since
  // nothing in src/ references it directly.

  const consoleErrors = [];
  const originalWarn = console.warn;
  const originalError = console.error;
  console.warn = (...args) => originalWarn(...args);
  console.error = (...args) => {
    consoleErrors.push(args.join(' '));
    originalError(...args);
  };

  const pageErrors = [];
  window.addEventListener('error', (e) => pageErrors.push(e.error?.message || e.message));
  process.on('unhandledRejection', (err) => pageErrors.push(`unhandledRejection: ${err?.message || err}`));

  // ---- Import the real library (self-registers every sa-* custom element) ----
  const { currentRoute, navigate } = await import(path.join(root, 'src', 'index.js'));
  const { createMockDataProvider, defaultSeedData } = await import(
    path.join(root, 'examples', 'mock-data-provider.js')
  );

  check(
    'library import registers custom elements',
    customElements.get('sa-admin') && customElements.get('sa-text-field') && customElements.get('sa-reference-input'),
  );

  // ==================================================================================
  // Scenario A: the realistic timing every example app actually hits — <sa-admin> markup
  // connects first (customElements.define upgrades it), THEN a later script line sets
  // .dataProvider. Exercises the reboot fix in components/admin.js.
  // ==================================================================================
  {
    const list = el('sa-list', { 'per-page': 5 }, [el('sa-datagrid', {}, [el('sa-text-field', { source: 'name' })])]);
    const resource = el('sa-resource', { name: 'authors', 'record-representation': 'name' }, [list]);
    const adminEl = el('sa-admin', { id: 'admin-a', title: 'Scenario A' }, [resource]);
    document.body.appendChild(adminEl); // connects with NO dataProvider yet — matches real markup order
    await sleep(20);
    check(
      'late-connect: missing dataProvider is diagnosed, not thrown',
      consoleErrors.some((m) => m.includes('no-data-provider') || m.includes('was mounted without a dataProvider')),
    );

    adminEl.dataProvider = createMockDataProvider(defaultSeedData); // the realistic "too-late" assignment
    await sleep(300);
    const rowsA = adminEl.querySelectorAll('sa-datagrid-row');
    check(
      'setting .dataProvider AFTER connect still populates the list (reboot fix)',
      rowsA.length > 0,
      `${rowsA.length} rows`,
    );
    adminEl.remove();
  }

  // ==================================================================================
  // Scenario B: full CRUD flow, built bottom-up and connected once (avoids the jsdom
  // bulk-innerHTML upgrade-ordering issue noted above), dataProvider set before connecting.
  // ==================================================================================
  const dataProvider = createMockDataProvider(defaultSeedData);

  const authorsResource = el('sa-resource', { name: 'authors', 'record-representation': 'name' }, [
    el('sa-list', { 'per-page': 10 }, [el('sa-datagrid', {}, [el('sa-text-field', { source: 'name' })])]),
  ]);

  const postsList = el(
    'sa-list',
    { 'sort-field': 'published_at', 'sort-order': 'DESC', 'per-page': 10, 'row-click': 'edit' },
    [
      el('sa-filters', {}, [el('sa-search-input', { source: 'q', 'always-on': true })]),
      el('sa-datagrid', {}, [
        el('sa-text-field', { source: 'id' }),
        el('sa-text-field', { source: 'title', label: 'Title', sortable: true }),
        el('sa-reference-field', { source: 'author_id', reference: 'authors', link: 'show' }, [
          el('sa-text-field', { source: 'name' }),
        ]),
        el('sa-boolean-field', { source: 'is_published', label: 'Published' }),
      ]),
      el('sa-bulk-delete-button'),
    ],
  );
  const postsCreate = el('sa-create', { redirect: 'list' }, [
    el('sa-simple-form', {}, [
      el('sa-text-input', { source: 'title', validate: 'required|minLength:3' }),
      el('sa-reference-input', { source: 'author_id', reference: 'authors' }, [
        el('sa-select-input', { 'option-text': 'name' }),
      ]),
    ]),
  ]);
  const postsEdit = el('sa-edit', { redirect: 'list' }, [
    el('sa-simple-form', {}, [el('sa-text-input', { source: 'title', validate: 'required|minLength:3' })]),
  ]);
  const postsResource = el('sa-resource', { name: 'posts', 'record-representation': 'title' }, [
    postsList,
    postsCreate,
    postsEdit,
  ]);

  const adminEl = el('sa-admin', { id: 'admin-b', title: 'Scenario B' }, [authorsResource, postsResource]);
  adminEl.dataProvider = dataProvider; // set before connecting: the clean, no-timing-bug path
  document.body.appendChild(adminEl);

  navigate('#/posts');
  await sleep(300); // initial getList + reference batching

  // Only rows of the MOUNTED view — parked resources' lists render rows too.
  const rows = () => adminEl.querySelectorAll('.sa-content sa-datagrid-row');
  check('list loads rows from the mock data provider', rows().length > 0, `${rows().length} rows`);

  // Scope to a rendered datagrid row: the admin subtree also contains parked view templates
  // (hidden authored host, non-active sibling views) whose reference fields render nothing.
  // Reference resolution is a batched async fetch AFTER row render — poll briefly instead of
  // assuming one fixed sleep covers it.
  let refText = null;
  for (let attempt = 0; attempt < 20 && !refText; attempt++) {
    const refCell = adminEl.querySelector('sa-datagrid-row sa-reference-field');
    refText = refCell ? refCell.textContent.trim() : null;
    if (!refText) await sleep(100);
  }
  const looksLikeName = !!refText && !/^\d+$/.test(refText);
  check('reference field resolves to author name, not raw id', looksLikeName, JSON.stringify(refText));

  // ---- Sort ----
  const listController = postsList.listController;
  const beforeSort = Array.from(rows()).map((r) => r.record?.id);
  listController.setSort('title', 'ASC');
  await sleep(300);
  const afterSort = Array.from(rows()).map((r) => r.record?.id);
  check('sorting re-fetches and re-renders rows', JSON.stringify(beforeSort) !== JSON.stringify(afterSort), `before=${beforeSort} after=${afterSort}`);

  // ---- Filter (debounced) ----
  const searchInput = postsList.querySelector('sa-search-input input');
  const totalBefore = rows().length;
  searchInput.value = 'signals';
  searchInput.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(700);
  const totalAfterFilter = rows().length;
  check('filter input narrows the row set after debounce', totalAfterFilter < totalBefore, `before=${totalBefore} after=${totalAfterFilter}`);
  searchInput.value = '';
  searchInput.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(700);

  // ---- Create form: validation, then a real save ----
  navigate('#/posts/create');
  await sleep(200);
  check('create form renders inputs', document.querySelectorAll('sa-text-input').length > 0);

  const clickSave = () => {
    const saveBtn = document.querySelector('sa-save-button');
    (saveBtn.querySelector('button') || saveBtn).dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  };
  clickSave();
  await sleep(100);
  // First NON-EMPTY error span: every input renders an (empty) error span, and document order
  // can put an errorless input's span first.
  const errorText = [...document.querySelectorAll('.sa-input__error')]
    .map((n) => n.textContent.trim())
    .find(Boolean);
  check('submitting empty required field shows a validation error', !!errorText, JSON.stringify(errorText));

  const titleInput = document.querySelector('sa-text-input input');
  titleInput.value = 'jsdom smoke test post';
  titleInput.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(50);

  const before = await dataProvider.getList('posts', { pagination: { page: 1, perPage: 100 }, sort: { field: 'id', order: 'ASC' }, filter: {} });
  clickSave();
  await sleep(300);
  const after = await dataProvider.getList('posts', { pagination: { page: 1, perPage: 100 }, sort: { field: 'id', order: 'ASC' }, filter: {} });
  check('saving a valid create form actually calls dataProvider.create', after.total === before.total + 1, `before=${before.total} after=${after.total}`);
  check('create redirects back to the list (#/posts) on success', currentRoute.get().view === 'list' && currentRoute.get().resource === 'posts', JSON.stringify(currentRoute.get()));

  // ---- Bulk delete ----
  await sleep(300);
  // Scope to the MOUNTED list (.sa-content): parked resources' lists also render rows and a
  // bulk button, and they come first in document order.
  const firstCheckbox = document.querySelector('.sa-content sa-datagrid-row input[type="checkbox"]');
  const rowCountBeforeDelete = rows().length;
  firstCheckbox.checked = true;
  firstCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(50);
  const bulkBtn =
    document.querySelector('.sa-content sa-bulk-delete-button button') ||
    document.querySelector('.sa-content sa-bulk-delete-button');
  // Assert on the provider's total, not the rendered row count: with more records than the
  // page size, the post-delete refetch renders a full page again and the row count is unchanged.
  const totalBeforeDelete = (await dataProvider.getList('posts', { pagination: { page: 1, perPage: 100 }, sort: { field: 'id', order: 'ASC' }, filter: {} })).total;
  bulkBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(400);
  const totalAfterDelete = (await dataProvider.getList('posts', { pagination: { page: 1, perPage: 100 }, sort: { field: 'id', order: 'ASC' }, filter: {} })).total;
  check('bulk delete removes the selected row', totalAfterDelete === totalBeforeDelete - 1, `total before=${totalBeforeDelete} after=${totalAfterDelete} (rows rendered: ${rowCountBeforeDelete} -> ${rows().length})`);

  // ---- Diagnostics: deliberately misconfigure an element and confirm a graceful warning ----
  const errCountBefore = consoleErrors.length;
  const badField = document.createElement('sa-text-field'); // no source attribute
  postsList.querySelector('sa-datagrid').appendChild(badField);
  await sleep(50);
  check(
    'a misconfigured field logs a [simple-admin] diagnostic instead of throwing',
    consoleErrors.slice(errCountBefore).some((m) => m.includes('[simple-admin]') && m.includes('source')),
  );

  // ---- Summary ----
  console.warn = originalWarn;
  console.error = originalError;

  const failed = results.filter((r) => !r.pass);
  console.log('\n--- Summary ---');
  console.log(`${results.length - failed.length}/${results.length} checks passed`);
  if (pageErrors.length) console.log('Uncaught errors during run:', pageErrors);
  if (failed.length) {
    console.log('Failed checks:', failed.map((r) => r.label));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Harness crashed:', err);
  process.exit(1);
});
