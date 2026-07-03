// Actionable console hints on misconfiguration (architecture §11, doc 13 §6).
//
// Every message: (1) is prefixed "[simple-admin]", (2) names the element/resource/source at fault,
// (3) states the likely cause, (4) states the fix. Messages are deduped (same text logged once)
// and gated by setLogLevel('silent'|'error'|'warn'|'verbose').

const LEVELS = { silent: 0, error: 1, warn: 2, verbose: 3 };
let currentLevel = LEVELS.warn;

const seen = new Set();

export const setLogLevel = (level) => {
  if (!(level in LEVELS)) return;
  currentLevel = LEVELS[level];
};

export const getLogLevel = () =>
  Object.keys(LEVELS).find((k) => LEVELS[k] === currentLevel) || 'warn';

// Message templates keyed by diagnostic code. Each receives the `detail` object.
const TEMPLATES = {
  'unknown-element': (d) =>
    `Unknown element <${d.tag}> inside <${d.parentTag}${d.resource ? ` resource="${d.resource}"` : ''}>. ` +
    `This tag is not a registered field/input. ${d.suggestion ? `Did you mean <${d.suggestion}>? ` : ''}` +
    `Register it with SimpleAdmin.registerField('${d.type ?? '…'}', …) or remove it. Skipping this column.`,

  'field-missing-source': (d) =>
    `<${d.tag}> is missing the required "source" attribute (inside ${d.ctx}). ` +
    `Add source="fieldName" so it knows which record property to display. Skipping.`,

  'input-missing-source': (d) =>
    `<${d.tag}> is missing the required "source" attribute (inside ${d.ctx}). ` +
    `Add source="fieldName" so it knows which record property to bind. Skipping.`,

  'field-no-record-context': (d) =>
    `<${d.tag}${d.source ? ` source="${d.source}"` : ''}> could not find a record to read from. ` +
    `A field must live inside a record context such as <sa-datagrid>, <sa-simple-show-layout>, or ` +
    `<sa-reference-field>. Rendering nothing.`,

  'input-no-form': (d) =>
    `<${d.tag}${d.source ? ` source="${d.source}"` : ''}> is not inside a <sa-simple-form>, ` +
    `<sa-tabbed-form>, or <sa-filters>. It has no FormStore to bind to and will not save. ` +
    `Move it inside a form.`,

  'provider-method-missing': (d) =>
    `dataProvider.${d.method} is not a function, but resource "${d.resource}" tried a ${d.operation}` +
    `${d.target ? ` (target="${d.target}")` : ''}. Add ${d.method}(resource, params) to your dataProvider. ` +
    `See _docs/react-admin/02-data-provider.md.`,

  'resource-no-views': (d) =>
    `Resource "${d.resource}" was declared without any of list/edit/create/show views. ` +
    `It will register for reference lookups only and show no menu entry. If that is intentional, ignore this hint.`,

  'reference-undeclared': (d) =>
    `<sa-reference-field reference="${d.reference}"> in resource "${d.resource}" points to resource ` +
    `"${d.reference}", which is not declared in <sa-admin>. Declare <sa-resource name="${d.reference}"> ` +
    `(even with no views) so its records can be fetched. Rendering the raw id for now.`,

  'route-view-missing': (d) =>
    `Route ${d.hash} requested the "${d.view}" view, but resource "${d.resource}" has no ${d.view} view ` +
    `configured. Redirecting to the list. Add <sa-${d.view}> or an ${d.view}:{} config to enable it.`,

  'validate-both-levels': (d) =>
    `Form for "${d.resource}" has both form-level validate and input-level validate on <${d.tag}` +
    `${d.source ? ` source="${d.source}"` : ''}>. Like react-admin/react-hook-form, these are mutually ` +
    `exclusive — the form-level validator will be ignored for that field. Pick one.`,

  'filter-alwayson-defaultvalue': (d) =>
    `Filter <${d.tag}${d.source ? ` source="${d.source}"` : ''}> has both always-on and default-value, ` +
    `which react-admin disallows. Use filter-default-values on <sa-list> for a default the user can change. ` +
    `Ignoring default-value.`,

  'unknown-validator': (d) =>
    `Unknown validator "${d.name}" in validate="${d.dsl}"${d.source ? ` on <${d.tag} source="${d.source}">` : ''}. ` +
    `Valid names: required, minLength, maxLength, minValue, maxValue, number, email, regex, choices. ` +
    `Skipping the unknown one.`,

  'no-data-provider': () =>
    `<sa-admin> was mounted without a dataProvider. Nothing can load. Pass one via ` +
    `SimpleAdmin.admin({ dataProvider }) or the .dataProvider property. See 02-data-provider.md.`,

  'no-auth-provider': () =>
    `requireAuth is set but no authProvider was provided to <sa-admin>. Either remove requireAuth or ` +
    `supply an authProvider with checkAuth/login. See 03-auth-provider.md.`,

  'record-missing-id': (d) =>
    `A record returned by dataProvider.getList("${d.resource}") has no "id" field: ${previewRecord(d.record)}. ` +
    `Every record must have a unique id (string|number). Rows may not update or select correctly.`,

  'field-reregistered': (d) =>
    `A field type "${d.type}" is already registered. Ignoring the second ` +
    `SimpleAdmin.registerField('${d.type}', …). Use a distinct type name.`,

  'input-reregistered': (d) =>
    `An input type "${d.type}" is already registered. Ignoring the second ` +
    `SimpleAdmin.registerInput('${d.type}', …). Use a distinct type name.`,

  'list-no-body': (d) =>
    `<sa-list${d.resource ? ` resource="${d.resource}"` : ''}> has no <sa-datagrid> (or ` +
    `<sa-simple-list>) child. Add one so records have something to render into.`,

  'datagrid-no-list': () =>
    `<sa-datagrid> is not inside a <sa-list>. It has no ListController to read data/selection ` +
    `from. Move it inside <sa-list>...</sa-list>.`,

  'pagination-no-list': () =>
    `<sa-pagination> is not inside a <sa-list>. It has no ListController to read page/total from.`,
};

const previewRecord = (record) => {
  try {
    const json = JSON.stringify(record);
    if (json == null) return String(record);
    return json.length > 60 ? `${json.slice(0, 57)}…}` : json;
  } catch (_) {
    return String(record);
  }
};

// Build the final message string. A caller may pass an explicit `message` in detail
// (doc 13 §6 — custom component codes), which is used verbatim.
const format = (code, detail = {}) => {
  if (detail && typeof detail.message === 'string') return detail.message;
  const template = TEMPLATES[code];
  const body = template ? template(detail) : `${code} ${safeDetail(detail)}`;
  return `[simple-admin] ${body}`;
};

const safeDetail = (detail) => {
  try {
    return JSON.stringify(detail);
  } catch (_) {
    return '';
  }
};

const emit = (minLevel, consoleMethod, code, detail) => {
  if (currentLevel < minLevel) return;
  const message = format(code, detail);
  if (seen.has(message)) return;
  seen.add(message);
  consoleMethod(message);
};

export const warn = (code, detail) => emit(LEVELS.warn, console.warn, code, detail);
export const error = (code, detail) => emit(LEVELS.error, console.error, code, detail);

// Test/tooling seam: forget the dedupe history.
export const _resetDiagnostics = () => seen.clear();
