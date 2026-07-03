# React-Admin Data Provider Contract

This document describes, in implementation-grade detail, the **Data Provider** contract used by
[react-admin](https://marmelab.com/react-admin/documentation.html) (marmelab). It is meant to be
a reference for building a vanilla-JS "simple-admin" clone whose data providers can be near
drop-in compatible with react-admin's data providers — i.e. the same `dataProvider` object (same
method names, same params shape, same return shape) should work, or need only trivial adaptation,
against both frameworks.

Sources consulted: `DataProviders.html`, `DataProviderWriting.html`, `Actions.html` /
`Querying the API` guide, `Authentication.html` (for `addRefreshAuthToDataProvider`),
`FileInput.html`, and the GitHub source of `packages/ra-core/src/dataProvider`,
`packages/ra-data-simple-rest`, and `packages/ra-data-json-server`.

---

## 1. The core idea

A **Data Provider** is a single JavaScript object with a fixed set of methods. Every method:

- takes exactly two arguments: `(resource: string, params: object)`
- returns a `Promise` that resolves to a `{ data, ... }` result object, or rejects with an
  `Error`-like object (ideally an `HttpError`, see §5).

```ts
interface DataProvider {
    getList:          (resource: string, params: GetListParams)          => Promise<GetListResult>;
    getOne:            (resource: string, params: GetOneParams)           => Promise<GetOneResult>;
    getMany:           (resource: string, params: GetManyParams)          => Promise<GetManyResult>;
    getManyReference:  (resource: string, params: GetManyReferenceParams) => Promise<GetManyReferenceResult>;
    create:            (resource: string, params: CreateParams)           => Promise<CreateResult>;
    update:            (resource: string, params: UpdateParams)           => Promise<UpdateResult>;
    updateMany:        (resource: string, params: UpdateManyParams)       => Promise<UpdateManyResult>;
    delete:            (resource: string, params: DeleteParams)           => Promise<DeleteResult>;
    deleteMany:        (resource: string, params: DeleteManyParams)       => Promise<DeleteManyResult>;
    // optional
    supportAbortSignal?: boolean;
    [customMethod: string]: any; // extra, resource/backend specific methods are allowed
}
```

React-admin's UI layer (`<List>`, `<Edit>`, `<ReferenceField>`, buttons, etc.) never talks to the
HTTP API directly — it always goes through this object, retrieved via `useDataProvider()` or via
dedicated query/mutation hooks (`useGetList`, `useGetOne`, `useCreate`, `useUpdate`, ...). This
indirection is exactly what makes the contract portable: **any object matching this shape is a
valid data provider**, whether it is talking to a REST API, GraphQL, Firebase, localStorage, or
an in-memory fake.

`resource` is always a plain string (e.g. `"posts"`, `"comments"`); it identifies which
"table"/"collection" the operation targets. It is up to the data provider to map it to a URL,
table name, endpoint, etc.

Record identity: every record MUST have an `id` field (or the field mapped via
`resource.identifier`/`recordRepresentation` machinery — for a clone, just require `id`). Type is
`Identifier = string | number`.

---

## 2. Method-by-method contract

### 2.1 `getList(resource, params)`

Fetch a paginated, sorted, filtered collection.

**Params:**

```ts
interface GetListParams {
    pagination: { page: number; perPage: number };   // page is 1-based
    sort: { field: string; order: 'ASC' | 'DESC' };
    filter: Record<string, any>;                      // arbitrary key/value filter object
    meta?: any;                                        // opaque, provider-specific
    signal?: AbortSignal;                               // present if supportAbortSignal = true
}
```

Example call as issued by `<List>` with default settings:

```js
dataProvider.getList('posts', {
    pagination: { page: 1, perPage: 25 },
    sort: { field: 'published_at', order: 'DESC' },
    filter: { status: 'published' },
});
```

**Result:**

