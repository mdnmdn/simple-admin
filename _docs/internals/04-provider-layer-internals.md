# 04 — The Provider Layer, Internals

> Audience: engineers maintaining or extending simple-admin. The user-facing manual
> (`_docs/manual/`) covers how to *use* data/auth providers and the composition helpers.
> This document covers how those helpers *work inside*, and — more importantly — it records
> the **verified truth** about what the current source actually does, including one whole
> piece of infrastructure that is wired up to nothing, and a batcher-sharing divergence that
> means fields and inputs do not share batched requests. Everything below was read from the
> final source, not inferred from the design docs. Where the code contradicts the idealized
> design, the code wins and is flagged.

The provider layer lives under `src/providers/` plus `src/auth/authGuard.js`. It has two
distinct kinds of thing in it, and conflating them is the main source of confusion:

1. **DataProvider-facing infrastructure** — primitives and wrappers that take *any*
   DataProvider and return another DataProvider (or take/return an AuthProvider):
   `HttpError`, `fetchJson`, `saDataSimpleRest`, `saDataJsonServer`, `combineDataProviders`,
   `withLifecycleCallbacks`, `addRefreshAuthToDataProvider` / `addRefreshAuthToAuthProvider`,
   and `addAuthCheckToDataProvider`.
2. **simple-admin-core-side performance infrastructure** — `createQueryCache` and
   `createGetManyBatcher`. These sit *on top of* whatever DataProvider you passed to
   `<sa-admin>`; they are transparent to the provider and require zero cooperation from it.
   A hand-rolled DataProvider that has never heard of simple-admin still gets batching.

Keeping (1) and (2) apart is the single most useful mental model for this file. The REST
twins in §6 are a clean demonstration: they depend on exactly two things from this layer
and deliberately know nothing about the rest.

---

## 1. The base primitives: `HttpError` and `fetchJson`

### 1.1 `HttpError` (`src/providers/httpError.js`)

The rejection contract for the entire data layer. Every DataProvider method is expected to
*reject with* an `HttpError` on failure. Two fields carry meaning downstream:

- `status` — the HTTP status. This is what `authProvider.checkError` reads to decide
  logout, and what `addAuthCheckToDataProvider` (§5.3) matches on (`401`/`403`).
- `body` — the parsed structured payload; e.g. field-level validation errors live under
  `body.errors` for forms to surface.

```js
export class HttpError extends Error {
  constructor(message, status, body = null) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
    ...
    this.stack = `${this.name}: ${message}`;
  }
}
```

Nothing exotic; note only that `body` defaults to `null`, so consumers must null-check
before reaching for `body.errors`.

### 1.2 `fetchJson` (`src/providers/fetchJson.js`)

A thin `fetch()` wrapper. Responsibilities, in order:

- Build headers: default `Accept: application/json`; default `Content-Type: application/json`
  **only for string bodies** (never FormData — the browser must set the multipart boundary
  itself); optionally set `Authorization` from the react-admin-style
  `options.user = { authenticated: true, token: 'Bearer …' }` convenience.
- Read the body as text, then `JSON.parse` it into `.json` (swallowing parse errors so a
  non-JSON 2xx body just yields `json === undefined` rather than throwing).
- On a non-2xx status, **throw an `HttpError`**, deriving the message from `json.message`
  when present, else `statusText`, and passing the parsed `json` as the error `body`:

```js
const { status, statusText, headers } = response;
if (status < 200 || status >= 300) {
  throw new HttpError((json && json.message) || statusText, status, json);
}
return { status, headers, body: text, json };
```

The success shape is `{ status, headers, body /* raw text */, json /* parsed */ }`. The REST
twins destructure `json` and `headers` off this and never touch `body`/`status`.

---

## 2. The query cache — `createQueryCache` (`src/providers/cache.js`)

### 2.1 What it is

A `Map`-backed cache with explicit, resource-scoped invalidation. The key is derived by
concatenating the resource name with a **stable** serialization of the params:

```js
const store = new Map();
const keyOf = (resource, params) => `${resource}::${stableStringify(params ?? null)}`;
```

`stableStringify` (`src/core/util.js`) is a JSON stringify that recursively **sorts object
keys** and guards against cycles, so `{ page: 1, sort: 'id' }` and `{ sort: 'id', page: 1 }`
produce the *same* key. `params` is normalized to `null` when nullish, so a bare `getOne`
with no params still keys deterministically. The `::` separator plus the `resource` prefix is
also what invalidation keys off:

