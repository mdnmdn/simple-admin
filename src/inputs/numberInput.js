// SaNumberInput — `<input type="number">` with step/min/max; parse() converts string -> Number
// (doc 10 §10.2).
import { BaseInput } from './baseInput.js';
import { registerInput } from '../core/registry.js';

export class SaNumberInput extends BaseInput(HTMLElement) {
  static get observedAttributes() {
    return [...super.observedAttributes, 'step', 'min', 'max'];
  }

  get step() {
    return this._descriptor.step;
  }
  get min() {
    return this._descriptor.min;
  }
  get max() {
    return this._descriptor.max;
  }

  renderControl() {
    this.classList.add('sa-input', 'sa-number-input');
    this.setAttribute('data-sa-part', 'input');
    this.innerHTML = `
      <label class="sa-input__label"></label>
      <input class="sa-input__control" type="number" />
      <span class="sa-input__helper"></span>
      <span class="sa-input__error" role="alert"></span>`;

    this._control = this.querySelector('.sa-input__control');
    this.querySelector('.sa-input__label').textContent = this.label;
    if (this.step != null) this._control.step = this.step;
    if (this.min != null) this._control.min = this.min;
    if (this.max != null) this._control.max = this.max;

    this._control.disabled = this.disabled;
    if (this.readOnly) this._control.setAttribute('readonly', '');

    this._control.addEventListener('input', () => this.commit(this._control.value));
    this._control.addEventListener('blur', () => this.markTouched());
  }

  // Store value is a Number (or undefined); the control always deals in strings.
  parse(controlValue) {
    if (controlValue === '' || controlValue == null) return undefined;
    const n = Number(controlValue);
    return Number.isNaN(n) ? controlValue : n;
  }
  format(storeValue) {
    return storeValue == null ? '' : String(storeValue);
  }

  updateControl(value) {
    if (this._control && this._control.value !== value) this._control.value = value;
  }
}

registerInput('number', SaNumberInput);

export default SaNumberInput;
