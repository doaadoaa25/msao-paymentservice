'use strict';

/** Authentification (jwt / remote) et contrôle d'accès par propriétaire. */
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { buildTestApp, startFakeOrders, startFakeAuth, ADDRESS } = require('./helpers');

const SECRET = 'test-secret';
const token = (claims) => jwt.sign(claims, SECRET, { expiresIn: '5m' });
const bearer = (claims) => `Bearer ${token(claims)}`;

const ALICE = { id: 'user-1', role: 'CUSTOMER' };
const BOB = { id: 'user-2', role: 'CUSTOMER' };
const ADMIN = { id: 'admin-1', role: 'ADMIN' };

describe('Authentification JWT + autorisations', () => {
  let app; let orders;

  beforeEach(async () => {
    orders = await startFakeOrders([
      { id: 'order-alice', userId: 'user-1', status: 'PAID', customer: ADDRESS },
      { id: 'order-bob', userId: 'user-2', status: 'PAID', customer: ADDRESS },
    ]);
    ({ app } = buildTestApp({
      AUTH_MODE: 'jwt', JWT_SECRET: SECRET, ORDERS_INTEGRATION: 'true', ORDERS_URL: orders.url,
    }));
  });
  afterEach(() => orders.close());

  const as = (claims) => ({
    create: (orderId) => request(app).post('/api/shipments').set('Authorization', bearer(claims)).send({ orderId }),
    get: (path) => request(app).get(path).set('Authorization', bearer(claims)),
    patch: (id, status) => request(app).patch(`/api/shipments/${id}/status`).set('Authorization', bearer(claims)).send({ status }),
  });

  describe('authentification', () => {
    it('401 sans token', async () => {
      const res = await request(app).get('/api/shipments');
      assert.equal(res.status, 401);
      assert.ok(res.body.message);
    });

    it('401 token invalide / mauvaise signature / expiré / schéma incorrect', async () => {
      const bad = [
        'Bearer not-a-jwt',
        `Bearer ${jwt.sign(ALICE, 'wrong-secret')}`,
        `Bearer ${jwt.sign(ALICE, SECRET, { expiresIn: -10 })}`,
        `Basic ${token(ALICE)}`,
      ];
      for (const header of bad) {
        const res = await request(app).get('/api/shipments').set('Authorization', header);
        assert.equal(res.status, 401, header);
      }
    });

    it('401 : token valide mais sans identifiant utilisateur', async () => {
      const res = await request(app).get('/api/shipments').set('Authorization', bearer({ role: 'ADMIN' }));
      assert.equal(res.status, 401);
    });

    it('accepte les claims id, userId ou sub', async () => {
      for (const claims of [{ id: 'user-1' }, { userId: 'user-1' }, { sub: 'user-1' }]) {
        assert.equal((await as(claims).get('/api/shipments')).status, 200);
      }
    });

    it('/health reste public', async () => {
      assert.equal((await request(app).get('/health')).status, 200);
    });

    it('le préflight CORS n\'exige pas de token', async () => {
      const res = await request(app).options('/api/shipments')
        .set('Origin', 'http://localhost:5173').set('Access-Control-Request-Method', 'POST');
      assert.equal(res.status, 204);
    });
  });

  describe('autorisation (propriétaire / admin)', () => {
    it('un client crée l\'expédition de SA commande et la voit ; pas celle d\'un autre', async () => {
      assert.equal((await as(ALICE).create('order-alice')).status, 201);
      assert.equal((await as(ALICE).create('order-bob')).status, 403);
      assert.equal((await as(ALICE).get('/api/shipments/order/order-alice')).status, 200);
    });

    it('un client ne lit/modifie pas l\'expédition d\'un autre (403)', async () => {
      const { id } = (await as(ALICE).create('order-alice')).body;

      assert.equal((await as(BOB).get('/api/shipments/order/order-alice')).status, 403);
      assert.equal((await as(BOB).get(`/api/shipments/${id}`)).status, 403);
      assert.equal((await as(BOB).patch(id, 'SHIPPED')).status, 403);
      assert.equal(orders.orders.get('order-alice').status, 'PAID', 'Orders ne doit pas avoir été modifié');
    });

    it('GET /api/shipments : un client ne voit que les siennes, l\'admin voit tout', async () => {
      await as(ALICE).create('order-alice');
      await as(BOB).create('order-bob');

      const alice = (await as(ALICE).get('/api/shipments')).body;
      assert.deepEqual(alice.map((s) => s.orderId), ['order-alice']);

      const admin = (await as(ADMIN).get('/api/shipments')).body;
      assert.deepEqual(admin.map((s) => s.orderId).sort(), ['order-alice', 'order-bob']);
    });

    it('l\'admin peut faire avancer n\'importe quelle expédition', async () => {
      const { id } = (await as(ALICE).create('order-alice')).body;
      assert.equal((await as(ADMIN).patch(id, 'SHIPPED')).status, 200);
    });

    it('le propriétaire fait avancer son expédition (relais du token vers Orders)', async () => {
      const { id } = (await as(ALICE).create('order-alice')).body;
      assert.equal((await as(ALICE).patch(id, 'SHIPPED')).status, 200);
      assert.equal(orders.orders.get('order-alice').status, 'SHIPPED');
      assert.ok(orders.calls.every((c) => /^Bearer /.test(c.authorization)));
    });

    it('le champ interne userId n\'est jamais exposé', async () => {
      const res = await as(ALICE).create('order-alice');
      assert.equal('userId' in res.body, false);
    });
  });
});

