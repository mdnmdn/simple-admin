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
import { descriptorFromElement } from '../core/descriptor.js';
import { humanize } from '../core/util.js';
import * as diagnostics from '../core/diagnostics.js';

export class SaShow extends HTMLElement {
  connectedCallback() {
    this.classList.add('sa-show');

    // Capture the light-DOM field template(s) ONCE and hold them on the instance — they must
    // survive a disconnect+reconnect, which legitimately happens when <sa-admin>'s dataProvider is
    // set after this view already connected (_reconnectAuthoredViews in admin.js) and every time
    // the resource host is moved into/out of .sa-content on navigation. Re-reading childNodes on
    // each connect (the old behavior) lost them: the first connect detaches them, so a later
    // reconnect would capture an empty set and render a permanently blank view — the concrete
    // symptom was a deep-linked/refreshed <sa-show> stuck on "Loading…". This mirrors how
    // <sa-datagrid>/<sa-list> keep their persistent build state across reconnects.
    if (!this._fieldTemplates) {
      this._fieldTemplates = Array.from(this.childNodes);
    }
    // Detach current content each connect so fields never connect without a record context, and so
    // a re-append on (re)load re-runs their connectedCallback against the freshly fetched record.
    for (const node of Array.from(this.childNodes)) node.remove();

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
      // Boot race: a deep-linked <sa-show> can connect and load before `admin.dataProvider = ...`
      // runs (a few lines after the import that upgraded the tree). Retry once on the next
      // microtask — the module script has finished by then — before diagnosing. Same grace as the
      // list controller (core/store.js).
      if (!this._providerRetry) {
        this._providerRetry = true;
        queueMicrotask(() => {
          if (this.isConnected && this._id != null && !this.__recordContext) this._load();
        });
        return;
      }
      diagnostics.error('provider-method-missing', {
        method: 'getOne',
        resource: this._resource,
        operation: 'show lookup',
      });
      this._status.textContent = 'Unable to load: no dataProvider.getOne.';
      return;
    }
    this._providerRetry = false;

    this._status.textContent = 'Loading…';
    try {
      const result = await dataProvider.getOne(this._resource, { id: this._id });
      if (!this.isConnected) return;
      // Publish before re-appending children, so their connectedCallback resolves it.
      this.__recordContext = { record: result.data };
      this._status.remove();
      for (const node of this._fieldTemplates) this.appendChild(node);
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

    // Give every field a label and its own row — the layout's whole job ("purely-visual wrapper",
    // doc 02 §6). Without this the fields render as bare, unlabeled values running together inline
    // (a field renders only its value; the label lives on the field's descriptor, exactly like a
    // datagrid uses it for column headers). Read the label from attributes/seed via
    // descriptorFromElement rather than the field's own `label` getter: this runs in tree order
    // BEFORE the child fields' connectedCallbacks have populated their `_descriptor`.
    //
    // Done at most once per element instance: the rows (and the fields inside them) persist across
    // the detach/reattach <sa-show> performs on every (re)load — re-wrapping would nest rows.
    if (this._laidOut) return;
    this._laidOut = true;

    for (const field of Array.from(this.children)) {
      if (typeof field.toDescriptor !== 'function') continue;
      const descriptor = descriptorFromElement(field, 'field');
      // `label` (incl. an explicit empty string, which suppresses it) wins; else humanize source.
      const labelText =
        descriptor.label != null ? descriptor.label : humanize(descriptor.source || '');

      const row = document.createElement('div');
      row.className = 'sa-show__field';
      row.setAttribute('data-sa-part', 'field');
      if (labelText) {
        const label = document.createElement('span');
        label.className = 'sa-show__label';
        label.textContent = labelText;
        row.appendChild(label);
      }
      const value = document.createElement('div');
      value.className = 'sa-show__value';
      this.insertBefore(row, field);
      value.appendChild(field); // moves the field under the row; still resolves up to <sa-show>
      row.appendChild(value);
    }
  }
}

if (!customElements.get('sa-show')) customElements.define('sa-show', SaShow);
if (!customElements.get('sa-simple-show-layout'))
  customElements.define('sa-simple-show-layout', SaSimpleShowLayout);

export default SaShow;
