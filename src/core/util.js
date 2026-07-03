// Shared, dependency-free helpers used across the core, fields and inputs.

// camelCase -> kebab-case. 'referenceArray' -> 'reference-array'. (doc 10 §2.3 / doc 13 §1.1)
export const kebab = (s) =>
  String(s)
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase();

// kebab-case -> camelCase. 'empty-text' -> 'emptyText', 'read-only' -> 'readOnly'.
export const camelCase = (s) =>
  String(s).replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());

// 'author_id' -> 'Author id', 'publishedAt' -> 'Published at' (doc 13 §2.1 label derivation).
export const humanize = (source) => {
  if (source == null) return '';
  // Use the last dot-path segment so 'author.name' humanizes to 'Name'.
  const leaf = String(source).split('.').pop();
  const spaced = leaf
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (!spaced) return '';
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

// Read a dot-path (and array-index) value from an object.
// getByPath(record, 'author.name') -> record.author?.name
// getByPath(record, 'tags.0.id')   -> record.tags?.[0]?.id
export const getByPath = (obj, path) => {
  if (obj == null || path == null || path === '') return undefined;
  if (Object.prototype.hasOwnProperty.call(obj, path)) return obj[path];
  const segments = String(path).split('.');
  let current = obj;
  for (const segment of segments) {
    if (current == null) return undefined;
    current = current[segment];
  }
  return current;
};

// Immutably set a dot-path value, returning a shallow-cloned new object graph
// along the touched path (so signal identity changes and effects re-run).
export const setByPath = (obj, path, value) => {
  const root = Array.isArray(obj) ? obj.slice() : { ...(obj || {}) };
  if (path == null || path === '') return root;
  if (!String(path).includes('.')) {
    root[path] = value;
    return root;
  }
  const segments = String(path).split('.');
  let cursor = root;
  for (let i = 0; i < segments.length - 1; i++) {
    const key = segments[i];
    const existing = cursor[key];
    const clone = Array.isArray(existing) ? existing.slice() : { ...(existing || {}) };
    cursor[key] = clone;
    cursor = clone;
  }
  cursor[segments[segments.length - 1]] = value;
  return root;
};

// Deterministic JSON stringify with sorted object keys — used for stable cache keys.
export const stableStringify = (value) => {
  const seen = new WeakSet();
  const walk = (v) => {
    if (v == null || typeof v !== 'object') return v;
    if (seen.has(v)) return null;
    seen.add(v);
    if (Array.isArray(v)) return v.map(walk);
    const out = {};
    for (const key of Object.keys(v).sort()) out[key] = walk(v[key]);
    return out;
  };
  return JSON.stringify(walk(value));
};
