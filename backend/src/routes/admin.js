import { Router } from 'express';
import { login, requireAdmin } from '../auth.js';
import { DEFAULT_ADMIN_PASSWORD, usesDefaultPassword } from '../security.js';
import { resetCustomerPassword } from '../customerAuth.js';
import { buildReport } from '../reports.js';
import { CATEGORIES, db, getSettings, updateSettings } from '../db.js';
import { availabilityGrid, freeTechnicians } from '../availability.js';
import { getBooking, listBookings, STATUSES, updateBooking } from '../bookings.js';
import { KIND_LABELS, notify, sendMessage, TEMPLATES, waLink, whatsappProvider } from '../whatsapp.js';
import {
  addDays, hashPassword, HttpError, isDateStr, isTimeStr, isValidPhone, normalizePhone, ok, str, todayStr, verifyPassword,
} from '../util.js';

const r = Router();

// ---------- Auth ----------
r.post('/login', (req, res) => {
  ok(res, login(req.body?.username, req.body?.password, req.ip));
});

r.use(requireAdmin);

r.get('/me', (req, res) =>
  ok(res, { username: req.admin.username, whatsappProvider, defaultPassword: usesDefaultPassword(req.admin.sub) }),
);

r.post('/change-password', (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const admin = db.prepare('SELECT * FROM admins WHERE id = ?').get(req.admin.sub);
  if (!admin || !verifyPassword(String(currentPassword || ''), admin.password_hash)) throw new HttpError(400, 'Current password is wrong');
  const next = String(newPassword || '');
  if (next.length < 10 || !/[A-Za-z]/.test(next) || !/[0-9]/.test(next)) {
    throw new HttpError(400, 'New password must be at least 10 characters and include letters and numbers');
  }
  if (next === DEFAULT_ADMIN_PASSWORD || next === String(currentPassword)) {
    throw new HttpError(400, 'Please choose a new password, not the default or your current one');
  }
  db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), admin.id);
  ok(res, { ok: true });
});

// ---------- Dashboard ----------
r.get('/dashboard', (_req, res) => {
  const today = todayStr();
  const count = (sql, ...p) => db.prepare(sql).get(...p).c;
  ok(res, {
    today,
    todayTotal: count("SELECT COUNT(*) c FROM bookings WHERE date = ? AND status != 'cancelled'", today),
    todayCompleted: count("SELECT COUNT(*) c FROM bookings WHERE date = ? AND status = 'completed'", today),
    pending: count("SELECT COUNT(*) c FROM bookings WHERE status = 'pending' AND date >= ?", today),
    upcoming: count("SELECT COUNT(*) c FROM bookings WHERE status IN ('pending','confirmed') AND date > ?", today),
    failedMessages: count("SELECT COUNT(*) c FROM whatsapp_messages WHERE status = 'failed' AND created_at >= datetime('now','-7 day')"),
    manualMessages: count("SELECT COUNT(*) c FROM whatsapp_messages WHERE status = 'manual' AND created_at >= datetime('now','-1 day')"),
    activeTechnicians: count('SELECT COUNT(*) c FROM technicians WHERE active = 1'),
    todayBookings: listBookings({ date: today }).reverse(),
    next7: db.prepare(`SELECT date, COUNT(*) c FROM bookings WHERE status != 'cancelled' AND date BETWEEN ? AND ?
                       GROUP BY date ORDER BY date`).all(today, addDays(today, 6)),
    whatsappProvider,
  });
});

// ---------- Bookings ----------
r.get('/bookings', (req, res) => ok(res, listBookings(req.query)));

r.get('/bookings/:id', (req, res) => {
  const b = getBooking(Number(req.params.id));
  if (!b) throw new HttpError(404, 'Booking not found');
  const messages = db.prepare('SELECT * FROM whatsapp_messages WHERE booking_id = ? ORDER BY id DESC').all(b.id).map(msgDto);
  ok(res, { booking: b, messages });
});

