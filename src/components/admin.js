// SaAdmin — the app shell (doc 10 §1, §3, §5, §7). Owns:
//   - publishing the active dataProvider/authProvider to the registry singleton (core/registry.js)
//     so every field/input/guard in the tree can read them without DOM plumbing;
//   - starting the hash router and, on every route change, deciding which child view to mount;
//   - the auth dance (checkAuth/guardView before a protected view mounts, #/login on failure);
//   - the appbar (title + identity + logout) and the resource menu.
//
// Route -> view mounting (doc 10 §5.2):
//   view === 'login'                -> render <sa-login> standalone (shell hidden)
//   view === 'dashboard'            -> placeholder welcome panel in .sa-content
//   view === 'accessDenied'         -> placeholder "access denied" panel in .sa-content
//   view in list/create/edit/show   -> look up the matching resource's view via getResource():
//     - if the descriptor's view is a real HTMLElement (HTML-authoring path, §2.2(A)): the whole
//       <sa-resource> host (found via .closest) is moved into .sa-content; its list/create/edit/show
//       children are toggled with style.display so only the active one shows.
//     - if it's a plain descriptor object (JS-config path, §2.2(B)): a <sa-view-tag> element is
//       created on demand, wrapped in a synthesized <sa-resource> host (so context lookups such as
//       findResourceContext still work), and mounted.
//   Only one view is ever visible in .sa-content; the previous one is detached (HTML-authored
//   elements are parked back in a hidden host so they stay registered; JS-config elements are
//   simply discarded and recreated next visit).

import { effect } from '../core/signal.js';
import { currentRoute, navigate, startRouter } from '../core/router.js';
import {
  setDataProvider,
  setAuthProvider,
  getResource,
  getFieldClass,
  getInputClass,
  fieldTag,
  inputTag,
} from '../core/registry.js';
import { checkAuth, guardView, addAuthCheckToDataProvider } from '../auth/authGuard.js';
import * as diagnostics from '../core/diagnostics.js';
import { renderAppBar, renderMenu } from './layout.js';
import './resource.js';
import './login.js';

// ---- JS-config materialization (doc 10 §2 "dual syntax") ----
//
// A JS-config ViewDescriptor's `columns`/`filters`/`inputs`/`groups` are plain descriptor objects
// (e.g. { kind:'field', type:'text', source:'title' }), not real elements. But <sa-datagrid>,
// <sa-filters> and <sa-simple-form>/<sa-tabbed-form> only ever look at their *light-DOM children*
// (the same code path the HTML-authoring syntax uses) — that's what keeps the renderer written
// once for both syntaxes. So before a JS-config view element is ever appended (i.e. before it can
// connect), we materialize each plain descriptor into a real `sa-*-field`/`sa-*-input` element with
// its `.descriptor` pre-set, exactly like the seed step in core/descriptor.js. An unknown `type`
// falls back to `text` with a diagnostics warning rather than throwing.
const createFieldElement = (fieldDescriptor = {}) => {
  const type = getFieldClass(fieldDescriptor.type) ? fieldDescriptor.type : 'text';
  if (type !== fieldDescriptor.type) {
    diagnostics.warn('unknown-element', {
      message:
        `[simple-admin] Unknown field type "${fieldDescriptor.type}" in JS config ` +
        `(source="${fieldDescriptor.source}"). Register it with SimpleAdmin.registerField(` +
        `"${fieldDescriptor.type}", …) or use a known type. Falling back to a text field.`,
    });
  }
  const el = document.createElement(fieldTag(type));
  el.descriptor = { kind: 'field', ...fieldDescriptor, type };
  // f.reference({ child: f.text(...) }) (singular, per the JS factory ergonomics in doc 10 §2.2)
  // and the compiled descriptor's `children` (array, what referenceField.js/arrayField.js actually
  // walk as real light-DOM template children) are both accepted here.
  const kids = fieldDescriptor.children || (fieldDescriptor.child ? [fieldDescriptor.child] : []);
  for (const child of kids) el.appendChild(createFieldElement(child));
  return el;
};

const createInputElement = (inputDescriptor = {}) => {
  const type = getInputClass(inputDescriptor.type) ? inputDescriptor.type : 'text';
  if (type !== inputDescriptor.type) {
    diagnostics.warn('unknown-element', {
      message:
        `[simple-admin] Unknown input type "${inputDescriptor.type}" in JS config ` +
        `(source="${inputDescriptor.source}"). Register it with SimpleAdmin.registerInput(` +
        `"${inputDescriptor.type}", …) or use a known type. Falling back to a text input.`,
    });
  }
  const el = document.createElement(inputTag(type));
  el.descriptor = { kind: 'input', ...inputDescriptor, type };
  if (inputDescriptor.child) el.appendChild(createInputElement(inputDescriptor.child));
  return el;
};

