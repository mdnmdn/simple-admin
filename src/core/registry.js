// Resource registry + field/input type registries (architecture §12, doc 13 §1).
//
// A single `type` (camelCase identifier) is the source of truth for a component. From it the
// registry derives the custom-element tag, the JS-config factory, and the descriptor `type`.

import * as diagnostics from './diagnostics.js';
import { kebab } from './util.js';

// ---- resource registry ----

const resources = new Map();

export const registerResource = (descriptor) => {
  if (!descriptor || !descriptor.name) return descriptor;
  resources.set(descriptor.name, descriptor);
  return descriptor;
};

export const getResource = (name) => resources.get(name);
export const getAllResources = () => [...resources.values()];
export const hasResource = (name) => resources.has(name);

// ---- field / input type registries ----

const fieldRegistry = new Map(); // type -> ElementClass
const inputRegistry = new Map(); // type -> ElementClass

// JS-config factory maps. `index.js` re-exports these as `fields`/`f` and `inputs`/`i`.
export const fields = {};
export const inputs = {};

const defineTag = (tag, ElementClass) => {
  if (typeof customElements === 'undefined') return; // non-DOM env (e.g. node --check)
  if (!customElements.get(tag)) customElements.define(tag, ElementClass);
};

export const registerField = (type, ElementClass, factory) => {
  if (fieldRegistry.has(type)) {
    diagnostics.warn('field-reregistered', { type });
    return;
  }
  fieldRegistry.set(type, ElementClass);
  defineTag(`sa-${kebab(type)}-field`, ElementClass);
  fields[type] = factory || ((props = {}) => ({ kind: 'field', type, ...props }));
};

export const registerInput = (type, ElementClass, factory) => {
  if (inputRegistry.has(type)) {
    diagnostics.warn('input-reregistered', { type });
    return;
  }
  inputRegistry.set(type, ElementClass);
  defineTag(`sa-${kebab(type)}-input`, ElementClass);
  inputs[type] = factory || ((props = {}) => ({ kind: 'input', type, ...props }));
};

export const getFieldClass = (type) => fieldRegistry.get(type);
export const getInputClass = (type) => inputRegistry.get(type);

export const fieldTag = (type) => `sa-${kebab(type)}-field`;
export const inputTag = (type) => `sa-${kebab(type)}-input`;

// ---- active provider registry ----
//
// A single <sa-admin> per page is the common case (v1). Rather than have every field/input walk
// the DOM to find the nearest <sa-admin>, the admin component publishes its dataProvider/
// authProvider here on mount, and anything (reference fields/inputs, auth guards, examples) reads
// them back with getDataProvider()/getAuthProvider() instead of coupling to the DOM tree.
let activeDataProvider = null;
let activeAuthProvider = null;

export const setDataProvider = (dp) => {
  activeDataProvider = dp || null;
};
export const getDataProvider = () => activeDataProvider;

export const setAuthProvider = (ap) => {
  activeAuthProvider = ap || null;
};
export const getAuthProvider = () => activeAuthProvider;
