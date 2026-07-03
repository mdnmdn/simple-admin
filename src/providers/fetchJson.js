// fetchJson — thin fetch() wrapper (architecture §6, doc 02 §3.4).
//
// - Sets Accept: application/json (and Content-Type for string bodies).
// - Auto-parses the JSON body into `.json`, exposes `.headers`, `.status`, `.body` (raw text).
// - Rejects with an HttpError when the status is outside the 2xx range.
//
// The `options.user` convenience mirrors react-admin's fetchUtils: pass
// { user: { authenticated: true, token: 'Bearer …' } } to set the Authorization header.

import { HttpError } from './httpError.js';

const createHeadersFromOptions = (options) => {
  const requestHeaders =
    options.headers instanceof Headers ? options.headers : new Headers(options.headers || {});

  if (!requestHeaders.has('Accept')) {
    requestHeaders.set('Accept', 'application/json');
  }
  // Only default Content-Type for string bodies (never for FormData — the browser sets the boundary).
  if (
    options.body &&
    typeof options.body === 'string' &&
    !requestHeaders.has('Content-Type')
  ) {
    requestHeaders.set('Content-Type', 'application/json');
  }
  if (options.user && options.user.authenticated && options.user.token) {
    requestHeaders.set('Authorization', options.user.token);
  }
  return requestHeaders;
};

export const fetchJson = async (url, options = {}) => {
  const requestHeaders = createHeadersFromOptions(options);
  const response = await fetch(url, { ...options, headers: requestHeaders });

  const text = await response.text();
  let json;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch (_) {
      json = undefined;
    }
  }

  const { status, statusText, headers } = response;
  if (status < 200 || status >= 300) {
    throw new HttpError((json && json.message) || statusText, status, json);
  }
  return { status, headers, body: text, json };
};

export default fetchJson;
