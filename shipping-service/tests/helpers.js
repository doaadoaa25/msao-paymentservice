'use strict';

const http = require('node:http');
const { buildConfig } = require('../src/config');
const { openDatabase } = require('../src/db');
const { createApp } = require('../src/app');

const silentLogger = { error() {}, log() {}, warn() {} };

/** Construit l'application avec une base SQLite en mémoire. */
function buildTestApp(env = {}) {
  const config = buildConfig(
    { NODE_ENV: 'test', ORDERS_INTEGRATION: 'false', AUTH_MODE: 'off', ...env },
    [],
  );
  const db = openDatabase(':memory:', { seed: false });
  const app = createApp({ config, db, logger: silentLogger });
  return { app, db, config };
}

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        url: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((done) => { server.closeAllConnections(); server.close(done); }),
      });
    });
  });
}

const ORDER_TRANSITIONS = {
  PENDING_PAYMENT: ['PAID', 'CANCELLED'],
  PAID: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
};

/**
 * Faux service Orders (strict : refuse un PATCH vers le statut déjà en place,
 * comme pourrait le faire l'implémentation d'un coéquipier).
 */
async function startFakeOrders(initialOrders = []) {
  const orders = new Map(initialOrders.map((o) => [o.id, { ...o }]));
  const calls = [];
  const state = { down: false };

  const srv = await listen((req, res) => {
    if (state.down) { req.socket.destroy(); return; }

    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      calls.push({ method: req.method, url: req.url, authorization: req.headers.authorization ?? null, body: raw ? JSON.parse(raw) : null });

      const match = /^\/api\/orders\/([^/]+)(\/status)?$/.exec(req.url);
      const order = match && orders.get(decodeURIComponent(match[1]));
      if (!match || !order) return send(404, { message: 'Order not found' });

      if (req.method === 'GET' && !match[2]) return send(200, order);
      if (req.method === 'PATCH' && match[2]) {
        const { status } = JSON.parse(raw);
        if (!ORDER_TRANSITIONS[order.status]?.includes(status)) {
          return send(409, { message: `Invalid transition: ${order.status} → ${status}` });
        }
        order.status = status;
        return send(200, order);
      }
      return send(405, { message: 'Method not allowed' });
    });
  });

  return { ...srv, orders, calls, state };
}

/** Faux service Auth : GET /api/auth/me. */
async function startFakeAuth(users) {
  return listen((req, res) => {
    const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
    const user = users[token];
    res.writeHead(user ? 200 : 401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(user ? { user } : { message: 'Unauthorized' }));
  });
}

const ADDRESS = { name: 'Demo Customer', address: '123 Main Street', city: 'Casablanca' };

module.exports = { buildTestApp, startFakeOrders, startFakeAuth, ADDRESS };
