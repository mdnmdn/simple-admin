// SaFormToolbar / SaSaveButton / SaDeleteButton — form action bar (doc 05 §6).
//
// SaSaveButton never touches the dataProvider directly: it finds the nearest form host
// (`closest('sa-simple-form, sa-tabbed-form')`) and calls `formHost.save()`, which validates and
// (on success) dispatches the 'sa-submit' event that <sa-create>/<sa-edit> listen for — see
// simpleForm.js for the full event contract.
//
// SaDeleteButton is only meaningful inside <sa-edit>: it reads resource/id/record straight off
// the nearest <sa-edit> ancestor's properties (edit.js exposes them as getters), calls
// dataProvider.delete, then navigates to the resource list.

import { getDataProvider } from '../core/registry.js';
import { navigate } from '../core/router.js';
import * as diagnostics from '../core/diagnostics.js';

export class SaFormToolbar extends HTMLElement {
  connectedCallback() {
    this.classList.add('sa-form-toolbar');
    this.setAttribute('data-sa-part', 'toolbar');

    if (!this.querySelector('sa-save-button')) {
      this.appendChild(document.createElement('sa-save-button'));
    }
    if (this.closest('sa-edit') && !this.querySelector('sa-delete-button')) {
      this.appendChild(document.createElement('sa-delete-button'));
    }
  }
}

export class SaSaveButton extends HTMLElement {
  connectedCallback() {
    this.classList.add('sa-save-button');
    this.setAttribute('data-sa-part', 'save-button');
    if (!this.hasChildNodes()) this.textContent = this.getAttribute('label') || 'Save';

    this._onClick = () => {
      const host = this.closest('sa-simple-form, sa-tabbed-form');
      if (!host || typeof host.save !== 'function') return;
      host.save();
    };
    this.addEventListener('click', this._onClick);
  }

  disconnectedCallback() {
    this.removeEventListener('click', this._onClick);
  }
}

export class SaDeleteButton extends HTMLElement {
  connectedCallback() {
    this.classList.add('sa-delete-button');
    this.setAttribute('data-sa-part', 'delete-button');
    if (!this.hasChildNodes()) this.textContent = this.getAttribute('label') || 'Delete';

    this._onClick = () => this._handleClick();
    this.addEventListener('click', this._onClick);
  }

  disconnectedCallback() {
    this.removeEventListener('click', this._onClick);
  }

  async _handleClick() {
    const editEl = this.closest('sa-edit');
    if (!editEl) return;

    const dataProvider = getDataProvider();
    if (!dataProvider || typeof dataProvider.delete !== 'function') {
      diagnostics.error('provider-method-missing', {
        method: 'delete',
        resource: editEl.resource,
        operation: 'delete',
      });
      return;
    }

    await dataProvider.delete(editEl.resource, { id: editEl.id, previousData: editEl.record });
    navigate(`#/${editEl.resource}`);
  }
}

if (!customElements.get('sa-form-toolbar')) customElements.define('sa-form-toolbar', SaFormToolbar);
if (!customElements.get('sa-save-button')) customElements.define('sa-save-button', SaSaveButton);
if (!customElements.get('sa-delete-button')) customElements.define('sa-delete-button', SaDeleteButton);

export default SaFormToolbar;
