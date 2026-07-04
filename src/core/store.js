// Per-view reactive controllers (architecture §4.1(b) and §9.2).
//
// createListController — signal-backed ListContext; re-issues getList when page/perPage/sort
//   change (immediately) or filterValues change (debounced 500ms, matching react-admin).
// createFormController — the centralized FormStore: values/errors/touched/dirty/isValid plus
//   getField/setField/validateField/validateAll and register/unregister for inputs.

import { signal, computed, effect } from './signal.js';
import { getByPath, setByPath, stableStringify } from './util.js';
import { getDataProvider } from './registry.js';
import * as diagnostics from './diagnostics.js';

const FILTER_DEBOUNCE_MS = 500;

export const createListController = (descriptor = {}, { dataProvider } = {}) => {
  const resource = descriptor.resource;

  const initialSort =
    descriptor.sort && descriptor.sort.field
      ? { field: descriptor.sort.field, order: descriptor.sort.order || 'ASC' }
      : { field: 'id', order: 'DESC' };
  const initialPerPage = Number(descriptor.perPage) || 10;

  const data = signal([]);
  const total = signal(0);
  const pageInfo = signal(null);
  const isPending = signal(true);
  const error = signal(null);
  const page = signal(1);
  const perPage = signal(initialPerPage);
  const sort = signal(initialSort);
  const filterValues = signal({ ...(descriptor.filterDefaultValues || {}) });
  const selectedIds = signal([]);

  let currentAbort = null;
  let debounceTimer = null;
  let disposed = false;
  let waitedForProvider = false;

  const runFetch = async () => {
    if (disposed) return;
    if (!dataProvider || typeof dataProvider.getList !== 'function') {
      // The registry provider may be published a moment after this controller was created:
      // HTML-authored <sa-list> elements upgrade (and fetch) during the `import` of index.js,
      // while `admin.dataProvider = ...` runs a few lines later in the same module script.
      // Give it one microtask (module scripts finish before microtasks run) before diagnosing.
      const late = getDataProvider();
      if (late && typeof late.getList === 'function') {
        dataProvider = late;
      } else if (!waitedForProvider) {
        waitedForProvider = true;
        queueMicrotask(runFetch);
        return;
      } else {
        diagnostics.error('provider-method-missing', {
          method: 'getList',
          resource,
          operation: 'list lookup',
        });
        isPending.set(false);
        return;
      }
    }

    if (currentAbort) currentAbort.abort();
    const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
    currentAbort = ac;

    isPending.set(true);
    error.set(null);

    try {
      const result = await dataProvider.getList(resource, {
        pagination: { page: page.peek(), perPage: perPage.peek() },
        sort: sort.peek(),
        filter: { ...(descriptor.filter || {}), ...filterValues.peek() },
        signal: ac ? ac.signal : undefined,
      });
      if (disposed || (ac && ac.signal.aborted)) return;

      const rows = result.data || [];
      for (const record of rows) {
        if (record && record.id == null) {
          diagnostics.warn('record-missing-id', { resource, record });
        }
      }
      data.set(rows);
      if (result.total != null) total.set(result.total);
      pageInfo.set(result.pageInfo || null);
      isPending.set(false);
    } catch (err) {
      if (disposed || (ac && ac.signal.aborted)) return;
      error.set(err);
      isPending.set(false);
    }
  };

  const scheduleFetch = (debounced) => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (debounced) debounceTimer = setTimeout(runFetch, FILTER_DEBOUNCE_MS);
    else runFetch();
  };

  // Effects establish dependencies immediately but only react after the initial fetch,
  // so startup performs exactly one getList.
  let started = false;
  const disposePaging = effect(() => {
    page.get();
    perPage.get();
    sort.get();
    if (started) scheduleFetch(false);
  });
  const disposeFilters = effect(() => {
    filterValues.get();
    if (started) scheduleFetch(true);
  });
  started = true;
  runFetch();

  const dispose = () => {
    disposed = true;
    disposePaging();
    disposeFilters();
    if (debounceTimer) clearTimeout(debounceTimer);
    if (currentAbort) currentAbort.abort();
  };

  return {
    descriptor,
    resource,
    // state signals
    data,
    total,
    pageInfo,
    isPending,
    error,
    page,
    perPage,
    sort,
    filterValues,
    selectedIds,
    // mutators
    setPage: (p) => page.set(p),
    setPerPage: (n) => {
      perPage.set(n);
      page.set(1);
    },
    setSort: (field, order) => {
      const current = sort.peek();
      const nextOrder =
        order || (current.field === field && current.order === 'ASC' ? 'DESC' : 'ASC');
      sort.set({ field, order: nextOrder });
    },
    setFilters: (values) => {
      filterValues.set({ ...values });
      page.set(1);
    },
    setFilterValue: (key, value) => {
      filterValues.set({ ...filterValues.peek(), [key]: value });
      page.set(1);
    },
    // selection
    select: (id) => {
      if (!selectedIds.peek().includes(id)) selectedIds.set([...selectedIds.peek(), id]);
    },
    deselect: (id) => selectedIds.set(selectedIds.peek().filter((x) => x !== id)),
    toggleSelect: (id) => {
      const ids = selectedIds.peek();
      selectedIds.set(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
    },
    clearSelection: () => selectedIds.set([]),
    refetch: runFetch,
    dispose,
  };
};

