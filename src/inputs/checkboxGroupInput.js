// SaCheckboxGroupInput — a <fieldset> of checkboxes, one per choice; value is an array of
// selected ids (doc 10 §10.2, doc 06 §5).
import { BaseInput } from './baseInput.js';
import { registerInput } from '../core/registry.js';
import { normalizeChoices, labelFor, valueFor, resolveChoiceValue } from './choiceHelpers.js';

export class SaCheckboxGroupInput extends BaseInput(HTMLElement) {
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
    this.classList.add('sa-input', 'sa-checkbox-group-input');
    this.setAttribute('data-sa-part', 'input');
    this.innerHTML = `
      <fieldset class="sa-input__control sa-checkbox-group-input__fieldset">
        <legend class="sa-input__label"></legend>
      </fieldset>
      <span class="sa-input__helper"></span>
      <span class="sa-input__error" role="alert"></span>`;

    this._fieldset = this.querySelector('fieldset');
    this.querySelector('legend').textContent = this.label;
    this._fieldset.disabled = this.disabled || this.readOnly;

    this._renderOptions();
  }

  attributeChangedCallback(name, oldVal, newVal) {
    super.attributeChangedCallback(name, oldVal, newVal);
    if (name === 'choices' || name === 'option-text' || name === 'option-value') {
      this._renderOptions();
    }
  }

  _renderOptions() {
    if (!this._fieldset) return;
    const checked = new Set(this._checkedValues());
    for (const item of this._fieldset.querySelectorAll('.sa-checkbox-group-input__item')) {
      item.remove();
    }
    for (const choice of this.choices) {
      const value = String(valueFor(choice, this.optionValue));
      const item = document.createElement('label');
      item.className = 'sa-checkbox-group-input__item';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = value;
      cb.checked = checked.has(value);
      cb.addEventListener('change', () => this._onChange());
      cb.addEventListener('blur', () => this.markTouched());

      const text = document.createElement('span');
      text.textContent = String(labelFor(choice, this.optionText));

      item.appendChild(cb);
      item.appendChild(text);
      this._fieldset.appendChild(item);
    }
  }

  _checkedValues() {
    if (!this._fieldset) return [];
    return Array.from(this._fieldset.querySelectorAll('input[type="checkbox"]'))
      .filter((cb) => cb.checked)
      .map((cb) => cb.value);
  }

  _onChange() {
    this.commit(this._checkedValues());
  }

  parse(controlValue) {
    const arr = Array.isArray(controlValue) ? controlValue : [];
    return arr.map((raw) => resolveChoiceValue(this.choices, this.optionValue, raw));
  }
  format(storeValue) {
    return Array.isArray(storeValue) ? storeValue : [];
  }

  updateControl(value) {
    if (!this._fieldset) return;
    const arr = (Array.isArray(value) ? value : []).map(String);
    for (const cb of this._fieldset.querySelectorAll('input[type="checkbox"]')) {
      cb.checked = arr.includes(cb.value);
    }
  }
}

registerInput('checkboxGroup', SaCheckboxGroupInput);

export default SaCheckboxGroupInput;