r.patch('/bookings/:id', async (req, res) => {
  const body = req.body || {};
  if (body.status && !STATUSES.includes(body.status)) throw new HttpError(400, 'Invalid status');
  ok(res, await updateBooking(Number(req.params.id), body, { notifyCustomer: body.notify !== false }));
});

r.get('/bookings/:id/technicians', (req, res) => {
  const b = getBooking(Number(req.params.id));
  if (!b) throw new HttpError(404, 'Booking not found');
  const date = isDateStr(req.query.date) ? req.query.date : b.date;
  const slotId = Number(req.query.slotId || b.slotId);
  const free = freeTechnicians(date, slotId, b.category, { excludeBookingId: b.id });
  ok(res, free.map((t) => ({ id: t.id, name: t.name, phone: t.phone, skills: t.skills })));
});

r.post('/bookings/:id/whatsapp', async (req, res) => {
  const { kind, text } = req.body || {};
  if (kind !== 'custom' && !TEMPLATES[kind]) throw new HttpError(400, 'Unknown message type');
  if (kind === 'custom' && !str(text)) throw new HttpError(400, 'Message is empty');
  const result = await notify(kind, Number(req.params.id), { customText: text });
  if (!result) throw new HttpError(400, 'Message not sent (recipient missing or notification disabled)');
  ok(res, result);
});

// ---------- Availability ----------
r.get('/availability', (req, res) => {
  const date = isDateStr(req.query.date) ? req.query.date : todayStr();
  ok(res, availabilityGrid(date));
});

// ---------- Technicians ----------
const techDto = (t) => ({
  id: t.id, name: t.name, phone: t.phone, active: !!t.active,
  skills: t.skills.split(',').filter(Boolean),
  weeklyOff: t.weekly_off.split(',').filter(Boolean).map(Number),
});

function techInput(body) {
  const name = str(body.name, 100);
  if (name.length < 2) throw new HttpError(400, 'Name is required');
  if (!isValidPhone(body.phone)) throw new HttpError(400, 'Valid WhatsApp number is required');
  const skills = (Array.isArray(body.skills) ? body.skills : []).filter((s) => s in CATEGORIES);
  if (!skills.length) throw new HttpError(400, 'Select at least one skill');
  const weeklyOff = (Array.isArray(body.weeklyOff) ? body.weeklyOff : []).map(Number).filter((d) => d >= 0 && d <= 6);
  return { name, phone: normalizePhone(body.phone), skills: skills.join(','), weeklyOff: weeklyOff.join(','), active: body.active === false ? 0 : 1 };
}

r.get('/technicians', (_req, res) => ok(res, db.prepare('SELECT * FROM technicians ORDER BY active DESC, name').all().map(techDto)));

r.post('/technicians', (req, res) => {
  const t = techInput(req.body || {});
  const info = db.prepare('INSERT INTO technicians (name, phone, skills, weekly_off, active) VALUES (?, ?, ?, ?, ?)')
    .run(t.name, t.phone, t.skills, t.weeklyOff, t.active);
  ok(res, techDto(db.prepare('SELECT * FROM technicians WHERE id = ?').get(info.lastInsertRowid)), 201);
});

r.put('/technicians/:id', (req, res) => {
  const t = techInput(req.body || {});
  const info = db.prepare('UPDATE technicians SET name = ?, phone = ?, skills = ?, weekly_off = ?, active = ? WHERE id = ?')
    .run(t.name, t.phone, t.skills, t.weeklyOff, t.active, Number(req.params.id));
  if (!info.changes) throw new HttpError(404, 'Technician not found');
  ok(res, techDto(db.prepare('SELECT * FROM technicians WHERE id = ?').get(Number(req.params.id))));
});

r.delete('/technicians/:id', (req, res) => {
  const id = Number(req.params.id);
  const upcoming = db.prepare("SELECT COUNT(*) c FROM bookings WHERE technician_id = ? AND date >= ? AND status IN ('pending','confirmed','in_progress')")
    .get(id, todayStr()).c;
  if (upcoming) throw new HttpError(409, `Technician has ${upcoming} upcoming job(s). Reassign them first, or mark the technician inactive.`);
  const used = db.prepare('SELECT 1 FROM bookings WHERE technician_id = ? LIMIT 1').get(id);
  if (used) db.prepare('UPDATE technicians SET active = 0 WHERE id = ?').run(id); // keep history
  else db.prepare('DELETE FROM technicians WHERE id = ?').run(id);
  ok(res, { ok: true, deactivated: !!used });
});

