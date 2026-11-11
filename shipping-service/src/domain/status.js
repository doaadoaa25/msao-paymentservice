'use strict';

/**
 * Machine à états d'une expédition.
 *
 *   PREPARING ──► SHIPPED ──► IN_TRANSIT ──► DELIVERED
 *       │
 *       └──────► CANCELLED
 *
 * DELIVERED et CANCELLED sont des états finaux.
 */
const SHIPMENT_STATUSES = Object.freeze({
  PREPARING: 'PREPARING',
  SHIPPED: 'SHIPPED',
  IN_TRANSIT: 'IN_TRANSIT',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED',
});

const TRANSITIONS = Object.freeze({
  PREPARING: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['IN_TRANSIT'],
  IN_TRANSIT: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
});

/**
 * Statut de la COMMANDE à synchroniser dans le service Orders
 * lorsque l'expédition atteint un statut donné, avec les statuts
 * de commande depuis lesquels cette synchronisation est autorisée.
 */
const ORDER_SYNC = Object.freeze({
  SHIPPED: { orderStatus: 'SHIPPED', allowedFrom: ['PAID'] },
  DELIVERED: { orderStatus: 'DELIVERED', allowedFrom: ['SHIPPED'] },
});

const isValidStatus = (status) => Object.hasOwn(TRANSITIONS, status);
const canTransition = (from, to) => TRANSITIONS[from]?.includes(to) ?? false;

module.exports = {
  SHIPMENT_STATUSES, TRANSITIONS, ORDER_SYNC, isValidStatus, canTransition,
};
