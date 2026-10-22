'use strict';

class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code || undefined;
  }
}

const badRequest = (msg, code) => new HttpError(400, msg, code);
const notFound = (msg = 'Not found') => new HttpError(404, msg, 'not_found');

// Express 4 does not catch rejected promises from async handlers.
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, code: err.code });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON body', code: 'invalid_json' });
  }
  console.error(err);
  return res.status(500).json({ error: 'Internal server error' });
}

module.exports = { HttpError, badRequest, notFound, ah, errorHandler };
