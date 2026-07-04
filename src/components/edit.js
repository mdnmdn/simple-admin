// SaEdit — page-level controller for an "edit existing record" form (doc 05 §1, architecture §9.1).
//
// Reads `id` from the `id` attribute, falling back to `currentRoute` (router.js) when the
// resource matches. Fetches `dataProvider.getOne(resource, { id })` first, then publishes the
// fetched record as `this.__recordContext` (SaEdit is a RECORD_HOST_TAGS entry) and configures its
// light-DOM `<sa-simple-form>`/`<sa-tabbed-form>` child by property assignment. `mutationMode` is
// `'pessimistic'` only in v1 (no optimistic/undoable) — the save button is disabled-by-inaction
// until the update() promise settles is NOT implemented here; callers wanting that build it via
// mutationOptions equivalents in a later pass.
//
// ---- <sa-edit> <-> <sa-simple-form>/<sa-tabbed-form> event contract ----
// Same shape as <sa-create> (see create.js) — `formEl.resource` / `formEl.record` set as plain
// properties (record set once the async getOne() resolves), and a bubbling `'sa-submit'`
// CustomEvent `detail: { values }` consumed here to call
// `dataProvider.update(resource, { id, data, previousData })`.
//
// `sanitize-empty-values` (boolean attr, OFF by default matching react-admin): strips `''`-valued
// keys from `data` before calling update. `warn-when-unsaved-changes` (boolean attr): wires a
// `beforeunload` listener guarding on `formStore.dirty.peek()`.

import { getDataProvider } from '../core/registry.js';
import { navigate, currentRoute } from '../core/router.js';
import { descriptorFromElement } from '../core/descriptor.js';
import { findResourceContext } from '../core/context.js';
import * as diagnostics from '../core/diagnostics.js';
import './simpleForm.js';
import './tabbedForm.js';
import './toolbar.js';

const upgradeProperty = (el, prop) => {
  if (Object.prototype.hasOwnProperty.call(el, prop)) {
    const value = el[prop];
    delete el[prop];
    el[prop] = value;
  }
};

export class SaEdit extends HTMLElement {
  constructor() {
    super();
    this._resource = null;
    this._id = null;
    this.record = null;
  }

  get resource() {
    return this._resource;
  }
  set resource(value) {
    this._resource = value;
  }

  get id() {
    return this._id;
  }
  set id(value) {
    this._id = value;
  }

  connectedCallback() {
    upgradeProperty(this, 'resource');
    upgradeProperty(this, 'id');

    if (!this._resource) {
      const resourceCtx = findResourceContext(this);
      this._resource = (resourceCtx && resourceCtx.name) || this.getAttribute('resource') || null;
    }
    if (this._id == null) {
      const attrId = this.getAttribute('id');
      if (attrId != null) {
        this._id = attrId;
      } else {
        const route = currentRoute.peek();
        this._id = route && route.resource === this._resource ? route.id : null;
      }
    }

    this._descriptor = descriptorFromElement(this, 'view');
    this._sanitizeEmptyValues = !!this._descriptor.sanitizeEmptyValues;
    this._warnWhenUnsavedChanges = !!this._descriptor.warnWhenUnsavedChanges;

    this._onSubmit = (event) => this._handleSubmit(event);
    this.addEventListener('sa-submit', this._onSubmit);

    this._fetchRecord();
  }

  disconnectedCallback() {
    this.removeEventListener('sa-submit', this._onSubmit);
    if (this._beforeUnload) window.removeEventListener('beforeunload', this._beforeUnload);
  }

  async _fetchRecord() {
    // No id means this instance isn't the active route's edit view — e.g. every other
    // resource's <sa-edit> gets its connectedCallback re-run by _reconnectAuthoredViews
    // (admin.js) whenever the dataProvider is (re)set. Nothing to fetch; stay quiet.
    if (this._id == null) return;

    const dataProvider = getDataProvider();
    if (!dataProvider || typeof dataProvider.getOne !== 'function') {
      // Boot race: a deep-linked <sa-edit> can connect and fetch before `admin.dataProvider = ...`
      // runs. Retry once on the next microtask before diagnosing — same grace as <sa-show> and the
      // list controller (core/store.js).
      if (!this._providerRetry) {
        this._providerRetry = true;
        queueMicrotask(() => {
          if (this.isConnected && this._id != null && !this.__recordContext) this._fetchRecord();
        });
        return;
      }
      diagnostics.error('provider-method-missing', {
        method: 'getOne',
        resource: this._resource,
        operation: 'edit lookup',
      });
      return;
    }
    this._providerRetry = false;

    try {
      const result = await dataProvider.getOne(this._resource, { id: this._id });
      if (!this.isConnected) return;
      this.record = (result && result.data) || {};
      this.__recordContext = { record: this.record };

      this._configureForm();
      this._wireUnsavedGuard();
    } catch (err) {
      if (!this.isConnected) return;
      diagnostics.error('record-fetch-failed', {
        message:
          `[simple-admin] <sa-edit> failed to load resource "${this._resource}" id ${this._id}: ` +
          `${err && err.message ? err.message : err}`,
      });
    }
  }

  _configureForm() {
    const apply = () => {
      const formEl = this.querySelector('sa-simple-form, sa-tabbed-form');
      if (!formEl) return false;
      formEl.resource = this._resource;
      formEl.record = this.record;
      return true;
    };
    if (!apply()) queueMicrotask(apply);
  }

  _wireUnsavedGuard() {
    if (!this._warnWhenUnsavedChanges) return;
    const formEl = this.querySelector('sa-simple-form, sa-tabbed-form');
    if (!formEl) return;

    this._beforeUnload = (event) => {
      if (!formEl.formStore || !formEl.formStore.dirty.peek()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', this._beforeUnload);
  }

  async _handleSubmit(event) {
    event.stopPropagation();

    const dataProvider = getDataProvider();
    if (!dataProvider || typeof dataProvider.update !== 'function') {
      diagnostics.error('provider-method-missing', {
        method: 'update',
        resource: this._resource,
        operation: 'update',
      });
      return;
    }

    let data = event.detail.values;
    if (this._sanitizeEmptyValues) {
      data = Object.fromEntries(Object.entries(data).filter(([, value]) => value !== ''));
    }
    if (typeof this._descriptor.transform === 'function') {
      data = await this._descriptor.transform(data, { previousData: this.record });
    }

    const result = await dataProvider.update(this._resource, {
      id: this._id,
      data,
      previousData: this.record,
    });
    this.record = (result && result.data) || this.record;

    this._redirect();
  }

  _redirect() {
    const redirect = this._descriptor.redirect !== undefined ? this._descriptor.redirect : 'list';
    if (redirect === false) return;

    if (typeof redirect === 'function') {
      navigate(redirect(this._resource, this._id, this.record));
      return;
    }

    if (redirect === 'edit') navigate(`#/${this._resource}/${this._id}`);
    else if (redirect === 'show') navigate(`#/${this._resource}/${this._id}/show`);
    else navigate(`#/${this._resource}`);
  }
}

if (!customElements.get('sa-edit')) customElements.define('sa-edit', SaEdit);

export default SaEdit;
