# react-admin: Auth Provider Contract & Access Control

Source: https://marmelab.com/react-admin/Authentication.html, https://marmelab.com/react-admin/Permissions.html,
https://marmelab.com/react-admin/AuthProviderWriting.html, https://marmelab.com/react-admin/AuthProviderList.html,
and `packages/ra-core/src/types.ts` in https://github.com/marmelab/react-admin.

## 1. The `authProvider` object

react-admin treats auth as a pluggable object of async methods, passed to `<Admin authProvider={authProvider}>`.
There is no base class — any object matching the shape below works. Every method returns a `Promise`;
**resolve = allow, reject/throw = deny**. Extra custom methods are allowed (the type has a `[key: string]: any` index).

### 1.1 Full TypeScript shape (from `ra-core/src/types.ts`)

```typescript
export type AuthProvider = {
  login: (params: any) => Promise<{ redirectTo?: string | boolean } | void | any>;
  logout: (params: any) => Promise<void | false | string>;
  checkAuth: (params: any) => Promise<void>;
  checkError: (error: any) => Promise<void>;
  getIdentity?: (params?: any) => Promise<UserIdentity>;
  getPermissions?: (params?: any) => Promise<any>;
  handleCallback?: (params?: any) => Promise<AuthRedirectResult | void | any>;
  canAccess?: <RecordType extends Record<string, any> = Record<string, any>>(
    params: {
      action: string;
      resource: string;
      record?: RecordType;
    }
  ) => Promise<boolean>;
  [key: string]: any;
  supportAbortSignal?: boolean;
};

export interface UserIdentity {
  id: Identifier;       // string | number
  fullName?: string;
  avatar?: string;
  [key: string]: any;   // arbitrary extra fields allowed
}

export type AuthRedirectResult = {
  redirectTo?: string | false;
  logoutOnFailure?: boolean;
};
```

Only `login`, `logout`, `checkAuth`, and `checkError` are strictly required. `getIdentity`, `getPermissions`,
`canAccess`, and `handleCallback` are all **optional** — react-admin feature-detects them at runtime and
no-ops (or falls back to permissive behavior) if absent.

## 2. Method-by-method contract

### 2.1 `login(params)`

- **Purpose**: authenticate a user against the backend/IdP.
- **Called by**: the `useLogin()` hook, invoked from the login form's submit handler (or from a custom
  "Login with X" button for OAuth-style flows).
- **Params**: free-form object — for a classic form this is typically `{ username, password }` (or
  `{ email, password }`); for a redirect-based flow (OAuth/OIDC) it may just be an empty object triggering a
  `window.location` redirect to the identity provider.
- **Returns/resolves**: `void`/`any` on success, or `{ redirectTo }` to send the user somewhere other than the
  default post-login route.
- **Rejects**: with an `Error` (optionally `error.message` for the notification text) — the login form then
  displays that error.
- **Reference implementation** (username/password against a JSON API, storing token in `localStorage`):

```javascript
async login({ username, password }) {
  const request = new Request('https://mydomain.com/authenticate', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
    headers: new Headers({ 'Content-Type': 'application/json' }),
  });
  let response;
  try {
    response = await fetch(request);
  } catch (_error) {
    throw new Error('Network error');
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(response.statusText);
  }
  const auth = await response.json();
  localStorage.setItem('auth', JSON.stringify(auth));
}
```

### 2.2 `logout(params)`

- **Purpose**: clear local credentials and (optionally) notify the auth server / IdP.
- **Called by**: `useLogout()` hook — wired to the AppBar user-menu "Logout" item — and automatically by
  react-admin after a rejected `checkAuth` or `checkError`.