```js
invalidate(resource) {
  if (resource == null) { store.clear(); return; }
  const prefix = `${resource}::`;
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}
```

So `invalidate('posts')` drops every cached `posts` entry (any params) by prefix match;
`invalidate()` with no argument clears everything. The surface is `get`/`has`/`set`/
`invalidate`/`clear` plus a `size` getter. `set` returns the value it stored (convenient for
`return cache.set(...)` write-through patterns). There is **no automatic dependency
tracking and no TTL** — the header comment says as much: invalidation is "explicit ... after
create/update/delete (no automatic dependency tracking without react-query)."

### 2.2 VERIFIED TRUTH: it is wired into nothing

This is the non-obvious fact a contributor most needs. `createQueryCache` is **not consumed
anywhere in the running application.** A full-tree search for its usage returns only its own
definition and a re-export:

```
src/index.js:71:export { createQueryCache } from './providers/cache.js';
src/providers/cache.js:7:export const createQueryCache = () => {
```

Specifically:

- **`createListController` does NOT use it.** Read `src/core/store.js` carefully: on every
  page/perPage/sort change (immediately) and on filter change (debounced 500 ms), it calls
  `dataProvider.getList(...)` *directly*, with a fresh `AbortController`, and writes the
  result straight into signals. There is no `cache.get`/`cache.has` short-circuit before the
  fetch and no `cache.set` after it. The only `stableStringify` use in that file is inside
  the `dirty` computed of `createFormController`, comparing form values against their
  initial snapshot — nothing to do with the query cache.
- **`createFormController` does not use it either.**
- Nothing else imports `providers/cache.js`.

So `createQueryCache` exists as **public, tested-in-isolation infrastructure that is exported
for library consumers but is not currently plugged into any controller.** It is a faithful
port of the react-admin concept, ready to be wired in, but today a `getOne` after a `getList`
does *not* reuse data, and two identical `getList`s do *not* dedupe through this cache. (The
only request coalescing that actually happens at runtime is the getMany batcher — §3 — which
is a different mechanism entirely.) If you go looking for "why isn't caching working," this is
the answer: it was never connected.

---

## 3. The getMany batcher — `createGetManyBatcher` (`src/providers/batcher.js`)

### 3.1 The algorithm

This is the N+1 killer for reference rendering, and unlike the cache it **is** live. It
reproduces react-admin's per-tick getMany coalescing without react-query. One batcher wraps
one `dataProvider`. Internally it holds a `Map` of *buckets* keyed by reference resource name;
each bucket is `{ ids: Set, waiters: [{ ids, resolve, reject }] }`, plus a single
`scheduled` flag guarding a `queueMicrotask`.

The public method:

```js
const getMany = (reference, ids = []) =>
  new Promise((resolve, reject) => {
    let bucket = buckets.get(reference);
    if (!bucket) {
      bucket = { ids: new Set(), waiters: [] };
      buckets.set(reference, bucket);
    }
    for (const id of ids) bucket.ids.add(id);
    bucket.waiters.push({ ids: [...ids], resolve, reject });
    schedule();
  });
```

Each call: finds-or-creates the bucket for that `reference`, unions its ids into the bucket's
`Set` (dedup), records a *waiter* remembering the exact ids that particular caller asked for
(as a snapshot copy), and schedules a flush. `schedule()` is idempotent within a tick — the
first caller arms one `queueMicrotask(flush)`, subsequent callers in the same tick no-op on
the flag.

At end-of-tick, `flush` snapshots and clears the buckets, then for each reference issues **one**
`getMany`, and fans the result back out to that bucket's waiters:

```js
const flush = () => {
  scheduled = false;
  const pending = [...buckets.entries()];
  buckets.clear();
  for (const [reference, bucket] of pending) {
    const ids = [...bucket.ids];
    Promise.resolve()
      .then(() => dataProvider.getMany(reference, { ids }))
      .then((result) => {
        const byId = new Map(
          (result.data || []).map((record) => [String(record.id), record])
        );
        for (const waiter of bucket.waiters) {
          waiter.resolve(
            waiter.ids
              .map((id) => byId.get(String(id)))
              .filter((record) => record !== undefined)
          );
        }
      })
      .catch((err) => {
        for (const waiter of bucket.waiters) waiter.reject(err);
      });
  }
};
```

