'use strict';

/** Accès aux données : le seul module qui connaît le SQL et les noms de colonnes. */
function toShipment(row) {
  if (!row) return null;
  return {
    id: row.id,
    orderId: row.order_id,
    address: {
      name: row.recipient_name,
      address: row.address,
      city: row.city,
    },
    trackingNumber: row.tracking_number,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // Interne : utilisé pour le contrôle d'accès, jamais exposé par l'API.
    userId: row.user_id ?? null,
  };
}

class ShipmentRepository {
  constructor(db) {
    this.db = db;
    this.stmt = {
      byId: db.prepare('SELECT * FROM shipments WHERE id = ?'),
      byOrder: db.prepare('SELECT * FROM shipments WHERE order_id = ?'),
      insert: db.prepare(`
        INSERT INTO shipments
          (id, order_id, user_id, recipient_name, address, city, tracking_number, status, created_at, updated_at)
        VALUES
          (@id, @orderId, @userId, @name, @address, @city, @trackingNumber, @status, @createdAt, @updatedAt)`),
      // Mise à jour conditionnelle : ne réussit que si le statut n'a pas changé entre-temps.
      updateStatus: db.prepare(
        'UPDATE shipments SET status = @to, updated_at = @updatedAt WHERE id = @id AND status = @from',
      ),
    };
  }

  findAll({ status, userId } = {}) {
    const where = [];
    const params = {};
    if (status) { where.push('status = @status'); params.status = status; }
    if (userId) { where.push('user_id = @userId'); params.userId = userId; }

    const sql = `SELECT * FROM shipments${where.length ? ` WHERE ${where.join(' AND ')}` : ''}
                 ORDER BY created_at DESC, id`;
    return this.db.prepare(sql).all(params).map(toShipment);
  }

  findById(id) {
    return toShipment(this.stmt.byId.get(id));
  }

  findByOrderId(orderId) {
    return toShipment(this.stmt.byOrder.get(orderId));
  }

  insert({ id, orderId, userId, address, trackingNumber, status, createdAt }) {
    this.stmt.insert.run({
      id,
      orderId,
      userId: userId ?? null,
      name: address.name,
      address: address.address,
      city: address.city,
      trackingNumber,
      status,
      createdAt,
      updatedAt: createdAt,
    });
    return this.findById(id);
  }

  /** @returns {boolean} true si la ligne a été modifiée. */
  updateStatus(id, from, to, updatedAt) {
    return this.stmt.updateStatus.run({ id, from, to, updatedAt }).changes === 1;
  }
}

module.exports = { ShipmentRepository };