describe('Authentification remote (service Auth)', () => {
  let auth; let app;

  beforeEach(async () => {
    auth = await startFakeAuth({
      'good-token': { id: 'user-1', name: 'Demo', email: 'demo@msoa.shop', role: 'CUSTOMER' },
    });
    ({ app } = buildTestApp({ AUTH_MODE: 'remote', AUTH_URL: auth.url, AUTH_TIMEOUT_MS: '500' }));
  });
  afterEach(() => auth.close());

  it('401 sans token et 401 token refusé par Auth', async () => {
    assert.equal((await request(app).get('/api/shipments')).status, 401);
    assert.equal((await request(app).get('/api/shipments').set('Authorization', 'Bearer bad')).status, 401);
  });

  it('200 avec un token validé par GET /api/auth/me', async () => {
    const res = await request(app).get('/api/shipments').set('Authorization', 'Bearer good-token');
    assert.equal(res.status, 200);
  });

  it('503 si le service Auth est injoignable', async () => {
    await auth.close();
    const res = await request(app).get('/api/shipments').set('Authorization', 'Bearer good-token');
    assert.equal(res.status, 503);
  });
});

describe('Configuration', () => {
  const { buildConfig } = require('../src/config');

  it('refuse AUTH_MODE=jwt sans JWT_SECRET', () => {
    assert.throws(() => buildConfig({ AUTH_MODE: 'jwt' }, []), /JWT_SECRET/);
  });
  it('refuse un AUTH_MODE inconnu', () => {
    assert.throws(() => buildConfig({ AUTH_MODE: 'magic' }, []), /AUTH_MODE/);
  });
  it('--standalone désactive Orders et Auth', () => {
    const cfg = buildConfig({ AUTH_MODE: 'jwt', JWT_SECRET: 'x', ORDERS_INTEGRATION: 'true' }, ['--standalone']);
    assert.equal(cfg.orders.enabled, false);
    assert.equal(cfg.auth.mode, 'off');
  });
  it('valeurs par défaut : port 8086, Orders actif, CORS Vite', () => {
    const cfg = buildConfig({}, []);
    assert.equal(cfg.port, 8086);
    assert.equal(cfg.orders.enabled, true);
    assert.ok(cfg.corsOrigins.includes('http://localhost:5173'));
  });
});
