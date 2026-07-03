// SaFunctionField — escape hatch: renders arbitrary content via a `.render(record, source)`
// callback (doc 10 §10.1, doc 13 §5). No `source` is required — BaseField exempts `type ===
// 'function'` from the missing-source diagnostic, so the constructor pins that type up front
// (metadata only, no DOM work) so the exemption applies on both the HTML and JS-config paths.
import { BaseField } from './baseField.js';
import { registerField, fields } from '../core/registry.js';

export class SaFunctionField extends BaseField(HTMLElement) {
  constructor() {
    super();
    this._descriptor.type = 'function';
  }

  get render() {
    return this._descriptor.render;
  }
  set render(fn) {
    this._descriptor.render = fn;
    this._scheduleRender();
  }

  // No `source` means "always has a value" — always invoke render() with the whole record,
  // rather than falling into the inherited empty-value path.
  getValue() {
    if (!this.source) return true;
    return super.getValue();
  }

  renderValue(_value, record) {
    this.classList.add('sa-field', 'sa-field--function');
    const renderFn = this.render;
    if (typeof renderFn !== 'function') {
      this.textContent = '';
      return;
    }
    const result = renderFn(record, this.source);
    if (result == null || result === '') {
      this.renderEmpty(this.emptyText);
      return;
    }
    this.textContent = '';
    if (result instanceof Node) {
      this.appendChild(result);
    } else {
      this.textContent = String(result);
    }
  }
}

registerField('function', SaFunctionField);
// The catalog's JS-config surface for this field is `f.fn(...)`, not the mechanical `f.function(...)`
// the registry would otherwise derive from `type: 'function'` — alias it (doc 13 §1.2 "rare exception").
fields.fn = fields.function;

export default SaFunctionField;
