// SaBooleanField — renders a check/cross glyph, or custom `true-text`/`false-text` (doc 10 §10.1).
import { BaseField } from './baseField.js';
import { registerField } from '../core/registry.js';

export class SaBooleanField extends BaseField(HTMLElement) {
  static get observedAttributes() {
    return [...super.observedAttributes, 'true-text', 'false-text'];
  }

  get trueText() {
    return this._descriptor.trueText;
  }
  get falseText() {
    return this._descriptor.falseText;
  }

  renderValue(value) {
    this.classList.add('sa-field', 'sa-field--boolean');
    const isTrue = !!value;
    this.textContent = isTrue
      ? this.trueText != null ? this.trueText : '✓'
      : this.falseText != null ? this.falseText : '✗';
    this.setAttribute('aria-label', String(isTrue));
  }
}

registerField('boolean', SaBooleanField);

export default SaBooleanField;
