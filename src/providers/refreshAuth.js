// addRefreshAuthToDataProvider / addRefreshAuthToAuthProvider (doc 02 §5.3).
//
// Wraps each relevant method so a `refreshAuth()` callback runs (and resolves) before the real
// call. Typically refreshAuth checks token expiry and refreshes it, so a burst of parallel calls
// does not each independently 401 and race to refresh. Both wrappers share one refreshAuth so the
// data and auth layers stay in sync.

const DATA_PROVIDER_METHODS = [
  'getList',
  'getOne',
  'getMany',
  'getManyReference',
  'create',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
];

// Auth methods that read current auth state and therefore benefit from a pre-refresh.
const AUTH_PROVIDER_METHODS = ['checkAuth', 'getIdentity', 'getPermissions', 'canAccess'];

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

export const addRefreshAuthToAuthProvider = (authProvider, refreshAuth) =>
  new Proxy(authProvider, {
    get(target, name) {
      const value = target[name];
      if (typeof value === 'function' && AUTH_PROVIDER_METHODS.includes(String(name))) {
        return async (...args) => {
          await refreshAuth();
          return value.apply(target, args);
        };
      }
      return value;
    },
  });