- **Returns**: `Promise<void | false | string>`. Returning a string overrides the redirect target (e.g. an
  IdP's own logout/end-session URL for OAuth "single logout"); returning `false` disables the redirect.
- **Reference implementation**:

```javascript
async logout() {
  localStorage.removeItem('auth');
}
```

### 2.3 `checkAuth(params)`

- **Purpose**: verify that the current session is still valid.
- **Called by**: react-admin automatically, before rendering any page that requires authentication — i.e. on
  mount/navigation to CRUD routes (`list`/`edit`/`create`/`show`), and inside `<Authenticated>` /
  `useAuthenticated()` / `useAuthState()` for custom routes.
- **Returns**: `Promise<void>` — resolve = authenticated, reject = not authenticated.
- **On reject**: react-admin redirects to `/login` (calling `logout()` first to clear stale state).
- **Reference implementation**:

```javascript
async checkAuth() {
  if (!localStorage.getItem('auth')) {
    throw new Error();
  }
}
```

- Can also be used to kick off an OAuth redirect (e.g. `window.location.href = idpAuthorizeUrl` before
  throwing), which pairs with `handleCallback()` below.

### 2.4 `checkError(error)`

- **Purpose**: inspect errors returned by the `dataProvider` and decide whether they represent an auth failure.
- **Called by**: react-admin automatically **every time `dataProvider` rejects** (any CRUD call failing), via
  the internal `useLogoutIfAccessDenied` mechanism — this is the main way 401/403 API responses get turned
  into a logout+redirect.
- **Returns**: `Promise<void>` — resolve = "not an auth error, let the UI show it as a normal error"; reject
  = "this is an auth error."
- **On reject**: react-admin calls `logout()` and redirects to `/login` by default.
- **Docs do not distinguish 401 vs 403 by default** — the common reference implementation treats both the
  same way (session invalid → wipe credentials → redirect to login):

```javascript
async checkError(error) {
  const status = error.status;
  if (status === 401 || status === 403) {
    localStorage.removeItem('auth');
    throw new Error();
  }
  // other error codes (e.g. 500) are not auth errors: resolve so the UI shows the error normally
}
```

- **Customizing the redirect / suppressing logout**: attach extra properties to the thrown error:

```javascript
async checkError(error) {
  const status = error.status;
  if (status === 401 || status === 403) {
    localStorage.removeItem('auth');
    const err = new Error();
    err.redirectTo = '/credentials-required'; // instead of the default /login
    err.logoutUser = false;                   // stay "logged in" but redirect anyway
    // err.message = false;                    // suppress the error notification entirely
    throw err;
  }
}
```

This makes it possible to differentiate **401 (unauthenticated → force logout + /login)** from
**403 (authenticated but forbidden → redirect to an "access denied" page without logging out)** if desired,
even though the default example doesn't do so.

### 2.5 `getIdentity()` (optional)

- **Purpose**: return metadata about the current user for display purposes.
- **Called by**: react-admin on app init / whenever the AppBar user menu renders, and available to app code
  via `useGetIdentity()`; also used for audit trails (e.g. `<Edit mutationOptions>` can read identity to stamp
  "last edited by").
- **Returns**: `Promise<UserIdentity>`:

```typescript
{
  id: string | number;   // required
  fullName?: string;     // shown in the AppBar user menu
  avatar?: string;       // URL, shown as avatar image in the AppBar
  [key: string]: any;    // app-defined extra fields (email, role, etc.)
}
```

- **Usage locations**: `<AppBar>` user menu (name + avatar), and any custom component via
  `const { identity, isPending, error } = useGetIdentity()`.

### 2.6 `getPermissions()` (optional)

- **Purpose**: return the current user's role/permission data for **UI-level** conditional rendering (as
  opposed to `canAccess`, which is the page/route-level gatekeeper — see below).
- **Returns**: `Promise<any>` — deliberately untyped; can be a string (`"admin"`), an array of permission
  strings (`["post_editor", "super_admin"]`), or a structured object
  (`{ postList: { read: true, write: false } }`) — the app decides the shape and interprets it itself.
- **Reference implementation** (decoding a JWT stored at login):

```javascript
const authProvider = {
  async login({ username, password }) {
    const response = await fetch('https://mydomain.com/authenticate', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
      headers: { 'Content-Type': 'application/json' },
    });
    const { token } = await response.json();
    const decodedToken = decodeJwt(token);
    localStorage.setItem('token', token);
    localStorage.setItem('permissions', decodedToken.permissions);
  },
  async getPermissions() {
    const role = localStorage.getItem('permissions');
    if (!role) throw new Error('Permissions not found');
    return role;
  },
};
```

- **Consumed via** `usePermissions()` hook: `const { isPending, permissions } = usePermissions();`

### 2.7 `canAccess({ action, resource, record })` (optional)

- **Purpose**: fine-grained, resource+action (and optionally record) level authorization — the modern
  replacement/complement to `getPermissions` for gating actual page/button access rather than just hiding UI.
- **Signature**:

```typescript
type CanAccessParams = {
  action: string;    // e.g. "list" | "create" | "edit" | "show" | "delete" | custom string
  resource: string;  // resource name, e.g. "posts"
  record?: any;       // optional specific record for record-level checks
};
async function canAccess(params: CanAccessParams): Promise<boolean>;
```

- **Called automatically by**: the built-in `<List>`, `<Create>`, `<Edit>`, `<Show>` page components (before
  rendering — unauthorized access redirects to an "Access Denied" page, route `/accessDenied`, customizable),
  and by action buttons (`<EditButton>`, `<CreateButton>`, `<DeleteButton>`, `<ShowButton>`, `<ListButton>`),
  which hide themselves when `canAccess` resolves `false`.
- **Reference implementations**:

