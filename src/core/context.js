// DOM-ancestry context lookup (architecture §3.3) — the DOM-native equivalent of
// react-admin's useRecordContext()/useListContext()/etc.
//
// A host element publishes its context object on itself under a well-known property
// (e.g. host.__recordContext). Lookups walk up via closest() on the known host tags and
// return the nearest published context, skipping hosts that have not published one yet.

// `sa-reference-array-item` / `sa-array-field-row` are plain (undefined custom-element) light-DOM
// wrapper tags created at render time by referenceArrayField/arrayField — one per iterated item —
// purely so `closest()` can resolve a *distinct* per-item record context. They never need
// customElements.define(); tag-name selector matching works on any element regardless.
export const RECORD_HOST_TAGS =
  'sa-datagrid-row, sa-datagrid, sa-simple-show-layout, sa-tabbed-show-layout, ' +
  'sa-reference-field, sa-reference-array-field, sa-array-field, sa-reference-array-item, ' +
  'sa-array-field-row, sa-show, sa-edit, sa-create';

export const LIST_HOST_TAGS = 'sa-list';
export const FORM_HOST_TAGS = 'sa-simple-form, sa-tabbed-form, sa-filters';
export const RESOURCE_HOST_TAGS = 'sa-resource';

// Walk ancestors (including self) matching `selector`; return the first published context
// found under `prop`. If the nearest matching host has not published one, keep climbing.
const findContext = (el, selector, prop) => {
  if (!el || typeof el.closest !== 'function') return null;
  let node = el;
  while (node) {
    const host = node.closest(selector);
    if (!host) return null;
    if (host[prop] != null) return host[prop];
    node = host.parentElement;
  }
  return null;
};

export const findRecordContext = (el) =>
  findContext(el, RECORD_HOST_TAGS, '__recordContext');

export const findListContext = (el) =>
  findContext(el, LIST_HOST_TAGS, '__listContext');

export const findFormContext = (el) =>
  findContext(el, FORM_HOST_TAGS, '__formContext');

export const findResourceContext = (el) =>
  findContext(el, RESOURCE_HOST_TAGS, '__resourceContext');

// Human-readable "resource "posts", edit view" label for diagnostics messages.
export const contextLabel = (el) => {
  if (!el || typeof el.closest !== 'function') return 'unknown context';
  const resourceEl = el.closest(RESOURCE_HOST_TAGS);
  const resource =
    (resourceEl && (resourceEl.__resourceContext?.name || resourceEl.getAttribute?.('name'))) || null;

  let view;
  if (el.closest('sa-list, sa-filters')) view = el.closest('sa-filters') ? 'filter' : 'list';
  else if (el.closest('sa-create')) view = 'create';
  else if (el.closest('sa-edit')) view = 'edit';
  else if (el.closest('sa-show')) view = 'show';

  if (!resource) return view ? `${view} view` : 'unknown context';
  return view ? `resource "${resource}", ${view} view` : `resource "${resource}"`;
};
