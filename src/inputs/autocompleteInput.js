// SaAutocompleteInput — searchable single-select: a text <input> + a dropdown <ul> of choices
// filtered client-side over `choices` by default (doc 10 §10.2, doc 06 §5).
import { BaseInput } from './baseInput.js';
import { registerInput } from '../core/registry.js';
import { normalizeChoices, labelFor, valueFor } from './choiceHelpers.js';

// Blur closes the dropdown; delay it so a mousedown-driven selection on a list item can run first.
const BLUR_CLOSE_DELAY_MS = 100;

export class SaAutocompleteInput extends BaseInput(HTMLElement) {
  static get observedAttributes() {
    return [...super.observedAttributes, 'choices', 'option-text', 'option-value'];
  }

  // sa-reference-input sets this to be notified of the raw typed query, so it can re-run
  // dataProvider.getList() narrowed by search text (doc 10 §9.5). null by default (pure
  // client-side filtering over the `choices` property/attribute).
  onSearchTextChange = null;

  get choices() {
    return normalizeChoices(this._descriptor.choices);
  }
  set choices(list) {
    this._descriptor.choices = list;
    this._renderList();
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
    this.classList.add('sa-input', 'sa-autocomplete-input');
    this.setAttribute('data-sa-part', 'input');
    this.innerHTML = `
      <label class="sa-input__label"></label>
      <div class="sa-autocomplete-input__wrap">
        <input class="sa-input__control" type="text" role="combobox" aria-expanded="false" autocomplete="off" />
        <ul class="sa-autocomplete-input__list" hidden></ul>
      </div>
      <span class="sa-input__helper"></span>
      <span class="sa-input__error" role="alert"></span>`;

    this._control = this.querySelector('.sa-input__control');
    this._list = this.querySelector('.sa-autocomplete-input__list');
    this.querySelector('.sa-input__label').textContent = this.label;
    this._control.disabled = this.disabled;
    if (this.readOnly) this._control.setAttribute('readonly', '');

    this._open = false;
    this._selectedId = undefined;

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

    this._renderList();
  }

  attributeChangedCallback(name, oldVal, newVal) {
    super.attributeChangedCallback(name, oldVal, newVal);
    if (name === 'choices' || name === 'option-text' || name === 'option-value') {
      this._renderList();
    }
  }

  _matches(choice) {
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
        ev.preventDefault(); // keep focus on the control so 'blur' doesn't fire first
        this._select(choice);
      });
      this._list.appendChild(li);
    }
    this._list.hidden = matches.length === 0;
  }

  _select(choice) {
    this._selectedId = valueFor(choice, this.optionValue);
    this._control.value = String(labelFor(choice, this.optionText));
    this._open = false;
    this._renderList();
    this.commit(this._selectedId);
  }

  // The id is already resolved in _select(); commit() is called directly with it.
  parse(controlValue) {
    return controlValue;
  }

  updateControl(value) {
    if (!this._control) return;
    this._selectedId = value;
    if (document.activeElement === this._control && this._open) return; // don't clobber typing
    const match = this.choices.find((c) => String(valueFor(c, this.optionValue)) === String(value));
    this._control.value = match
      ? String(labelFor(match, this.optionText))
      : value == null
      ? ''
      : String(value);
  }
}

registerInput('autocomplete', SaAutocompleteInput);

export default SaAutocompleteInput;
