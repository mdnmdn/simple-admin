// SaArrayField — wraps an array-valued `source` and renders its light-DOM field-template
// children once per array item (doc 10 §10.1, doc 06 §2 "Collections"). Unlike the reference
// fields, this is purely local: no fetching, just re-publishing a per-item RecordContext.
// Per react-admin, "empty" is just an empty list — `emptyText` is not applied here.
import { BaseField } from './baseField.js';
import { registerField } from '../core/registry.js';
import {
  captureChildTemplates,
  buildChildTemplates,
} from './templateChildren.js';

export class SaArrayField extends BaseField(HTMLElement) {
  connectedCallback() {
    // Snapshot child templates into `_descriptor.children` so they survive <sa-datagrid>'s per-row
    // clone — see templateChildren.js.
    captureChildTemplates(this);
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
      for (const child of buildChildTemplates(this)) row.appendChild(child);
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
