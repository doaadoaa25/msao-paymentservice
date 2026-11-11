'use strict';

/** Communication inter-services : Shipping ⇄ Orders (REST synchrone). */
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { buildTestApp, startFakeOrders, ADDRESS } = require('./helpers');

describe('Shipping ⇄ Orders', () => {
  let app; let orders;

  beforeEach(async () => {
    orders = await startFakeOrders([
      { id: 'order-paid', userId: 'user-1', status: 'PAID', customer: ADDRESS },
      { id: 'order-pending', userId: 'user-1', status: 'PENDING_PAYMENT', customer: ADDRESS },
      { id: 'order-cancelled', userId: 'user-1', status: 'CANCELLED', customer: ADDRESS },
      { id: 'order-nocustomer', userId: 'user-1', status: 'PAID', customer: null },
    ]);
    ({ app } = buildTestApp({ ORDERS_INTEGRATION: 'true', ORDERS_URL: orders.url, ORDERS_TIMEOUT_MS: '500' }));
  });
  afterEach(() => orders.close());

  const create = (orderId, address = ADDRESS) => request(app).post('/api/shipments').send({ orderId, address });
  const patch = (id, status) => request(app).patch(`/api/shipments/${id}/status`).send({ status });
  const orderStatus = (id) => orders.orders.get(id).status;
  const orderPatches = () => orders.calls.filter((c) => c.method === 'PATCH');

  describe('création', () => {
    it('accepte une commande PAID', async () => {
      const res = await create('order-paid');
      assert.equal(res.status, 201);
      assert.equal(res.body.status, 'PREPARING');
    });

    it('404 : commande inexistante côté Orders', async () => {
      const res = await create('order-ghost');
      assert.equal(res.status, 404);
      assert.equal(res.body.message, 'Order not found.');
    });

    it('409 : commande PENDING_PAYMENT (non payée)', async () => {
      const res = await create('order-pending');
      assert.equal(res.status, 409);
      assert.match(res.body.message, /PENDING_PAYMENT.*PAID required/);
      assert.equal((await request(app).get('/api/shipments')).body.length, 0);
    });

    it('409 : commande CANCELLED', async () => {
      assert.equal((await create('order-cancelled')).status, 409);
    });

    it('reprend l\'adresse de la commande si elle n\'est pas fournie', async () => {
      const res = await request(app).post('/api/shipments').send({ orderId: 'order-paid' });
      assert.equal(res.status, 201);
      assert.deepEqual(res.body.address, ADDRESS);
    });

    it('400 : pas d\'adresse fournie ET commande sans customer exploitable', async () => {
      const res = await request(app).post('/api/shipments').send({ orderId: 'order-nocustomer' });
      assert.equal(res.status, 400);
    });

    it('409 : doublon pour la même commande', async () => {
      await create('order-paid');
      assert.equal((await create('order-paid')).status, 409);
    });

    it('503 : Orders injoignable → aucune expédition créée', async () => {
      orders.state.down = true;
      const res = await create('order-paid');
      assert.equal(res.status, 503);
      assert.equal(res.body.message, 'Orders service is unavailable.');
      orders.state.down = false;
      assert.equal((await request(app).get('/api/shipments')).body.length, 0);
    });
  });

  describe('synchronisation du statut de la commande', () => {
    it('SHIPPED → commande SHIPPED ; DELIVERED → commande DELIVERED ; IN_TRANSIT sans effet', async () => {
      const { id } = (await create('order-paid')).body;

      assert.equal((await patch(id, 'SHIPPED')).status, 200);
      assert.equal(orderStatus('order-paid'), 'SHIPPED');

      const before = orderPatches().length;
      assert.equal((await patch(id, 'IN_TRANSIT')).status, 200);
      assert.equal(orderPatches().length, before, 'IN_TRANSIT ne doit pas toucher Orders');
      assert.equal(orderStatus('order-paid'), 'SHIPPED');

      assert.equal((await patch(id, 'DELIVERED')).status, 200);
      assert.equal(orderStatus('order-paid'), 'DELIVERED');
    });

    it('idempotent : commande déjà SHIPPED (synchronisée par ailleurs) → pas de PATCH inutile', async () => {
      const { id } = (await create('order-paid')).body;
      orders.orders.get('order-paid').status = 'SHIPPED';

      const res = await patch(id, 'SHIPPED');
      assert.equal(res.status, 200);
      assert.equal(orderPatches().length, 0);
    });

    it('409 : commande annulée entre-temps → l\'expédition reste PREPARING', async () => {
      const { id } = (await create('order-paid')).body;
      orders.orders.get('order-paid').status = 'CANCELLED';

      const res = await patch(id, 'SHIPPED');
      assert.equal(res.status, 409);
      assert.match(res.body.message, /Order is CANCELLED/);
      assert.equal((await request(app).get(`/api/shipments/${id}`)).body.status, 'PREPARING');
    });

    it('503 : Orders tombe pendant la mise à jour → statut inchangé, réessai possible', async () => {
      const { id } = (await create('order-paid')).body;
      orders.state.down = true;
      assert.equal((await patch(id, 'SHIPPED')).status, 503);
      assert.equal((await request(app).get(`/api/shipments/${id}`)).body.status, 'PREPARING');

      orders.state.down = false;
      assert.equal((await patch(id, 'SHIPPED')).status, 200);
    });

    it('annuler une expédition PREPARING ne modifie pas la commande (Orders pilote son annulation)', async () => {
      const { id } = (await create('order-paid')).body;
      assert.equal((await patch(id, 'CANCELLED')).status, 200);
      assert.equal(orderPatches().length, 0);
      assert.equal(orderStatus('order-paid'), 'PAID');
    });

    it('une commande expédiée expose un suivi cohérent pour Orders (règle « plus d\'annulation »)', async () => {
      const { id } = (await create('order-paid')).body;
      await patch(id, 'SHIPPED');
      // Orders consulte GET /api/shipments/order/{id} avant d'autoriser une annulation :
      const shipment = (await request(app).get('/api/shipments/order/order-paid')).body;
      assert.equal(shipment.status, 'SHIPPED');
      assert.equal((await patch(id, 'CANCELLED')).status, 409);
    });
  });

  it('ORDERS_SYNC_STATUS=false : l\'expédition avance sans modifier la commande', async () => {
    const built = buildTestApp({
      ORDERS_INTEGRATION: 'true', ORDERS_URL: orders.url, ORDERS_SYNC_STATUS: 'false',
    });
    const { id } = (await request(built.app).post('/api/shipments').send({ orderId: 'order-paid', address: ADDRESS })).body;
    const res = await request(built.app).patch(`/api/shipments/${id}/status`).send({ status: 'SHIPPED' });

    assert.equal(res.status, 200);
    assert.equal(orders.orders.get('order-paid').status, 'PAID');
    assert.equal(orderPatches().length, 0);
  });

  it('relaie le header Authorization reçu vers Orders', async () => {
    await request(app).post('/api/shipments').set('Authorization', 'Bearer abc.def').send({ orderId: 'order-paid', address: ADDRESS });
    assert.ok(orders.calls.length > 0);
    assert.ok(orders.calls.every((c) => c.authorization === 'Bearer abc.def'));
  });
});
