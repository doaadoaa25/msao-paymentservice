'use strict';

const { Router } = require('express');

function createShipmentRouter(controller, authMiddleware) {
  const router = Router();

  router.use(authMiddleware);

  router.get('/', controller.list);
  router.post('/', controller.create);
  router.get('/order/:orderId', controller.getByOrder); // avant "/:id"
  router.get('/:id', controller.getById);
  router.patch('/:id/status', controller.updateStatus);

  return router;
}

module.exports = { createShipmentRouter };
