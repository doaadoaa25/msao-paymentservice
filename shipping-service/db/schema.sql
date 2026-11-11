PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS shipments (
  id              TEXT PRIMARY KEY,
  order_id        TEXT NOT NULL UNIQUE,
  user_id         TEXT,
  recipient_name  TEXT NOT NULL,
  address         TEXT NOT NULL,
  city            TEXT NOT NULL,
  tracking_number TEXT NOT NULL UNIQUE,
  status          TEXT NOT NULL CHECK (status IN ('PREPARING','SHIPPED','IN_TRANSIT','DELIVERED','CANCELLED')),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shipments_user_id ON shipments(user_id);
CREATE INDEX IF NOT EXISTS idx_shipments_status  ON shipments(status);
