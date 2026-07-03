// SaSelectField — resolves a raw stored value to its `choices` label (doc 10 §10.1, doc 06 §5).
import { BaseField } from './baseField.js';
import { registerField } from '../core/registry.js';

export class SaSelectField extends BaseField(HTMLElement) {
  static get observedAttributes() {
    return [...super.observedAttributes, 'choices', 'option-text', 'option-value'];
  }

  // `choices` is JSON-parsed by core/descriptor.js into an array of { id, name } (or custom-shaped) objects.
  get choices() {
    return this._descriptor.choices || [];
  }
  get optionText() {
    return this._descriptor.optionText || 'name';
  }
  get optionValue() {
    return this._descriptor.optionValue || 'id';
  }

  _labelFor(choice) {
    return typeof this.optionText === 'function' ? this.optionText(choice) : choice[this.optionText];
  }

  renderValue(value) {
    this.classList.add('sa-field', 'sa-field--select');
    const match = this.choices.find((choice) => choice && choice[this.optionValue] === value);
    this.textContent = match ? String(this._labelFor(match)) : String(value);
  }
}

registerField('select', SaSelectField);

export default SaSelectField;
