// HttpError — the rejection type every data provider method should throw on failure
// (architecture §6, doc 02 §4.1). `status` feeds authProvider.checkError; `body` carries
// the structured payload (e.g. field-level validation errors under body.errors).

export class HttpError extends Error {
  constructor(message, status, body = null) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, HttpError);
    }
    // Preserve message on the stack for environments that read it from there.
    this.stack = `${this.name}: ${message}`;
  }
}

export default HttpError;
