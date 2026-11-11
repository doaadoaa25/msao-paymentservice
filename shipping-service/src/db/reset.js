'use strict';

/** npm run db:reset — supprime la base locale et la recrée avec les données de démo. */
const fs = require('node:fs');
const { config } = require('../config');
const { openDatabase } = require('./index');

for (const suffix of ['', '-wal', '-shm']) {
  fs.rmSync(`${config.dbPath}${suffix}`, { force: true });
}
const db = openDatabase(config.dbPath, { seed: true });
const { count } = db.prepare('SELECT COUNT(*) AS count FROM shipments').get();
db.close();
console.log(`Base réinitialisée: ${config.dbPath} (${count} expédition(s) de démonstration)`);
