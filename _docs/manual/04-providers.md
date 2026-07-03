# 4. Providers

Two plain-object contracts sit between your `<sa-admin>` and the outside world: the **DataProvider** (all CRUD) and the **AuthProvider** (login/session/access control). Neither has any base class or React dependency — anything with the right method names and Promise semantics works. This chapter documents the actual implementation under `src/providers/` and `src/auth/`, cross-referencing react-admin's own contract (`_docs/react-admin/02-data-provider.md`, `03-auth-provider.md`) only to explain *why* the shapes look the way they do.

## 4.1 The DataProvider contract

A DataProvider is an object exposing 9 methods. Every method takes `(resource, params)` and returns a `Promise` that either resolves to a result object or rejects (ideally with an `HttpError`, see §4.3). This is exactly react-admin's contract — simple-admin didn't invent a new one, it re-implements the same method names/shapes so existing react-admin knowledge (and, largely, existing provider code) transfers directly.

The signatures below are the real, consistent shape used across `simpleRest.js`, `jsonServer.js`, and `examples/mock-data-provider.js` — all three implement the same 9 methods against the same params.

- **`getList(resource, params)`** — params: `{ pagination: { page, perPage }, sort: { field, order }, filter }`. Resolves `{ data: Record[], total?: number }`.
- **`getOne(resource, params)`** — params: `{ id }`. Resolves `{ data: Record }`.
- **`getMany(resource, params)`** — params: `{ ids: Identifier[] }`. Resolves `{ data: Record[] }` (order need not match `ids`; callers re-index by id — see the `createGetManyBatcher` note in §4.4).
- **`getManyReference(resource, params)`** — params: `{ target, id, pagination, sort, filter }` (records of `resource` whose `params.target` field equals `params.id`, e.g. all `comments` where `post_id = 123`). Resolves the same shape as `getList`.
- **`create(resource, params)`** — params: `{ data }` (no `id` — the backend assigns one). Resolves `{ data: Record }` with the new `id` included.
- **`update(resource, params)`** — params: `{ id, data, previousData }`. Resolves `{ data: Record }`, the full updated record.
- **`updateMany(resource, params)`** — params: `{ ids, data }` (the same patch applied to every id). Resolves `{ data: Identifier[] }`, the ids actually updated.
- **`delete(resource, params)`** — params: `{ id, previousData? }`. Resolves `{ data: Record }` (the deleted record, or at least `{ id }`).
- **`deleteMany(resource, params)`** — params: `{ ids }`. Resolves `{ data: Identifier[] }`, the ids actually deleted.

Every record must carry an `id` field — the datagrid, reference fields, and the batcher all key off it.

All three implementations agree on this shape: `mock-data-provider.js`'s `getOne` rejects with a plain `Error` when a row isn't found (fine for a demo; production code should prefer `HttpError` with a `status`, see §4.3), while `simpleRest.js`/`jsonServer.js` get their rejections for free from `fetchJson` on any non-2xx response.

## 4.2 The two built-in REST providers

simple-admin ships two ready-made "twins" of react-admin's own reference REST providers, both built on the shared `fetchJson` helper (`src/providers/fetchJson.js`) instead of react-admin's `fetchUtils`/`query-string` packages. `fetchJson(url, options)` sets `Accept: application/json`, adds `Content-Type: application/json` for string bodies (never for `FormData`, so the browser can set its own multipart boundary), attaches `Authorization` from `options.user.token` when given, auto-parses the JSON response, and **rejects with an `HttpError` for any non-2xx status**.

### `saDataSimpleRest(apiUrl, httpClient = fetchJson)`

Wire format (from `src/providers/simpleRest.js`):

| Method | Request |
|---|---|
| `getList` | `GET /{resource}?sort=["field","order"]&range=[start,end]&filter={...}` |
| `getOne` | `GET /{resource}/{id}` |
| `getMany` | `GET /{resource}?filter={"ids":[...]}` |
| `getManyReference` | `GET /{resource}?sort=...&range=...&filter={..., "<target>": id}` |
| `create` | `POST /{resource}` |
| `update` | `PUT /{resource}/{id}` |
| `updateMany` | N parallel `PUT /{resource}/{id}` calls (no native batch endpoint in the convention) |
| `delete` | `DELETE /{resource}/{id}` |
| `deleteMany` | N parallel `DELETE /{resource}/{id}` calls |

