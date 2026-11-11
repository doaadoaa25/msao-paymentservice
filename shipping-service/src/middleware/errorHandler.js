'use strict';

const { STATUS_CODES } = require('node:http');
const { HttpError } = require('../utils/errors');

function notFoundHandler(req, _res, next) {
  next(new HttpError(404, `Route not found: ${req.method} ${req.originalUrl}`));
}

/**
 * Format d'erreur uniforme. Le frontend (apiClient.js) lit `message`.
 *   { "status": 404, "error": "Not Found", "message": "...", "details": [...] }
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(logger = console) {
  return (err, req, res, next) => {
    if (res.headersSent) return next(err);

    let status = 500;
    let message = 'Internal server error.';
    let details;

    if (err instanceof HttpError) {
      ({ status, message, details } = err);
    } else if (err?.type === 'entity.parse.failed') {
      status = 400;
      message = 'Malformed JSON body.';
    } else if (err?.type === 'entity.too.large') {
      status = 413;
      message = 'Request body too large.';
    } else if (Number.isInteger(err?.status) && err.status >= 400 && err.status < 500) {
      status = err.status;
      message = err.message;
    } else {
      logger.error(`[error] ${req.method} ${req.originalUrl}`, err);
    }

    const body = { status, error: STATUS_CODES[status] ?? 'Error', message };
    if (details) body.details = details;
    return res.status(status).json(body);
  };
}

module.exports = { errorHandler, notFoundHandler };
