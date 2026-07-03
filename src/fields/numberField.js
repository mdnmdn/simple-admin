// SaNumberField — locale-aware number formatting via Intl.NumberFormat (doc 10 §10.1).
import { BaseField } from './baseField.js';
import { registerField } from '../core/registry.js';

export class SaNumberField extends BaseField(HTMLElement) {
  static get observedAttributes() {
    return [...super.observedAttributes, 'options'];
  }

  // `options` is JSON-parsed by core/descriptor.js (it's in JSON_ATTRS) into Intl.NumberFormat options.
  get options() {
    return this._descriptor.options || undefined;
  }

  renderValue(value) {
    this.classList.add('sa-field', 'sa-field--number');
    const n = Number(value);
    this.textContent = Number.isNaN(n)
      ? String(value)
      : new Intl.NumberFormat(undefined, this.options).format(n);
  }
}

registerField('number', SaNumberField);

export default SaNumberField;
