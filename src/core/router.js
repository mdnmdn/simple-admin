// Hash router (architecture §5). Parses location.hash into { resource, view, id },
// exposes a reactive `currentRoute` signal, and a `navigate(hash)` helper.
//
// Route table:
//   #/                      -> { view: 'dashboard' }
//   #/login                 -> { view: 'login' }
//   #/access-denied         -> { view: 'accessDenied' }
//   #/:resource             -> { resource, view: 'list' }
//   #/:resource/create      -> { resource, view: 'create' }
//   #/:resource/:id         -> { resource, id, view: 'edit' }
//   #/:resource/:id/show    -> { resource, id, view: 'show' }

import { signal } from './signal.js';

export const parseHash = (hash = '') => {
  let path = String(hash).replace(/^#/, '');
  path = path.replace(/^\/+/, '').replace(/\/+$/, '');

  if (path === '') return { view: 'dashboard' };

  const parts = path.split('/').filter(Boolean);

  if (parts[0] === 'login') return { view: 'login' };
  if (parts[0] === 'access-denied') return { view: 'accessDenied' };

  const [resource, second, third] = parts;
  if (!second) return { resource, view: 'list' };
  if (second === 'create') return { resource, view: 'create' };
  if (third === 'show') return { resource, id: second, view: 'show' };
  return { resource, id: second, view: 'edit' };
};

const readHash = () =>
  typeof location !== 'undefined' && location.hash ? location.hash : '';

export const currentRoute = signal(parseHash(readHash()));

export const navigate = (hash) => {
  const target = String(hash).startsWith('#') ? hash : `#${hash}`;
  if (typeof location !== 'undefined') {
    location.hash = target;
  } else {
    // Non-DOM environment: still update the reactive route for testing/SSR-adjacent use.
    currentRoute.set(parseHash(target));
  }
};

const syncFromLocation = () => currentRoute.set(parseHash(readHash()));

// Begin listening to hashchange; returns a teardown that stops the router.
export const startRouter = () => {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('hashchange', syncFromLocation);
  syncFromLocation();
  return () => window.removeEventListener('hashchange', syncFromLocation);
};