// Appends materialized light-DOM children onto `viewEl` for whichever of columns/filters/inputs/
// groups the JS-config `viewSpec` declares. HTML-authored views never reach this (they already
// have real children), so this is purely additive for the JS-config path.
const materializeView = (viewEl, viewSpec) => {
  if (Array.isArray(viewSpec.filters) && viewSpec.filters.length) {
    const filtersEl = document.createElement('sa-filters');
    for (const input of viewSpec.filters) filtersEl.appendChild(createInputElement(input));
    viewEl.appendChild(filtersEl);
  }
  if (Array.isArray(viewSpec.columns) && viewSpec.columns.length) {
    const bodyTag = (viewSpec.body && viewSpec.body.component) === 'simple-list'
      ? 'sa-simple-list'
      : 'sa-datagrid';
    const bodyEl = document.createElement(bodyTag);
    for (const field of viewSpec.columns) bodyEl.appendChild(createFieldElement(field));
    // JS-config `bulkActions: ['delete']` (doc 10 §8.1) materializes into the same real
    // <sa-bulk-delete-button> child the HTML syntax declares — <sa-datagrid> only ever looks at
    // actual light-DOM bulk-button children, it does not read the `bulkActions` array itself.
    for (const action of viewSpec.bulkActions || []) {
      const name = typeof action === 'string' ? action : action.type;
      if (name === 'delete') bodyEl.appendChild(document.createElement('sa-bulk-delete-button'));
    }
    viewEl.appendChild(bodyEl);
  }
  if (Array.isArray(viewSpec.fields) && viewSpec.fields.length) {
    const layoutEl = document.createElement('sa-simple-show-layout');
    for (const field of viewSpec.fields) layoutEl.appendChild(createFieldElement(field));
    viewEl.appendChild(layoutEl);
  }
  if (Array.isArray(viewSpec.groups) && viewSpec.groups.length) {
    const formEl = document.createElement('sa-tabbed-form');
    for (const group of viewSpec.groups) {
      const tabEl = document.createElement('sa-form-tab');
      if (group.label) tabEl.setAttribute('label', group.label);
      for (const input of group.inputs || []) tabEl.appendChild(createInputElement(input));
      formEl.appendChild(tabEl);
    }
    viewEl.appendChild(formEl);
  } else if (Array.isArray(viewSpec.inputs) && viewSpec.inputs.length) {
    const formEl = document.createElement('sa-simple-form');
    for (const input of viewSpec.inputs) formEl.appendChild(createInputElement(input));
    viewEl.appendChild(formEl);
  }
};

const VIEW_TAGS = { list: 'sa-list', create: 'sa-create', edit: 'sa-edit', show: 'sa-show' };
const VIEW_ACTIONS = new Set(Object.keys(VIEW_TAGS));

export class SaAdmin extends HTMLElement {
  constructor() {
    super();
    // NO DOM work in the constructor (doc 10 §3.3): metadata only.
    this._dataProvider = null;
    this._authProvider = null;
    this._title = 'Admin';
    this._requireAuth = false;
    this._identity = null;
    this._dispose = null;
    this._authoredHost = null;
    this._shellRoot = null;
    this._content = null;
    this._loginEl = null;
    this._booted = false;
  }

  // ---- properties (settable directly, or in bulk via .descriptor) ----
  //
  // `dataProvider`/`authProvider` are re-published and the current route re-mounted whenever they
  // are set on an ALREADY-CONNECTED element. This matters because every real usage sets them
  // *after* the markup already connected: a `<script type="module">` is deferred, so by the time
  // `admin.dataProvider = ...` runs, `customElements.define('sa-admin', ...)` (triggered by the
  // preceding `import '.../index.js'` in the same script) has already upgraded the parsed
  // `<sa-admin>` element and fired `connectedCallback` once — with no provider yet. Without this
  // re-publish step every HTML-authored example would boot permanently provider-less.
  set dataProvider(dp) {
    this._dataProvider = dp;
    if (this._booted) this._rebootProviders();
  }
  get dataProvider() {
    return this._dataProvider;
  }
  set authProvider(ap) {
    this._authProvider = ap;
    if (this._booted) this._rebootProviders();
  }
  get authProvider() {
    return this._authProvider;
  }
  set title(t) {
    this._title = t;
  }
  get title() {
    return this._title;
  }
  set requireAuth(v) {
    this._requireAuth = !!v;
  }
  get requireAuth() {
    return this._requireAuth;
  }

