'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { openDatabase } = require('../src/db');

describe('Base SQLite', () => {
  it('crée le fichier, le schéma et les données de démo à la première ouverture', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-'));
    const file = path.join(dir, 'nested', 'shipping.db');

    const db = openDatabase(file);
    const rows = db.prepare('SELECT * FROM shipments').all();
    db.close();

    assert.equal(rows.length, 1);
    assert.equal(rows[0].order_id, 'order-demo-001');
    assert.equal(rows[0].status, 'DELIVERED');
    assert.equal(rows[0].user_id, 'user-1');
  });

  it('ne réinjecte pas les données de démo sur une base existante', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ship-')), 'shipping.db');
    openDatabase(file).close();
    const db = openDatabase(file);
    db.prepare("DELETE FROM shipments WHERE id = 'shipment-demo-001'").run();
    db.close();

    const again = openDatabase(file);
    assert.equal(again.prepare('SELECT COUNT(*) AS n FROM shipments').get().n, 0);
    again.close();
  });

  it('migre la base fournie dans le TP (sans colonne user_id) sans perdre de données', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ship-')), 'shipping.db');
    const legacy = new Database(file);
    legacy.exec(`
      CREATE TABLE shipments (id TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE, recipient_name TEXT NOT NULL, address TEXT NOT NULL, city TEXT NOT NULL, tracking_number TEXT NOT NULL UNIQUE, status TEXT NOT NULL CHECK(status IN ('PREPARING','SHIPPED','IN_TRANSIT','DELIVERED','CANCELLED')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      INSERT INTO shipments VALUES ('s1','o1','Demo Customer','123 Main Street','Casablanca','MSOA-DEMO001','DELIVERED','2026-11-01T10:02:00Z','2026-11-03T15:00:00Z');`);
    legacy.close();

    const db = openDatabase(file);
    const columns = db.prepare('PRAGMA table_info(shipments)').all().map((c) => c.name);
    assert.ok(columns.includes('user_id'));
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM shipments').get().n, 1);
    db.close();
  });

  it('la contrainte CHECK rejette un statut inconnu', () => {
    const db = openDatabase(':memory:', { seed: false });
    assert.throws(() => db.prepare(`INSERT INTO shipments (id, order_id, recipient_name, address, city, tracking_number, status, created_at, updated_at)
      VALUES ('x','o','n','a','c','T','LOST','t','t')`).run(), /CHECK/);
  });
});