Result distribution is by an `id -> record` map with **string-coerced** keys on both sides
(`String(record.id)` and `String(id)`), so a numeric `1` and a string `'1'` match — important
because JSON backends are inconsistent about id types. Each waiter gets back only the records
for the ids *it* requested, in the order it requested them, with misses filtered out
(so a waiter can legitimately receive a shorter array than it asked for, or an empty one).
On failure the whole bucket's waiters reject with the same error.

### 3.2 Walk-through: two `sa-reference-field`s, same reference, same tick

Two `<sa-reference-field reference="authors">` render in the same synchronous pass, one needing
author `7`, the other author `12`, against the *same* batcher instance:

1. Field A calls `batcher.getMany('authors', [7])`. No `authors` bucket exists → create it,
   `ids = {7}`, push waiter `{ ids:[7], resolve_A }`, `schedule()` arms the microtask.
2. Field B calls `batcher.getMany('authors', [12])`. Bucket exists → `ids = {7,12}`, push
   waiter `{ ids:[12], resolve_B }`, `schedule()` sees `scheduled === true` → no-op.
3. Microtask fires. `flush` reads `ids = [7,12]`, clears buckets, issues **one**
   `dataProvider.getMany('authors', { ids: [7,12] })`.
4. Response arrives → `byId = { '7': {…}, '12': {…} }`. Waiter A resolves with `[author7]`,
   waiter B with `[author12]`.

Two fields, one HTTP round-trip. If a *third* field on the same page asked for `authors` id
`7` again, its id would dedup into the same `Set` and it would still resolve from the shared
`byId` map — no extra request.

### 3.3 VERIFIED TRUTH: fields and inputs use TWO different sharing strategies

The batcher only coalesces calls made **on the same batcher instance**. There are two
module-level caches of batcher instances, and they key differently:

**(a) Fields — keyed by reference NAME** (`src/fields/referenceField.js`):

```js
const batchersByReference = new Map();

export const getReferenceBatcher = (reference) => {
  let batcher = batchersByReference.get(reference);
  if (batcher) return batcher;
  const dataProvider = getDataProvider();
  if (!dataProvider) return null;
  batcher = createGetManyBatcher(dataProvider);
  batchersByReference.set(reference, batcher);
  return batcher;
};
```

One batcher instance **per reference resource name**, module-global, created lazily the first
time any reference field for that name renders (it needs the registry's active `dataProvider`,
which does not exist until `<sa-admin>` mounts). `src/fields/referenceArrayField.js` imports
and reuses this exact `getReferenceBatcher`, so a `<sa-reference-field>` and a
`<sa-reference-array-field>` pointing at the same resource **do** share one batcher and
coalesce.

**(b) Inputs — keyed by dataProvider INSTANCE** (`src/inputs/referenceShared.js`):

```js
const batcherCache = new WeakMap();

export const batcherFor = (dataProvider) => {
  if (!dataProvider) return null;
  let batcher = batcherCache.get(dataProvider);
  if (!batcher) {
    batcher = createGetManyBatcher(dataProvider);
    batcherCache.set(dataProvider, batcher);
  }
  return batcher;
};
```

One batcher instance **per dataProvider object**, held in a `WeakMap`. Both
`src/inputs/referenceInput.js` and `src/inputs/referenceArrayInput.js` go through
`batcherFor`, so all reference *inputs* on a page share a single batcher instance (that one
batcher still buckets internally by reference name — §3.1 — so per-reference coalescing is
correct within the input world).

**Do a field and an input reading the same reference on the same page share one batched
request? No.** Verified by the two cache keys above: they live in *different modules*, are
*different Map/WeakMap objects*, and key on *different things* (a string reference name vs. the
dataProvider object). Even though both ultimately fetch the **same** registry-singleton
`dataProvider` (fields via `getDataProvider()`; inputs are handed the same singleton — e.g.
`referenceInput._hydrateCurrent(dataProvider)` calls `batcherFor(dataProvider)`), they resolve
to two **distinct** `createGetManyBatcher` instances. So a `<sa-reference-field reference="authors">`
and a `<sa-reference-input reference="authors">` rendering in the same tick issue **two**
`getMany('authors', …)` calls, not one.

**Is this a bug or harmless?** It is a **harmless efficiency gap, not a correctness bug.**
Each side independently coalesces correctly; the only cost is that the field-world and the
input-world don't merge their two requests into one. In practice a page rarely renders both a
reference *field* and a reference *input* for the very same resource in the same tick (fields
are for read views, inputs for edit/create forms), so the extra round-trip is uncommon. But it
is real, and a future contributor "optimizing" reference loading should know the two worlds are
deliberately (or at least actually) siloed. If you ever want true unification, both sides would
need to route through one cache keyed the same way — most naturally the dataProvider-keyed
`WeakMap`, since that also correctly handles a dataProvider swap (the name-keyed `Map` on the
field side captures whatever `dataProvider` existed at first call and never re-derives it).