  // JS-config path: SimpleAdmin.admin({...}).mount() sets this in one shot.
  set descriptor(d = {}) {
    if (d.dataProvider) this._dataProvider = d.dataProvider;
    if (d.authProvider) this._authProvider = d.authProvider;
    if (d.title) this._title = d.title;
    if (d.requireAuth != null) this._requireAuth = !!d.requireAuth;
    if (this._booted) this._rebootProviders();
  }

  // Re-publish the (now-current) providers to the registry singleton and re-mount whatever the
  // current route resolves to, so a provider set post-connect isn't silently ignored. Safe to call
  // any number of times; does not re-run connectedCallback's one-time DOM/router setup.
  _rebootProviders() {
    this._publishProviders();
    this._reconnectAuthoredViews();
    if (currentRoute.peek().view !== 'login') this._handleRoute(currentRoute.peek());
  }

  // JS-config views are recreated fresh on every _mountConfiguredView call, so a re-run of
  // _handleRoute alone is enough for them to pick up the now-correct dataProvider. HTML-authored
  // views are real elements that already ran their one-shot connectedCallback (and, for <sa-list>,
  // already issued one getList call) — possibly before a provider existed. Forcing a synchronous
  // detach+reattach makes each re-run its own connectedCallback/disconnectedCallback cleanly (every
  // view component already resets its build state in disconnectedCallback for exactly this reason).
  _reconnectAuthoredViews() {
    if (!this._authoredHost) return;
    const resourceHosts = [
      ...this._authoredHost.children,
      ...(this._content ? Array.from(this._content.children).filter((el) => el.__isAuthoredResource) : []),
    ];
    for (const resourceHostEl of resourceHosts) {
      for (const view of Array.from(resourceHostEl.children)) {
        if (!Object.values(VIEW_TAGS).includes(view.tagName.toLowerCase())) continue;
        const parent = view.parentNode;
        const next = view.nextSibling;
        parent.removeChild(view);
        parent.insertBefore(view, next);
      }
    }
  }

  _publishProviders() {
    if (!this._dataProvider) {
      diagnostics.error('no-data-provider', {});
    }
    if (this._requireAuth && !this._authProvider) {
      diagnostics.warn('no-auth-provider', {});
    }

    // Publish providers to the registry singleton (core/registry.js) before anything below us
    // renders — reference fields/inputs and auth guards read them back via getDataProvider()/
    // getAuthProvider() instead of walking the DOM.
    let publishedDataProvider = this._dataProvider;
    if (this._authProvider) {
      publishedDataProvider = addAuthCheckToDataProvider(this._dataProvider, this._authProvider);
      setAuthProvider(this._authProvider);
    }
    setDataProvider(publishedDataProvider);
  }

  connectedCallback() {
    this._publishProviders();

    // Preserve author-declared light-DOM children (HTML-authoring path — <sa-resource> elements)
    // in a hidden host so they stay connected (and registered) even while not the active route's
    // view. They are moved into .sa-content on demand by _mountView() and parked back here when
    // navigation moves away from their resource.
    this._authoredHost = document.createElement('div');
    this._authoredHost.style.display = 'none';
    this._authoredHost.setAttribute('data-sa-part', 'authored-resources');
    for (const child of Array.from(this.children)) this._authoredHost.appendChild(child);

    this.innerHTML = '';
    this.appendChild(this._authoredHost);

    this._shellRoot = document.createElement('div');
    this._shellRoot.className = 'sa-admin';
    this._shellRoot.setAttribute('data-sa-part', 'admin');
    this.appendChild(this._shellRoot);

    if (this._authProvider && typeof this._authProvider.getIdentity === 'function') {
      this._authProvider
        .getIdentity()
        .then((identity) => {
          this._identity = identity;
          if (currentRoute.peek().view !== 'login') this._renderShell();
        })
        .catch(() => {});
    }

    startRouter();
    this._dispose = effect(() => {
      const route = currentRoute.get();
      this._handleRoute(route);
    });
    this._booted = true;
  }

  disconnectedCallback() {
    if (this._dispose) this._dispose();
    this._dispose = null;
  }

  async _logout() {
    if (this._authProvider && typeof this._authProvider.logout === 'function') {
      try {
        await this._authProvider.logout({});
      } catch (_) {
        // ignore logout failure; still redirect
      }
    }
    navigate('#/login');
  }

  async _handleRoute(route) {
    if (route.view === 'login') {
      this._renderLoginOnly();
      return;
    }

    if (this._authProvider) {
      const ok = VIEW_ACTIONS.has(route.view)
        ? await guardView(this._authProvider, { action: route.view, resource: route.resource })
        : await checkAuth(this._authProvider);
      if (!ok) return; // guardView/checkAuth already navigated on failure
    }

    this._renderShell();
    this._mountView(route);
  }

