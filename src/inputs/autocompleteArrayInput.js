// SaAutocompleteArrayInput — searchable multi-select with removable "tag" chips for selected
// values (doc 10 §10.2, doc 06 §5).
import { BaseInput } from './baseInput.js';
import { registerInput } from '../core/registry.js';
import { normalizeChoices, labelFor, valueFor } from './choiceHelpers.js';

const BLUR_CLOSE_DELAY_MS = 100;

export class SaAutocompleteArrayInput extends BaseInput(HTMLElement) {
  static get observedAttributes() {
    return [...super.observedAttributes, 'choices', 'option-text', 'option-value'];
  }

  // See SaAutocompleteInput — set by sa-reference-array-input to react to typed search text.
  onSearchTextChange = null;

  get choices() {
    return normalizeChoices(this._descriptor.choices);
  }
  set choices(list) {
    this._descriptor.choices = list;
    this._renderList();
    this._renderChips();
  }
  get optionText() {
    return this._descriptor.optionText || 'name';
  }
  set optionText(v) {
    this._descriptor.optionText = v;
  }
  get optionValue() {
    return this._descriptor.optionValue || 'id';
  }
  set optionValue(v) {
    this._descriptor.optionValue = v;
  }

  renderControl() {
    this.classList.add('sa-input', 'sa-autocomplete-array-input');
    this.setAttribute('data-sa-part', 'input');
    this.innerHTML = `
      <label class="sa-input__label"></label>
      <div class="sa-autocomplete-array-input__wrap">
        <ul class="sa-autocomplete-array-input__chips"></ul>
        <input class="sa-input__control" type="text" role="combobox" aria-expanded="false" autocomplete="off" />
        <ul class="sa-autocomplete-input__list" hidden></ul>
      </div>
      <span class="sa-input__helper"></span>
      <span class="sa-input__error" role="alert"></span>`;

    this._control = this.querySelector('.sa-input__control');
    this._list = this.querySelector('.sa-autocomplete-input__list');
    this._chips = this.querySelector('.sa-autocomplete-array-input__chips');
    this.querySelector('.sa-input__label').textContent = this.label;
    this._control.disabled = this.disabled;
    if (this.readOnly) this._control.setAttribute('readonly', '');

    this._open = false;
    this._values = [];

    this._control.addEventListener('input', () => {
      this._open = true;
      if (this.onSearchTextChange) this.onSearchTextChange(this._control.value);
      this._renderList();
    });
    this._control.addEventListener('focus', () => {
      this._open = true;
      this._renderList();
    });
    this._control.addEventListener('blur', () => {
      setTimeout(() => {
        this._open = false;
        this._renderList();
        this.markTouched();
      }, BLUR_CLOSE_DELAY_MS);
    });

    this._renderChips();
    this._renderList();
  }

  attributeChangedCallback(name, oldVal, newVal) {
    super.attributeChangedCallback(name, oldVal, newVal);
    if (name === 'choices' || name === 'option-text' || name === 'option-value') {
      this._renderList();
      this._renderChips();
    }
  }

  _matches(choice) {
    const already = this._values.some((v) => String(v) === String(valueFor(choice, this.optionValue)));
    if (already) return false;
    const q = (this._control.value || '').trim().toLowerCase();
    if (!q) return true;
    return String(labelFor(choice, this.optionText)).toLowerCase().includes(q);
  }

  _renderList() {
    if (!this._list) return;
    this._list.textContent = '';
    this._control.setAttribute('aria-expanded', String(!!this._open));
    if (!this._open) {
      this._list.hidden = true;
      return;
    }
    const matches = this.choices.filter((c) => this._matches(c));
    for (const choice of matches) {
      const li = document.createElement('li');
      li.className = 'sa-autocomplete-input__option';
      li.textContent = String(labelFor(choice, this.optionText));
      li.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        this._add(choice);
      });
      this._list.appendChild(li);
    }
    this._list.hidden = matches.length === 0;
  }

  _renderChips() {
    if (!this._chips) return;
    this._chips.textContent = '';
    for (const v of this._values) {
      const match = this.choices.find((c) => String(valueFor(c, this.optionValue)) === String(v));
      const li = document.createElement('li');
      li.className = 'sa-autocomplete-array-input__chip';

      const label = document.createElement('span');
      label.textContent = match ? String(labelFor(match, this.optionText)) : String(v);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'sa-autocomplete-array-input__chip-remove';
      remove.setAttribute('aria-label', 'Remove');
      remove.textContent = '×';
      remove.addEventListener('click', () => this._remove(v));

      li.appendChild(label);
      li.appendChild(remove);
      this._chips.appendChild(li);
    }
  }

  _add(choice) {
    const id = valueFor(choice, this.optionValue);
    if (!this._values.some((v) => String(v) === String(id))) this._values = [...this._values, id];
    this._control.value = '';
    this._renderChips();
    this._renderList();
    this.commit(this._values);
  }

  _remove(id) {
    this._values = this._values.filter((v) => String(v) !== String(id));
    this._renderChips();
    this.commit(this._values);
  }

  parse(controlValue) {
    return Array.isArray(controlValue) ? controlValue : [];
  }
  format(storeValue) {
    return Array.isArray(storeValue) ? storeValue : [];
  }

  updateControl(value) {
    this._values = Array.isArray(value) ? value : [];
    this._renderChips();
  }
}

registerInput('autocompleteArray', SaAutocompleteArrayInput);

export default SaAutocompleteArrayInput;
