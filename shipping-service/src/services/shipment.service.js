'use strict';

const crypto = require('node:crypto');
const {
  conflict, forbidden, notFound, badRequest,
} = require('../utils/errors');
const { generateTrackingNumber } = require('../utils/tracking');
const { parseAddress } = require('../utils/validation');
const { isAdmin } = require('../utils/roles');
const { SHIPMENT_STATUSES, ORDER_SYNC, canTransition } = require('../domain/status');

const MAX_TRACKING_ATTEMPTS = 5;

/** Retire le champ interne `userId` avant d'envoyer la ressource au client. */
const present = (shipment) => {
  if (!shipment) return shipment;
  const { userId: _userId, ...publicShipment } = shipment;
  return publicShipment;
};

const isUniqueViolation = (error, column) =>
  error?.code === 'SQLITE_CONSTRAINT_UNIQUE' && String(error.message).includes(column);

/**
 * Logique métier du service Shipping.
 *
 * `ctx` = { user, authorization }
 *   user          : utilisateur authentifié (null si AUTH_MODE=off)
 *   authorization : header Authorization d'origine, relayé à Orders
 */
class ShipmentService {
  constructor({
    repository, orders, syncOrderStatus = true, now = () => new Date().toISOString(),
  }) {
    this.repo = repository;
    this.orders = orders;
    this.syncOrderStatus = syncOrderStatus;
    this.now = now;
  }

  // ----------------------------------------------------------- lecture

  list(ctx, { status } = {}) {
    // Un client ne voit que ses propres expéditions ; un admin voit tout.
    const userId = ctx.user && !isAdmin(ctx.user) ? ctx.user.id : undefined;
    return this.repo.findAll({ status, userId }).map(present);
  }

  getById(ctx, id) {
    const shipment = this.repo.findById(id);
    if (!shipment) throw notFound('Shipment not found.');
    this.#assertAccess(ctx, shipment);
    return present(shipment);
  }

  getByOrder(ctx, orderId) {
    const shipment = this.repo.findByOrderId(orderId);
    if (!shipment) throw notFound('No shipment found for this order.');
    this.#assertAccess(ctx, shipment);
    return present(shipment);
  }

  // ---------------------------------------------------------- création

  async create(ctx, { orderId, address }) {
    let ownerId = ctx.user?.id ?? null;
    let deliveryAddress = address;

    if (this.orders.enabled) {
      const order = await this.orders.getOrder(orderId, ctx.authorization);

      if (ctx.user && !isAdmin(ctx.user) && order.userId !== ctx.user.id) {
        throw forbidden('You can only create a shipment for your own orders.');
      }
      if (order.status !== 'PAID') {
        throw conflict(`Cannot create a shipment for an order in status ${order.status} (PAID required).`);
      }

      ownerId = order.userId ?? ownerId;
      if (!deliveryAddress) {
        const fromOrder = parseAddress(order.customer);
        if (!fromOrder.value) throw badRequest('Delivery address is required.', fromOrder.errors);
        deliveryAddress = fromOrder.value;
      }
    } else if (!deliveryAddress) {
      throw badRequest('Validation failed.', [{ field: 'address', message: 'Address object is required.' }]);
    }

    if (this.repo.findByOrderId(orderId)) {
      throw conflict('Shipment already exists for this order.');
    }

    const createdAt = this.now();
    for (let attempt = 1; attempt <= MAX_TRACKING_ATTEMPTS; attempt += 1) {
      try {
        return present(this.repo.insert({
          id: crypto.randomUUID(),
          orderId,
          userId: ownerId,
          address: deliveryAddress,
          trackingNumber: generateTrackingNumber(),
          status: SHIPMENT_STATUSES.PREPARING,
          createdAt,
        }));
      } catch (error) {
        // Deux requêtes concurrentes pour la même commande : l'index UNIQUE tranche.
        if (isUniqueViolation(error, 'order_id')) throw conflict('Shipment already exists for this order.');
        // Collision (très improbable) sur le numéro de suivi : on en tire un autre.
        if (isUniqueViolation(error, 'tracking_number') && attempt < MAX_TRACKING_ATTEMPTS) continue;
        throw error;
      }
    }
    /* c8 ignore next */
    throw new Error('Unable to generate a unique tracking number.');
  }

  // ------------------------------------------------- changement d'état

  async updateStatus(ctx, id, nextStatus) {
    const shipment = this.repo.findById(id);
    if (!shipment) throw notFound('Shipment not found.');
    this.#assertAccess(ctx, shipment);

    if (!canTransition(shipment.status, nextStatus)) {
      throw conflict(`Invalid shipment transition: ${shipment.status} → ${nextStatus}`);
    }

    // Cohérence avec la commande : on met Orders à jour AVANT de valider localement.
    // Si Orders refuse ou est indisponible, l'expédition garde son statut actuel.
    const sync = ORDER_SYNC[nextStatus];
    if (sync && this.orders.enabled && this.syncOrderStatus) {
      await this.orders.syncStatus(shipment.orderId, sync, ctx.authorization);
    }

    const updated = this.repo.updateStatus(id, shipment.status, nextStatus, this.now());
    if (!updated) {
      throw conflict('Shipment was modified by another request. Please retry.');
    }
    return present(this.repo.findById(id));
  }

  // --------------------------------------------------------- sécurité

  #assertAccess(ctx, shipment) {
    if (!ctx.user || isAdmin(ctx.user)) return;
    if (shipment.userId !== ctx.user.id) {
      throw forbidden('You do not have access to this shipment.');
    }
  }
}

module.exports = { ShipmentService };
