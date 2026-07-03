// SaTextInput — `<input type="text">`, or `<textarea>` when `multiline` is present (doc 10 §10.2).
import { BaseInput } from './baseInput.js';
import { registerInput } from '../core/registry.js';

export class SaTextInput extends BaseInput(HTMLElement) {
  static get observedAttributes() {
    return [...super.observedAttributes, 'multiline'];
  }

  get multiline() {
    return !!this._descriptor.multiline;
  }

  renderControl() {
    this.classList.add('sa-input', 'sa-text-input');
    this.setAttribute('data-sa-part', 'input');
    this.innerHTML = `
      <label class="sa-input__label"></label>
      <span class="sa-text-input__control-slot"></span>
      <span class="sa-input__helper"></span>
      <span class="sa-input__error" role="alert"></span>`;
    this.querySelector('.sa-input__label').textContent = this.label;

    this._control = document.createElement(this.multiline ? 'textarea' : 'input');
    this._control.className = 'sa-input__control';
    if (!this.multiline) this._control.type = 'text';
    this.querySelector('.sa-text-input__control-slot').replaceWith(this._control);

    this._control.disabled = this.disabled;
    if (this.readOnly) this._control.setAttribute('readonly', '');

    this._control.addEventListener('input', () => this.commit(this._control.value));
    this._control.addEventListener('blur', () => this.markTouched());
  }

  updateControl(value) {
    if (this._control && this._control.value !== value) this._control.value = value ?? '';
  }
}

registerInput('text', SaTextInput);

export default SaTextInput;
