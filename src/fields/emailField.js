// SaEmailField — wraps the value in a `mailto:` link (doc 10 §10.1).
import { BaseField } from './baseField.js';
import { registerField } from '../core/registry.js';

export class SaEmailField extends BaseField(HTMLElement) {
  renderValue(value) {
    this.classList.add('sa-field', 'sa-field--email');
    this.textContent = '';
    const a = document.createElement('a');
    a.href = `mailto:${value}`;
    a.textContent = String(value);
    this.appendChild(a);
  }
}

registerField('email', SaEmailField);

export default SaEmailField;