Pagination range is a **0-based, inclusive** `[start, end]` window: `start = (page-1)*perPage`, `end = page*perPage - 1`. The total count is read from the `Content-Range` response header (`items 0-24/319` — the number after `/`), falling back to `X-Total-Count` if present. Your backend must expose whichever header it sends via `Access-Control-Expose-Headers` (browsers strip non-whitelisted response headers by default).

```js
import { saDataSimpleRest } from '../src/index.js'; // or 'simple-admin'

const dataProvider = saDataSimpleRest('https://api.example.com');

admin.dataProvider = dataProvider; // or pass via SimpleAdmin.admin({ dataProvider, ... })
```

### `saDataJsonServer(apiUrl, httpClient = fetchJson)`

Wire format (from `src/providers/jsonServer.js`), matching a plain `json-server` backend:

| Method | Request |
|---|---|
| `getList` | `GET /{resource}?_sort=field&_order=ASC&_start=0&_end=25` |
| `getOne` | `GET /{resource}/{id}` |
| `getMany` | `GET /{resource}?id=1&id=2&id=3` (repeated params, not a JSON blob) |
| `getManyReference` | `GET /{resource}?<target>=<id>&_sort=...&_start=...&_end=...` |
| `create` | `POST /{resource}` |
| `update` | `PUT /{resource}/{id}` |
| `updateMany` | N parallel `PUT /{resource}/{id}` calls |
| `delete` | `DELETE /{resource}/{id}` |
| `deleteMany` | N parallel `DELETE /{resource}/{id}` calls |

`_start`/`_end` is 0-based with an **exclusive** end. Total count comes only from `X-Total-Count` — `json-server` doesn't send `Content-Range`. There is no native batch-write endpoint, so `updateMany`/`deleteMany` degrade to N individual requests issued in parallel, same as `saDataSimpleRest`.

```js
import { saDataJsonServer } from '../src/index.js';

const dataProvider = saDataJsonServer('http://localhost:3000');

SimpleAdmin.admin({ dataProvider, authProvider, requireAuth: true }).mount('#app');
```

Both factories accept an optional second `httpClient` argument (defaults to `fetchJson`) if you need to swap in your own fetch wrapper (e.g. one that injects auth headers differently) while keeping the same URL/query conventions.

## 4.3 Writing your own DataProvider

Since a DataProvider is just an object of async functions, you can write one from scratch — against a GraphQL API, `localStorage`, an SDK, whatever. `examples/mock-data-provider.js`'s `createMockDataProvider(seedData)` is a good template: it implements all 9 methods purely in memory (deep-cloning a `{ [resource]: record[] }` seed so callers never mutate your original data), with a small `matchesFilter`/`compare` helper pair for filtering and sorting.

A minimal hand-rolled skeleton:

```js
import { HttpError } from '../src/index.js'; // or 'simple-admin'

export const myDataProvider = {
  async getList(resource, { pagination, sort, filter }) {
    const { page, perPage } = pagination;
    // ... fetch/compute rows for `resource` ...
    return { data: rows, total };
  },

  async getOne(resource, { id }) {
    const record = await findRecord(resource, id);
    if (!record) throw new HttpError('Not found', 404);
    return { data: record };
  },

  async getMany(resource, { ids }) {
    return { data: await findRecords(resource, ids) };
  },

  async getManyReference(resource, { target, id, pagination, sort, filter }) {
    return this.getList(resource, { pagination, sort, filter: { ...filter, [target]: id } });
  },

  async create(resource, { data }) {
    const record = await insertRecord(resource, data);
    return { data: record };
  },

  async update(resource, { id, data }) {
    const record = await saveRecord(resource, id, data);
    return { data: record };
  },

  async updateMany(resource, { ids, data }) {
    return { data: await Promise.all(ids.map((id) => saveRecord(resource, id, data).then(() => id))) };
  },

  async delete(resource, { id }) {
    const record = await removeRecord(resource, id);
    return { data: record };
  },

  async deleteMany(resource, { ids }) {
    return { data: await Promise.all(ids.map((id) => removeRecord(resource, id).then(() => id))) };
  },
};
```