// ---------- Technician leaves ----------
r.get('/leaves', (req, res) => {
  const from = isDateStr(req.query.from) ? req.query.from : todayStr();
  const to = isDateStr(req.query.to) ? req.query.to : addDays(from, 60);
  ok(res, db.prepare(`SELECT l.id, l.technician_id AS technicianId, tech.name AS technicianName, l.date, l.slot_id AS slotId,
                             ts.start_time AS slotStart, ts.end_time AS slotEnd, l.reason
                      FROM technician_leaves l JOIN technicians tech ON tech.id = l.technician_id
                      LEFT JOIN time_slots ts ON ts.id = l.slot_id
                      WHERE l.date BETWEEN ? AND ? ORDER BY l.date, tech.name`).all(from, to));
});

r.post('/leaves', (req, res) => {
  const { technicianId, date, toDate, slotId, reason } = req.body || {};
  if (!db.prepare('SELECT 1 FROM technicians WHERE id = ?').get(Number(technicianId))) throw new HttpError(400, 'Invalid technician');
  if (!isDateStr(date)) throw new HttpError(400, 'Invalid date');
  const end = isDateStr(toDate) && toDate >= date ? toDate : date;
  const slot = slotId ? Number(slotId) : null;
  const created = [];
  const clashes = [];
  for (let d = date, i = 0; d <= end && i < 62; d = addDays(d, 1), i++) {
    const exists = db.prepare('SELECT 1 FROM technician_leaves WHERE technician_id = ? AND date = ? AND (slot_id IS NULL OR slot_id IS ?)')
      .get(Number(technicianId), d, slot);
    if (exists) continue;
    db.prepare('INSERT INTO technician_leaves (technician_id, date, slot_id, reason) VALUES (?, ?, ?, ?)')
      .run(Number(technicianId), d, slot, str(reason, 200));
    created.push(d);
    const jobs = db.prepare(`SELECT ref FROM bookings WHERE technician_id = ? AND date = ? AND status IN ('pending','confirmed','in_progress')
                             ${slot ? 'AND slot_id = ?' : ''}`).all(...[Number(technicianId), d, ...(slot ? [slot] : [])]);
    clashes.push(...jobs.map((j) => j.ref));
  }
  ok(res, { created, clashes }, 201);
});

r.delete('/leaves/:id', (req, res) => {
  db.prepare('DELETE FROM technician_leaves WHERE id = ?').run(Number(req.params.id));
  ok(res, { ok: true });
});

// ---------- Blocked dates (holidays) ----------
r.get('/blocked-dates', (_req, res) => ok(res, db.prepare('SELECT * FROM blocked_dates WHERE date >= ? ORDER BY date').all(addDays(todayStr(), -30))));

r.post('/blocked-dates', (req, res) => {
  const { date, reason } = req.body || {};
  if (!isDateStr(date)) throw new HttpError(400, 'Invalid date');
  db.prepare('INSERT INTO blocked_dates (date, reason) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET reason = excluded.reason').run(date, str(reason, 200));
  const existing = db.prepare("SELECT COUNT(*) c FROM bookings WHERE date = ? AND status IN ('pending','confirmed','in_progress')").get(date).c;
  ok(res, { ok: true, existingBookings: existing }, 201);
});

r.delete('/blocked-dates/:id', (req, res) => {
  db.prepare('DELETE FROM blocked_dates WHERE id = ?').run(Number(req.params.id));
  ok(res, { ok: true });
});

// ---------- Time slots ----------
const slotDto = (s) => ({ id: s.id, start: s.start_time, end: s.end_time, active: !!s.active });