```ts
interface GetListResult<RecordType = any> {
    data: RecordType[];
    total?: number;      // total number of records matching filter, across all pages
    pageInfo?: {          // alternative to `total`, for "partial pagination" (see 2.1.1)
        hasNextPage?: boolean;
        hasPreviousPage?: boolean;
    };
    meta?: any;
}
```

Exactly one of `total` or `pageInfo` must be present (react-admin's pagination widget switches
behavior based on which is provided).

#### 2.1.1 Partial pagination mode

When counting all matching rows is expensive (e.g. huge tables, some NoSQL backends), the
provider can skip `total` and return `pageInfo` instead:

```js
return {
    data: records,           // exactly `perPage` records (or fewer on the last page)
    pageInfo: {
        hasNextPage: page * perPage < someCheapUpperBoundOrProbe,
        hasPreviousPage: page > 1,
    },
};
```

React-admin's `<Pagination>` then renders "Next"/"Previous" only, without a total page count or
"1-25 of 100" label. `<List pagination={false}>` or a custom pagination component is typically
paired with this mode.

### 2.2 `getOne(resource, params)`

**Params:**

```ts
interface GetOneParams {
    id: Identifier;
    meta?: any;
    signal?: AbortSignal;
}
```

**Result:**

```ts
interface GetOneResult<RecordType = any> {
    data: RecordType; // must include `id`, and SHOULD have the exact same shape as records
                       // returned by getList/getMany for the same resource, to avoid UI
                       // flicker when react-admin swaps a cached list-record for a fetched one
}
```

### 2.3 `getMany(resource, params)`

Used internally by `<ReferenceField>` / `<ReferenceArrayField>` / `<ReferenceInput>` to batch
fetch several records by id (deduplicated & aggregated across a render tick).

**Params:**

```ts
interface GetManyParams {
    ids: Identifier[];
    meta?: any;
    signal?: AbortSignal;
}
```

**Result:**

```ts
interface GetManyResult<RecordType = any> {
    data: RecordType[]; // order does not need to match `ids`; react-admin re-indexes by id
}
```

### 2.4 `getManyReference(resource, params)`

Fetch records of `resource` whose foreign-key field (`target`) equals `id` — e.g. "all comments
where `post_id` = 123". Used by `<ReferenceManyField>` and reference tabs.

**Params:**

```ts
interface GetManyReferenceParams {
    target: string;                                    // e.g. "post_id"
    id: Identifier;                                     // e.g. 123
    pagination: { page: number; perPage: number };
    sort: { field: string; order: 'ASC' | 'DESC' };
    filter: Record<string, any>;                        // additional filters, merged with target=id
    meta?: any;
    signal?: AbortSignal;
}
```

**Result:** identical shape to `getList`'s result (`{ data, total }` or `{ data, pageInfo }`).

### 2.5 `create(resource, params)`

**Params:**

```ts
interface CreateParams<RecordType = any> {
    data: Partial<RecordType>;  // record to create, without `id` (server assigns it)
    meta?: any;
}
```

**Result:**

```ts
interface CreateResult<RecordType = any> {
    data: RecordType; // MUST include the newly-assigned `id`, plus all other fields
                       // (react-admin uses the full returned record to update its cache
                       // and to redirect to the Edit/Show view of the new record)
}
```

### 2.6 `update(resource, params)`

**Params:**

```ts
interface UpdateParams<RecordType = any> {
    id: Identifier;
    data: Partial<RecordType>;       // usually the *entire* edited record (all form fields)
    previousData: RecordType;        // the full record as it was before edition (for
                                       // optimistic-locking / diff-based backends)
    meta?: any;
}
```

**Result:**

```ts
interface UpdateResult<RecordType = any> {
    data: RecordType; // full, updated record
}
```

### 2.7 `updateMany(resource, params)`

Bulk update, typically triggered from a `<Datagrid>` bulk action bar ("update selected").

**Params:**

```ts
interface UpdateManyParams<RecordType = any> {
    ids: Identifier[];
    data: Partial<RecordType>; // same patch applied to every id
    meta?: any;
}
```

