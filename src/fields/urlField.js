// SaUrlField — renders the value as a clickable <a href> link (doc 10 §10.1).
import { BaseField } from './baseField.js';
import { registerField } from '../core/registry.js';

export class SaUrlField extends BaseField(HTMLElement) {
  renderValue(value) {
    this.classList.add('sa-field', 'sa-field--url');
    this.textContent = '';
    const a = document.createElement('a');
    a.href = String(value);
    a.textContent = String(value);
    this.appendChild(a);
  }
}

registerField('url', SaUrlField);

export default SaUrlField;
