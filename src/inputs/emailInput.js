// SaEmailInput — `<input type="email">`; pair with `validate="email"` for the email() validator
// (doc 10 §10.2).
import { BaseInput } from './baseInput.js';
import { registerInput } from '../core/registry.js';

export class SaEmailInput extends BaseInput(HTMLElement) {
  renderControl() {
    this.classList.add('sa-input', 'sa-email-input');
    this.setAttribute('data-sa-part', 'input');
    this.innerHTML = `
      <label class="sa-input__label"></label>
      <input class="sa-input__control" type="email" />
      <span class="sa-input__helper"></span>
      <span class="sa-input__error" role="alert"></span>`;

    this._control = this.querySelector('.sa-input__control');
    this.querySelector('.sa-input__label').textContent = this.label;
    this._control.disabled = this.disabled;
    if (this.readOnly) this._control.setAttribute('readonly', '');

    this._control.addEventListener('input', () => this.commit(this._control.value));
    this._control.addEventListener('blur', () => this.markTouched());
  }

  updateControl(value) {
    if (this._control && this._control.value !== value) this._control.value = value ?? '';
  }
}

registerInput('email', SaEmailInput);

export default SaEmailInput;
