// SaSearchInput — `<input type="search">` w/ an icon hook; meant for filter bars (doc 10 §10.2).
// `always-on` is a plain descriptor flag read by <sa-filters>, not by this input (doc 13 §4.1).
import { BaseInput } from './baseInput.js';
import { registerInput } from '../core/registry.js';

export class SaSearchInput extends BaseInput(HTMLElement) {
  static get observedAttributes() {
    return [...super.observedAttributes, 'always-on'];
  }

  renderControl() {
    this.classList.add('sa-input', 'sa-search-input');
    this.setAttribute('data-sa-part', 'input');
    this.innerHTML = `
      <label class="sa-input__label"></label>
      <span class="sa-search-input__wrap">
        <span class="sa-search-input__icon" aria-hidden="true">&#128269;</span>
        <input class="sa-input__control" type="search" />
      </span>
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

registerInput('search', SaSearchInput);

export default SaSearchInput;
