// SaDateField — locale-aware date/time formatting via Intl.DateTimeFormat (doc 10 §10.1).
import { BaseField } from './baseField.js';
import { registerField } from '../core/registry.js';

export class SaDateField extends BaseField(HTMLElement) {
  static get observedAttributes() {
    return [...super.observedAttributes, 'options', 'show-time'];
  }

  // `options` is JSON-parsed by core/descriptor.js into Intl.DateTimeFormat options.
  get options() {
    return this._descriptor.options || undefined;
  }
  get showTime() {
    return !!this._descriptor.showTime;
  }

  renderValue(value) {
    this.classList.add('sa-field', 'sa-field--date');
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      this.textContent = String(value);
      return;
    }
    const options =
      this.options || (this.showTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' });
    this.textContent = new Intl.DateTimeFormat(undefined, options).format(date);
  }
}

registerField('date', SaDateField);

export default SaDateField;