**Result:**

```ts
interface UpdateManyResult {
    data: Identifier[]; // ids of the records that were actually updated
}
```

Backends without a native bulk-update endpoint implement this as N sequential/parallel calls to
the single-record update endpoint (see `ra-data-json-server`, §4.2).

### 2.8 `delete(resource, params)`

**Params:**

```ts
interface DeleteParams<RecordType = any> {
    id: Identifier;
    previousData?: RecordType; // full record before deletion, if available (some APIs need
                                 // the body of the resource to authorize/route the DELETE)
    meta?: any;
}
```

**Result:**

```ts
interface DeleteResult<RecordType = any> {
    data: RecordType; // the deleted record (or at least `{ id }`)
}
```

### 2.9 `deleteMany(resource, params)`

**Params:**

```ts
interface DeleteManyParams {
    ids: Identifier[];
    meta?: any;
}
```

**Result:**

```ts
interface DeleteManyResult {
    data: Identifier[]; // ids that were actually deleted
}
```

---

## 3. Mapping to a "Simple REST" backend (`ra-data-simple-rest` conventions)

`ra-data-simple-rest` is the reference implementation for a generic REST/JSON API. Its exact
wire conventions (worth cloning verbatim for maximum interoperability):

### 3.1 Query parameters

- `sort`  → JSON array string: `sort=["title","ASC"]`
- `range` → JSON array string of a **0-based, inclusive** `[start, end]` window:
  `range=[0,24]` for page 1 / perPage 25 (`start = (page-1)*perPage`, `end = page*perPage - 1`)
- `filter` → JSON object string: `filter={"title":"bar"}`
- for `getMany`: `filter={"ids":[123,124,125]}`
- for `getManyReference`: `filter` gets the extra `{ [target]: id }` entry merged in, e.g.
  `filter={"post_id":345}`
- for `updateMany` / `deleteMany`: `filter={"id":[123,124,125]}` (note: key is singular `id`,
  not `ids`, in the write-batch case)

All are serialized with `query-string`'s `stringify()` and appended to the resource URL, e.g.:

```
GET http://my.api.url/posts?sort=["title","ASC"]&range=[0,24]&filter={"author_id":12}
```

### 3.2 Response headers for pagination totals

`getList` / `getManyReference` responses MUST expose the total count via **one of**:

- `Content-Range: posts 0-24/319` — react-admin parses the number after the `/`
- `X-Total-Count: 319`

Because browsers strip non-whitelisted response headers by default, the API must send:

```
Access-Control-Expose-Headers: Content-Range
```

(or `X-Total-Count`, matching whichever header is used).

### 3.3 HTTP verb / URL mapping table

| Method             | HTTP request                                                                 | Success body                          |
|---------------------|-------------------------------------------------------------------------------|----------------------------------------|
| `getList`           | `GET /{resource}?sort=...&range=...&filter=...`                               | `[ {record}, ... ]` + `Content-Range`/`X-Total-Count` header |
| `getOne`            | `GET /{resource}/{id}`                                                         | `{record}`                            |
| `getMany`           | `GET /{resource}?filter={"ids":[...]}`                                        | `[ {record}, ... ]`                   |
| `getManyReference`  | `GET /{resource}?sort=...&range=...&filter={"<target>":<id>, ...}`             | `[ {record}, ... ]` + count header     |
| `create`            | `POST /{resource}` body = `JSON.stringify(data)`                              | `{record}` (with server-assigned `id`) |
| `update`            | `PUT /{resource}/{id}` body = `JSON.stringify(data)`                          | `{record}`                            |
| `updateMany`        | `PUT /{resource}?filter={"id":[...]}` body = `JSON.stringify(data)`           | `[id, id, ...]`                       |
| `delete`            | `DELETE /{resource}/{id}`                                                      | `{record}`                            |
| `deleteMany`        | `DELETE /{resource}?filter={"id":[...]}`                                       | `[id, id, ...]`                       |

### 3.4 Reference implementation (verbatim pattern)