### `HttpError`

`src/providers/httpError.js` exports a small `Error` subclass: `new HttpError(message, status, body = null)`. On failure, throw (or reject with) an `HttpError` rather than a plain `Error` — the `status` is what lets the rest of the stack special-case auth failures:

- `addAuthCheckToDataProvider` (wired automatically by `<sa-admin>`, see §4.5) inspects every rejected call and, when `error.status === 401 || error.status === 403`, feeds the error into `authProvider.checkError(error)` — which is how "session expired" auto-logout/redirect happens.
- `error.body` carries the structured payload — e.g. a validation-errors object under `body.errors` — for form code that wants field-level messages, not just a top-level notification string.

`fetchJson` already throws `HttpError` for you on any non-2xx response, so `saDataSimpleRest`/`saDataJsonServer` get this for free; a hand-rolled provider (like the mock one, which currently rejects with plain `Error`) should throw `HttpError` with a real `status` if you want 401/403 responses to trigger the auth flow.

## 4.4 Provider composition helpers

These are decorator functions: each takes a DataProvider (or AuthProvider) and returns a new one with the same method surface, so they compose freely. All are exported from `src/index.js`.

**`combineDataProviders(getDataProvider)`** (`src/providers/combine.js`) — routes each call to a different underlying provider based on `resource`, via a `Proxy` that dispatches every method name to `getDataProvider(resource)[name](resource, params)`.

```js
import { combineDataProviders } from '../src/index.js';

const dataProvider = combineDataProviders((resource) => {
  switch (resource) {
    case 'posts':
    case 'authors':
      return restProvider;
    case 'uploads':
      return storageProvider;
    default:
      throw new Error(`Unknown resource: ${resource}`);
  }
});
```

**`withLifecycleCallbacks(dataProvider, callbacks)`** (`src/providers/lifecycle.js`) — injects `before<Method>`/`after<Method>` hooks per resource (or `'*'` for all resources) around any of the 9 core methods, without touching the base provider. `before` hooks receive `(params, dataProvider, resource)` and must return the (possibly modified) params; `after` hooks receive `(result, dataProvider, resource)` and must return the (possibly modified) result. Multiple matching handlers chain in order.

```js
import { withLifecycleCallbacks } from '../src/index.js';

const dataProvider = withLifecycleCallbacks(baseDataProvider, [
  {
    resource: 'posts',
    beforeDelete: async (params, dp) => {
      await dp.deleteMany('comments', { ids: await commentIdsFor(params.id) });
      return params;
    },
    afterCreate: async (result) => {
      console.log('created post', result.data.id);
      return result;
    },
  },
]);
```

**`addRefreshAuthToDataProvider(dataProvider, refreshAuth)` / `addRefreshAuthToAuthProvider(authProvider, refreshAuth)`** (`src/providers/refreshAuth.js`) — wrap every relevant method in a `Proxy` so the shared `refreshAuth()` callback runs (and resolves) before the real call goes through. `addRefreshAuthToDataProvider` covers all 9 CRUD methods; `addRefreshAuthToAuthProvider` covers `checkAuth`/`getIdentity`/`getPermissions`/`canAccess` — the auth methods that read current session state. Pass the *same* `refreshAuth` to both so the data and auth layers stay in sync and a burst of parallel calls doesn't each independently hit a 401 and race to refresh the token.

```js
import { addRefreshAuthToDataProvider, addRefreshAuthToAuthProvider } from '../src/index.js';

const refreshAuth = async () => {
  const token = localStorage.getItem('access_token');
  if (isExpired(token)) {
    const { access_token } = await refreshTokenRequest();
    localStorage.setItem('access_token', access_token);
  }
};

const dataProvider = addRefreshAuthToDataProvider(baseDataProvider, refreshAuth);
const authProvider = addRefreshAuthToAuthProvider(baseAuthProvider, refreshAuth);
```

Two other primitives live in `src/providers/` but are internal plumbing rather than something you typically wire yourself: `createQueryCache()` (`cache.js`), a `Map`-based cache keyed by `resource + serialized params`, invalidated per-resource after writes; and `createGetManyBatcher(dataProvider)` (`batcher.js`), which collects the ids requested by reference fields within one microtask tick and issues a single `dataProvider.getMany(reference, { ids })` call instead of one per field. You don't need to call either directly when writing a provider — they consume whatever `getMany`/`getList` you already implemented.

