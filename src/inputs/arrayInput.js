// SaArrayInput + SaFormIterator — repeatable object rows over an array-valued `source` (doc 10
// §9.6/§10.2, doc 06 §2 "Collections"). `<sa-form-iterator>` declares the row "shape" as a
// light-DOM template of input elements (e.g. `<sa-text-input source="name">`); one row is
// rendered per array item, each a `cloneNode(true)` of the template inputs with `source`
// rewritten to be array-index-scoped (`items.2.name`), which core/util.js's getByPath/setByPath
// resolve like any other dot-path (numeric segments index into arrays fine, see setByPath).
//
// Unlike reference inputs, row inputs are NOT delegates: each clone is a real, independently
// registered BaseInput bound straight to its own `items.<i>.<field>` path on the SAME FormStore,
// so editing a row commits directly without SaArrayInput being in the loop. SaArrayInput itself
// only (a) owns the add/remove buttons, which push/splice the array via `this._form.setField`,
// and (b) re-renders the row DOM when the array LENGTH changes (a full re-render on every value
// change would tear down/rebuild every row — and steal focus — on every keystroke inside any
// row, since this simple FormStore has one values signal shared by every registered input).
import { BaseInput } from './baseInput.js';
import { registerInput } from '../core/registry.js';

export class SaFormIterator extends HTMLElement {}
if (typeof customElements !== 'undefined' && !customElements.get('sa-form-iterator')) {
  customElements.define('sa-form-iterator', SaFormIterator);
}

export class SaArrayInput extends BaseInput(HTMLElement) {
  constructor() {
    super();
    this._templateChildren = null; // captured once, on first connect
    this._rows = null;
    this._lastLength = -1;
  }

  format(storeValue) {
    return Array.isArray(storeValue) ? storeValue : [];
  }
  parse(controlValue) {
    return Array.isArray(controlValue) ? controlValue : [];
  }

  connectedCallback() {
    // Capture (and detach) the <sa-form-iterator> template's child inputs BEFORE
    // super.connectedCallback() rebuilds this element's innerHTML in renderControl() — otherwise
    // the template markup would be destroyed before we ever get to read it.
    if (!this._templateChildren) {
      const iterator = this.querySelector(':scope > sa-form-iterator');
      this._templateChildren = iterator ? [...iterator.children] : [...this.children];
      for (const child of this._templateChildren) child.remove();
      if (iterator) iterator.remove();
    }
    super.connectedCallback();
  }

  renderControl() {
    this.classList.add('sa-input', 'sa-array-input');
    this.setAttribute('data-sa-part', 'input');
    this.innerHTML = `
      <label class="sa-input__label"></label>
      <div class="sa-input__control">
        <div class="sa-array-input__rows"></div>
        <button type="button" class="sa-btn sa-array-input__add">Add</button>
      </div>
      <span class="sa-input__helper"></span>
      <span class="sa-input__error" role="alert"></span>`;

    this.querySelector('.sa-input__label').textContent = this.label;
    this._rows = this.querySelector('.sa-array-input__rows');
    this._addBtn = this.querySelector('.sa-array-input__add');
    this._addBtn.disabled = this.disabled || this.readOnly;
    this._addBtn.addEventListener('click', () => this._addRow());
    this._lastLength = -1; // force the next updateControl() to (re)build rows
  }

  // Row inputs render their own (unused, empty) .sa-input__error/.sa-input__helper — scope to a
  // direct child so we never clobber a nested row input's error/helper display, or vice versa.
  renderError(message) {
    const node = this.querySelector(':scope > .sa-input__error');
    if (node) node.textContent = message || '';
  }
  renderHelper(text) {
    const node = this.querySelector(':scope > .sa-input__helper');
    if (node) node.textContent = text || '';
  }

  updateControl(value) {
    if (!this._rows) return;
    const arr = Array.isArray(value) ? value : [];
    if (arr.length === this._lastLength) return; // same length: leave in-progress row edits alone
    this._renderRows(arr);
  }

  _renderRows(arr) {
    this._lastLength = arr.length;
    this._rows.textContent = '';
    arr.forEach((_, index) => this._rows.appendChild(this._buildRow(index)));
  }

  _buildRow(index) {
    const row = document.createElement('div');
    row.className = 'sa-array-input__row';

    const fields = document.createElement('div');
    fields.className = 'sa-array-input__row-fields';
    for (const template of this._templateChildren) {
      const clone = template.cloneNode(true);
      const childSource = template.getAttribute('source');
      if (childSource) clone.setAttribute('source', `${this.source}.${index}.${childSource}`);
      fields.appendChild(clone);
    }
    row.appendChild(fields);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'sa-btn sa-array-input__remove';
    removeBtn.textContent = 'Remove';
    removeBtn.disabled = this.disabled || this.readOnly;
    removeBtn.addEventListener('click', () => this._removeRow(index));
    row.appendChild(removeBtn);

    return row;
  }

  _currentArray() {
    return this.format(this._form.getField(this.source));
  }

  _addRow() {
    if (!this._form) return;
    this._form.setField(this.source, [...this._currentArray(), {}]);
  }

  _removeRow(index) {
    if (!this._form) return;
    this._form.setField(
      this.source,
      this._currentArray().filter((_, i) => i !== index)
    );
  }
}

registerInput('array', SaArrayInput);

export default SaArrayInput;
