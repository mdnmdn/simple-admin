// SaSelectInput — `<select>`, single choice (doc 10 §10.2, doc 06 §5).
import { BaseInput } from './baseInput.js';
import { registerInput } from '../core/registry.js';
import { normalizeChoices, labelFor, valueFor, resolveChoiceValue } from './choiceHelpers.js';

export class SaSelectInput extends BaseInput(HTMLElement) {
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
    this.classList.add('sa-input', 'sa-select-input');
    this.setAttribute('data-sa-part', 'input');
    this.innerHTML = `
      <label class="sa-input__label"></label>
      <select class="sa-input__control"></select>
      <span class="sa-input__helper"></span>
      <span class="sa-input__error" role="alert"></span>`;

    this._control = this.querySelector('.sa-input__control');
    this.querySelector('.sa-input__label').textContent = this.label;
    this._control.disabled = this.disabled || this.readOnly; // native <select> has no readonly

    this._renderOptions();

    this._control.addEventListener('change', () => this.commit(this._control.value));
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
    const current = this._control.value;
    this._control.textContent = '';
    const blank = document.createElement('option');
    blank.value = '';
    this._control.appendChild(blank);
    for (const choice of this.choices) {
      const opt = document.createElement('option');
      opt.value = String(valueFor(choice, this.optionValue));
      opt.textContent = String(labelFor(choice, this.optionText));
      this._control.appendChild(opt);
    }
    this._control.value = current;
  }

  // Resolve the <select>'s (string) value back to the matching choice's actual stored value.
  parse(controlValue) {
    if (controlValue === '' || controlValue == null) return undefined;
    return resolveChoiceValue(this.choices, this.optionValue, controlValue);
  }

  updateControl(value) {
    if (!this._control) return;
    const next = value == null ? '' : String(value);
    if (this._control.value !== next) this._control.value = next;
  }
}

registerInput('select', SaSelectInput);

export default SaSelectInput;