```js
import { fetchUtils } from 'react-admin';
import { stringify } from 'query-string';

const apiUrl = 'https://my.api.com';
const httpClient = fetchUtils.fetchJson;

export default {
    getList: async (resource, params) => {
        const { page, perPage } = params.pagination;
        const { field, order } = params.sort;
        const query = {
            sort: JSON.stringify([field, order]),
            range: JSON.stringify([(page - 1) * perPage, page * perPage - 1]),
            filter: JSON.stringify(params.filter),
        };
        const url = `${apiUrl}/${resource}?${stringify(query)}`;
        const { json, headers } = await httpClient(url, { signal: params.signal });
        return {
            data: json,
            total: parseInt(headers.get('content-range').split('/').pop(), 10),
        };
    },

    getOne: async (resource, params) => {
        const { json } = await httpClient(`${apiUrl}/${resource}/${params.id}`, {
            signal: params.signal,
        });
        return { data: json };
    },

    getMany: async (resource, params) => {
        const query = { filter: JSON.stringify({ ids: params.ids }) };
        const { json } = await httpClient(`${apiUrl}/${resource}?${stringify(query)}`, {
            signal: params.signal,
        });
        return { data: json };
    },

    getManyReference: async (resource, params) => {
        const { page, perPage } = params.pagination;
        const { field, order } = params.sort;
        const query = {
            sort: JSON.stringify([field, order]),
            range: JSON.stringify([(page - 1) * perPage, page * perPage - 1]),
            filter: JSON.stringify({ ...params.filter, [params.target]: params.id }),
        };
        const { json, headers } = await httpClient(`${apiUrl}/${resource}?${stringify(query)}`, {
            signal: params.signal,
        });
        return {
            data: json,
            total: parseInt(headers.get('content-range').split('/').pop(), 10),
        };
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

    updateMany: async (resource, params) => {
        const query = { filter: JSON.stringify({ id: params.ids }) };
        const { json } = await httpClient(`${apiUrl}/${resource}?${stringify(query)}`, {
            method: 'PUT',
            body: JSON.stringify(params.data),
        });
        return { data: json };
    },

    delete: async (resource, params) => {
        const { json } = await httpClient(`${apiUrl}/${resource}/${params.id}`, {
            method: 'DELETE',
        });
        return { data: json };
    },

    deleteMany: async (resource, params) => {
        const query = { filter: JSON.stringify({ id: params.ids }) };
        const { json } = await httpClient(`${apiUrl}/${resource}?${stringify(query)}`, {
            method: 'DELETE',
        });
        return { data: json };
    },
};
```

`fetchUtils.fetchJson` is a thin `fetch()` wrapper that: sets `Accept: application/json`,
auto-parses the JSON body into `.json`, exposes `.headers` (a `Headers` object) and `.status`,
and — critically — **rejects the promise with an `HttpError` when `status` is not in the 2xx
range** (see §5).

### 3.5 `ra-data-json-server` variant (json-server backend)

Same overall shape, but different query param names and only one count header, matching
`json-server`'s own conventions:

| Concern              | Param / header                                    |
|-----------------------|----------------------------------------------------|
| sort field            | `_sort=title`                                       |
| sort order            | `_order=ASC` / `_order=DESC`                        |
| pagination            | `_start=0&_end=24` (0-based, end-exclusive)         |
| total count           | response header `X-Total-Count` (only, no Content-Range) |
| embedding relations   | `_embed=author` (maps from `meta.embed` / `_embed`) |
| getMany               | repeated `id=123&id=124&id=125` query params (not a JSON blob) |
| getManyReference      | `<target>=<id>` query param, e.g. `postId=345`      |
| updateMany/deleteMany | **N sequential single-record requests** — json-server has no native batch filter endpoint |

This illustrates the intended flexibility of the contract: two backends with incompatible wire
formats can both be wrapped in objects that satisfy the exact same `DataProvider` interface: the
UI code never changes.

---

## 4. Error handling conventions

