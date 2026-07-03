// SaCanAccess — declarative access guard (doc 10 §7, doc 03 §2.7). Wraps light-DOM children
// (e.g. a button) and hides them when canAccess({action, resource}) resolves false. Mirrors
// react-admin's <CanAccess>. v1: a static check performed once on connect (no reactive re-check
// on identity/permission change — matches the task's stated scope).

import { canAccess } from '../auth/authGuard.js';
import { getAuthProvider } from '../core/registry.js';

export class SaCanAccess extends HTMLElement {
  static get observedAttributes() {
    return ['action', 'resource'];
  }

  connectedCallback() {
    this.setAttribute('data-sa-part', 'can-access');
    const action = this.getAttribute('action');
    const resource = this.getAttribute('resource');
    canAccess(getAuthProvider(), { action, resource }).then((allowed) => {
      this.style.display = allowed ? '' : 'none';
    });
  }
}

if (!customElements.get('sa-can-access')) customElements.define('sa-can-access', SaCanAccess);

export default SaCanAccess;
