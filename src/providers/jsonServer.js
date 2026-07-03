// saDataJsonServer — port of ra-data-json-server (doc 02 §3.5), targeting a plain `json-server`
// backend. Wire format:
//   getList          GET /{resource}?_sort=field&_order=ASC&_start=0&_end=25
//   getOne            GET /{resource}/{id}
//   getMany           GET /{resource}?id=1&id=2&id=3           (repeated params, not a JSON blob)
//   getManyReference  GET /{resource}?<target>=<id>&_sort=...&_start=...&_end=...
//   create            POST /{resource}
//   update            PUT /{resource}/{id}
//   delete            DELETE /{resource}/{id}
// Total count is read from the `X-Total-Count` response header only (no Content-Range support
// in json-server). json-server has no native batch-write endpoint, so updateMany/deleteMany fall
// back to N sequential single-record requests (issued in parallel here, same net effect).

import { fetchJson } from './fetchJson.js';

const buildQuery = (params) => {
  const query = new URLSearchParams();
  Object.keys(params).forEach((key) => {
    const value = params[key];
    if (value === undefined) return;
    if (Array.isArray(value)) {
      value.forEach((v) => query.append(key, v));
    } else {
      query.set(key, value);
    }
  });
  return query.toString();
};

const getTotal = (headers) => {
  const totalCount = headers.get('x-total-count');
  if (totalCount === null) return undefined;
  const total = parseInt(totalCount, 10);
  return Number.isNaN(total) ? undefined : total;
};

export const saDataJsonServer = (apiUrl, httpClient = fetchJson) => ({
  getList: async (resource, params) => {
    const { page, perPage } = params.pagination;
    const { field, order } = params.sort;
    const query = buildQuery({
      ...(params.filter || {}),
      _sort: field,
      _order: order,
      _start: (page - 1) * perPage,
      _end: page * perPage,
    });
    const { json, headers } = await httpClient(`${apiUrl}/${resource}?${query}`, {
      signal: params.signal,
    });
    return { data: json, total: getTotal(headers) };
  },

  getOne: async (resource, params) => {
    const { json } = await httpClient(`${apiUrl}/${resource}/${params.id}`, {
      signal: params.signal,
    });
    return { data: json };
  },

  // json-server has no `filter={"ids":[...]}` shorthand; use repeated `id=` params instead.
  getMany: async (resource, params) => {
    const query = buildQuery({ id: params.ids });
    const { json } = await httpClient(`${apiUrl}/${resource}?${query}`, {
      signal: params.signal,
    });
    return { data: json };
  },

  getManyReference: async (resource, params) => {
    const { page, perPage } = params.pagination;
    const { field, order } = params.sort;
    const query = buildQuery({
      ...(params.filter || {}),
      [params.target]: params.id,
      _sort: field,
      _order: order,
      _start: (page - 1) * perPage,
      _end: page * perPage,
    });
    const { json, headers } = await httpClient(`${apiUrl}/${resource}?${query}`, {
      signal: params.signal,
    });
    return { data: json, total: getTotal(headers) };
  },

  create: async (resource, params) => {
    const { json } = await httpClient(`${apiUrl}/${resource}`, {
      method: 'POST',
      body: JSON.stringify(params.data),
    });
    return { data: json };
  },

  update: async (resource, params) => {
    const { json } = await httpClient(`${apiUrl}/${resource}/${params.id}`, {
      method: 'PUT',
      body: JSON.stringify(params.data),
    });
    return { data: json };
  },

  // Fallback: N sequential (here, parallel) individual PUT requests — json-server has no bulk
  // update endpoint.
  updateMany: async (resource, params) => {
    const ids = await Promise.all(
      params.ids.map((id) =>
        httpClient(`${apiUrl}/${resource}/${id}`, {
          method: 'PUT',
          body: JSON.stringify(params.data),
        }).then(() => id)
      )
    );
    return { data: ids };
  },

  delete: async (resource, params) => {
    const { json } = await httpClient(`${apiUrl}/${resource}/${params.id}`, {
      method: 'DELETE',
    });
    return { data: json };
  },

  // Fallback: N sequential (here, parallel) individual DELETE requests — same reasoning as
  // updateMany.
  deleteMany: async (resource, params) => {
    const ids = await Promise.all(
      params.ids.map((id) =>
        httpClient(`${apiUrl}/${resource}/${id}`, { method: 'DELETE' }).then(() => id)
      )
    );
    return { data: ids };
  },
});

export default saDataJsonServer;
