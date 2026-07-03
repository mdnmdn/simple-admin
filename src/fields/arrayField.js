// SaArrayField — wraps an array-valued `source` and renders its light-DOM field-template
// children once per array item (doc 10 §10.1, doc 06 §2 "Collections"). Unlike the reference
// fields, this is purely local: no fetching, just re-publishing a per-item RecordContext.
// Per react-admin, "empty" is just an empty list — `emptyText` is not applied here.
import { BaseField } from './baseField.js';
import { registerField } from '../core/registry.js';

export class SaArrayField extends BaseField(HTMLElement) {
  constructor() {
    super();
    this._templateChildren = null; // captured once, on first connect
  }

  connectedCallback() {
    if (!this._templateChildren) {
      this._templateChildren = [...this.children];
      for (const child of this._templateChildren) child.remove();
    }
    super.connectedCallback();
  }

  renderValue(value) {
    this.classList.add('sa-field', 'sa-field--array');
    const items = Array.isArray(value) ? value : [value];

    this.textContent = '';
    for (const item of items) {
      const row = document.createElement('sa-array-field-row');
      row.className = 'sa-field__row';
      row.__recordContext = { record: item };
      for (const child of this._templateChildren) row.appendChild(child.cloneNode(true));
      this.appendChild(row);
    }
  }

  renderEmpty() {
    this.classList.add('sa-field', 'sa-field--array');
    this.textContent = '';
  }
}

registerField('array', SaArrayField);

export default SaArrayField;
