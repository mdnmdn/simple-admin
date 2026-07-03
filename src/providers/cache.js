// Map-based query cache (architecture §4.3). Keyed by resource + serialized params so a
// getOne after a getList can reuse data and identical getLists dedupe. Invalidated explicitly
// by resource after create/update/delete (no automatic dependency tracking without react-query).

import { stableStringify } from '../core/util.js';

export const createQueryCache = () => {
  const store = new Map();

  const keyOf = (resource, params) => `${resource}::${stableStringify(params ?? null)}`;

  return {
    get(resource, params) {
      return store.get(keyOf(resource, params));
    },
    has(resource, params) {
      return store.has(keyOf(resource, params));
    },
    set(resource, params, value) {
      store.set(keyOf(resource, params), value);
      return value;
    },
    // Invalidate one resource's entries, or the whole cache when resource is omitted.
    invalidate(resource) {
      if (resource == null) {
        store.clear();
        return;
      }
      const prefix = `${resource}::`;
      for (const key of store.keys()) {
        if (key.startsWith(prefix)) store.delete(key);
      }
    },
    clear() {
      store.clear();
    },
    get size() {
      return store.size;
    },
  };
};

export default createQueryCache;
