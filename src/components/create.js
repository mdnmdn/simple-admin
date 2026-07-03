// SaCreate — page-level controller for a "new record" form (doc 05 §1, architecture §9.1).
//
// Publishes a FRESH empty record context (no fetch): `this.__recordContext = { record: {} }`
// (SaCreate is one of the RECORD_HOST_TAGS in core/context.js, so nested show-style fields could
// read it too, though the common case is its light-DOM child form). Configures its light-DOM
// `<sa-simple-form>`/`<sa-tabbed-form>` child by property assignment — see the contract doc below.
//
// ---- <sa-create> <-> <sa-simple-form>/<sa-tabbed-form> event contract ----
// Out (Create -> form): `formEl.resource = 'posts'; formEl.record = {}` — plain property
//   assignment, done in `_configureForm()` (with a queueMicrotask fallback for the case where the
//   form child hasn't been parsed/inserted into the light DOM yet when this connectedCallback
//   runs — e.g. plain streamed HTML parsing, as opposed to a subtree built off-document and
//   appended in one shot). See simpleForm.js for why setting these properties is safe regardless
//   of upgrade ordering.
// In (form -> Create): a bubbling, composed `'sa-submit'` CustomEvent, `detail: { values }`,
//   dispatched by the form's `.save()`. SaCreate listens for it on itself, applies the view
//   descriptor's `transform` (if any), calls `dataProvider.create(resource, { data })`, then
//   navigates per the `redirect` attribute (`'list'|'edit'|'show'|false`, default `'list'`).

import { getDataProvider } from '../core/registry.js';
import { navigate } from '../core/router.js';
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

export class SaCreate extends HTMLElement {
  constructor() {
    super();
    this._resource = null;
    this.record = {};
  }

  get resource() {
    return this._resource;
  }
  set resource(value) {
    this._resource = value;
  }

  connectedCallback() {
    upgradeProperty(this, 'resource');

    if (!this._resource) {
      const resourceCtx = findResourceContext(this);
      this._resource = (resourceCtx && resourceCtx.name) || this.getAttribute('resource') || null;
    }

    this._descriptor = descriptorFromElement(this, 'view');
    this.__recordContext = { record: this.record };

    this._onSubmit = (event) => this._handleSubmit(event);
    this.addEventListener('sa-submit', this._onSubmit);

    this._configureForm();
  }

  disconnectedCallback() {
    this.removeEventListener('sa-submit', this._onSubmit);
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

  async _handleSubmit(event) {
    event.stopPropagation();

    const dataProvider = getDataProvider();
    if (!dataProvider || typeof dataProvider.create !== 'function') {
      diagnostics.error('provider-method-missing', {
        method: 'create',
        resource: this._resource,
        operation: 'create',
      });
      return;
    }

    let data = event.detail.values;
    if (typeof this._descriptor.transform === 'function') {
      data = await this._descriptor.transform(data);
    }

    const result = await dataProvider.create(this._resource, { data });
    this._redirect(result && result.data);
  }

  _redirect(created) {
    const redirect = this._descriptor.redirect !== undefined ? this._descriptor.redirect : 'list';
    if (redirect === false) return;

    if (typeof redirect === 'function') {
      navigate(redirect(this._resource, created && created.id, created));
      return;
    }

    const id = created && created.id;
    if (redirect === 'edit' && id != null) navigate(`#/${this._resource}/${id}`);
    else if (redirect === 'show' && id != null) navigate(`#/${this._resource}/${id}/show`);
    else navigate(`#/${this._resource}`);
  }
}

if (!customElements.get('sa-create')) customElements.define('sa-create', SaCreate);

export default SaCreate;
