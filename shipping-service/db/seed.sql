INSERT OR IGNORE INTO shipments
  (id, order_id, user_id, recipient_name, address, city, tracking_number, status, created_at, updated_at)
VALUES
  ('shipment-demo-001', 'order-demo-001', 'user-1', 'Demo Customer', '123 Main Street', 'Casablanca',
   'MSOA-DEMO001', 'DELIVERED', '2026-11-01T10:02:00Z', '2026-11-03T15:00:00Z');
