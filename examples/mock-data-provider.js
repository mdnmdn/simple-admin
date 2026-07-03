// createMockDataProvider — pure in-memory DataProvider (doc 02 §1-2) for examples/demos.
// Self-contained: no dependency on the REST providers or fetchJson. Implements the full 9-method
// interface against a deep-cloned copy of `seedData` (shape: `{ [resource]: record[] }`), never
// mutating the caller's original object.

const DELAY_MS = 150;

const delay = (value) => new Promise((resolve) => setTimeout(() => resolve(value), DELAY_MS));

const deepClone = (value) =>
  typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));

const compare = (a, b) => {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b);
  return a > b ? 1 : -1;
};

const matchesFilter = (record, filter) =>
  Object.keys(filter || {}).every((key) => {
    const filterValue = filter[key];
    if (filterValue === undefined || filterValue === null) return true;
    if (key === 'id' || key === 'ids') {
      const ids = Array.isArray(filterValue) ? filterValue : [filterValue];
      // eslint-disable-next-line eqeqeq
      return ids.some((id) => id == record.id);
    }
    const recordValue = record[key];
    if (Array.isArray(filterValue)) {
      return filterValue.includes(recordValue);
    }
    if (typeof filterValue === 'string' && typeof recordValue === 'string') {
      return recordValue.toLowerCase().includes(filterValue.toLowerCase());
    }
    return recordValue === filterValue;
  });

const nextId = (rows) =>
  rows.reduce((max, row) => (typeof row.id === 'number' && row.id >= max ? row.id + 1 : max), 1);

export const createMockDataProvider = (seedData) => {
  const store = deepClone(seedData);

  const rowsOf = (resource) => {
    if (!store[resource]) store[resource] = [];
    return store[resource];
  };

  return {
    getList: (resource, params) => {
      const { page = 1, perPage = 25 } = params.pagination || {};
      const { field, order = 'ASC' } = params.sort || {};
      let rows = rowsOf(resource).filter((row) => matchesFilter(row, params.filter));
      if (field) {
        rows = [...rows].sort((a, b) => (order === 'DESC' ? -1 : 1) * compare(a[field], b[field]));
      }
      const total = rows.length;
      const start = (page - 1) * perPage;
      const data = deepClone(rows.slice(start, start + perPage));
      return delay({ data, total });
    },

    getOne: (resource, params) => {
      // eslint-disable-next-line eqeqeq
      const row = rowsOf(resource).find((r) => r.id == params.id);
      if (!row) return Promise.reject(new Error(`${resource} with id ${params.id} not found`));
      return delay({ data: deepClone(row) });
    },

    getMany: (resource, params) => {
      const ids = params.ids || [];
      // eslint-disable-next-line eqeqeq
      const rows = rowsOf(resource).filter((r) => ids.some((id) => id == r.id));
      return delay({ data: deepClone(rows) });
    },

    getManyReference: (resource, params) => {
      const { page = 1, perPage = 25 } = params.pagination || {};
      const { field, order = 'ASC' } = params.sort || {};
      const filter = { ...(params.filter || {}), [params.target]: params.id };
      let rows = rowsOf(resource).filter((row) => matchesFilter(row, filter));
      if (field) {
        rows = [...rows].sort((a, b) => (order === 'DESC' ? -1 : 1) * compare(a[field], b[field]));
      }
      const total = rows.length;
      const start = (page - 1) * perPage;
      const data = deepClone(rows.slice(start, start + perPage));
      return delay({ data, total });
    },

    create: (resource, params) => {
      const rows = rowsOf(resource);
      const record = { ...deepClone(params.data), id: nextId(rows) };
      rows.push(record);
      return delay({ data: deepClone(record) });
    },

    update: (resource, params) => {
      const rows = rowsOf(resource);
      // eslint-disable-next-line eqeqeq
      const index = rows.findIndex((r) => r.id == params.id);
      if (index === -1) return Promise.reject(new Error(`${resource} with id ${params.id} not found`));
      rows[index] = { ...rows[index], ...deepClone(params.data), id: rows[index].id };
      return delay({ data: deepClone(rows[index]) });
    },

    updateMany: (resource, params) => {
      const rows = rowsOf(resource);
      const ids = [];
      params.ids.forEach((id) => {
        // eslint-disable-next-line eqeqeq
        const index = rows.findIndex((r) => r.id == id);
        if (index !== -1) {
          rows[index] = { ...rows[index], ...deepClone(params.data), id: rows[index].id };
          ids.push(rows[index].id);
        }
      });
      return delay({ data: ids });
    },

    delete: (resource, params) => {
      const rows = rowsOf(resource);
      // eslint-disable-next-line eqeqeq
      const index = rows.findIndex((r) => r.id == params.id);
      if (index === -1) return Promise.reject(new Error(`${resource} with id ${params.id} not found`));
      const [removed] = rows.splice(index, 1);
      return delay({ data: deepClone(removed) });
    },

    deleteMany: (resource, params) => {
      const rows = rowsOf(resource);
      const ids = [];
      params.ids.forEach((id) => {
        // eslint-disable-next-line eqeqeq
        const index = rows.findIndex((r) => r.id == id);
        if (index !== -1) {
          ids.push(rows[index].id);
          rows.splice(index, 1);
        }
      });
      return delay({ data: ids });
    },
  };
};

const AUTHORS = [
  { id: 1, name: 'Ada Lovelace', email: 'ada@example.com' },
  { id: 2, name: 'Alan Turing', email: 'alan@example.com' },
  { id: 3, name: 'Grace Hopper', email: 'grace@example.com' },
  { id: 4, name: 'Margaret Hamilton', email: 'margaret@example.com' },
];

const POST_TITLES = [
  'Getting started with data providers',
  'A tour of the datagrid',
  'Building forms without a framework',
  'Signals vs virtual DOM',
  'Theming with CSS custom properties',
  'Hash routing for admin panels',
  'Writing your first REST provider',
  'Reference fields explained',
  'Optimistic vs pessimistic mutations',
  'Batching getMany calls',
  'Light DOM web components',
  'BEM naming for design systems',
  'Filters and debounced search',
  'Pagination strategies compared',
  'Shipping without a build step',
];

export const defaultSeedData = {
  authors: AUTHORS,
  posts: POST_TITLES.map((title, index) => ({
    id: index + 1,
    title,
    body: `Body copy for "${title}". Lorem ipsum dolor sit amet, consectetur adipiscing elit.`,
    published_at: new Date(2026, 0, 1 + index * 3).toISOString().slice(0, 10),
    author_id: AUTHORS[index % AUTHORS.length].id,
    is_published: index % 3 !== 0,
  })),
};

export default createMockDataProvider;
