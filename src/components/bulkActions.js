// SaBulkDeleteButton — datagrid selection bulk action (doc 05 / architecture §9, list side).
//
// Declared inside <sa-datagrid> (itself inside <sa-list>), so `findListContext(this)` resolves the
// ListController published by <sa-list>. Shown/enabled only while at least one row is selected;
// on click calls `dataProvider.deleteMany(resource, { ids })`, then clears selection and refetches.

import { effect } from '../core/signal.js';
import { findListContext } from '../core/context.js';
import { getDataProvider } from '../core/registry.js';
import * as diagnostics from '../core/diagnostics.js';

export class SaBulkDeleteButton extends HTMLElement {
  connectedCallback() {
    this.classList.add('sa-bulk-delete-button');
    this.setAttribute('data-sa-part', 'bulk-delete-button');
    if (!this.hasChildNodes()) this.textContent = this.getAttribute('label') || 'Delete';

    this._listController = findListContext(this);
    if (!this._listController) return; // degrade: no list context, render inert.

    this._onClick = () => this._handleClick();
    this.addEventListener('click', this._onClick);

    this._dispose = effect(() => {
      const count = this._listController.selectedIds.get().length;
      this.hidden = count === 0;
      this.toggleAttribute('disabled', count === 0);
    });
  }

  disconnectedCallback() {
    this.removeEventListener('click', this._onClick);
    if (this._dispose) this._dispose();
    this._dispose = null;
  }

  async _handleClick() {
    const ids = this._listController.selectedIds.peek();
    if (!ids.length) return;

    const dataProvider = getDataProvider();
    if (!dataProvider || typeof dataProvider.deleteMany !== 'function') {
      diagnostics.error('provider-method-missing', {
        method: 'deleteMany',
        resource: this._listController.resource,
        operation: 'bulk delete',
      });
      return;
    }

    await dataProvider.deleteMany(this._listController.resource, { ids });
    this._listController.clearSelection();
    this._listController.refetch();
  }
}

if (!customElements.get('sa-bulk-delete-button')) {
  customElements.define('sa-bulk-delete-button', SaBulkDeleteButton);
}

export default SaBulkDeleteButton;
