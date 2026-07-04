// Child-template handling shared by the composite fields (sa-reference-field,
// sa-reference-array-field, sa-array-field) — the ones that render authored child field(s) once
// per related record / array item.
//
// The hard requirement: a composite field is used as a <sa-datagrid> COLUMN, and the datagrid
// stamps each row by cloning its column template. `cloneNode(true)` copies DOM (elements +
// attributes) but NOT instance JS state, and — crucially — custom elements inside cloned
// <template> content are never upgraded, so a captured DOM template can't carry JS-config
// descriptors through a clone. The robust representation that DOES survive cloning is a plain
// DESCRIPTOR TREE stored on `_descriptor.children`: the datagrid transfers `_descriptor` onto each
// row clone (see cloneWithDescriptors + BaseField's upgradeProperty), so the children travel with
// it, for BOTH the HTML-authoring and JS-config paths, with no <template> and no re-upgrade
// hazard. Each render then builds FRESH child elements from those descriptors.

import { fieldTag } from '../core/registry.js';
import { descriptorFromElement } from '../core/descriptor.js';

// Is this element one of our field custom elements (has the BaseField descriptor plumbing)?
const isField = (el) => el.nodeType === 1 && typeof el.toDescriptor === 'function';

// Recursively read a child field element's config into a plain descriptor tree. Uses
// `descriptorFromElement` (attributes + any pre-set `.descriptor` seed) rather than
// `toDescriptor()`, because capture runs in the PARENT's connectedCallback — before the child's
// own connectedCallback has absorbed its attributes — so `toDescriptor()` would still be the empty
// constructor default for an HTML-authored child. `descriptorFromElement` reads the attributes
// directly, so HTML-authored and JS-config children are captured identically.
const snapshotDescriptor = (el) => {
  const own = descriptorFromElement(el, 'field');
  delete own.children;
  const kids = [...el.children].filter(isField);
  return kids.length ? { ...own, children: kids.map(snapshotDescriptor) } : own;
};

// Capture the element's authored child fields as a descriptor array on its own `_descriptor`
// (so it rides along with `_descriptor` through the datagrid's per-row clone), then detach the
// live children. Idempotent: only snapshots the first time, and re-captures nothing on a clone
// that already carries `_descriptor.children`.
export const captureChildTemplates = (el) => {
  const descriptor = el.toDescriptor();
  if (!Array.isArray(descriptor.children)) {
    const kids = [...el.children].filter(isField);
    descriptor.children = kids.map(snapshotDescriptor);
  }
  for (const child of [...el.children]) child.remove();
};

// True when any child field was authored.
export const hasChildTemplates = (el) => {
  const descriptor = el.toDescriptor();
  return Array.isArray(descriptor.children) && descriptor.children.length > 0;
};

// Build fresh child field elements from the captured descriptor tree, ready to append into a
// render pass. Each element gets its `.descriptor` set before connect, exactly like admin.js's
// JS-config materialization.
const buildFromDescriptor = (descriptor) => {
  const el = document.createElement(fieldTag(descriptor.type || 'text'));
  const { children, ...own } = descriptor;
  el.descriptor = own;
  for (const child of children || []) el.appendChild(buildFromDescriptor(child));
  return el;
};

export const buildChildTemplates = (el) => (el.toDescriptor().children || []).map(buildFromDescriptor);

// Deep-clone a field subtree, re-attaching each node's `_descriptor` JS state — which
// `cloneNode(true)` does NOT copy. HTML-authored fields survive a plain clone because their config
// lives in `source="..."`/etc. attributes (which ARE cloned, and BaseField rebuilds `_descriptor`
// from them on connect); a JS-config-materialized field carries its config ONLY on `_descriptor`
// (no reflecting attributes), so a plain clone would lose it and render nothing. Copy each
// field/input descriptor across so both paths clone identically. (Composite fields keep their
// children on `_descriptor.children`, so a single top-level descriptor copy carries the whole
// column.)
export const cloneWithDescriptors = (node) => {
  const clone = node.cloneNode(true);
  const originals = [node, ...node.querySelectorAll('*')];
  const clones = [clone, ...clone.querySelectorAll('*')];
  for (let i = 0; i < originals.length; i++) {
    const original = originals[i];
    const cloned = clones[i];
    if (cloned && typeof original.toDescriptor === 'function') {
      cloned.descriptor = original.toDescriptor();
    }
  }
  return clone;
};
