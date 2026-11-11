'use strict';

const { timedFetch, readJson } = require('./http');
const { notFound, conflict, badGateway, unavailable } = require('../utils/errors');

/**
 * Client REST du microservice Orders (communication synchrone).
 *
 *   GET   {ORDERS_URL}/api/orders/{id}
 *   PATCH {ORDERS_URL}/api/orders/{id}/status   { "status": "SHIPPED" | "DELIVERED" }
 *
 * Le header Authorization reçu par Shipping est relayé tel quel à Orders.
 */
class OrdersClient {
  constructor({ enabled, baseUrl, timeoutMs, fetchImpl = globalThis.fetch }) {
    this.enabled = enabled;
    this.baseUrl = baseUrl;
    this.timeoutMs = timeoutMs;
    this.fetch = fetchImpl;
  }

  async #call(path, { method = 'GET', body, authorization } = {}) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (authorization) headers.Authorization = authorization;

    try {
      return await timedFetch(
        this.fetch,
        `${this.baseUrl}${path}`,
        { method, headers, body: body === undefined ? undefined : JSON.stringify(body) },
        this.timeoutMs,
      );
    } catch (error) {
      if (error.network) throw unavailable('Orders service is unavailable.');
      throw error;
    }
  }

  /** @returns {{id, userId, status, customer}} */
  async getOrder(orderId, authorization) {
    const response = await this.#call(`/api/orders/${encodeURIComponent(orderId)}`, { authorization });

    if (response.status === 404) throw notFound('Order not found.');
    if (!response.ok) throw badGateway(`Orders service error (HTTP ${response.status}).`);

    const order = await readJson(response);
    if (!order || typeof order !== 'object' || !order.id) {
      throw badGateway('Orders service returned an invalid order payload.');
    }
    return { id: order.id, userId: order.userId ?? null, status: order.status, customer: order.customer ?? null };
  }

  async updateOrderStatus(orderId, status, authorization) {
    const response = await this.#call(`/api/orders/${encodeURIComponent(orderId)}/status`, {
      method: 'PATCH',
      body: { status },
      authorization,
    });

    if (response.ok) return readJson(response);
    const payload = await readJson(response);

    if (response.status === 404) throw notFound('Order not found.');
    if (response.status === 400 || response.status === 409 || response.status === 422) {
      throw conflict(`Orders service refused the status change: ${payload?.message ?? `HTTP ${response.status}`}`);
    }
    throw badGateway(`Orders service error (HTTP ${response.status}).`);
  }

  /**
   * Aligne le statut de la commande sur celui de l'expédition.
   * - déjà au statut cible  → rien à faire (idempotent)
   * - statut incompatible   → 409 (ex. commande annulée)
   */
  async syncStatus(orderId, { orderStatus, allowedFrom }, authorization) {
    const order = await this.getOrder(orderId, authorization);
    if (order.status === orderStatus) return order;

    if (!allowedFrom.includes(order.status)) {
      throw conflict(`Order is ${order.status}; it cannot be marked ${orderStatus}.`);
    }
    await this.updateOrderStatus(orderId, orderStatus, authorization);
    return { ...order, status: orderStatus };
  }
}

module.exports = { OrdersClient };
