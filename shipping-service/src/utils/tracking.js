'use strict';

const crypto = require('node:crypto');

/** Numéro de suivi au format MSOA-XXXXXXXX (8 hexa majuscules). */
function generateTrackingNumber() {
  return `MSOA-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

module.exports = { generateTrackingNumber };
