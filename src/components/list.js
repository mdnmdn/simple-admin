// SaList — <sa-list> root list controller (doc 10 §8, doc 04 §1).
//
// Publishes `this.__listContext = ListController` synchronously as the FIRST thing it does in
// connectedCallback, before touching any light-DOM children — LIST_HOST_TAGS lookups from
// descendants (<sa-datagrid>, <sa-filters>, <sa-pagination>) rely on that ordering, exactly like
// context.js documents for record/form/resource hosts.

import { createListController } from '../core/store.js';
import { descriptorFromElement } from '../core/descriptor.js';
import { getDataProvider } from '../core/registry.js';
import { findResourceContext } from '../core/context.js';
import { effect } from '../core/signal.js';
import * as diagnostics from '../core/diagnostics.js';

export class SaList extends HTMLElement {
  connectedCallback() {
    if (this._built) return;
    this._built = true;
    this.classList.add('sa-list');

    const descriptor = descriptorFromElement(this, 'view');
    descriptor.type = 'list';
    if (!descriptor.resource) descriptor.resource = this._resolveResource();
    if (descriptor.rowClick === undefined) descriptor.rowClick = false;

    this._controller = createListController(descriptor, { dataProvider: getDataProvider() });
    // Publish before any child (sa-filters/sa-datagrid/sa-pagination) gets a chance to connect.
    this.__listContext = this._controller;

    this._renderChrome();
  }

  disconnectedCallback() {
    if (this._disposeStatus) this._disposeStatus();
    this._disposeStatus = null;
    if (this._controller) this._controller.dispose();
    this._built = false;
  }

  get listController() {
    return this._controller;
  }

  _resolveResource() {
    const attr = this.getAttribute('resource');
    if (attr) return attr;
    const ctx = findResourceContext(this);
    if (ctx && (ctx.name || ctx.resource)) return ctx.name || ctx.resource;
    const resourceEl = this.closest('sa-resource');
    return resourceEl ? resourceEl.getAttribute('name') : undefined;
  }

  // Structural chrome (the status div, the datagrid-presence check, the auto-injected default
  // pagination) must only ever be built ONCE per element instance — these are persistent light-DOM
  // children that survive a disconnect (disconnectedCallback never removes them), so rebuilding
  // them on every reconnect would keep stacking duplicates (e.g. a second/third auto-injected
  // <sa-pagination>) each time this element is detached and reattached — which legitimately
  // happens whenever <sa-admin>'s dataProvider is set after it already connected (see
  // _reconnectAuthoredViews in components/admin.js). Only the reactive status EFFECT needs to be
  // rebuilt each connect, since disconnectedCallback disposes the previous one and `this._controller`
  // is a fresh instance on every reconnect.
  _renderChrome() {
    if (!this._chromeBuilt) {
      this._chromeBuilt = true;

      this._statusEl = document.createElement('div');
      this._statusEl.className = 'sa-list__status';
      this._statusEl.setAttribute('data-sa-part', 'status');
      this._statusEl.hidden = true;
      this.insertBefore(this._statusEl, this.firstChild);

      if (!this.querySelector(':scope > sa-datagrid, :scope > sa-simple-list')) {
        diagnostics.warn('list-no-body', { resource: this._controller.resource });
      }
      if (!this.querySelector(':scope > sa-pagination')) {
        this.appendChild(document.createElement('sa-pagination'));
      }
    }

    const status = this._statusEl;
    this._disposeStatus = effect(() => {
      const pending = this._controller.isPending.get();
      const err = this._controller.error.get();
      if (err) {
        status.hidden = false;
        status.textContent = `Error: ${err.message || err}`;
        status.classList.add('sa-list__status--error');
      } else if (pending) {
        status.hidden = false;
        status.textContent = 'Loading…';
        status.classList.remove('sa-list__status--error');
      } else {
        status.hidden = true;
        status.textContent = '';
        status.classList.remove('sa-list__status--error');
      }
    });
  }
}

if (!customElements.get('sa-list')) customElements.define('sa-list', SaList);

export default SaList;
