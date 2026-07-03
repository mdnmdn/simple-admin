// SaResource — declares a resource's identity + its list/create/edit/show views (doc 10 §2.1,
// §3.3, §8). Publishes a ResourceDescriptor as __resourceContext (RESOURCE_HOST_TAGS, core/context.js)
// so any descendant field/input finds its ambient resource via findResourceContext(), and registers
// itself with the resource registry so <sa-admin>'s menu/router can find it by name.
//
// Two authoring paths, both supported:
//   (A) HTML: <sa-resource name="posts"><sa-list>…</sa-list><sa-edit>…</sa-edit></sa-resource>
//       — list/create/edit/show become the *real element* found among light-DOM children.
//   (B) JS-config: SimpleAdmin.resource('posts', { list: {...} }) registers directly (bypassing
//       this element entirely) OR, when <sa-admin> needs a context host for a JS-config resource,
//       it creates a bare <sa-resource> and sets `.descriptor`/`__resourceContext` itself — in that
//       case this element must NOT clobber the pre-set context on connect.

import { registerResource } from '../core/registry.js';
import * as diagnostics from '../core/diagnostics.js';

const VIEWS = ['list', 'create', 'edit', 'show'];

export class SaResource extends HTMLElement {
  static get observedAttributes() {
    return ['name', 'icon', 'record-representation'];
  }

  constructor() {
    super();
    // NO DOM work in the constructor (doc 10 §3.3).
    this.__resourceContext = null;
    this._ownsDescriptor = false;
  }

  connectedCallback() {
    if (!this.__resourceContext) {
      this.__resourceContext = this._buildDescriptor();
    }
    registerResource(this.__resourceContext);

    if (VIEWS.every((view) => !this.__resourceContext[view])) {
      diagnostics.warn('resource-no-views', { resource: this.__resourceContext.name });
    }
  }

  attributeChangedCallback() {
    // Only re-derive when this instance owns its descriptor (HTML-authoring path). A
    // JS-config-provided context (set via .descriptor / __resourceContext) is never rebuilt
    // from attributes, so <sa-admin> can safely stamp a `name` attribute for debugging without
    // clobbering the real descriptor.
    if (this.isConnected && this._ownsDescriptor) {
      this.__resourceContext = this._buildDescriptor();
      registerResource(this.__resourceContext);
    }
  }

  // JS-config path: <sa-admin> (or an author) sets this directly instead of relying on attrs.
  set descriptor(d) {
    this._ownsDescriptor = false;
    this.__resourceContext = { kind: 'resource', ...d };
    if (this.isConnected) registerResource(this.__resourceContext);
  }
  get descriptor() {
    return this.__resourceContext;
  }

  _buildDescriptor() {
    this._ownsDescriptor = true;
    const descriptor = {
      kind: 'resource',
      name: this.getAttribute('name'),
      icon: this.getAttribute('icon') || undefined,
      recordRepresentation: this.getAttribute('record-representation') || undefined,
    };
    for (const view of VIEWS) {
      const el = this.querySelector(`:scope > sa-${view}`);
      if (el) descriptor[view] = el;
    }
    return descriptor;
  }
}

if (!customElements.get('sa-resource')) customElements.define('sa-resource', SaResource);

export default SaResource;