---

## 4. `combineDataProviders` (`src/providers/combine.js`)

A near-verbatim port of ra-core's Proxy dispatcher. It takes a `getDataProvider(resource)`
function and returns an object that *looks like* a full DataProvider but routes each call to a
different underlying provider chosen by `resource`:

```js
export const combineDataProviders = (getDataProvider) =>
  new Proxy({}, {
    get: (_target, name) => {
      if (typeof name === 'symbol' || name === 'then') return undefined;
      return (resource, params) => {
        const provider = getDataProvider(resource);
        const method = provider[name];
        if (typeof method !== 'function') {
          throw new Error(
            `Unknown dataProvider method '${String(name)}' for resource '${resource}'`
          );
        }
        return method.call(provider, resource, params);
      };
    },
  });
```

Mechanics worth noting:

- The Proxy target is an **empty object**; every property access is intercepted by `get`.
- Any property access returns a **function** `(resource, params) => …`. The routing decision
  is deferred to call time and made purely from the *first argument* (`resource`): it calls
  `getDataProvider(resource)`, then invokes the same-named method on that provider with
  `method.call(provider, resource, params)` (preserving `this`).
- `symbol` keys and `'then'` return `undefined`. The `'then'` guard is the important one: it
  keeps the Proxy from being mistaken for a thenable if it is ever `await`ed or returned from
  an async function, which would otherwise hang.
- Because access is by method *name*, it transparently supports any custom method your
  providers expose, not just the nine core ones — the only failure mode is calling a method
  the chosen provider doesn't implement, which throws the descriptive error above.

---

## 5. The wrappers, and how the auth wrappers relate

### 5.1 `withLifecycleCallbacks` (`src/providers/lifecycle.js`)

Injects before/after hooks per resource without modifying the base provider. It shallow-clones
the provider (`const wrapped = { ...dataProvider }`) and replaces each of the nine core methods
with an async version that runs matching hooks:

```js
wrapped[method] = async (resource, params) => {
  const applicable = matching(resource);
  let nextParams = params;
  for (const handler of applicable) {
    if (typeof handler[beforeKey] === 'function') {
      nextParams = await handler[beforeKey](nextParams, dataProvider, resource);
    }
  }
  let result = await dataProvider[method](resource, nextParams);
  for (const handler of applicable) {
    if (typeof handler[afterKey] === 'function') {
      result = await handler[afterKey](result, dataProvider, resource);
    }
  }
  return result;
};
```

Contract:

- **Handler shape:** each callback entry has a `resource` (a resource name **or `'*'`**) and
  any of `before<Method>` / `after<Method>` for the nine core methods (`getList`, `getOne`,
  `getMany`, `getManyReference`, `create`, `update`, `updateMany`, `delete`, `deleteMany`).
  `matching(resource)` selects entries whose `resource` equals the call's resource **or** is
  `'*'`.
- **before hooks** receive `(params, dataProvider, resource)` and **return the (possibly
  modified) params**; each hook's return feeds the next (they chain). The value they return is
  what is finally passed to the real method.
- **after hooks** receive `(result, dataProvider, resource)` and **return the (possibly
  modified) result**, likewise chained.
- Hooks may be async — every step is `await`ed.
- Order is **handler array order**. A `'*'` handler and a resource-specific handler both run;
  their relative order is their order in the array. Note there is no de-dup and no priority.
- Methods the base provider does not implement are skipped (`if (typeof dataProvider[method]
  !== 'function') continue`), so wrapping a partial provider is safe.

**Realistic use case:** upload handling. A `beforeCreate`/`beforeUpdate` on `resource: 'posts'`
detects a `params.data.image` that is a `File`, uploads it, and rewrites `params.data.image`
to the returned URL before the real `create` runs — the classic react-admin example. A `'*'`
`afterGetList` could stamp a client-side `_fetchedAt` on every record across all resources.

### 5.2 `combineDataProviders` + `withLifecycleCallbacks` compose freely — both are DataProvider→DataProvider

Neither of these two knows about the other; each takes a DataProvider and returns a
DataProvider, so you can nest them in any order. That is the whole point of the layer being a
stack of transparent wrappers.

### 5.3 The two auth wrappers: `refreshAuth` vs. `authGuard` — different jobs, meant to compose

