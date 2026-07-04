// SaReferenceArrayField — many-to-many display (doc 10 §10.1, doc 06 §4.3). Reads an array of
// foreign-key ids at `source`, resolves them all through the same per-reference batcher used by
// SaReferenceField (ids from both coalesce into one dataProvider.getMany() per reference per
// microtask), and renders each resolved record as a chip — either via a cloned light-DOM field
// template or the raw id as a fallback.
import { BaseField } from './baseField.js';
import { registerField, hasResource } from '../core/registry.js';
import { getReferenceBatcher } from './referenceField.js';
import {
  captureChildTemplates,
  buildChildTemplates,
  hasChildTemplates,
} from './templateChildren.js';
import * as diagnostics from '../core/diagnostics.js';

export class SaReferenceArrayField extends BaseField(HTMLElement) {
  static get observedAttributes() {
    return [...super.observedAttributes, 'reference'];
  }

  constructor() {
    super();
    this._fetchToken = 0;
  }

  get reference() {
    return this._descriptor.reference;
  }

  connectedCallback() {
    // Snapshot child templates into `_descriptor.children` so they survive <sa-datagrid>'s per-row
    // clone — see templateChildren.js.
    captureChildTemplates(this);
    super.connectedCallback();
  }

  renderValue(value) {
    this.classList.add('sa-field', 'sa-field--reference-array');
    const ids = Array.isArray(value) ? value : [value];

    if (ids.length === 0) {
      this.renderEmpty(this.emptyText);
      return;
    }

    if (!hasResource(this.reference)) {
      diagnostics.warn('reference-undeclared', {
        reference: this.reference,
        resource: this._resourceName(),
      });
      this._renderFallback(ids);
      return;
    }

    const batcher = getReferenceBatcher(this.reference);
    if (!batcher) {
      this._renderFallback(ids);
      return;
    }

    const token = ++this._fetchToken;
    batcher.getMany(this.reference, ids).then((records) => {
      if (token !== this._fetchToken || !this.isConnected) return;
      this._renderResolved(records);
    });
  }

  renderEmpty(emptyText) {
    this.classList.add('sa-field', 'sa-field--reference-array');
    this.textContent = emptyText;
  }

  _renderFallback(ids) {
    this.textContent = '';
    for (const id of ids) {
      const chip = document.createElement('span');
      chip.className = 'sa-field__chip';
      chip.textContent = String(id);
      this.appendChild(chip);
    }
  }

  _renderResolved(records) {
    this.textContent = '';
    for (const record of records) {
      const chip = document.createElement('span');
      chip.className = 'sa-field__chip';

      if (hasChildTemplates(this)) {
        const host = document.createElement('sa-reference-array-item');
        host.__recordContext = { record };
        for (const child of buildChildTemplates(this)) host.appendChild(child);
        chip.appendChild(host);
      } else {
        chip.textContent = String(record.id);
      }

      this.appendChild(chip);
    }
  }

  _resourceName() {
    const resourceEl = this.closest('sa-resource');
    return (
      (resourceEl && (resourceEl.__resourceContext?.name || resourceEl.getAttribute?.('name'))) ||
      undefined
    );
  }
}

registerField('referenceArray', SaReferenceArrayField);

export default SaReferenceArrayField;
