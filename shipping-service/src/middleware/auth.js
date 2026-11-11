'use strict';

const jwt = require('jsonwebtoken');
const { timedFetch, readJson } = require('../clients/http');
const { unauthorized, unavailable, badGateway } = require('../utils/errors');

const normalizeUser = (raw) => {
  if (!raw || typeof raw !== 'object') return null;
  const id = raw.id ?? raw.userId ?? raw.sub;
  if (id === undefined || id === null || id === '') return null;
  return {
    id: String(id),
    name: raw.name ?? null,
    email: raw.email ?? null,
    role: typeof raw.role === 'string' ? raw.role.toUpperCase() : 'CUSTOMER',
  };
};

function extractBearer(req) {
  const header = req.get('authorization');
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? '');
  if (!match) throw unauthorized('Missing or malformed Authorization header.');
  return { header, token: match[1] };
}

/**
 * Authentification des appels entrants.
 *
 *  off    → aucune vérification (req.user = null). Pratique tant que le frontend
 *           utilise le service Auth en mode mock (tokens factices).
 *  jwt    → vérification locale de la signature (secret partagé avec Auth).
 *  remote → délégation au service Auth : GET /api/auth/me.
 *
 * Dans tous les cas, `req.authorization` contient le header d'origine afin de le
 * relayer aux autres microservices.
 */
function createAuthMiddleware(authConfig, { fetchImpl = globalThis.fetch } = {}) {
  if (authConfig.mode === 'off') {
    return (req, _res, next) => {
      req.user = null;
      req.authorization = req.get('authorization') ?? null;
      next();
    };
  }

  const verify = authConfig.mode === 'jwt'
    ? async (token) => {
      try {
        const payload = jwt.verify(token, authConfig.jwtSecret, { algorithms: ['HS256', 'HS384', 'HS512'] });
        return normalizeUser(payload);
      } catch {
        throw unauthorized('Invalid or expired token.');
      }
    }
    : async (token) => {
      let response;
      try {
        response = await timedFetch(
          fetchImpl,
          `${authConfig.url}/api/auth/me`,
          { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } },
          authConfig.timeoutMs,
        );
      } catch (error) {
        if (error.network) throw unavailable('Auth service is unavailable.');
        throw error;
      }
      if (response.status === 401 || response.status === 403) throw unauthorized('Invalid or expired token.');
      if (!response.ok) throw badGateway(`Auth service error (HTTP ${response.status}).`);
      const body = await readJson(response);
      return normalizeUser(body?.user ?? body);
    };

  return async (req, _res, next) => {
    try {
      const { header, token } = extractBearer(req);
      const user = await verify(token);
      if (!user) throw unauthorized('Token does not identify a user.');
      req.user = user;
      req.authorization = header;
      next();
    } catch (error) {
      next(error);
    }
  };
}

module.exports = { createAuthMiddleware };