```javascript
// Role-based
const accessControlStrategies = {
  admin: () => true,
  user: ({ resource }) => resource !== 'users',
  reader: ({ resource, action }) => resource !== 'users' && action === 'read',
};
const authProvider = {
  async canAccess({ resource, action }) {
    const role = localStorage.getItem('role');
    return accessControlStrategies[role]({ resource, action });
  },
};

// Permission-list based
const authProvider = {
  async canAccess({ resource, action, record }) {
    const permissions = JSON.parse(localStorage.getItem('permissions'));
    return permissions.some(p => p.resource === resource && p.action === action);
  },
};
```

- **Performance note (from docs)**: "react-admin calls `dataProvider.canAccess()` before rendering all page
  components, so if the call is slow, user navigation may be delayed." Recommendation: resolve/cache
  permissions once at login time rather than hitting the network on every check.

### 2.8 `handleCallback()` (optional, OAuth/OIDC flows)

- **Purpose**: process the redirect-back from a third-party identity provider.
- **Called by**: react-admin automatically when the app mounts at the `/auth-callback` route (the route the
  IdP redirects to after login).
- **Returns**: `Promise<AuthRedirectResult | void | any>` where
  `AuthRedirectResult = { redirectTo?: string | false; logoutOnFailure?: boolean }`.
- **Typical implementation**: reads `window.location.search` for an authorization `code`/`state`, exchanges it
  for tokens against the IdP's token endpoint, stores tokens, then returns/resolves so react-admin redirects
  into the app.

## 3. How the login form is wired

- `<Admin loginPage={...}>` (default: built-in `<Login>` page wrapping `<LoginForm>`) is shown whenever
  `checkAuth()` rejects and the app redirects to `/login`.
- The default `<LoginForm>` renders `TextInput` (username) + `PasswordInput` (password) and calls
  `useLogin()`'s returned function with `{ username, password }` on submit.
- `useLogin()` signature: `const login = useLogin(); login(params, pathName?)` — calls
  `authProvider.login(params)`, and on success redirects to `pathName` (default: wherever the user was
  originally headed, or `/`).
- Fully custom login pages/forms are supported — just call `useLogin()` with whatever credential shape your
  `authProvider.login()` expects (e.g. SSO button with no params, magic-link email, etc.). Pass the custom
  component via `<Admin loginPage={MyLoginPage}>`.
- `backgroundImage` prop customizes the default login page background.

## 4. Access-control building blocks (components/hooks)

| API | Kind | Behavior |
|---|---|---|
| `<Authenticated>` | component | Wraps children; calls `checkAuth()`; redirects to `/login` if not authenticated. Used to protect custom routes. |
| `useAuthenticated()` | hook | Same check as `<Authenticated>`, imperative form; returns `{ isPending }`. |
| `useAuthState()` | hook | Lower-level: returns `{ authenticated, isPending, error }` without side-effecting a redirect. |
| `usePermissions()` | hook | Calls `authProvider.getPermissions()`; returns `{ isPending, permissions }`. |
| `useCanAccess({ action, resource, record? })` | hook | Calls `authProvider.canAccess()`; returns `{ isPending, error, canAccess }`. |
| `useCanAccessResources({ action, resources: [] })` | hook | Batch version of `useCanAccess` for multiple resources at once; returns `{ isPending, canAccess }` map keyed by resource. |
| `<CanAccess action resource record? accessDenied?>` | component | Declarative wrapper; renders children only if `canAccess` resolves true, otherwise renders `accessDenied` (default: nothing / built-in `<AccessDenied>` page for page-level use). |
| `useGetIdentity()` | hook | Calls `authProvider.getIdentity()`; returns `{ identity, isPending, error }`. |
| `useLogin()` / `useLogout()` | hooks | Imperative wrappers around `authProvider.login()` / `logout()`. |

### 4.1 Page-level defaults

- `<List>`, `<Create>`, `<Edit>`, `<Show>` automatically require authentication (`checkAuth`) **and**, if
  `authProvider.canAccess` is defined, call it with `{ resource, action: '<list|create|edit|show>' }` before
  rendering. Failing either redirects (login, or the Access Denied page respectively).
- `requireAuth` prop can force auth checks even earlier (before menu/resource names are shown).
- `disableAuthentication` prop opts a specific CRUD page out of the auth requirement (public pages).
- Custom routes rendered with `noLayout` bypass the authentication requirement entirely.

### 4.2 Restricting resources/menu declaratively

```javascript
// Conditionally include whole <Resource> trees based on permissions
<Admin dataProvider={dataProvider} authProvider={authProvider}>
  {permissions => (
    <>
      <Resource
        name="customers"
        list={VisitorList}
        edit={permissions === 'admin' ? VisitorEdit : null}
      />
      {permissions === 'admin' && <Resource name="categories" list={CategoryList} />}
    </>
  )}
</Admin>

// Hiding a custom menu item
<Menu>
  <Menu.ResourceItems />
  <CanAccess resource="logs" action="read">
    <Menu.Item primaryText="Logs" to="/logs" />
  </CanAccess>
</Menu>
```

