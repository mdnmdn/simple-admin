// saDataSimpleRest — faithful port of ra-data-simple-rest (doc 02 §3), using plain
// URLSearchParams instead of the `query-string` package. Wire format:
//   getList          GET /{resource}?sort=["field","order"]&range=[start,end]&filter={...}
//   getOne            GET /{resource}/{id}
//   getMany           GET /{resource}?filter={"ids":[...]}
//   getManyReference  GET /{resource}?sort=...&range=...&filter={..., [target]: id}
//   create            POST /{resource}
//   update            PUT /{resource}/{id}
//   updateMany        PUT /{resource}?filter={"id":[...]}
//   delete            DELETE /{resource}/{id}
//   deleteMany        DELETE /{resource}?filter={"id":[...]}
// Total count is read from the `Content-Range` header (`items 0-24/319` format), falling back
// to `X-Total-Count` when present instead.

import { fetchJson } from './fetchJson.js';

const buildQuery = (params) => {
  const query = new URLSearchParams();
  Object.keys(params).forEach((key) => {
    if (params[key] !== undefined) query.set(key, params[key]);
  });
  return query.toString();
};

const getTotal = (headers) => {
  const contentRange = headers.get('content-range');
  if (contentRange) {
    const total = parseInt(contentRange.split('/').pop(), 10);
    if (!Number.isNaN(total)) return total;
  }
  const totalCount = headers.get('x-total-count');
  if (totalCount !== null) {
    const total = parseInt(totalCount, 10);
    if (!Number.isNaN(total)) return total;
  }
  return undefined;
};

export const saDataSimpleRest = (apiUrl, httpClient = fetchJson) => ({
  getList: async (resource, params) => {
    const { page, perPage } = params.pagination;
    const { field, order } = params.sort;
    const query = buildQuery({
      sort: JSON.stringify([field, order]),
      range: JSON.stringify([(page - 1) * perPage, page * perPage - 1]),
      filter: JSON.stringify(params.filter || {}),
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

  getMany: async (resource, params) => {
    const query = buildQuery({ filter: JSON.stringify({ ids: params.ids }) });
    const { json } = await httpClient(`${apiUrl}/${resource}?${query}`, {
      signal: params.signal,
    });
    return { data: json };
  },

  getManyReference: async (resource, params) => {
    const { page, perPage } = params.pagination;
    const { field, order } = params.sort;
    const query = buildQuery({
      sort: JSON.stringify([field, order]),
      range: JSON.stringify([(page - 1) * perPage, page * perPage - 1]),
      filter: JSON.stringify({ ...(params.filter || {}), [params.target]: params.id }),
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

  // No native bulk-update endpoint in the simple-rest convention beyond the filter=id[] form
  // (doc 02 §3.3) — this issues one PUT per id in parallel, matching how ra-data-simple-rest's
  // own updateMany degrades against backends without real batch support.
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

  // Sequential/parallel individual DELETEs — see updateMany comment above.
  deleteMany: async (resource, params) => {
    const ids = await Promise.all(
      params.ids.map((id) =>
        httpClient(`${apiUrl}/${resource}/${id}`, { method: 'DELETE' }).then(() => id)
      )
    );
    return { data: ids };
  },
});

export default saDataSimpleRest;
