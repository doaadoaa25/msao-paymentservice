'use strict';

const { badRequest } = require('./errors');
const { SHIPMENT_STATUSES, isValidStatus } = require('../domain/status');

const ID_PATTERN = /^[A-Za-z0-9._:-]{1,100}$/;
const LIMITS = { name: 100, address: 200, city: 100 };

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Valide et normalise un identifiant de commande / d'expédition. */
function validateId(value, field = 'id') {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw badRequest(`Invalid ${field}.`, [{ field, message: 'Expected 1-100 chars: letters, digits, . _ : -' }]);
  }
  return value;
}

/** @returns {{ value: object|null, errors: Array }} */
function parseAddress(address, prefix = 'address') {
  const errors = [];
  if (!isPlainObject(address)) {
    return { value: null, errors: [{ field: prefix, message: 'Address object is required.' }] };
  }
  const value = {};
  for (const key of ['name', 'address', 'city']) {
    const raw = address[key];
    if (typeof raw !== 'string' || raw.trim() === '') {
      errors.push({ field: `${prefix}.${key}`, message: 'Required non-empty string.' });
    } else if (raw.trim().length > LIMITS[key]) {
      errors.push({ field: `${prefix}.${key}`, message: `Must be at most ${LIMITS[key]} characters.` });
    } else {
      value[key] = raw.trim();
    }
  }
  return { value: errors.length ? null : value, errors };
}

/**
 * POST /api/shipments
 * `address` est facultatif ici : le service peut le reprendre de la commande
 * (customer) lorsque l'intégration Orders est active.
 */
function validateCreateBody(body) {
  if (!isPlainObject(body)) throw badRequest('Request body must be a JSON object.');

  const errors = [];
  if (typeof body.orderId !== 'string' || !ID_PATTERN.test(body.orderId)) {
    errors.push({ field: 'orderId', message: 'Required. Expected 1-100 chars: letters, digits, . _ : -' });
  }

  let address = null;
  if (body.address !== undefined && body.address !== null) {
    const parsed = parseAddress(body.address);
    errors.push(...parsed.errors);
    address = parsed.value;
  }

  if (errors.length) throw badRequest('Validation failed.', errors);
  return { orderId: body.orderId, address };
}

/** PATCH /api/shipments/{id}/status */
function validateStatusBody(body) {
  if (!isPlainObject(body) || typeof body.status !== 'string' || !isValidStatus(body.status)) {
    throw badRequest(
      `Invalid status. Allowed values: ${Object.keys(SHIPMENT_STATUSES).join(', ')}.`,
      [{ field: 'status', message: 'Required. Must be a valid shipment status.' }],
    );
  }
  return body.status;
}

/** GET /api/shipments?status=... */
function validateStatusFilter(value) {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || !isValidStatus(value)) {
    throw badRequest(
      `Invalid status filter. Allowed values: ${Object.keys(SHIPMENT_STATUSES).join(', ')}.`,
    );
  }
  return value;
}

module.exports = {
  validateId, parseAddress, validateCreateBody, validateStatusBody, validateStatusFilter,
};
