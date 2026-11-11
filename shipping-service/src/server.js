'use strict';

const { config } = require('./config');
const { openDatabase } = require('./db');
const { createApp } = require('./app');

const db = openDatabase(config.dbPath);
const app = createApp({ config, db });

const server = app.listen(config.port, () => {
  const line = '─'.repeat(54);
  console.log(`\n${line}`);
  console.log(` MSOA Shipping service — http://localhost:${config.port}`);
  console.log(line);
  console.log(` Base de données : ${config.dbPath}`);
  console.log(` Orders          : ${config.orders.enabled ? config.orders.url : 'désactivé (mode autonome)'}`);
  console.log(` Authentification: ${config.auth.mode}`);
  console.log(` CORS            : ${config.corsOrigins.join(', ')}`);
  console.log(` Console de test : http://localhost:${config.port}/`);
  console.log(`${line}\n`);
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Le port ${config.port} est déjà utilisé. Changez PORT dans .env.`);
  } else {
    console.error(error);
  }
  process.exit(1);
});

function shutdown(signal) {
  console.log(`\n${signal} reçu — arrêt du service...`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