function slotInput(body) {
  if (!isTimeStr(body.start) || !isTimeStr(body.end)) throw new HttpError(400, 'Use HH:MM time format');
  if (body.start >= body.end) throw new HttpError(400, 'End time must be after start time');
  return { start: body.start, end: body.end, active: body.active === false ? 0 : 1 };
}

r.get('/slots', (_req, res) => ok(res, db.prepare('SELECT * FROM time_slots ORDER BY start_time').all().map(slotDto)));

r.post('/slots', (req, res) => {
  const s = slotInput(req.body || {});
  const info = db.prepare('INSERT INTO time_slots (start_time, end_time, active) VALUES (?, ?, ?)').run(s.start, s.end, s.active);
  ok(res, slotDto(db.prepare('SELECT * FROM time_slots WHERE id = ?').get(info.lastInsertRowid)), 201);
});

r.put('/slots/:id', (req, res) => {
  const s = slotInput(req.body || {});
  db.prepare('UPDATE time_slots SET start_time = ?, end_time = ?, active = ? WHERE id = ?').run(s.start, s.end, s.active, Number(req.params.id));
  ok(res, slotDto(db.prepare('SELECT * FROM time_slots WHERE id = ?').get(Number(req.params.id))));
});

r.delete('/slots/:id', (req, res) => {
  const id = Number(req.params.id);
  if (db.prepare('SELECT 1 FROM bookings WHERE slot_id = ? LIMIT 1').get(id)) {
    db.prepare('UPDATE time_slots SET active = 0 WHERE id = ?').run(id);
    return ok(res, { ok: true, deactivated: true });
  }
  db.prepare('DELETE FROM time_slots WHERE id = ?').run(id);
  ok(res, { ok: true, deactivated: false });
});

// ---------- Services ----------
const svcDto = (s) => ({
  id: s.id, category: s.category, name: s.name, description: s.description, price: s.price,
  durationMin: s.duration_min, active: !!s.active, sortOrder: s.sort_order,
});

function svcInput(b) {
  if (!(b.category in CATEGORIES)) throw new HttpError(400, 'Invalid category');
  if (str(b.name).length < 2) throw new HttpError(400, 'Name is required');
  return {
    category: b.category, name: str(b.name, 120), description: str(b.description, 600),
    price: Math.max(0, Math.round(Number(b.price) || 0)), duration: Math.max(15, Math.round(Number(b.durationMin) || 60)),
    active: b.active === false ? 0 : 1, sort: Math.round(Number(b.sortOrder) || 0),
  };
}

r.get('/services', (_req, res) => ok(res, db.prepare('SELECT * FROM services ORDER BY sort_order, id').all().map(svcDto)));

