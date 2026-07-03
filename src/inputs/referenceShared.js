// Shared plumbing for sa-reference-input / sa-reference-array-input (doc 10 §9.5, doc 06 §4.4-4.5).
// Not a registered field/input itself.

import { createGetManyBatcher } from '../providers/batcher.js';

const batcherCache = new WeakMap();

// One getMany batcher per dataProvider instance — reference inputs sharing a dataProvider share a
// batcher, matching the batching intent of providers/batcher.js.
export const batcherFor = (dataProvider) => {
  if (!dataProvider) return null;
  let batcher = batcherCache.get(dataProvider);
  if (!batcher) {
    batcher = createGetManyBatcher(dataProvider);
    batcherCache.set(dataProvider, batcher);
  }
  return batcher;
};

// Turn a declared/default choice-input child into a rendering-only delegate of `parentInput`.
//
// Why: sa-select-input / sa-autocomplete-input are themselves BaseInput subclasses that, on a
// normal connectedCallback, look up the nearest form via closest('sa-simple-form, ...') and
// register themselves against the FormStore under their own `source`. Since sa-reference-input
// is not a form host, that lookup would find the SAME outer FormStore the parent reference input
// is already registered against — a second, competing registration for the same field, and a
// second reactive effect that would race the parent's own effect when pushing values into the
// control (see the DECISION comment in referenceInput.js).
//
// So the child is never given a real `source` binding of its own: we replace its
// connectedCallback with a trimmed version that only (re)builds its control DOM, and shadow its
// commit()/markTouched() so user interaction flows straight back into the parent's own
// commit()/markTouched() — the parent is the only element actually registered with the FormStore.
export const patchChildAsDelegate = (child, parentInput) => {
  child.connectedCallback = () => child.renderControl();
  child.disconnectedCallback = () => {};
  child.commit = (controlValue) => parentInput.commit(controlValue);
  child.markTouched = () => parentInput.markTouched();
  return child;
};