There are **two distinct** provider-wrapping mechanisms related to auth, and they are **not
alternatives** — they do different things and are designed to stack.

**(a) `addRefreshAuthToDataProvider` / `addRefreshAuthToAuthProvider`
(`src/providers/refreshAuth.js`)** — *pre-*call token refresh. Each is a Proxy that, for the
relevant method set, `await refreshAuth()` **before** delegating:

```js
export const addRefreshAuthToDataProvider = (dataProvider, refreshAuth) =>
  new Proxy(dataProvider, {
    get(target, name) {
      const value = target[name];
      if (typeof value === 'function' && DATA_PROVIDER_METHODS.includes(String(name))) {
        return async (...args) => {
          await refreshAuth();
          return value.apply(target, args);
        };
      }
      return value;
    },
  });
```

The data-provider variant guards the nine core methods; the auth-provider variant guards
`['checkAuth', 'getIdentity', 'getPermissions', 'canAccess']`. Both take the **same**
`refreshAuth` callback so the data and auth layers refresh in lockstep. `refreshAuth` is
typically a "if the access token is near expiry, refresh it and resolve when done" function, so
a burst of parallel calls each waits on one refresh instead of each 401-ing and racing.

**(b) `addAuthCheckToDataProvider` (`src/auth/authGuard.js`)** — *post-*call error funnel. A
Proxy that wraps **every** function property (not a fixed list) and catches rejections; on a
`401`/`403` it routes the error through `checkError` (which may log out + redirect), then
**always re-throws** so the calling view still sees the error:

```js
export const addAuthCheckToDataProvider = (dataProvider, authProvider) => {
  if (!authProvider) return dataProvider;
  return new Proxy(dataProvider, {
    get(target, name) {
      const value = target[name];
      if (typeof value !== 'function') return value;
      return async (...args) => {
        try {
          return await value.apply(target, args);
        } catch (error) {
          if (error && (error.status === 401 || error.status === 403)) {
            await checkError(authProvider, error);
          }
          throw error;
        }
      };
    },
  });
};
```