r.post('/services', (req, res) => {
  const s = svcInput(req.body || {});
  const info = db.prepare('INSERT INTO services (category, name, description, price, duration_min, active, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(s.category, s.name, s.description, s.price, s.duration, s.active, s.sort);
  ok(res, svcDto(db.prepare('SELECT * FROM services WHERE id = ?').get(info.lastInsertRowid)), 201);
});

r.put('/services/:id', (req, res) => {
  const s = svcInput(req.body || {});
  db.prepare('UPDATE services SET category = ?, name = ?, description = ?, price = ?, duration_min = ?, active = ?, sort_order = ? WHERE id = ?')
    .run(s.category, s.name, s.description, s.price, s.duration, s.active, s.sort, Number(req.params.id));
  ok(res, svcDto(db.prepare('SELECT * FROM services WHERE id = ?').get(Number(req.params.id))));
});

r.delete('/services/:id', (req, res) => {
  const id = Number(req.params.id);
  if (db.prepare('SELECT 1 FROM bookings WHERE service_id = ? LIMIT 1').get(id)) {
    db.prepare('UPDATE services SET active = 0 WHERE id = ?').run(id);
    return ok(res, { ok: true, deactivated: true });
  }
  db.prepare('DELETE FROM services WHERE id = ?').run(id);
  ok(res, { ok: true, deactivated: false });
});

// ---------- Settings ----------
r.get('/settings', (_req, res) => ok(res, getSettings()));

r.put('/settings', (req, res) => {
  const body = { ...(req.body || {}) };
  if (body.business_whatsapp != null) body.business_whatsapp = normalizePhone(body.business_whatsapp);
  for (const k of ['booking_window_days', 'min_lead_minutes', 'reminder_hours_before', 'feedback_delay_hours', 'followup_days']) {
    if (body[k] != null && !(Number(body[k]) >= 0)) throw new HttpError(400, `${k} must be a positive number`);
  }
  ok(res, updateSettings(body));
});

// ---------- WhatsApp log ----------
function msgDto(m) {
  return {
    id: m.id, bookingId: m.booking_id, bookingRef: m.booking_ref, recipientType: m.recipient_type, phone: m.phone,
    kind: m.kind, kindLabel: KIND_LABELS[m.kind] || m.kind, body: m.body, status: m.status, provider: m.provider,
    error: m.error, createdAt: m.created_at, link: waLink(m.phone, m.body),
  };
}

r.get('/messages', (req, res) => {
  const where = [];
  const params = [];
  if (req.query.status) { where.push('m.status = ?'); params.push(req.query.status); }
  if (req.query.kind) { where.push('m.kind = ?'); params.push(req.query.kind); }
  const rows = db.prepare(`SELECT m.*, b.ref AS booking_ref FROM whatsapp_messages m LEFT JOIN bookings b ON b.id = m.booking_id
                           ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY m.id DESC LIMIT 300`).all(...params);
  ok(res, rows.map(msgDto));
});

r.post('/messages/:id/resend', async (req, res) => {
  const m = db.prepare('SELECT * FROM whatsapp_messages WHERE id = ?').get(Number(req.params.id));
  if (!m) throw new HttpError(404, 'Message not found');
  ok(res, await sendMessage({ bookingId: m.booking_id, recipientType: m.recipient_type, phone: m.phone, kind: m.kind, body: m.body }));
});

r.post('/messages/:id/mark-sent', (req, res) => {
  db.prepare("UPDATE whatsapp_messages SET status = 'sent', error = NULL WHERE id = ?").run(Number(req.params.id));
  ok(res, { ok: true });
});

// ---------- Reports ----------
r.get('/reports', (req, res) => ok(res, buildReport(String(req.query.group || 'day'))));

// ---------- Customers (website accounts) ----------
r.get('/customers', (req, res) => {
  const q = String(req.query.q || '').trim();
  const like = `%${q}%`;
  const rows = db.prepare(`
    SELECT c.*, (SELECT COUNT(*) FROM bookings b WHERE b.customer_id = c.id
                 OR (c.phone_verified = 1 AND c.phone IS NOT NULL AND b.phone = c.phone)) AS booking_count
    FROM customers c
    ${q ? 'WHERE c.name LIKE ? OR c.phone LIKE ? OR c.email LIKE ?' : ''}
    ORDER BY c.id DESC LIMIT 300`).all(...(q ? [like, like, like] : []));
  ok(res, rows.map((c) => ({
    id: c.id, name: c.name, phone: c.phone, email: c.email,
    phoneVerified: !!c.phone_verified, hasPassword: !!c.password_hash, hasGoogle: !!c.google_sub,
    bookingCount: c.booking_count, createdAt: c.created_at, lastLoginAt: c.last_login_at,
  })));
});

/** Forgot password: create a temporary password and a ready-to-send WhatsApp message. */
r.post('/customers/:id/reset-password', (req, res) => {
  const { tempPassword, customer } = resetCustomerPassword(Number(req.params.id));
  const s = getSettings();
  const text = `Hi ${customer.name || ''}, your ${s.business_name} login password has been reset.

` +
    `Mobile: +${customer.phone}
Temporary password: ${tempPassword}

` +
    'Please log in and change it from My Orders > Change password.';
  ok(res, { tempPassword, waLink: waLink(customer.phone, text) });
});

r.get('/meta', (_req, res) => ok(res, { categories: CATEGORIES, statuses: STATUSES, messageKinds: KIND_LABELS, whatsappProvider }));

export default r;
