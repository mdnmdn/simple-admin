// SaReferenceArrayInput — multi foreign-key picker (doc 10 §9.5, doc 06 §4.5). Same
// single-registration/delegate-child design as SaReferenceInput (see referenceShared.js), but
// `source` holds an array of ids. Data flow: dataProvider.getList() for the browsable choice
// set, plus a batched getMany() (referenceShared.batcherFor) for the currently-selected ids so
// they render correctly even if absent from the first page of choices.
import { BaseInput } from './baseInput.js';
import { registerInput, hasResource, getDataProvider } from '../core/registry.js';
import { batcherFor, patchChildAsDelegate } from './referenceShared.js';
import * as diagnostics from '../core/diagnostics.js';

const DEFAULT_CHILD_TAG = 'sa-autocomplete-array-input';
const CHILD_SELECTOR =
  ':scope > sa-select-array-input, :scope > sa-autocomplete-array-input, :scope > sa-checkbox-group-input';

export class SaReferenceArrayInput extends BaseInput(HTMLElement) {
  static get observedAttributes() {
    return [...super.observedAttributes, 'reference', 'filter', 'sort', 'per-page'];
  }

  constructor() {
    super();
    this._child = null;
    this._fallback = false;
    this._fetchToken = 0;
  }

  get reference() {
    return this._descriptor.reference;
  }

  // Value is always an array on the store side, never the `?? ''` scalar default.
  format(storeValue) {
    return Array.isArray(storeValue) ? storeValue : [];
  }
  parse(controlValue) {
    return Array.isArray(controlValue) ? controlValue : [];
  }

  connectedCallback() {
    // See SaReferenceInput: capture/detach the declared child before super.connectedCallback()
    // rebuilds this element's innerHTML in renderControl().
    if (!this._child) {
      const declared = this.querySelector(CHILD_SELECTOR);
      if (declared) declared.remove();
      this._child = declared || document.createElement(DEFAULT_CHILD_TAG);
      patchChildAsDelegate(this._child, this);
    }

    super.connectedCallback();

    if (!this._form) return;
    this._setup();
  }

  renderControl() {
    this.classList.add('sa-input', 'sa-reference-array-input');
    this.setAttribute('data-sa-part', 'input');
    this.innerHTML = `
      <label class="sa-input__label"></label>
      <div class="sa-input__control"></div>
      <span class="sa-input__helper"></span>
      <span class="sa-input__error" role="alert"></span>`;
    this.querySelector('.sa-input__label').textContent = this.label;
  }

  renderError(message) {
    const node = this.querySelector(':scope > .sa-input__error');
    if (node) node.textContent = message || '';
  }
  renderHelper(text) {
    const node = this.querySelector(':scope > .sa-input__helper');
    if (node) node.textContent = text || '';
  }

  _setup() {
    const wrap = this.querySelector('.sa-input__control');

    if (!hasResource(this.reference)) {
      diagnostics.warn('reference-undeclared', {
        reference: this.reference,
        resource: this._resourceName(),
        message:
          `[simple-admin] <sa-reference-array-input reference="${this.reference}"> in resource ` +
          `"${this._resourceName() || '?'}" points to resource "${this.reference}", which is not ` +
          `declared in <sa-admin>. Declare <sa-resource name="${this.reference}"> (even with no ` +
          `views) so its records can be fetched. Rendering the raw ids for now.`,
      });
      this._fallback = true;
      wrap.innerHTML = '';
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'sa-reference-array-input__fallback';
      input.disabled = true;
      const value = this.format(this._form.getField(this.source));
      input.value = value.join(', ');
      wrap.appendChild(input);
      return;
    }

    this._fallback = false;
    this._child._descriptor.optionValue = 'id';
    this._child._descriptor.translateChoice = false;
    wrap.appendChild(this._child);

    this.updateControl(this.format(this._form.getField(this.source)));

    this._loadChoices();
  }

  async _loadChoices() {
    const dataProvider = getDataProvider();
    if (!dataProvider) return;

    const token = ++this._fetchToken;
    const perPage = this._descriptor.perPage || 25;
    const sort = this._descriptor.sort || { field: 'id', order: 'ASC' };
    const filter = this._descriptor.filter || {};

    const [listResult, current] = await Promise.all([
      dataProvider.getList(this.reference, { pagination: { page: 1, perPage }, sort, filter }),
      this._hydrateCurrent(dataProvider),
    ]);
    if (token !== this._fetchToken || !this.isConnected) return;

    let choices = listResult.data || [];
    const known = new Set(choices.map((c) => String(c.id)));
    for (const record of current) {
      if (!known.has(String(record.id))) {
        choices = [...choices, record];
        known.add(String(record.id));
      }
    }
    this._child.choices = choices;

    this.updateControl(this.format(this._form.getField(this.source)));
  }

  async _hydrateCurrent(dataProvider) {
    const ids = this.format(this._form.getField(this.source));
    if (!ids.length) return [];
    const batcher = batcherFor(dataProvider);
    if (!batcher) return [];
    return batcher.getMany(this.reference, ids);
  }

  updateControl(value) {
    const arr = Array.isArray(value) ? value : [];
    if (this._fallback) {
      const input = this.querySelector('.sa-reference-array-input__fallback');
      if (input) input.value = arr.join(', ');
      return;
    }
    if (this._child && typeof this._child.updateControl === 'function') {
      this._child.updateControl(arr);
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._fetchToken++;
  }

  _resourceName() {
    const resourceEl = this.closest('sa-resource');
    return (
      (resourceEl && (resourceEl.__resourceContext?.name || resourceEl.getAttribute?.('name'))) ||
      undefined
    );
  }
}

registerInput('referenceArray', SaReferenceArrayInput);

export default SaReferenceArrayInput;