### 4.1 `HttpError`

```ts
class HttpError extends Error {
    status: number;
    body: any;
    constructor(message: string, status: number, body: any = null) {
        super(message);
        this.status = status;
        this.body = body;
        this.name = 'HttpError';
    }
}
```

Any data provider method should, on failure, **reject its Promise with an `HttpError`** (or at
minimum a plain `Error` — but without `.status`, react-admin cannot special-case auth failures).

```js
if (status < 200 || status >= 300) {
    throw new HttpError((json && json.message) || statusText, status, json);
}
```

### 4.2 What react-admin does with the error

- `error.message` is shown to the user, typically via a toast/snackbar notification
  (`notify(error.message, { type: 'error' })`), or inline on forms (validation errors — see 4.3).
- `error.status === 401` or `403` triggers `authProvider.checkError(error)`, which can force a
  logout/redirect to the login page (this is how "session expired" flows work).
- `error.status === 403` alone (without 401) commonly triggers an "access denied" message without
  logout, depending on `authProvider` implementation.
- Any other status just surfaces the message; the mutation/query hook's `isPending` flips to
  `false` and `error` is populated for the calling component.
- If the response body contains a validation-errors payload (e.g.
  `{ errors: { title: 'Required' } }`), forms built with `useNotify` + form libraries can surface
  field-level errors — react-admin's `HttpError.body` is where that structured payload should be
  attached, so form code can read `error.body.errors`.

### 4.3 Optimistic / pessimistic mutation modes and rollback

React-admin's mutation hooks (`useUpdate`, `useDelete`, etc.) support `mutationMode: 'optimistic' |
'pessimistic' | 'undoable'`. On error, previously-applied optimistic UI changes are rolled back
(this is react-query cache manipulation — see §7 "Compatibility notes" for what a JS clone needs
instead).

---

## 5. Wrapping mechanisms

These are **decorator functions**: they take a `DataProvider` (and sometimes other providers) and
return a new `DataProvider` with the same 9-method interface, so they compose freely.

### 5.1 `withLifecycleCallbacks(dataProvider, callbacks[])`

Injects before/after hooks per resource, without touching the base provider. Useful for
client-side cascading logic (e.g. delete related records, compute derived fields, upload files
before `create`/`update`).

```js
import { withLifecycleCallbacks } from 'react-admin';

const dataProvider = withLifecycleCallbacks(baseDataProvider, [
    {
        resource: 'posts',
        beforeCreate: async (params, dataProvider) => {
            // e.g. upload params.data.picture.rawFile, replace with the returned URL
            return params;
        },
        afterCreate: async (result, dataProvider) => result,
        beforeUpdate: async (params, dataProvider) => params,
        afterUpdate: async (result, dataProvider) => result,
        beforeDelete: async (params, dataProvider) => {
            // e.g. cascade-delete comments belonging to this post
            await dataProvider.deleteMany('comments', { ids: [...] });
            return params;
        },
        afterDelete: async (result, dataProvider) => result,
        beforeGetList: async (params, dataProvider) => params,
        afterGetList: async (result, dataProvider) => result,
        // ...equivalent before/after hooks exist for every one of the 9 core methods
    },
]);
```

Each hook receives the params (or result) plus the underlying `dataProvider`, and must return the
(possibly modified) params/result — enabling chaining across multiple resource entries.

### 5.2 `combineDataProviders(resource => dataProvider)`

Routes each resource name to a distinct underlying provider — e.g. use a REST provider for most
resources but a special one for a resource backed by cloud storage or a different microservice.

```js
import { combineDataProviders } from 'react-admin';