## 4.5 The AuthProvider contract

An AuthProvider is a plain object of async methods, enforced by `src/auth/authGuard.js` under a single rule: **resolve = allow, reject/throw = deny**. Only `login`/`logout` are needed to make the login screen work at all; `checkAuth`, `checkError`, `getIdentity`, `getPermissions`, `canAccess` are all feature-detected — if a method is missing, `authGuard.js` treats the check as permissive (e.g. `canAccess` with no such method always resolves `true`).

- **`login(params)`** — called from the login form's submit handler with whatever credential shape you expect (`{ username, password }` typically). Reject with an `Error` to show a message on the form; resolve to complete login.
- **`logout(params)`** — called by the user-menu "Logout" action, and automatically whenever `checkAuth`/`checkError` rejects. Per `authGuard.js`'s `logoutAndRedirect`: resolving a `string` navigates there instead of the default `#/login`; resolving `false` skips the redirect entirely; resolving/throwing anything else falls through to the default redirect. Logout failures are swallowed — the redirect still happens.
- **`checkAuth(params)`** — run by `guardView`/`checkAuth` on every protected view mount (i.e. whenever `<sa-admin require-auth>` is set and a CRUD route renders). Reject ⇒ `authGuard.js` calls `logout()` then navigates to `#/login` (or `error.redirectTo` if set, unless `error.logoutUser === false` skips the logout step).
- **`checkError(error)`** — fed every dataProvider rejection whose `status` is `401` or `403` (wired by `addAuthCheckToDataProvider`, applied automatically inside `<sa-admin>`, see §4.6). Resolve ⇒ not an auth error, the UI shows it normally. Reject ⇒ same `logout()` + redirect dance as `checkAuth`, honoring `redirectTo`/`logoutUser: false` on the thrown error object.
- **`getIdentity()`** — called on admin mount to populate the top-bar/user menu. Resolves `{ id, fullName, ... }`.
- **`getPermissions()`** — resolves an opaque, app-defined blob (string, array, object) consumed by your own UI code; simple-admin's own guard code never inspects it.
- **`canAccess({ action, resource, record })`** — called by `guardView` before rendering a protected view, with `action` set to the view name (`list`/`create`/`edit`/`show`). Resolve `false` ⇒ navigate to `#/access-denied`. Absent method ⇒ permissive (always allowed).

`guardView(authProvider, { action, resource, record })` is the single entry point views use: it runs `checkAuth` first, then `canAccess`, redirecting on either failure and returning `true` only when the view may render.

## 4.6 Using the demo AuthProvider, or writing your own

`createLocalAuthProvider({ users })` (`src/auth/localAuthProvider.js`) is a `localStorage`-backed username/password provider meant for demos, not production auth. Default user list is `[{ username: 'admin', password: 'admin', fullName: 'Administrator' }]`; pass your own `users` array to override it. It implements `login`/`logout`/`checkAuth`/`checkError`/`getIdentity`/`getPermissions` (no `canAccess` — access is permissive by default), storing `{ id, fullName }` under the `sa-auth` key on successful login and clearing it on logout or on a `checkError` that sees `status === 401 || 403`.

```js
import { createLocalAuthProvider } from '../src/index.js';

const authProvider = createLocalAuthProvider(); // admin / admin
// or: createLocalAuthProvider({ users: [{ username: 'me', password: 'secret', fullName: 'Me' }] })
```

Writing your own against a real login API follows the same shape — store a token, attach it on every request via the DataProvider's `httpClient`, and clear it on logout/401:

```js
export const myAuthProvider = {
  async login({ username, password }) {
    const res = await fetch('/api/authenticate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) throw new Error('Invalid credentials');
    const { token, fullName } = await res.json();
    localStorage.setItem('sa-token', token);
    localStorage.setItem('sa-identity', JSON.stringify({ id: username, fullName }));
  },

  async logout() {
    localStorage.removeItem('sa-token');
    localStorage.removeItem('sa-identity');
  },

  async checkAuth() {
    if (!localStorage.getItem('sa-token')) throw new Error('Not authenticated');
  },

  async checkError(error) {
    if (error.status === 401 || error.status === 403) {
      localStorage.removeItem('sa-token');
      throw new Error('Session expired');
    }
    // any other status: resolve, let the UI show it normally
  },

  async getIdentity() {
    const raw = localStorage.getItem('sa-identity');
    if (!raw) throw new Error('Not authenticated');
    return JSON.parse(raw);
  },

  async getPermissions() {
    return [];
  },

  async canAccess({ resource, action }) {
    return true; // or check a role/permission list here
  },
};
```

