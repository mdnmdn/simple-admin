// Shared helpers for choice-based inputs (select/selectArray/checkboxGroup/autocomplete*) —
// mirrors the choices/optionText/optionValue conventions (doc 06 §5). Not a registered
// field/input itself, just plumbing reused by the concrete choice inputs.

// A plain string/number choice is auto-normalized to { id, name } (doc 06 §5).
export const normalizeChoices = (list) =>
  (Array.isArray(list) ? list : []).map((c) =>
    typeof c === 'object' && c !== null ? c : { id: c, name: String(c) }
  );

// optionText may be a string field name or a function(choice) -> label.
export const labelFor = (choice, optionText) => {
  if (!choice) return '';
  return typeof optionText === 'function' ? optionText(choice) : choice[optionText];
};

export const valueFor = (choice, optionValue) => (choice ? choice[optionValue] : undefined);

// Resolve a raw control-side value (usually a string, e.g. from a <select>) back to the actual
// choice's stored value (preserving type — ids are often numbers) by matching on string form.
export const resolveChoiceValue = (choices, optionValue, raw) => {
  const match = choices.find((c) => String(valueFor(c, optionValue)) === String(raw));
  return match ? valueFor(match, optionValue) : raw;
};