const dataProvider = combineDataProviders((resource) => {
    switch (resource) {
        case 'posts':
        case 'comments':
            return restProvider;
        case 'uploads':
            return storageProvider;
        default:
            throw new Error(`Unknown resource: ${resource}`);
    }
});
```

The returned object still exposes the same 9 methods; each call is dispatched to whichever
provider the callback selects based on the `resource` argument.

### 5.3 `addRefreshAuthToDataProvider(dataProvider, refreshAuth)`

Wraps every call so that, before hitting the network, a `refreshAuth()` callback runs (typically
checking token expiry and refreshing it via the auth backend, updating storage). Pairs with
`addRefreshAuthToAuthProvider` so both the data layer and the auth layer stay in sync about token
freshness — avoids a burst of parallel calls all independently 401-ing then trying to refresh the
token concurrently.

```js
import { addRefreshAuthToDataProvider } from 'react-admin';

const refreshAuth = () => {
    const accessToken = localStorage.getItem('access_token');
    if (!isTokenValid(accessToken)) {
        return refreshTokenRequest().then(({ access_token }) => {
            localStorage.setItem('access_token', access_token);
        });
    }
    return Promise.resolve();
};

const dataProvider = addRefreshAuthToDataProvider(baseDataProvider, refreshAuth);
```

### 5.4 Async / lazily-initialized providers

Because a provider may need async setup (e.g. resolving a backend SDK, discovering an OpenAPI
schema), the app is allowed to render `null`/a loading state until `dataProvider` is ready:

```js
const [dataProvider, setDataProvider] = useState(null);
useEffect(() => {
    buildProvider().then(provider => setDataProvider(() => provider));
}, []);
if (!dataProvider) return <p>Loading...</p>;
```

(the function form of `setState` avoids React treating the provider object itself as a state
updater function).

---

## 6. `meta` parameter and custom methods

`meta` is an **opaque, provider-defined bag** accepted by every one of the 9 standard methods.
React-admin core never reads or sets it (aside from passing it through) — it exists purely so
UI code can request backend-specific behavior without breaking the generic interface. Common
uses:

- Embedding related resources: `meta: { embed: ['author'] }` (or `_embed` for json-server style)
- Requesting extra prefetched data alongside the main payload:
  `meta.prefetch: ['comments']` → the provider can return
  `{ data, total, meta: { prefetched: { comments: [...] } } }` and callers dig it out of the
  result's own `meta`.
- Passing GraphQL variables, extra headers, cache hints, tenant/locale scoping, etc.

Example call:

```js
const { data } = useGetOne('books', { id, meta: { embed: ['authors'] } });
```

**Custom methods**: nothing prevents a data provider object from exposing additional methods
beyond the 9 required ones (e.g. `dataProvider.banUser(id)`, `dataProvider.exportCsv(resource,
filter)`). These are simply called directly via `useDataProvider()` — react-admin's generic hooks
don't need to know about them. This is the standard extension point for backend actions that
don't map to CRUD.

---

## 7. File upload conventions

`<FileInput>` / `<ImageInput>` do **not** upload anything themselves — they only manage local
file selection and hand a value to the record's field. The Data Provider is solely responsible
for turning that value into whatever the backend expects.

### 7.1 Value shape produced by `<FileInput>`

- Existing/persisted file: `{ src: 'https://.../file.pdf', title: 'file.pdf' }`
- Newly selected (not yet saved) file: `{ src: 'blob:...' /* local object URL */, title: 'file.pdf', rawFile: File }`
  — `rawFile` is the actual browser `File` object; multiple files (with `multiple` prop) produce
  an array of such objects.

### 7.2 Base64 inline upload pattern

Used for small files / simple backends that accept the file content inline in JSON:

```js
const convertFileToBase64 = file =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file.rawFile);
    });