  _renderLoginOnly() {
    this._shellRoot.style.display = 'none';
    if (!this._loginEl) {
      this._loginEl = document.createElement('sa-login');
      this.appendChild(this._loginEl);
    }
    this._loginEl.style.display = '';
  }

  _renderShell() {
    if (this._loginEl) this._loginEl.style.display = 'none';
    this._shellRoot.style.display = '';

    if (!this._content) {
      this._content = document.createElement('main');
      this._content.className = 'sa-content';
      this._content.setAttribute('data-sa-part', 'content');
    }

    const appbar = renderAppBar({
      title: this._title,
      identity: this._identity,
      onLogout: this._authProvider ? () => this._logout() : null,
    });
    const menu = renderMenu();

    this._shellRoot.innerHTML = '';
    this._shellRoot.appendChild(appbar);
    this._shellRoot.appendChild(menu);
    this._shellRoot.appendChild(this._content);
  }

  _mountView(route) {
    // Detach the previously mounted view. HTML-authored <sa-resource> hosts are parked back in
    // the hidden authored host (staying connected/registered); JS-config ones are discarded.
    const prev = this._content.firstChild;
    if (prev && prev.__isAuthoredResource) {
      this._authoredHost.appendChild(prev);
    }
    this._content.innerHTML = '';

    if (route.view === 'dashboard') {
      const el = document.createElement('div');
      el.className = 'sa-dashboard';
      el.setAttribute('data-sa-part', 'dashboard');
      el.textContent = this._title ? `Welcome to ${this._title}` : 'Welcome';
      this._content.appendChild(el);
      return;
    }

    if (route.view === 'accessDenied') {
      const el = document.createElement('div');
      el.className = 'sa-access-denied';
      el.setAttribute('data-sa-part', 'access-denied');
      el.textContent = 'Access denied.';
      this._content.appendChild(el);
      return;
    }

    const resourceDescriptor = getResource(route.resource);
    if (!resourceDescriptor) {
      diagnostics.error('route-view-missing', {
        hash: `#/${route.resource}`,
        view: route.view,
        resource: route.resource,
        message:
          `[simple-admin] Route #/${route.resource} does not match any declared resource. ` +
          `Declare it with <sa-resource name="${route.resource}"> or SimpleAdmin.resource('${route.resource}', {...}).`,
      });
      return;
    }

    const viewSpec = resourceDescriptor[route.view];
    if (!viewSpec) {
      diagnostics.warn('route-view-missing', {
        hash: `#/${route.resource}`,
        view: route.view,
        resource: route.resource,
      });
      navigate(`#/${route.resource}`);
      return;
    }

    if (viewSpec instanceof HTMLElement) {
      this._mountAuthoredView(viewSpec);
    } else {
      this._mountConfiguredView(route, resourceDescriptor, viewSpec);
    }
  }

  // HTML-authoring path: the view element already exists inside its <sa-resource>. Show only
  // that view among its siblings and move the whole resource host into .sa-content.
  _mountAuthoredView(viewSpec) {
    const resourceHostEl = viewSpec.closest('sa-resource') || viewSpec;
    resourceHostEl.__isAuthoredResource = true;
    for (const child of Array.from(resourceHostEl.children)) {
      if (Object.values(VIEW_TAGS).includes(child.tagName.toLowerCase())) {
        child.style.display = child === viewSpec ? '' : 'none';
      }
    }
    this._content.appendChild(resourceHostEl);
  }

  // JS-config path: no real element yet — create the view tag and set its descriptor property,
  // wrapped in a synthesized <sa-resource> host so descendant fields can find their ambient
  // resource via findResourceContext() (core/context.js).
  _mountConfiguredView(route, resourceDescriptor, viewSpec) {
    const resourceHostEl = document.createElement('sa-resource');
    resourceHostEl.descriptor = resourceDescriptor;

    const tag = VIEW_TAGS[route.view];
    const viewEl = document.createElement(tag);
    viewEl.descriptor = { kind: 'view', type: route.view, resource: route.resource, ...viewSpec };
    // SaEdit exposes its own `id` property accessor; SaShow has none, so this falls through to the
    // native HTMLElement `id` property, which reflects to the `id` attribute — exactly what
    // SaShow's `getAttribute('id')` fallback reads. One assignment satisfies both.
    if (route.id != null) viewEl.id = route.id;
    // Turn columns/filters/inputs/groups plain descriptors into real light-DOM children BEFORE
    // this element (or its sa-resource host) ever connects — see materializeView() above.
    materializeView(viewEl, viewSpec);

    resourceHostEl.appendChild(viewEl);
    this._content.appendChild(resourceHostEl);
  }
}

if (!customElements.get('sa-admin')) customElements.define('sa-admin', SaAdmin);

export default SaAdmin;
