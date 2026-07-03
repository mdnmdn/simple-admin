// SaSimpleForm — single-column list-of-inputs form container (architecture §9, doc 05 §2).
//
// Owns the FormStore (doc 10 §9.2) and publishes it on `this.formStore` so that `sa-*-input`
// children (BaseInput) can find it via `this.closest('sa-simple-form, sa-tabbed-form, sa-filters')`
// unmodified. Renders its light-DOM `sa-*-input` children as-is; they self-register in their own
// connectedCallback. Auto-injects a `<sa-form-toolbar>` if none is declared.
//
// ---- <sa-create>/<sa-edit> <-> <sa-simple-form> contract ----
// In:  `.resource` / `.record` are plain properties assigned directly by the record host
//      (create.js / edit.js), e.g. `formEl.resource = 'posts'; formEl.record = {...}`.
//      Because custom-element upgrade/connection ordering between a parent (<sa-create>/
//      <sa-edit>) and a light-DOM child like this one is not guaranteed by the platform (it
//      depends on how the subtree was built — streamed HTML parse vs. built-then-appended), both
//      properties are implemented as real accessors plus the `_upgradeProperty` shim below, so
//      setting them before OR after this element's connectedCallback has already run works: a
//      pre-connect assignment is picked up when connectedCallback runs; a post-connect
//      (re-)assignment of `.record` re-seeds the already-built FormStore via `formStore.reset()`.
// Out: `.save()` — validates (formStore.validateAll()) and, if valid, dispatches a bubbling,
//      composed `'sa-submit'` CustomEvent with `detail: { values, resource, record }`. The nearest
//      `<sa-create>`/`<sa-edit>` ancestor listens for this event to perform the actual
//      dataProvider.create/update + transform + redirect. `<sa-save-button>`/`<sa-form-toolbar>`
//      call `.save()` on the nearest form host — they never touch the dataProvider directly.
//
// Ordering assumption: `connectedCallback` below builds `this.formStore` as the very first thing
// it does (before any other work), so that for the common case — this element's `sa-*-input`
// children are declared in markup and connect *after* their parent per the custom-element
// insertion algorithm (pre-order: parent's connectedCallback runs, then children's) — the
// FormStore is guaranteed to exist by the time any child input looks for it.

import { createFormController } from '../core/store.js';
import { getDataProvider } from '../core/registry.js';
import { descriptorFromElement } from '../core/descriptor.js';
import { findResourceContext } from '../core/context.js';
import * as diagnostics from '../core/diagnostics.js';
import './toolbar.js';

// Moves a plain own-property (set on the element before it was upgraded/before this accessor
// existed) over to the prototype accessor, so later reads/writes go through get/set.
const upgradeProperty = (el, prop) => {
  if (Object.prototype.hasOwnProperty.call(el, prop)) {
    const value = el[prop];
    delete el[prop];
    el[prop] = value;
  }
};

export class SaSimpleForm extends HTMLElement {
  constructor() {
    super();
    this._resource = null;
    this._record = null;
    this.formStore = null;
  }

  get resource() {
    return this._resource;
  }
  set resource(value) {
    this._resource = value;
  }

  get record() {
    return this._record;
  }
  set record(value) {
    this._record = value;
    // Late (re-)assignment after the FormStore already exists: reseed in place rather than
    // rebuilding, so already-registered inputs keep working (matches Edit's async getOne flow).
    if (this.formStore) this.formStore.reset(value);
  }

  connectedCallback() {
    upgradeProperty(this, 'resource');
    upgradeProperty(this, 'record');

    if (!this._resource) {
      const resourceCtx = findResourceContext(this);
      this._resource = (resourceCtx && resourceCtx.name) || this.getAttribute('resource') || null;
    }

    this._descriptor = descriptorFromElement(this, 'view');

    // Build the FormStore first — see the ordering-assumption comment above.
    this.formStore = createFormController(this._descriptor, {
      dataProvider: getDataProvider(),
      record: this._record || {},
    });
    this.__formContext = { formStore: this.formStore, resource: this._resource };

    this._warnMixedValidation();
    this._ensureToolbar();
  }

  // Form-level validate + input-level validate are mutually exclusive (doc 10 §9.3 / react-hook
  // form parity). Detect via the `validate` attribute on descendants rather than the FormStore's
  // private registry, since this runs before those inputs have necessarily connected.
  _warnMixedValidation() {
    if (!this._descriptor.validate) return;
    this.querySelectorAll('[validate]').forEach((el) => {
      diagnostics.warn('validate-both-levels', {
        resource: this._resource,
        tag: el.localName,
        source: el.getAttribute('source'),
      });
    });
  }

  _ensureToolbar() {
    if (this.querySelector('sa-form-toolbar')) return;
    this.appendChild(document.createElement('sa-form-toolbar'));
  }

  // Validates all registered fields; on success dispatches the 'sa-submit' contract event.
  // Returns true/false so callers (SaveButton) can short-circuit on validation failure.
  save() {
    if (!this.formStore.validateAll()) return false;
    this.dispatchEvent(
      new CustomEvent('sa-submit', {
        bubbles: true,
        composed: true,
        detail: {
          values: this.formStore.values.peek(),
          resource: this._resource,
          record: this._record,
        },
      })
    );
    return true;
  }
}

if (!customElements.get('sa-simple-form')) customElements.define('sa-simple-form', SaSimpleForm);

export default SaSimpleForm;
