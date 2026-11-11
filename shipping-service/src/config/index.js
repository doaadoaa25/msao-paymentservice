'use strict';

const path = require('node:path');
require('dotenv').config({ quiet: true });

const bool = (value, fallback) => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};
const int = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};
const list = (value, fallback) =>
  (value ? value.split(',') : fallback).map((s) => s.trim()).filter(Boolean);

/**
 * Builds the configuration from an environment-like object.
 * Exposed as a function so that tests can build isolated configurations.
 */
function buildConfig(env = process.env, argv = process.argv) {
  const standalone = argv.includes('--standalone');

  const authMode = standalone ? 'off' : (env.AUTH_MODE || 'off').toLowerCase();
  if (!['off', 'jwt', 'remote'].includes(authMode)) {
    throw new Error(`AUTH_MODE invalide: "${authMode}" (off | jwt | remote)`);
  }
  if (authMode === 'jwt' && !env.JWT_SECRET) {
    throw new Error('AUTH_MODE=jwt nécessite JWT_SECRET');
  }

  return {
    env: env.NODE_ENV || 'development',
    port: int(env.PORT, 8086),
    dbPath: path.resolve(env.DB_PATH || './data/shipping.db'),
    corsOrigins: list(env.CORS_ORIGINS, ['http://localhost:5173', 'http://127.0.0.1:5173']),
    standalone,
    orders: {
      enabled: standalone ? false : bool(env.ORDERS_INTEGRATION, true),
      url: (env.ORDERS_URL || 'http://localhost:8084').replace(/\/+$/, ''),
      timeoutMs: int(env.ORDERS_TIMEOUT_MS, 4000),
      syncStatus: bool(env.ORDERS_SYNC_STATUS, true),
    },
    auth: {
      mode: authMode,
      jwtSecret: env.JWT_SECRET || '',
      url: (env.AUTH_URL || 'http://localhost:8081').replace(/\/+$/, ''),
      timeoutMs: int(env.AUTH_TIMEOUT_MS, 4000),
    },
  };
}

module.exports = { buildConfig, config: buildConfig() };
