// SaBooleanInput — `<input type="checkbox">` (doc 10 §10.2).
import { BaseInput } from './baseInput.js';
import { registerInput } from '../core/registry.js';

export class SaBooleanInput extends BaseInput(HTMLElement) {
  renderControl() {
    this.classList.add('sa-input', 'sa-boolean-input');
    this.setAttribute('data-sa-part', 'input');
    this.innerHTML = `
      <label class="sa-input__label sa-boolean-input__label">
        <input class="sa-input__control" type="checkbox" />
        <span class="sa-boolean-input__label-text"></span>
      </label>
      <span class="sa-input__helper"></span>
      <span class="sa-input__error" role="alert"></span>`;

    this._control = this.querySelector('.sa-input__control');
    this.querySelector('.sa-boolean-input__label-text').textContent = this.label;
    this._control.disabled = this.disabled;
    if (this.readOnly) this._control.setAttribute('disabled', ''); // checkboxes have no readonly

    this._control.addEventListener('change', () => this.commit(this._control.checked));
    this._control.addEventListener('blur', () => this.markTouched());
  }

  format(storeValue) {
    return !!storeValue;
  }
  parse(controlValue) {
    return !!controlValue;
  }

  updateControl(value) {
    if (this._control) this._control.checked = !!value;
  }
}

registerInput('boolean', SaBooleanInput);

export default SaBooleanInput;
