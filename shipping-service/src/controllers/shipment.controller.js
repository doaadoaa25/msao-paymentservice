'use strict';

const {
  validateId, validateCreateBody, validateStatusBody, validateStatusFilter,
} = require('../utils/validation');

/** Couche HTTP : validation des entrées + appel du service. Aucune logique métier. */
function createShipmentController(service) {
  const ctx = (req) => ({ user: req.user, authorization: req.authorization });

  return {
    list(req, res) {
      const status = validateStatusFilter(req.query.status);
      res.json(service.list(ctx(req), { status }));
    },

    getById(req, res) {
      res.json(service.getById(ctx(req), validateId(req.params.id)));
    },

    getByOrder(req, res) {
      res.json(service.getByOrder(ctx(req), validateId(req.params.orderId, 'orderId')));
    },

    async create(req, res) {
      const input = validateCreateBody(req.body);
      const shipment = await service.create(ctx(req), input);
      res.status(201).location(`/api/shipments/${shipment.id}`).json(shipment);
    },

    async updateStatus(req, res) {
      const id = validateId(req.params.id);
      const status = validateStatusBody(req.body);
      res.json(await service.updateStatus(ctx(req), id, status));
    },
  };
}

module.exports = { createShipmentController };
