// SaShow + SaSimpleShowLayout — read-only detail view (doc 10 §8.3, doc 04 §9).
//
// A record is fetched asynchronously (dataProvider.getOne), but BaseField resolves
// findRecordContext(this) exactly ONCE, in its own connectedCallback, and never re-reads it
// later. So sa-*-field descendants must not connect until the record has actually arrived —
// otherwise they'd capture a null record context forever. SaShow therefore detaches its
// light-DOM children synchronously on connect (before any of them can connect on their own),
// fetches the record, publishes __recordContext, and only THEN re-appends the children.

import { getDataProvider } from '../core/registry.js';
import { findResourceContext } from '../core/context.js';
import { currentRoute } from '../core/router.js';
import * as diagnostics from '../core/diagnostics.js';

export class SaShow extends HTMLElement {
  connectedCallback() {
    if (this._built) return;
    this._built = true;
    this.classList.add('sa-show');

    // Detach every child before it gets a chance to connect with no record context yet.
    this._pending = Array.from(this.childNodes);
    for (const node of this._pending) node.remove();

    this._resource = this.getAttribute('resource') || this._resolveResource();
    const attrId = this.getAttribute('id');
    if (attrId != null) {
      this._id = attrId;
    } else {
      const route = currentRoute.peek();
      this._id = route && route.resource === this._resource ? route.id : null;
    }

    this._status = document.createElement('div');
    this._status.className = 'sa-show__status';
    this._status.setAttribute('data-sa-part', 'status');
    this.appendChild(this._status);

    this._load();
  }

  disconnectedCallback() {
    this._built = false;
  }

  get record() {
    return this.__recordContext ? this.__recordContext.record : undefined;
  }

  _resolveResource() {
    const ctx = findResourceContext(this);
    if (ctx && (ctx.name || ctx.resource)) return ctx.name || ctx.resource;
    const resourceEl = this.closest('sa-resource');
    return resourceEl ? resourceEl.getAttribute('name') : undefined;
  }

  async _load() {
    // No id means this instance isn't the active route's show view — e.g. every other
    // resource's <sa-show> gets its connectedCallback re-run by _reconnectAuthoredViews
    // (admin.js) whenever the dataProvider is (re)set. Nothing to fetch; stay quiet.
    if (this._id == null) return;

    const dataProvider = getDataProvider();
    if (!dataProvider || typeof dataProvider.getOne !== 'function') {
      diagnostics.error('provider-method-missing', {
        method: 'getOne',
        resource: this._resource,
        operation: 'show lookup',
      });
      this._status.textContent = 'Unable to load: no dataProvider.getOne.';
      return;
    }

    this._status.textContent = 'Loading…';
    try {
      const result = await dataProvider.getOne(this._resource, { id: this._id });
      if (!this.isConnected) return;
      // Publish before re-appending children, so their connectedCallback resolves it.
      this.__recordContext = { record: result.data };
      this._status.remove();
      for (const node of this._pending) this.appendChild(node);
    } catch (err) {
      if (!this.isConnected) return;
      this._status.textContent = `Error: ${err && err.message ? err.message : err}`;
    }
  }
}

// Thin record-context pass-through: it deliberately does NOT publish its own __recordContext,
// so findRecordContext keeps climbing to the nearest ancestor that has (typically <sa-show>).
export class SaSimpleShowLayout extends HTMLElement {
  connectedCallback() {
    this.classList.add('sa-simple-show-layout');
    this.setAttribute('data-sa-part', 'show-layout');
  }
}

if (!customElements.get('sa-show')) customElements.define('sa-show', SaShow);
if (!customElements.get('sa-simple-show-layout'))
  customElements.define('sa-simple-show-layout', SaSimpleShowLayout);

export default SaShow;
