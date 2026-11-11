'use strict';

/** Contrat REST + validation + machine à états (mode autonome, sans Orders ni Auth). */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { buildTestApp, ADDRESS } = require('./helpers');

describe('Shipping — contrat REST (mode autonome)', () => {
  let app;
  beforeEach(() => { ({ app } = buildTestApp()); });

  const create = (orderId = 'order-123', body = {}) =>
    request(app).post('/api/shipments').send({ orderId, address: ADDRESS, ...body });

  describe('POST /api/shipments', () => {
    it('crée une expédition PREPARING avec numéro de suivi MSOA-XXXXXXXX', async () => {
      const res = await create();
      assert.equal(res.status, 201);
      assert.match(res.headers.location, /^\/api\/shipments\/.+/);
      assert.deepEqual(Object.keys(res.body).sort(),
        ['address', 'createdAt', 'id', 'orderId', 'status', 'trackingNumber', 'updatedAt']);
      assert.equal(res.body.orderId, 'order-123');
      assert.equal(res.body.status, 'PREPARING');
      assert.deepEqual(res.body.address, ADDRESS);
      assert.match(res.body.trackingNumber, /^MSOA-[0-9A-F]{8}$/);
      assert.equal(res.body.createdAt, res.body.updatedAt);
    });

    it('refuse une 2e expédition pour la même commande (409)', async () => {
      await create();
      const res = await create();
      assert.equal(res.status, 409);
      assert.equal(res.body.message, 'Shipment already exists for this order.');
    });

    it('un seul succès lors de requêtes concurrentes pour la même commande', async () => {
      const results = await Promise.all([create('race-1'), create('race-1'), create('race-1')]);
      assert.deepEqual(results.map((r) => r.status).sort(), [201, 409, 409]);
    });

    it('génère des numéros de suivi uniques', async () => {
      const a = await create('o-1');
      const b = await create('o-2');
      assert.notEqual(a.body.trackingNumber, b.body.trackingNumber);
    });

    for (const [label, body] of [
      ['orderId manquant', { address: ADDRESS }],
      ['orderId avec caractères interdits', { orderId: '../etc/passwd', address: ADDRESS }],
      ['adresse absente (mode autonome)', { orderId: 'o-9' }],
      ['adresse incomplète', { orderId: 'o-9', address: { name: 'A', address: '', city: 'X' } }],
      ['champ adresse non textuel', { orderId: 'o-9', address: { name: 1, address: 'a', city: 'b' } }],
      ['ville trop longue', { orderId: 'o-9', address: { ...ADDRESS, city: 'x'.repeat(101) } }],
    ]) {
      it(`400 : ${label}`, async () => {
        const res = await request(app).post('/api/shipments').send(body);
        assert.equal(res.status, 400);
        assert.equal(res.body.status, 400);
        assert.equal(res.body.error, 'Bad Request');
        assert.ok(res.body.message);
      });
    }

    it('400 : JSON mal formé', async () => {
      const res = await request(app).post('/api/shipments').set('Content-Type', 'application/json').send('{oops');
      assert.equal(res.status, 400);
      assert.equal(res.body.message, 'Malformed JSON body.');
    });

    it('400 : corps absent', async () => {
      const res = await request(app).post('/api/shipments');
      assert.equal(res.status, 400);
    });

    it('trim les espaces dans l\'adresse', async () => {
      const res = await create('o-trim', { address: { name: '  Ali  ', address: ' 1 rue X ', city: ' Fès ' } });
      assert.deepEqual(res.body.address, { name: 'Ali', address: '1 rue X', city: 'Fès' });
    });
  });

  describe('lecture', () => {
    it('GET /api/shipments renvoie un tableau (vide puis rempli)', async () => {
      assert.deepEqual((await request(app).get('/api/shipments')).body, []);
      await create('o-1'); await create('o-2');
      const res = await request(app).get('/api/shipments');
      assert.equal(res.status, 200);
      assert.equal(res.body.length, 2);
    });

    it('GET /api/shipments?status= filtre, et refuse un statut inconnu', async () => {
      const a = (await create('o-1')).body;
      await create('o-2');
      await request(app).patch(`/api/shipments/${a.id}/status`).send({ status: 'SHIPPED' });

      const shipped = await request(app).get('/api/shipments?status=SHIPPED');
      assert.deepEqual(shipped.body.map((s) => s.orderId), ['o-1']);
      assert.equal((await request(app).get('/api/shipments?status=NOPE')).status, 400);
    });

    it('GET /api/shipments/order/{orderId} : 200 puis 404 si absent', async () => {
      await create('o-1');
      const ok = await request(app).get('/api/shipments/order/o-1');
      assert.equal(ok.status, 200);
      assert.equal(ok.body.orderId, 'o-1');

      const missing = await request(app).get('/api/shipments/order/o-unknown');
      assert.equal(missing.status, 404);
      assert.ok(missing.body.message);
    });

    it('GET /api/shipments/{id} : 200 puis 404', async () => {
      const { id } = (await create('o-1')).body;
      assert.equal((await request(app).get(`/api/shipments/${id}`)).status, 200);
      assert.equal((await request(app).get('/api/shipments/does-not-exist')).status, 404);
    });
  });

  describe('PATCH /api/shipments/{id}/status — machine à états', () => {
    const patch = (id, status) => request(app).patch(`/api/shipments/${id}/status`).send({ status });

    it('parcours nominal PREPARING → SHIPPED → IN_TRANSIT → DELIVERED', async () => {
      const { id, createdAt } = (await create()).body;
      for (const status of ['SHIPPED', 'IN_TRANSIT', 'DELIVERED']) {
        const res = await patch(id, status);
        assert.equal(res.status, 200);
        assert.equal(res.body.status, status);
        assert.ok(res.body.updatedAt >= createdAt);
      }
    });

    it('PREPARING → CANCELLED autorisé, puis état final', async () => {
      const { id } = (await create()).body;
      assert.equal((await patch(id, 'CANCELLED')).status, 200);
      assert.equal((await patch(id, 'SHIPPED')).status, 409);
    });

    const forbidden = [
      ['PREPARING', 'IN_TRANSIT'], ['PREPARING', 'DELIVERED'], ['PREPARING', 'PREPARING'],
      ['SHIPPED', 'PREPARING'], ['SHIPPED', 'DELIVERED'], ['SHIPPED', 'CANCELLED'],
      ['IN_TRANSIT', 'SHIPPED'], ['IN_TRANSIT', 'CANCELLED'], ['DELIVERED', 'IN_TRANSIT'], ['DELIVERED', 'CANCELLED'],
    ];
    const path = { SHIPPED: ['SHIPPED'], IN_TRANSIT: ['SHIPPED', 'IN_TRANSIT'], DELIVERED: ['SHIPPED', 'IN_TRANSIT', 'DELIVERED'], PREPARING: [] };

    for (const [from, to] of forbidden) {
      it(`409 : transition interdite ${from} → ${to}`, async () => {
        const { id } = (await create(`o-${from}-${to}`)).body;
        for (const step of path[from]) await patch(id, step);

        const res = await patch(id, to);
        assert.equal(res.status, 409);
        assert.equal(res.body.message, `Invalid shipment transition: ${from} → ${to}`);
        assert.equal((await request(app).get(`/api/shipments/${id}`)).body.status, from);
      });
    }

    it('400 : statut invalide ou absent', async () => {
      const { id } = (await create()).body;
      assert.equal((await patch(id, 'LOST')).status, 400);
      assert.equal((await request(app).patch(`/api/shipments/${id}/status`).send({})).status, 400);
      assert.equal((await patch(id, 'constructor')).status, 400);
    });

    it('404 : expédition inconnue', async () => {
      assert.equal((await patch('nope', 'SHIPPED')).status, 404);
    });
  });

  describe('infrastructure', () => {
    it('GET /health', async () => {
      const res = await request(app).get('/health');
      assert.equal(res.status, 200);
      assert.equal(res.body.status, 'UP');
      assert.equal(res.body.database, 'UP');
    });

    it('route inconnue → 404 JSON', async () => {
      const res = await request(app).get('/api/nothing');
      assert.equal(res.status, 404);
      assert.equal(res.body.error, 'Not Found');
    });

    it('CORS : autorise le frontend Vite (préflight PATCH + Authorization)', async () => {
      const res = await request(app).options('/api/shipments/x/status')
        .set('Origin', 'http://localhost:5173')
        .set('Access-Control-Request-Method', 'PATCH')
        .set('Access-Control-Request-Headers', 'authorization,content-type');
      assert.equal(res.status, 204);
      assert.equal(res.headers['access-control-allow-origin'], 'http://localhost:5173');
      assert.match(res.headers['access-control-allow-methods'], /PATCH/);
      assert.match(res.headers['access-control-allow-headers'], /Authorization/i);
    });

    it('CORS : n\'autorise pas une origine inconnue', async () => {
      const res = await request(app).get('/api/shipments').set('Origin', 'http://evil.example');
      assert.equal(res.headers['access-control-allow-origin'], undefined);
    });

    it('sert la console de démonstration sur /', async () => {
      const res = await request(app).get('/');
      assert.equal(res.status, 200);
      assert.match(res.text, /Shipping Console/);
    });
  });
});
