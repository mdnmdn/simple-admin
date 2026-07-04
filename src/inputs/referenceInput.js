// SaReferenceInput — single foreign-key picker (doc 10 §9.5, doc 06 §4.4). Unlike every other
// input, `sa-reference-input` is itself the FormStore-registered element (see the DECISION
// comment in referenceShared.js): a declared/default choice-input child is patched into a
// rendering-only delegate via patchChildAsDelegate() so only ONE registration exists per
// `source`. Data flow: dataProvider.getList() for the browsable choice set, plus a batched
// getMany() (referenceShared.batcherFor) to hydrate the currently-selected value's label even if
// it isn't on the first page of choices.
import { BaseInput } from './baseInput.js';
import { registerInput, hasResource, getDataProvider } from '../core/registry.js';
import { batcherFor, patchChildAsDelegate } from './referenceShared.js';
import * as diagnostics from '../core/diagnostics.js';

const DEFAULT_CHILD_TAG = 'sa-autocomplete-input';

export class SaReferenceInput extends BaseInput(HTMLElement) {
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

  connectedCallback() {
    // Capture (and detach) a declared child selector BEFORE super.connectedCallback() runs,
    // because renderControl() below rebuilds this element's innerHTML — which would otherwise
    // destroy the declared child before we ever get a chance to look at it.
    if (!this._child) {
      const declared = this.querySelector(':scope > sa-select-input, :scope > sa-autocomplete-input');
      if (declared) declared.remove();
      this._child = declared || document.createElement(DEFAULT_CHILD_TAG);
      patchChildAsDelegate(this._child, this);
    }

    super.connectedCallback(); // registers `source` with the FormStore, calls renderControl().

    if (!this._form) return; // baseInput already warned/bailed (missing source or no form host)
    this._setup();
  }

  renderControl() {
    this.classList.add('sa-input', 'sa-reference-input');
    this.setAttribute('data-sa-part', 'input');
    this.innerHTML = `
      <label class="sa-input__label"></label>
      <div class="sa-input__control"></div>
      <span class="sa-input__helper"></span>
      <span class="sa-input__error" role="alert"></span>`;
    this.querySelector('.sa-input__label').textContent = this.label;
  }

  // The nested child renders its own (empty, unused) .sa-input__error/.sa-input__helper spans —
  // scope to a direct child so we never clobber the child's, or vice versa.
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
          `[simple-admin] <sa-reference-input reference="${this.reference}"> in resource ` +
          `"${this._resourceName() || '?'}" points to resource "${this.reference}", which is not ` +
          `declared in <sa-admin>. Declare <sa-resource name="${this.reference}"> (even with no ` +
          `views) so its records can be fetched. Rendering the raw id for now.`,
      });
      this._fallback = true;
      wrap.innerHTML = '';
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'sa-reference-input__fallback';
      input.disabled = true;
      const value = this._form.getField(this.source);
      input.value = value == null ? '' : String(value);
      wrap.appendChild(input);
      return;
    }

    this._fallback = false;
    this._child._descriptor.optionValue = 'id'; // forced per doc 06 §5 when nested in a reference input
    this._child._descriptor.translateChoice = false;
    wrap.appendChild(this._child);
    // Build the delegate's control explicitly. patchChildAsDelegate() overrides the child's
    // connectedCallback with an INSTANCE own property, but a real browser dispatches custom-element
    // lifecycle reactions from the PROTOTYPE method captured at define() time — so on append the
    // browser runs BaseInput.connectedCallback (which no-ops for a sourceless delegate), NOT the
    // patched override, and the control would otherwise never render. (jsdom resolves the callback
    // dynamically, which is why this only broke in a real browser.)
    this._child.renderControl();

    // Best-effort immediate display (raw id) while choices/hydration are in flight.
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
    if (current && !choices.some((c) => String(c.id) === String(current.id))) {
      choices = [...choices, current];
    }
    this._child.choices = choices;

    // Refresh the child's display now that choices (and thus labels) are known.
    this.updateControl(this.format(this._form.getField(this.source)));
  }

  async _hydrateCurrent(dataProvider) {
    const id = this._form.getField(this.source);
    if (id == null) return null;
    const batcher = batcherFor(dataProvider);
    if (!batcher) return null;
    const records = await batcher.getMany(this.reference, [id]);
    return records[0] || null;
  }

  updateControl(value) {
    if (this._fallback) {
      const input = this.querySelector('.sa-reference-input__fallback');
      if (input) input.value = value == null ? '' : String(value);
      return;
    }
    if (this._child && typeof this._child.updateControl === 'function') {
      this._child.updateControl(value);
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._fetchToken++; // invalidate any in-flight fetch
  }

  _resourceName() {
    const resourceEl = this.closest('sa-resource');
    return (
      (resourceEl && (resourceEl.__resourceContext?.name || resourceEl.getAttribute?.('name'))) ||
      undefined
    );
  }
}

registerInput('reference', SaReferenceInput);

export default SaReferenceInput;