**Relationship:** `refreshAuth` is *proactive* (refresh before the call so it doesn't fail);
`authGuard` is *reactive* (if a call fails with an auth status, run `checkError`). They are
**complementary and composable**, not competing. `refreshAuth` also takes and wraps an
`authProvider`, while `authGuard` takes a `(dataProvider, authProvider)` pair but only wraps
the dataProvider — neither imports the other; they compose by nesting DataProviders.

**What `<sa-admin>` actually does (verified, `src/components/admin.js`):** it wires **only the
authGuard**, and only when an `authProvider` is present. `refreshAuth` is *not* applied
automatically by the shell — it is opt-in library plumbing you'd compose yourself before
handing the provider to `<sa-admin>`. The actual shell code:

```js
let publishedDataProvider = this._dataProvider;
if (this._authProvider) {
  publishedDataProvider = addAuthCheckToDataProvider(this._dataProvider, this._authProvider);
  setAuthProvider(this._authProvider);
}
setDataProvider(publishedDataProvider);
```

So the **effective call order at runtime** for a data call, outermost-first, is: whatever stack
you built (e.g. `addRefreshAuthToDataProvider(combineDataProviders(...))` →
`withLifecycleCallbacks(...)`), then `<sa-admin>` wraps that whole thing in
`addAuthCheckToDataProvider`, then publishes it to the registry singleton. Every field/input
that reads `getDataProvider()` — including both reference batchers in §3 — therefore operates
on the **auth-guarded** provider, so their getMany failures also funnel through `checkError`.
If you additionally want proactive refresh, you apply `addRefreshAuthToDataProvider` yourself
*inside* the provider you pass in; the shell will then guard the already-refreshing provider.

---

## 6. Case study: the REST twins — what the provider layer requires vs. doesn't

`saDataSimpleRest` (`simpleRest.js`, ra-data-simple-rest port) and `saDataJsonServer`
(`jsonServer.js`, ra-data-json-server port) are structurally identical DataProviders differing
only in wire format:

| Aspect | `saDataSimpleRest` | `saDataJsonServer` |
| --- | --- | --- |
| list query | `sort=[...]&range=[...]&filter={...}` | `_sort&_order&_start&_end` + flattened filter |
| getMany | `filter={"ids":[...]}` (one blob) | repeated `id=1&id=2&id=3` |
| total count | `Content-Range` header, else `X-Total-Count` | `X-Total-Count` only |
| updateMany/deleteMany | N parallel single-record requests | N parallel single-record requests |

**What they depend on from the provider layer:** exactly two things.

- `fetchJson` — the default `httpClient` (injectable as the second constructor arg for tests
  or auth-header injection): `saDataSimpleRest = (apiUrl, httpClient = fetchJson) => ({...})`.
- `HttpError` — *transitively*, because `fetchJson` throws it on non-2xx. The twins never
  import `httpError.js` directly; they simply let the rejection propagate. That rejection is
  what `addAuthCheckToDataProvider` later inspects for `status === 401/403`.

**What they deliberately do NOT depend on:** `createQueryCache` and `createGetManyBatcher`.
Neither file imports either. This confirms the core claim of §whole-document: **caching and
batching are simple-admin-core-side concerns layered on top of any DataProvider, requiring no
cooperation from the provider.** The batcher calls `dataProvider.getMany(reference, { ids })`
like any other consumer — the twins just implement `getMany`; they have no idea a batcher is
coalescing calls into it. A completely hand-rolled DataProvider that has never heard of
simple-admin gets the same batching for free, provided it implements `getMany` with the
standard `{ data: [...] }` return shape. (And it would get caching too — if the cache were
wired in. It isn't; see §2.2.)

Note also that `updateMany`/`deleteMany` in both twins fan out into N single-record requests
via `Promise.all` (`.then(() => id)` to recover the id list) — there is no real bulk endpoint
in either backend convention, matching how the react-admin originals degrade.

---

## 7. Gotchas / non-obvious facts for a future contributor

1. **`createQueryCache` is dead infrastructure.** It is exported from `src/index.js` and works
   correctly in isolation, but **no controller consumes it.** `createListController` fetches
   directly on every param change with no cache read/write. If you expected `getOne`-after-
   `getList` reuse or `getList` dedup, it is not happening. Wiring it in is a real feature, not
   a bug fix — and you'd own the invalidation calls after create/update/delete yourself, since
   the cache does no automatic dependency tracking. (§2)

2. **Fields and inputs do not share a getMany batcher.** Fields key batcher instances by
   *reference name* (`batchersByReference` Map in `referenceField.js`, reused by
   `referenceArrayField.js`); inputs key by *dataProvider instance* (`batcherCache` WeakMap in
   `referenceShared.js`, used by `referenceInput.js` and `referenceArrayInput.js`). Same
   reference + same page + same tick across a field and an input ⇒ **two** `getMany` calls, not
   one. Harmless efficiency gap, not a correctness bug, but surprising if you assumed one shared
   batcher. Also: the field-side name-keyed Map captures the dataProvider present at first call
   and never re-derives it, so it would not follow a runtime dataProvider swap; the input-side
   WeakMap would. (§3.3)

3. **The batcher matches ids by string.** Both the lookup map and the request keys are
   `String(...)`-coerced, so numeric/string id mismatches between backend and caller don't cause
   phantom misses. A waiter can still resolve with **fewer** records than it asked for (missing
   ids are filtered out) — reference fields handle this by falling back to rendering the raw id.
   (§3.1)

4. **`<sa-admin>` applies `addAuthCheckToDataProvider` but NOT `addRefreshAuthTo*`.** Proactive
   token refresh is opt-in and must be composed by you *before* passing the provider to the
   shell; only the reactive error funnel is automatic, and only when an `authProvider` exists.
   Every reference batcher operates on the auth-guarded provider, so batched getMany failures
   also route through `checkError`. (§5.3)

5. **`combineDataProviders` returns a thenable-safe Proxy over an empty object.** The `'then'`
   and `symbol` guards are load-bearing — remove them and the object can be mistaken for a
   Promise. Method resolution is purely by the *first argument* (`resource`) at call time, and
   any unknown method on the chosen provider throws a descriptive error rather than returning
   `undefined`. (§4)

6. **`withLifecycleCallbacks` chains hooks in array order with no priority and `'*'` as a
   plain match.** A wildcard handler and a resource handler both run; order is just their order
   in the array. before-hooks must *return* the params (a hook that forgets to return turns the
   next params into `undefined`) and after-hooks must return the result. (§5.1)

7. **The whole layer is a stack of transparent DataProvider→DataProvider wrappers.** `combine`,
   `lifecycle`, `refreshAuth`, and `authGuard` each take a provider and return a provider; none
   requires the wrapped provider to know it's wrapped. This is why the REST twins can depend on
   nothing but `fetchJson`/`HttpError` and still participate in the full stack. (§6)
