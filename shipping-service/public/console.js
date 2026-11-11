'use strict';

/**
 * Console de démonstration du service Shipping (même origine que l'API).
 * Toutes les données affichées sont insérées via textContent (aucun innerHTML).
 */
const NEXT = { PREPARING: 'SHIPPED', SHIPPED: 'IN_TRANSIT', IN_TRANSIT: 'DELIVERED' };
const $ = (id) => document.getElementById(id);

const els = {
  rows: $('rows'), empty: $('empty'), count: $('count'), toast: $('toast'),
  filter: $('status-filter'), search: $('search'), token: $('token'),
  form: $('create-form'), health: $('health'), healthText: $('health-text'),
};

let shipments = [];
let toastTimer;

$('port').textContent = location.port || '80';

function toast(message, type = 'success') {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.className = `toast ${type}`;
  els.toast.hidden = false;
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 5000);
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (els.token.value.trim()) headers.Authorization = `Bearer ${els.token.value.trim()}`;

  const response = await fetch(path, { ...options, headers });
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.message || `HTTP ${response.status}`);
  return body;
}

function el(tag, { text, className, attrs } = {}) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  if (attrs) Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
  return node;
}

function formatDate(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

function actionButton(label, className, onClick) {
  const button = el('button', { text: label, className, attrs: { type: 'button' } });
  button.addEventListener('click', async () => {
    button.disabled = true;
    try { await onClick(); } finally { button.disabled = false; }
  });
  return button;
}

async function changeStatus(shipment, status) {
  try {
    await api(`/api/shipments/${encodeURIComponent(shipment.id)}/status`, {
      method: 'PATCH', body: JSON.stringify({ status }),
    });
    toast(`${shipment.trackingNumber} → ${status.replace('_', ' ')}`);
    await load();
  } catch (error) {
    toast(error.message, 'error');
  }
}

function render() {
  const query = els.search.value.trim().toLowerCase();
  const visible = shipments.filter((s) => !query || [
    s.orderId, s.trackingNumber, s.address.name, s.address.city, s.address.address,
  ].some((value) => value.toLowerCase().includes(query)));

  els.rows.replaceChildren();
  els.count.textContent = String(visible.length);
  els.empty.hidden = visible.length > 0;

  for (const s of visible) {
    const tr = el('tr');

    const tracking = el('td', { className: 'mono' });
    tracking.append(el('span', { text: s.trackingNumber }));
    tr.append(tracking);

    tr.append(el('td', { text: s.orderId, className: 'mono' }));

    const recipient = el('td');
    recipient.append(el('span', { text: s.address.name }));
    recipient.append(el('small', { text: `${s.address.address}, ${s.address.city}` }));
    tr.append(recipient);

    const status = el('td');
    status.append(el('span', { text: s.status.replace('_', ' '), className: `badge s-${s.status}` }));
    tr.append(status);

    tr.append(el('td', { text: formatDate(s.updatedAt) }));

    const actions = el('td', { className: 'actions' });
    if (NEXT[s.status]) {
      actions.append(actionButton(`→ ${NEXT[s.status].replace('_', ' ')}`, '', () => changeStatus(s, NEXT[s.status])));
    }
    if (s.status === 'PREPARING') {
      actions.append(actionButton('Annuler', 'danger', () => changeStatus(s, 'CANCELLED')));
    }
    tr.append(actions);

    els.rows.append(tr);
  }
}

async function load() {
  try {
    const status = els.filter.value;
    shipments = await api(`/api/shipments${status ? `?status=${encodeURIComponent(status)}` : ''}`);
    render();
  } catch (error) {
    shipments = [];
    render();
    toast(error.message, 'error');
  }
}

async function checkHealth() {
  try {
    const health = await fetch('/health').then((r) => r.json());
    els.health.className = `health ${health.status === 'UP' ? 'up' : 'down'}`;
    const orders = health.dependencies.orders.integration;
    els.healthText.textContent = `${health.status} · Orders ${orders} · Auth ${health.dependencies.auth.mode}`;
  } catch {
    els.health.className = 'health down';
    els.healthText.textContent = 'Service injoignable';
  }
}

els.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(els.form).entries());
  const payload = { orderId: data.orderId.trim() };
  if (data.name || data.address || data.city) {
    payload.address = { name: data.name, address: data.address, city: data.city };
  }

  try {
    const created = await api('/api/shipments', { method: 'POST', body: JSON.stringify(payload) });
    toast(`Expédition créée : ${created.trackingNumber}`);
    els.form.reset();
    await load();
  } catch (error) {
    toast(error.message, 'error');
  }
});

els.filter.addEventListener('change', load);
els.search.addEventListener('input', render);
$('refresh').addEventListener('click', load);

checkHealth();
load();
setInterval(checkHealth, 15000);
