// SaTextField — the default fallback field (doc 10 §10.1). Renders `source` as plain text.
import { BaseField } from './baseField.js';
import { registerField } from '../core/registry.js';

export class SaTextField extends BaseField(HTMLElement) {
  renderValue(value) {
    this.classList.add('sa-field', 'sa-field--text');
    this.textContent = String(value);
  }
}

registerField('text', SaTextField);

export default SaTextField;