Then pass the token to your DataProvider's requests — `fetchJson`'s `options.user` convenience sets the `Authorization` header for you: `fetchJson(url, { user: { authenticated: true, token: \`Bearer ${localStorage.getItem('sa-token')}\` } })`.

## 4.7 How providers reach the rest of the app

`<sa-admin>` doesn't hand its `dataProvider`/`authProvider` down through the DOM — instead, on `connectedCallback()` it publishes both to a module-level singleton in `src/core/registry.js` via `setDataProvider()`/`setAuthProvider()` (wrapping the data provider first in `addAuthCheckToDataProvider` when an `authProvider` is set, so every CRUD call is auto-checked for 401/403). Anything elsewhere in the tree — reference fields/inputs resolving a related record, auth guards checking a route, example code — reads them back with `getDataProvider()`/`getAuthProvider()` instead of walking up to find the nearest `<sa-admin>`. This is a deliberate v1 simplification documented in `registry.js`: it assumes a single `<sa-admin>` per page, which covers the common case without requiring every field/input to know about DOM ancestry.

## 4.8 React-admin compatibility, precisely

**DataProvider**: yes, a hand-written react-admin-style `dataProvider` object works as-is. The method names (`getList`, `getOne`, `getMany`, `getManyReference`, `create`, `update`, `updateMany`, `delete`, `deleteMany`), the params shapes (`pagination`/`sort`/`filter`/`target`/`id`/`data`/`previousData`/`ids`), and the result shapes (`{ data }`, `{ data, total }`) match what's actually implemented in `simpleRest.js`/`jsonServer.js`/`mock-data-provider.js` — there's nothing React-specific in any of it, it's a plain object of Promise-returning functions. Custom/extra methods beyond the 9 core ones are also fine to add; nothing in simple-admin restricts the method set.

What does **not** carry over automatically: the actual npm `ra-data-*` packages (e.g. a `ra-data-simple-rest`/`ra-data-json-server` install) import react-admin's own `fetchUtils` and the `query-string` package. simple-admin ships its own equivalents instead (`src/providers/fetchJson.js`, plain `URLSearchParams` in `simpleRest.js`/`jsonServer.js`) and has zero runtime dependencies by design — it doesn't depend on react-admin or its npm packages at all. To reuse an actual `ra-data-*` package unmodified you'd need to resolve its `fetchUtils`/`query-string` imports yourself (an import map, a bundler alias, or vendoring those two small dependencies) — nothing in this project provides that resolution for you. Hand-copying the *logic* of such a provider (as `simpleRest.js`/`jsonServer.js` do) is the supported path; it's a small, dependency-free rewrite once you're not importing the npm package directly.

**AuthProvider**: same story. `login`/`logout`/`checkAuth`/`checkError`/`getIdentity`/`getPermissions`/`canAccess` match react-admin's method names and resolve/reject convention exactly (`authGuard.js` was written to that contract), so a plain object authored for react-admin's `<Admin authProvider={...}>` will work against `<sa-admin>` unmodified as long as it doesn't call into any react-admin-only helper internally. The one difference worth knowing: simple-admin's redirect target on failure is a hash route (`#/login`, `#/access-denied`) rather than react-admin's path-based routing — if your existing `checkError`/`checkAuth` sets a custom `error.redirectTo`, make sure it's a hash route the router understands.

**Composition helpers**: `combineDataProviders`, `withLifecycleCallbacks`, and `addRefreshAuthToDataProvider`/`addRefreshAuthToAuthProvider` are pure function composition with no React dependency in react-admin either, and simple-admin's versions (`src/providers/combine.js`, `lifecycle.js`, `refreshAuth.js`) are near-verbatim ports — code written against these in react-admin should work here without changes.