## 5. Error / redirect flow summary

1. Any `dataProvider` call rejects (e.g. HTTP 401/403 from the API) → react-admin calls
   `authProvider.checkError(error)`.
2. If `checkError` **rejects**: react-admin calls `authProvider.logout()`, then redirects — to `/login` by
   default, or to `error.redirectTo` if the thrown error set it. If `error.logoutUser === false`, credentials
   are not cleared even though the redirect still happens. If `error.message === false`, no error
   notification is shown.
3. If `checkError` **resolves**: the error is surfaced normally (e.g. a notification toast), no logout/redirect.
4. Independently, on mount of any protected page/route, react-admin calls `authProvider.checkAuth()`. If it
   **rejects**: same logout + redirect-to-`/login` behavior as above (this is what catches "session expired
   while the tab was idle" before any API call even happens).
5. `logout()` itself decides the final redirect target: resolving `void` → default `/login`; resolving a
   `string` → redirect there instead (useful for IdP end-session URLs); resolving `false` → no redirect.

## 6. Common real-world implementations (patterns, not full detail)

- **Simple username/password**: `login` POSTs credentials to a custom `/authenticate` endpoint, stores a
  token/permissions blob in `localStorage`; `checkAuth`/`getPermissions` just read `localStorage`; a matching
  `dataProvider` httpClient attaches `Authorization: Bearer <token>` to every request. This is the pattern
  shown throughout the official docs and is the natural template for an MVP.
- **OAuth/OIDC-style providers** (official packages: `ra-auth-auth0`, `ra-auth-cognito`, `ra-auth-msal`,
  `ra-auth-google`, `ra-keycloak`, `ra-supabase`, `ra-directus`, `ra-appwrite`, plus community packages for
  AWS Amplify, Firebase, Casdoor, SurrealDB, Apache Apisix): `login` redirects the browser to the IdP;
  `handleCallback` runs at `/auth-callback` to exchange the returned code for tokens; `checkAuth`/`checkError`
  validate/refresh the token silently or force a re-redirect; `logout` may call the IdP's end-session endpoint
  (via a returned string redirect URL) for single sign-out. These wrap the same core `AuthProvider` contract —
  no react-admin-side API differs, only the internals of each method.

## 7. Minimal AuthProvider contract to replicate

For a vanilla-JS "simple-admin" MVP aiming at near drop-in compatibility, clone this subset:

```typescript
type AuthProvider = {
  // Required
  login(params: any): Promise<void | { redirectTo?: string }>;
  logout(params?: any): Promise<void | string | false>;
  checkAuth(params?: any): Promise<void>;      // reject => redirect to /login
  checkError(error: any): Promise<void>;       // reject => logout() + redirect

  // Strongly recommended (covers 90% of real usage)
  getIdentity?(): Promise<{ id: string | number; fullName?: string; avatar?: string; [k: string]: any }>;
  getPermissions?(): Promise<any>;             // opaque blob (string/array/object), app-interpreted
  canAccess?(params: { action: string; resource: string; record?: any }): Promise<boolean>;

  // Skip for MVP unless doing OAuth/OIDC
  // handleCallback?(): Promise<{ redirectTo?: string|false; logoutOnFailure?: boolean } | void>;
};
```

Behavioral contract to preserve, even in a minimal clone:

- **Resolve = allow, throw/reject = deny** for every method — this single convention drives all
  redirect/logout logic and is the most important thing to replicate exactly.
- `checkError` must be wired to fire on **every** data-layer error response so 401/403 auto-logout works
  without each page having to handle it manually.
- `checkAuth` must be wired to fire on **every** protected route/page mount (equivalent of `<Authenticated>`),
  independent of any data call.
- Allow an error thrown from `checkError`/`checkAuth` to carry an optional `redirectTo` (and ideally
  `logoutUser: false`) so apps can send users to a custom "access denied" page instead of always `/login`.
- `canAccess` should be checked at the page/route level (list/create/edit/show-equivalent) and exposed as a
  small reusable guard (hook/helper) so buttons and menu items can hide themselves declaratively, mirroring
  `useCanAccess` / `<CanAccess>`.
- `getIdentity` should feed a top-bar user menu (name + avatar) — keep the `{ id, fullName, avatar }` field
  names for drop-in familiarity even though extra fields are always allowed.
- `getPermissions` should remain deliberately untyped/opaque — the framework should not assume a shape, only
  pass it through to app code.
