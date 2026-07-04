// SaTabbedForm / SaFormTab — grouped-tabs form container (architecture §9, doc 05 §2).
//
// Same FormStore wiring, `.save()` method, and `.resource`/`.record` property contract as
// SaSimpleForm (see simpleForm.js for the full contract doc — not repeated here). Light-DOM
// children are `<sa-form-tab label="...">` wrappers, each containing its own `sa-*-input`
// children; only the active tab's panel is visible. A tab is flagged (data-sa-error) whenever any
// input inside it currently has a validation error, mirroring react-admin's TabbedForm behavior.

import { createFormController } from '../core/store.js';
import { effect } from '../core/signal.js';
import { getDataProvider } from '../core/registry.js';
import { descriptorFromElement } from '../core/descriptor.js';
import { findResourceContext } from '../core/context.js';
import * as diagnostics from '../core/diagnostics.js';
import './toolbar.js';

const upgradeProperty = (el, prop) => {
  if (Object.prototype.hasOwnProperty.call(el, prop)) {
    const value = el[prop];
    delete el[prop];
    el[prop] = value;
  }
};

export class SaFormTab extends HTMLElement {
  connectedCallback() {
    this.classList.add('sa-tabbed-form__panel');
    this.setAttribute('data-sa-part', 'tab-panel');
  }

  get label() {
    return this.getAttribute('label') || '';
  }
}

export class SaTabbedForm extends HTMLElement {
  constructor() {
    super();
    this._resource = null;
    this._record = null;
    this.formStore = null;
    this._activeIndex = 0;
    this._disposeErrors = null;
    this._tabs = [];
    this._tabButtons = [];
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

    // ONE FormStore per element, created lazily and kept across reconnects (same staleness
    // rationale as <sa-filters>'s stable store): custom-element reaction batches during boot can
    // interleave so a child input's last (re)connect — which caches `this._form` and registers
    // its validators — lands between two of THIS element's reconnects. A fresh store per connect
    // would strand those inputs on the previous store: their edits and registered validators
    // would be invisible to save()/validateAll(). Per-mount record state is handled by the
    // `record` setter calling formStore.reset(), not by rebuilding the store.
    if (!this.formStore) {
      this.formStore = createFormController(this._descriptor, {
        dataProvider: getDataProvider(),
        record: this._record || {},
      });
    } else {
      this.formStore.reset(this._record || {});
    }
    this.__formContext = { formStore: this.formStore, resource: this._resource };

    this._warnMixedValidation();
    // _buildTabStrip() inserts a new tab-strip <div> unconditionally and is not safe to re-run:
    // like <sa-datagrid>'s table, the strip persists across a disconnect/reconnect (see the
    // matching comment in datagrid.js), so re-running it on reconnect would insert a second,
    // duplicate strip alongside the first instead of replacing it.
    if (!this._domBuilt) {
      this._domBuilt = true;
      this._buildTabStrip();
    }
    this._ensureToolbar();

    this._disposeErrors = effect(() => this._updateTabIndicators());
  }

  disconnectedCallback() {
    if (this._disposeErrors) this._disposeErrors();
    this._disposeErrors = null;
  }

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

  _buildTabStrip() {
    const tabs = Array.from(this.children).filter((el) => el.localName === 'sa-form-tab');
    const strip = document.createElement('div');
    strip.className = 'sa-tabbed-form__tabstrip';
    strip.setAttribute('data-sa-part', 'tab-strip');

    const buttons = tabs.map((tab, index) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sa-tabbed-form__tab';
      btn.setAttribute('data-sa-part', 'tab');
      btn.textContent = tab.label || `Tab ${index + 1}`;
      btn.addEventListener('click', () => this._setActive(index));
      strip.appendChild(btn);
      return btn;
    });

    this._tabs = tabs;
    this._tabButtons = buttons;
    this.insertBefore(strip, this.firstChild);
    this._setActive(this._activeIndex);
  }

  _setActive(index) {
    this._activeIndex = index;
    this._tabs.forEach((tab, i) => {
      tab.hidden = i !== index;
    });
    this._tabButtons.forEach((btn, i) => {
      btn.classList.toggle('sa-tabbed-form__tab--active', i === index);
      btn.setAttribute('aria-selected', i === index ? 'true' : 'false');
    });
  }

  _updateTabIndicators() {
    const errorSources = new Set(Object.keys(this.formStore.errors.get()));
    this._tabs.forEach((tab, i) => {
      const hasError = Array.from(tab.querySelectorAll('[source]')).some((el) =>
        errorSources.has(el.getAttribute('source'))
      );
      const btn = this._tabButtons[i];
      if (!btn) return;
      btn.classList.toggle('sa-tabbed-form__tab--error', hasError);
      btn.setAttribute('data-sa-error', hasError ? 'true' : 'false');
    });
  }

  _ensureToolbar() {
    if (this.querySelector('sa-form-toolbar')) return;
    this.appendChild(document.createElement('sa-form-toolbar'));
  }

  // See simpleForm.js for the full 'sa-submit' contract doc.
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

if (!customElements.get('sa-form-tab')) customElements.define('sa-form-tab', SaFormTab);
if (!customElements.get('sa-tabbed-form')) customElements.define('sa-tabbed-form', SaTabbedForm);

export default SaTabbedForm;
