// Auth wiring (architecture §7, doc 03 §5/§7). Enforces the single convention:
// resolve = allow, reject/throw = deny.
//
// - checkAuth: run on protected view mount. Reject => logout() + redirect to #/login.
// - checkError: run on every dataProvider rejection (401/403). Reject => logout() + redirect.
//   Thrown-error extras honored: redirectTo, logoutUser:false.
// - canAccess: guard before rendering a view; false => #/access-denied. Absent => permissive.

import { navigate } from '../core/router.js';

const isFn = (obj, name) => obj && typeof obj[name] === 'function';

// Perform the logout + redirect dance, honoring optional error extras.
const logoutAndRedirect = async (authProvider, errorLike) => {
  const redirectTo = (errorLike && errorLike.redirectTo) || '#/login';
  const logoutUser = !errorLike || errorLike.logoutUser !== false;

  if (logoutUser && isFn(authProvider, 'logout')) {
    try {
      const result = await authProvider.logout({});
      if (typeof result === 'string') {
        navigate(result);
        return;
      }
      if (result === false) return; // logout opted out of redirect
    } catch (_) {
      // ignore logout failure; still redirect
    }
  }
  navigate(redirectTo);
};

// Returns true if authenticated. On reject, logs out + redirects and returns false.
export const checkAuth = async (authProvider, params) => {
  if (!isFn(authProvider, 'checkAuth')) return true;
  try {
    await authProvider.checkAuth(params);
    return true;
  } catch (error) {
    await logoutAndRedirect(authProvider, error);
    return false;
  }
};

// Feed a dataProvider error through checkError. Returns true if it was NOT an auth error
// (UI should surface it normally); false if it triggered a logout/redirect.
export const checkError = async (authProvider, error) => {
  if (!isFn(authProvider, 'checkError')) return true;
  try {
    await authProvider.checkError(error);
    return true;
  } catch (authError) {
    const extras = authError && typeof authError === 'object' ? authError : error;
    await logoutAndRedirect(authProvider, extras);
    return false;
  }
};

// Resolve access for an action/resource(/record). Permissive when canAccess is absent.
export const canAccess = async (authProvider, params) => {
  if (!isFn(authProvider, 'canAccess')) return true;
  try {
    return await authProvider.canAccess(params);
  } catch (_) {
    return false;
  }
};

// Full page-mount guard: authenticate, then authorize. Redirects on failure and returns
// false; returns true only when the view may render.
export const guardView = async (authProvider, { action, resource, record } = {}) => {
  const authenticated = await checkAuth(authProvider);
  if (!authenticated) return false;
  const allowed = await canAccess(authProvider, { action, resource, record });
  if (!allowed) {
    navigate('#/access-denied');
    return false;
  }
  return true;
};

// Global wrapper that routes 401/403 dataProvider rejections through checkError.
// The original error is always re-thrown so calling views can render it.
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
