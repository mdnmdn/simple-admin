// SaReferenceField — many-to-one/one-to-one display (doc 10 §10.1, doc 06 §4.1). Reads the
// foreign-key id at `source` on the current record, fetches the related `reference` record
// through a per-reference batched getMany (doc 06 §6), and either renders its own light-DOM
// field children against the related record or falls back to the raw id.
import { BaseField } from './baseField.js';
import { registerField, hasResource, getDataProvider } from '../core/registry.js';
import { createGetManyBatcher } from '../providers/batcher.js';
import * as diagnostics from '../core/diagnostics.js';

// One shared batcher per reference resource name, created lazily against the active
// dataProvider (not available until <sa-admin> mounts). referenceArrayField.js reuses this
// exact map/pattern so a <sa-reference-field> and a <sa-reference-array-field> pointing at the
// same resource in the same tick coalesce into a single dataProvider.getMany() call.
const batchersByReference = new Map();

export const getReferenceBatcher = (reference) => {
  let batcher = batchersByReference.get(reference);
  if (batcher) return batcher;
  const dataProvider = getDataProvider();
  if (!dataProvider) return null;
  batcher = createGetManyBatcher(dataProvider);
  batchersByReference.set(reference, batcher);
  return batcher;
};

export class SaReferenceField extends BaseField(HTMLElement) {
  static get observedAttributes() {
    return [...super.observedAttributes, 'reference', 'link'];
  }

  constructor() {
    super();
    this._templateChildren = null; // captured once, on first connect
    this._fetchToken = 0;
  }

  get reference() {
    return this._descriptor.reference;
  }
  get link() {
    const l = this._descriptor.link;
    if (l == null || l === false || l === 'false') return false;
    return l;
  }

  connectedCallback() {
    // Snapshot the light-DOM child field(s) supplied as the "how to render the related record"
    // template BEFORE any render pass has a chance to clear this element's content.
    if (!this._templateChildren) {
      this._templateChildren = [...this.children];
      for (const child of this._templateChildren) child.remove();
    }
    super.connectedCallback();
  }

  renderValue(value) {
    this.classList.add('sa-field', 'sa-field--reference');

    if (!hasResource(this.reference)) {
      diagnostics.warn('reference-undeclared', {
        reference: this.reference,
        resource: this._resourceName(),
      });
      this._renderFallback(value);
      return;
    }

    const batcher = getReferenceBatcher(this.reference);
    if (!batcher) {
      this._renderFallback(value);
      return;
    }

    const token = ++this._fetchToken;
    batcher.getMany(this.reference, [value]).then((records) => {
      if (token !== this._fetchToken || !this.isConnected) return;
      const related = records[0];
      if (!related) {
        this._renderFallback(value);
        return;
      }
      this._renderResolved(related);
    });
  }

  renderEmpty(emptyText) {
    this.classList.add('sa-field', 'sa-field--reference');
    this.__recordContext = null;
    this.textContent = emptyText;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.__recordContext = null;
  }

  _renderFallback(id) {
    this.__recordContext = null;
    this.textContent = '';
    this.appendChild(this._maybeLink(document.createTextNode(String(id)), id));
  }

  _renderResolved(related) {
    this.__recordContext = { record: related };
    this.textContent = '';
    let content;
    if (this._templateChildren.length) {
      content = document.createDocumentFragment();
      for (const child of this._templateChildren) content.appendChild(child);
    } else {
      content = document.createTextNode(String(related.id));
    }
    this.appendChild(this._maybeLink(content, related.id));
  }

  _maybeLink(node, id) {
    if (!this.link) return node;
    const a = document.createElement('a');
    a.href = `#/${this.reference}/${id}${this.link === 'show' ? '/show' : ''}`;
    a.appendChild(node);
    return a;
  }

  _resourceName() {
    const resourceEl = this.closest('sa-resource');
    return (
      (resourceEl && (resourceEl.__resourceContext?.name || resourceEl.getAttribute?.('name'))) ||
      undefined
    );
  }
}

registerField('reference', SaReferenceField);

export default SaReferenceField;
