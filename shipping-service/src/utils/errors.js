'use strict';

/** Erreur applicative convertie en réponse JSON par le middleware d'erreurs. */
class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}

const badRequest = (message, details) => new HttpError(400, message, details);
const unauthorized = (message = 'Authentication required.') => new HttpError(401, message);
const forbidden = (message = 'Access denied.') => new HttpError(403, message);
const notFound = (message = 'Resource not found.') => new HttpError(404, message);
const conflict = (message) => new HttpError(409, message);
const badGateway = (message) => new HttpError(502, message);
const unavailable = (message) => new HttpError(503, message);

module.exports = {
  HttpError, badRequest, unauthorized, forbidden, notFound, conflict, badGateway, unavailable,
};
