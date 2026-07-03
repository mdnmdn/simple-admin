// Built-in field validators mirroring react-admin (architecture §9.3).
//
// Each factory returns a validator: (value, allValues, meta) => undefined | string.
// Validators run in order, first failure wins. `required()`'s validator carries an
// `isRequired` flag so an input can append "*" to its label.

import * as diagnostics from '../core/diagnostics.js';

const isEmpty = (value) =>
  value == null ||
  value === '' ||
  (Array.isArray(value) && value.length === 0);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const required = (message = 'Required') => {
  const validator = (value) => (isEmpty(value) ? message : undefined);
  validator.isRequired = true;
  return validator;
};

export const minLength = (min, message) => (value) =>
  !isEmpty(value) && String(value).length < min
    ? message ?? `Must be ${min} characters at least`
    : undefined;

export const maxLength = (max, message) => (value) =>
  !isEmpty(value) && String(value).length > max
    ? message ?? `Must be ${max} characters or fewer`
    : undefined;

export const minValue = (min, message) => (value) =>
  !isEmpty(value) && Number(value) < min
    ? message ?? `Must be at least ${min}`
    : undefined;

export const maxValue = (max, message) => (value) =>
  !isEmpty(value) && Number(value) > max
    ? message ?? `Must be ${max} or less`
    : undefined;

export const number = (message = 'Must be a number') => (value) =>
  !isEmpty(value) && Number.isNaN(Number(value)) ? message : undefined;

export const email = (message = 'Must be a valid email') => (value) =>
  !isEmpty(value) && !EMAIL_RE.test(String(value)) ? message : undefined;

export const regex = (pattern, message = 'Invalid format') => {
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern);
  return (value) => (!isEmpty(value) && !re.test(String(value)) ? message : undefined);
};

export const choices = (list, message = 'Invalid choice') => {
  const allowed = Array.isArray(list) ? list : [];
  return (value) => {
    if (isEmpty(value)) return undefined;
    const values = Array.isArray(value) ? value : [value];
    return values.every((v) => allowed.includes(v)) ? undefined : message;
  };
};

// The DSL vocabulary: name -> factory. Names match the descriptor/HTML DSL exactly.
const FACTORIES = {
  required,
  minLength,
  maxLength,
  minValue,
  maxValue,
  number,
  email,
  regex,
  choices,
};

const coerceArg = (raw) => {
  const trimmed = raw.trim();
  if (trimmed === '') return trimmed;
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  const asNumber = Number(trimmed);
  return Number.isNaN(asNumber) ? trimmed : asNumber;
};

// Parse "required|minLength:2|maxLength:15" into an array of validator functions.
// Unknown validator names emit the 'unknown-validator' diagnostic (architecture §11) and are skipped.
export const parseValidatorDSL = (str, meta = {}) => {
  if (!str || typeof str !== 'string') return [];
  const validators = [];
  for (const token of str.split('|')) {
    const trimmed = token.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(':');
    const name = colon === -1 ? trimmed : trimmed.slice(0, colon);
    const argString = colon === -1 ? '' : trimmed.slice(colon + 1);
    const factory = FACTORIES[name];
    if (!factory) {
      diagnostics.error('unknown-validator', {
        name,
        dsl: str,
        tag: meta.tag,
        source: meta.source,
      });
      continue;
    }
    const args = argString === '' ? [] : argString.split(',').map(coerceArg);
    validators.push(factory(...args));
  }
  return validators;
};

// Normalize whatever a descriptor's `validate` holds into an array of validator functions:
// an array of fns (pass-through), a single fn, or a DSL string.
export const compileValidators = (validate, meta = {}) => {
  if (!validate) return [];
  if (Array.isArray(validate)) return validate.filter((v) => typeof v === 'function');
  if (typeof validate === 'function') return [validate];
  if (typeof validate === 'string') return parseValidatorDSL(validate, meta);
  return [];
};