export const createFormController = (descriptor = {}, { dataProvider, record } = {}) => {
  const seed = { ...(descriptor.defaultValues || {}), ...(record || {}) };

  const values = signal(seed);
  const errors = signal({});
  const touched = signal({});
  const initial = signal(seed);

  // source -> { defaultValue, validators, parse, format }
  const registry = new Map();

  const getField = (source) => getByPath(values.get(), source);
  const getError = (source) => errors.get()[source];
  const isTouched = (source) => !!touched.get()[source];

  const validateField = (source) => {
    const entry = registry.get(source);
    if (!entry || !entry.validators || entry.validators.length === 0) {
      clearError(source);
      return undefined;
    }
    const allValues = values.peek();
    const value = getByPath(allValues, source);
    let message;
    for (const validator of entry.validators) {
      const result = validator(value, allValues, { source });
      if (result !== undefined) {
        message = typeof result === 'string' ? result : result.message ?? String(result);
        break;
      }
    }
    const nextErrors = { ...errors.peek() };
    if (message) nextErrors[source] = message;
    else delete nextErrors[source];
    errors.set(nextErrors);
    return message;
  };

  const clearError = (source) => {
    if (errors.peek()[source] === undefined) return;
    const nextErrors = { ...errors.peek() };
    delete nextErrors[source];
    errors.set(nextErrors);
  };

  const setField = (source, value) => {
    values.set(setByPath(values.peek(), source, value));
    validateField(source);
  };

  const setValues = (next) => {
    values.set({ ...next });
  };

  const touch = (source) => {
    if (touched.peek()[source]) return;
    touched.set({ ...touched.peek(), [source]: true });
  };

  const register = (source, options = {}) => {
    registry.set(source, options);
    if (
      options.defaultValue !== undefined &&
      getByPath(values.peek(), source) === undefined
    ) {
      values.set(setByPath(values.peek(), source, options.defaultValue));
      initial.set(setByPath(initial.peek(), source, options.defaultValue));
    }
  };

  const unregister = (source) => registry.delete(source);

  const validateAll = () => {
    // A submit attempt touches every registered field (react-admin semantics): inputs only
    // DISPLAY an error once their field is touched, so without this, a failed submit of a
    // pristine form would set errors that no input ever shows.
    const nextTouched = { ...touched.peek() };
    let valid = true;
    for (const source of registry.keys()) {
      nextTouched[source] = true;
      if (validateField(source)) valid = false;
    }
    touched.set(nextTouched);
    return valid;
  };

  const reset = (nextRecord) => {
    const base = { ...(descriptor.defaultValues || {}), ...(nextRecord || record || {}) };
    values.set(base);
    initial.set(base);
    errors.set({});
    touched.set({});
  };

  const dirty = computed(
    () => stableStringify(values.get()) !== stableStringify(initial.get())
  );
  const isValid = computed(() => Object.keys(errors.get()).length === 0);

  return {
    descriptor,
    dataProvider,
    // state
    values,
    errors,
    touched,
    initial,
    dirty,
    isValid,
    // field accessors
    getField,
    setField,
    setValues,
    getError,
    touch,
    isTouched,
    // registration
    register,
    unregister,
    // validation
    validateField,
    validateAll,
    reset,
  };
};
