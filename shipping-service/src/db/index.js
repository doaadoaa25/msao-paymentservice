'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const SCHEMA_PATH = path.join(__dirname, '..', '..', 'db', 'schema.sql');
const SEED_PATH = path.join(__dirname, '..', '..', 'db', 'seed.sql');

/**
 * Ouvre (et initialise si nécessaire) la base SQLite du service Shipping.
 *
 * - crée le fichier + le schéma s'il n'existe pas ;
 * - injecte les données de démonstration uniquement à la première création ;
 * - migre une base existante (ex. fichier fourni dans le TP) en ajoutant la
 *   colonne `user_id` utilisée pour le contrôle d'accès.
 */
function openDatabase(dbPath, { seed = true } = {}) {
  const inMemory = dbPath === ':memory:';
  const existed = !inMemory && fs.existsSync(dbPath);

  if (!inMemory) fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  migrateLegacyTable(db);
  db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));

  if (seed && !existed) db.exec(fs.readFileSync(SEED_PATH, 'utf8'));

  return db;
}

function migrateLegacyTable(db) {
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'shipments'")
    .get();
  if (!table) return;

  const columns = db.prepare('PRAGMA table_info(shipments)').all().map((c) => c.name);
  if (!columns.includes('user_id')) {
    db.exec('ALTER TABLE shipments ADD COLUMN user_id TEXT');
  }
}

module.exports = { openDatabase };