const addUploadFeature = requestHandler => (type, resource, params) => {
    if ((type === 'create' || type === 'update') && resource === 'posts') {
        if (!params.data.picture?.rawFile) {
            return requestHandler(type, resource, params);
        }
        return convertFileToBase64(params.data.picture).then(base64 =>
            requestHandler(type, resource, {
                ...params,
                data: { ...params.data, picture: { src: base64, title: params.data.picture.title } },
            })
        );
    }
    return requestHandler(type, resource, params);
};
```

In modern react-admin, the same idea is expressed with `withLifecycleCallbacks`'s
`beforeCreate`/`beforeUpdate` hooks instead of the legacy `(type, resource, params)` "handler"
signature shown above, but the transformation logic is identical: intercept before the HTTP call,
replace `rawFile` with a persisted representation.

### 7.3 Multipart / `FormData` upload pattern

Used when the backend expects a real `multipart/form-data` POST (large files, direct-to-storage
uploads):

```js
create: async (resource, params) => {
    if (resource !== 'posts' || !params.data.picture?.rawFile) {
        return defaultDataProvider.create(resource, params);
    }
    const formData = new FormData();
    formData.append('file', params.data.picture.rawFile);
    Object.keys(params.data).forEach(key => {
        if (key !== 'picture') formData.append(key, params.data[key]);
    });
    return fetchUtils.fetchJson(`${apiUrl}/${resource}`, {
        method: 'POST',
        body: formData, // do NOT set Content-Type; the browser sets the multipart boundary
    }).then(({ json }) => ({ data: json }));
},
```

Key rule: when sending `FormData`, do not manually set the `Content-Type` header — leave it to
the browser so the multipart boundary is generated correctly.

### 7.4 General rule

Whichever strategy is used, the data provider must ultimately replace the transient `rawFile` /
blob `src` with a stable, server-hosted URL (or embedded base64) in the record it returns from
`create`/`update`, since that returned record becomes the new cached truth for the form/list.

---

## 8. Compatibility notes for a JS clone

Goal: a vanilla-JS "simple-admin" should accept **the same `dataProvider` object shape** as
react-admin, so existing react-admin data providers (or ones written against this doc) plug in
with zero or minimal changes.

### 8.1 Directly replicable 1:1 (framework-agnostic — just re-implement as-is)

- **The 9-method interface itself**: `getList`, `getOne`, `getMany`, `getManyReference`,
  `create`, `update`, `updateMany`, `delete`, `deleteMany` — exact method names, exact params
  shapes (`pagination`, `sort`, `filter`, `target`/`id`, `data`, `previousData`, `meta`, `ids`),
  exact result shapes (`{ data }`, `{ data, total }`, `{ data, pageInfo }`). This is pure data/
  JSON contract, nothing React-specific about it.
- **`HttpError`**: trivial to port — a small `Error` subclass with `status` and `body`. Reuse
  verbatim.
- **Simple REST / json-server wire conventions** (§3): query-string formats, header conventions
  (`Content-Range`, `X-Total-Count`), HTTP verb mapping — all pure HTTP, no React involved.
  Existing `ra-data-simple-rest` / `ra-data-json-server` npm packages could likely be used
  *unmodified* against a clone, since they only depend on `fetchUtils` (a thin fetch wrapper) and
  `query-string`, neither of which is React-specific.
- **`meta` parameter passthrough**: just an opaque bag forwarded to the provider; no framework
  dependency.
- **Custom/extra methods on the provider object**: also framework-agnostic — the clone's own
  "call the data provider" code just needs to allow arbitrary method names beyond the 9 core ones.
- **`combineDataProviders`**: pure function composition (`resource => provider`), trivially
  portable.
- **`withLifecycleCallbacks`**: pure function composition/wrapping around Promise-returning
  methods; no React dependency. Fully portable, including the before/after-hook-per-resource
  design.
- **`addRefreshAuthToDataProvider`**: also pure async wrapping logic (check token, refresh,
  proceed); portable as-is.
- **File upload conventions** (§7): base64 conversion and `FormData`/multipart patterns use only
  `FileReader`/`fetch` — standard browser APIs, no React needed. Directly portable, including the
  "dataProvider owns the rawFile → persisted URL transform" responsibility split.
- **Error-to-notification mapping** (`error.message` → toast, `error.status` → 401/403 handling):
  purely a convention about what fields to read off the rejected error object; trivially
  reproducible with any pub/sub or event-based notification system.

### 8.2 React-specific — need a simplified equivalent

- **`useGetList` / `useGetOne` / `useCreate` / `useUpdate` / ... hooks and their `isPending`,
  `error`, `data` return shape**: these are thin wrappers around **react-query** (`@tanstack/
  react-query`). A JS clone needs its own lightweight async-state primitive: e.g. a function that
  calls `dataProvider.getList(...)`, tracks a `{ loading, error, data }` object, and notifies
  subscribers/re-renders relevant DOM — but without React's hook lifecycle, this becomes a plain
  promise-tracking wrapper or a small store (observable/pub-sub) instead of a hook.
- **Caching & cache invalidation**: react-query gives react-admin automatic caching of `getOne`/
  `getList` results keyed by `[resource, params]`, background refetching, and cross-hook cache
  sharing (e.g. a `getOne` call reuses data already fetched by a `getList` on the same resource).
  A clone needs an explicit, simplified cache layer (e.g. a `Map` keyed by `resource+id`, with
  manual invalidation calls after mutations) — there is no free automatic dependency-tracking
  invalidation without a react-query-equivalent library.
- **Optimistic / undoable mutation modes** (`mutationMode: 'optimistic' | 'undoable' |
  'pessimistic'`) and automatic rollback on error: this relies on react-query's mutation
  lifecycle (`onMutate`, cache snapshot, `onError` rollback) plus react-admin's own "undo" queue
  UI (toast with an Undo button that delays the real network call). A clone needs to hand-roll:
  (a) an optimistic local state update, (b) a snapshot for rollback, (c) a delayed-commit queue
  if "undoable" behavior is wanted. This is meaningfully more work than a straight port and is a
  reasonable place to simplify (e.g. clone could support only `pessimistic` mode initially).
- **Automatic request de-duplication / batching of `getMany` calls** across simultaneously
  mounted components (e.g. many `<ReferenceField>`s on one page collapse into a single
  `getMany`): react-admin does this via a react-query-integrated batching hook
  (`useGetManyAggregate`) tied to the component render cycle. A clone reimplementing this needs
  a manual microtask/tick-based batcher (collect ids requested within the same tick, flush once).
  Doable without React, but it's bespoke plumbing, not a drop-in port.
- **`AbortSignal` cancellation tied to component unmount**: react-admin wires `signal` from
  react-query's automatic cancellation-on-unmount behavior. A clone can still pass an
  `AbortSignal` into data provider calls (the data provider code itself is unaffected — see 8.1),
  but the "abort when the view is torn down" trigger needs to be wired manually to the clone's own
  view lifecycle (e.g. router navigation / component destroy hook) rather than getting it for
  free from a query library.
- **`authProvider.checkError` integration on 401/403**: in react-admin this is orchestrated by a
  react-query global error handler plus the router (`useLogoutIfAccessDenied`). A clone needs its
  own equivalent glue code (e.g. a wrapper around all data provider calls that inspects
  `error.status` and redirects), but the *policy* (401/403 → logout) is simple to reproduce; it's
  just not "free" the way it is when react-query's global `onError` is already wired into
  react-admin's core.

### 8.3 Practical recommendation

For maximum compatibility, the clone should:

1. Define its `DataProvider` interface identical to §1–§4 of this document (method names, params,
   results, `HttpError`).
2. Ship its own minimal `fetchUtils.fetchJson`-equivalent helper for authors writing REST
   providers, matching the same auto-JSON/`HttpError`-on-non-2xx behavior.
3. Provide `combineDataProviders`, `withLifecycleCallbacks`, and `addRefreshAuthToDataProvider`
   as pure functions, copied near-verbatim from react-admin's implementation (they have no React
   dependency in `ra-core`).
4. Build a small, explicit cache/store (not react-query) for the clone's own data-fetching glue,
   and treat optimistic/undoable mutation modes, request de-duplication, and abort-on-unmount as
   "nice-to-have" features layered on top later, since those are the parts genuinely coupled to
   React's render/hook model rather than to the data provider contract itself.
