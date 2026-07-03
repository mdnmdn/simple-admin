// Shared descriptor normalization (architecture §2.1/§2.3).
//
// Both author-facing syntaxes normalize to the same descriptor object:
//   - HTML light-DOM element  -> descriptorFromElement(el, kind) / absorbAttributes(desc, el)
//   - JS config object        -> normalizeConfig(config, kind)
//
// The attribute<->descriptor-key coercion is the ONLY transformation between the two paths.

import { camelCase } from './util.js';
import { parseValidatorDSL } from '../validators/index.js';

// Attributes whose mere presence means `true` (boolean-presence attributes).
export const BOOLEAN_ATTRS = new Set([
  'always-on',
  'sortable',
  'disabled',
  'read-only',
  'multiline',
  'full-width',
  'show-time',
  'required',
  'translate-choice',
  'sanitize-empty-values',
  'warn-when-unsaved-changes',
  'expand',
]);

// Attributes whose value is a JSON literal.
export const JSON_ATTRS = new Set([
  'choices',
  'filter',
  'filter-default-values',
  'options',
]);

// Attributes that should be coerced to Number.
export const NUMERIC_ATTRS = new Set(['per-page', 'page', 'min', 'max', 'step']);

// Attributes that are not descriptor keys (styling / DOM plumbing).
const IGNORED_ATTRS = new Set(['class', 'style', 'id', 'slot']);

const safeJsonParse = (value) => {
  try {
    return JSON.parse(value);
  } catch (_) {
    return value;
  }
};

// Apply a single kebab-case attribute onto a descriptor, coercing per the table in doc 10 §2.3.
export const applyAttribute = (descriptor, name, value) => {
  if (IGNORED_ATTRS.has(name)) return descriptor;

  // sort-field + sort-order collapse into sort: { field, order }.
  if (name === 'sort-field') {
    descriptor.sort = { ...(descriptor.sort || {}), field: value };
    return descriptor;
  }
  if (name === 'sort-order') {
    descriptor.sort = { ...(descriptor.sort || {}), order: value };
    return descriptor;
  }

  const key = camelCase(name);

  // Attribute removed (attributeChangedCallback with null).
  if (value == null) {
    if (BOOLEAN_ATTRS.has(name)) descriptor[key] = false;
    else delete descriptor[key];
    return descriptor;
  }

  if (BOOLEAN_ATTRS.has(name)) {
    descriptor[key] = value !== 'false';
    return descriptor;
  }
  if (JSON_ATTRS.has(name)) {
    descriptor[key] = safeJsonParse(value);
    return descriptor;
  }
  if (NUMERIC_ATTRS.has(name)) {
    const n = Number(value);
    descriptor[key] = Number.isNaN(n) ? value : n;
    return descriptor;
  }

  descriptor[key] = value;
  return descriptor;
};

// Read every attribute of an element into a descriptor (mutating and returning it).
// `validate` is DSL-parsed into an array of validator functions (needs the resolved source).
export const absorbAttributes = (descriptor, el) => {
  let validateDSL = null;
  for (const attr of Array.from(el.attributes || [])) {
    if (attr.name === 'validate') {
      validateDSL = attr.value;
      continue;
    }
    applyAttribute(descriptor, attr.name, attr.value);
  }
  if (validateDSL != null) {
    descriptor.validate = parseValidatorDSL(validateDSL, {
      tag: el.localName,
      source: descriptor.source,
    });
  }
  return descriptor;
};

// Build a fresh descriptor of the given kind from an element's attributes, seeded from any
// pre-set `.descriptor` own-property (the JS-config path: admin.js sets `viewEl.descriptor = {...}`
// before the element ever connects; view components like <sa-list>/<sa-edit> only ever call this
// function, so without this seed step JS-config scalar values — sort/perPage/rowClick/redirect/
// etc. — would be silently discarded in favor of an attribute-only rebuild). Attributes (HTML path)
// take precedence over the seed when both are present, since attributes reflect the most recent
// author intent for an element that started life with a JS-config base.
export const descriptorFromElement = (el, kind) => {
  const seed = el && el.descriptor && typeof el.descriptor === 'object' ? el.descriptor : null;
  return absorbAttributes({ kind, ...seed }, el);
};

// Normalize a JS-config object into a descriptor (ensures `kind`, otherwise pass-through).
// `validate` may be a DSL string here too; parse it for structural parity with the HTML path.
export const normalizeConfig = (config = {}, kind) => {
  const descriptor = { kind, ...config };
  if (typeof descriptor.validate === 'string') {
    descriptor.validate = parseValidatorDSL(descriptor.validate, { source: descriptor.source });
  }
  return descriptor;
};
