'use strict';

const path = require('node:path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const { ShipmentRepository } = require('./repositories/shipment.repository');
const { ShipmentService } = require('./services/shipment.service');
const { createShipmentController } = require('./controllers/shipment.controller');
const { createShipmentRouter } = require('./routes/shipment.routes');
const { OrdersClient } = require('./clients/orders.client');
const { createAuthMiddleware } = require('./middleware/auth');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

/**
 * Fabrique l'application Express. Les dépendances (db, clients, auth) sont
 * injectables, ce qui permet de tester le service de bout en bout.
 */
function createApp({
  config, db, ordersClient, authMiddleware, logger = console,
}) {
  const app = express();
  const startedAt = Date.now();

  const orders = ordersClient ?? new OrdersClient({
    enabled: config.orders.enabled,
    baseUrl: config.orders.url,
    timeoutMs: config.orders.timeoutMs,
  });
  const service = new ShipmentService({
    repository: new ShipmentRepository(db),
    orders,
    syncOrderStatus: config.orders.syncStatus,
  });
  const controller = createShipmentController(service);
  const auth = authMiddleware ?? createAuthMiddleware(config.auth);

  app.disable('x-powered-by');
  app.use(helmet({
    // API consommée depuis un autre origin (Vite :5173) : CORP "cross-origin".
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    // HSTS / upgrade-insecure-requests n'ont de sens qu'en HTTPS (production).
    strictTransportSecurity: config.env === 'production',
    contentSecurityPolicy: {
      useDefaults: true,
      directives: { upgradeInsecureRequests: config.env === 'production' ? [] : null },
    },
  }));
  app.use(cors({
    origin: config.corsOrigins,
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
  }));
  if (config.env !== 'test') app.use(morgan(config.env === 'production' ? 'combined' : 'dev'));
  app.use(express.json({ limit: '10kb' }));

  // Console de démonstration (HTML/CSS/JS statiques, sans dépendance).
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.get('/health', (_req, res) => {
    let database = 'UP';
    try { db.prepare('SELECT 1').get(); } catch { database = 'DOWN'; }
    res.status(database === 'UP' ? 200 : 503).json({
      status: database === 'UP' ? 'UP' : 'DOWN',
      service: 'shipping',
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      database,
      dependencies: {
        orders: { integration: orders.enabled ? 'enabled' : 'disabled' },
        auth: { mode: config.auth.mode },
      },
    });
  });

  app.use('/api/shipments', createShipmentRouter(controller, auth));

  app.use(notFoundHandler);
  app.use(errorHandler(logger));

  return app;
}

module.exports = { createApp };
