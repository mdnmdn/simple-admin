// SaSelectArrayInput — `<select multiple>`, value is an array (doc 10 §10.2, doc 06 §5).
import { BaseInput } from './baseInput.js';
import { registerInput } from '../core/registry.js';
import { normalizeChoices, labelFor, valueFor, resolveChoiceValue } from './choiceHelpers.js';

export class SaSelectArrayInput extends BaseInput(HTMLElement) {
  static get observedAttributes() {
    return [...super.observedAttributes, 'choices', 'option-text', 'option-value'];
  }

  get choices() {
    return normalizeChoices(this._descriptor.choices);
  }
  set choices(list) {
    this._descriptor.choices = list;
    this._renderOptions();
  }
  get optionText() {
    return this._descriptor.optionText || 'name';
  }
  set optionText(v) {
    this._descriptor.optionText = v;
    this._renderOptions();
  }
  get optionValue() {
    return this._descriptor.optionValue || 'id';
  }
  set optionValue(v) {
    this._descriptor.optionValue = v;
    this._renderOptions();
  }

  renderControl() {
    this.classList.add('sa-input', 'sa-select-array-input');
    this.setAttribute('data-sa-part', 'input');
    this.innerHTML = `
      <label class="sa-input__label"></label>
      <select class="sa-input__control" multiple></select>
      <span class="sa-input__helper"></span>
      <span class="sa-input__error" role="alert"></span>`;

    this._control = this.querySelector('.sa-input__control');
    this.querySelector('.sa-input__label').textContent = this.label;
    this._control.disabled = this.disabled || this.readOnly;

    this._renderOptions();

    this._control.addEventListener('change', () => {
      const values = Array.from(this._control.selectedOptions).map((o) => o.value);
      this.commit(values);
    });
    this._control.addEventListener('blur', () => this.markTouched());
  }

  attributeChangedCallback(name, oldVal, newVal) {
    super.attributeChangedCallback(name, oldVal, newVal);
    if (name === 'choices' || name === 'option-text' || name === 'option-value') {
      this._renderOptions();
    }
  }

  _renderOptions() {
    if (!this._control) return;
    const selected = new Set(Array.from(this._control.selectedOptions).map((o) => o.value));
    this._control.textContent = '';
    for (const choice of this.choices) {
      const opt = document.createElement('option');
      opt.value = String(valueFor(choice, this.optionValue));
      opt.textContent = String(labelFor(choice, this.optionText));
      opt.selected = selected.has(opt.value);
      this._control.appendChild(opt);
    }
  }

  parse(controlValue) {
    const arr = Array.isArray(controlValue) ? controlValue : [];
    return arr.map((raw) => resolveChoiceValue(this.choices, this.optionValue, raw));
  }
  format(storeValue) {
    return Array.isArray(storeValue) ? storeValue : [];
  }

  updateControl(value) {
    if (!this._control) return;
    const arr = (Array.isArray(value) ? value : []).map(String);
    for (const opt of this._control.options) opt.selected = arr.includes(opt.value);
  }
}

registerInput('selectArray', SaSelectArrayInput);

export default SaSelectArrayInput;
