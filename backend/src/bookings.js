import { db, getSettings, tx } from './db.js';
import { freeTechnicians, slotsForDate, slotStartEpoch } from './availability.js';
import { bookingRef, HttpError, isDateStr, isValidPhone, normalizePhone, str, todayStr } from './util.js';

/** Anti-spam limits for online bookings (per mobile number). */
const MAX_UPCOMING_PER_PHONE = 3; // open bookings on future dates
const MAX_NEW_PER_PHONE_PER_DAY = 5; // bookings created in the last 24 hours, cancelled ones included

function checkPhoneLimits(phone) {
  const upcoming = db.prepare(`SELECT COUNT(*) c FROM bookings WHERE phone = ? AND date >= ?
                                AND status IN ('pending','confirmed','in_progress')`).get(phone, todayStr()).c;
  if (upcoming >= MAX_UPCOMING_PER_PHONE) {
    throw new HttpError(429, `This number already has ${upcoming} upcoming bookings. Please WhatsApp us to book more.`);
  }
  const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const recent = db.prepare('SELECT COUNT(*) c FROM bookings WHERE phone = ? AND created_at >= ?').get(phone, since).c;
  if (recent >= MAX_NEW_PER_PHONE_PER_DAY) {
    throw new HttpError(429, 'Too many bookings for this number today. Please WhatsApp us and we will help.');
  }
}
import { notify } from './whatsapp.js';

export const STATUSES = ['pending', 'confirmed', 'in_progress', 'completed', 'cancelled'];
export const PAYMENT_MODES = ['cash', 'upi', 'card', 'other'];

const BASE_SELECT = `
  SELECT b.*, s.name AS service_name, s.category, s.price,
         t.start_time, t.end_time,
         tech.name AS technician_name, tech.phone AS technician_phone
  FROM bookings b
  JOIN services s ON s.id = b.service_id
  JOIN time_slots t ON t.id = b.slot_id
  LEFT JOIN technicians tech ON tech.id = b.technician_id`;

export function toDto(b) {
  if (!b) return null;
  return {
    id: b.id,
    ref: b.ref,
    customerName: b.customer_name,
    phone: b.phone,
    address: b.address,
    landmark: b.landmark,
    pincode: b.pincode,
    serviceId: b.service_id,
    serviceName: b.service_name,
    category: b.category,
    price: b.price,
    brand: b.brand,
    issue: b.issue,
    date: b.date,
    slotId: b.slot_id,
    slotStart: b.start_time,
    slotEnd: b.end_time,
    technicianId: b.technician_id,
    technicianName: b.technician_name,
    technicianPhone: b.technician_phone,
    status: b.status,
    customerId: b.customer_id ?? null,
    amountCollected: b.amount_collected ?? null,
    paymentMode: b.payment_mode ?? null,
    paidAt: b.paid_at ?? null,
    adminNotes: b.admin_notes,
    whatsappOptin: !!b.whatsapp_optin,
    reminderSentAt: b.reminder_sent_at,
    feedbackSentAt: b.feedback_sent_at,
    followupSentAt: b.followup_sent_at,
    completedAt: b.completed_at,
    cancelledAt: b.cancelled_at,
    createdAt: b.created_at,
    updatedAt: b.updated_at,
  };
}

export function getBooking(id) {
  return toDto(db.prepare(`${BASE_SELECT} WHERE b.id = ?`).get(id));
}

export function getBookingByRef(ref) {
  return toDto(db.prepare(`${BASE_SELECT} WHERE b.ref = ?`).get(String(ref).toUpperCase()));
}

export function listBookings({ date, from, to, status, q, technicianId, phone, owner, limit = 200 } = {}) {
  const where = [];
  const params = [];
  if (phone) { where.push('b.phone = ?'); params.push(phone); }
  // owner: bookings made by this customer account, and (if given) any booking with this proven phone number
  if (owner) {
    if (owner.phone) { where.push('(b.customer_id = ? OR b.phone = ?)'); params.push(owner.customerId, owner.phone); }
    else { where.push('b.customer_id = ?'); params.push(owner.customerId); }
  }
  if (date) { where.push('b.date = ?'); params.push(date); }
  if (from) { where.push('b.date >= ?'); params.push(from); }
  if (to) { where.push('b.date <= ?'); params.push(to); }
  if (status) { where.push('b.status = ?'); params.push(status); }
  if (technicianId) { where.push('b.technician_id = ?'); params.push(Number(technicianId)); }
  if (q) {
    where.push('(b.ref LIKE ? OR b.customer_name LIKE ? OR b.phone LIKE ? OR b.address LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  const sql = `${BASE_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY b.date DESC, t.start_time ASC LIMIT ${Math.min(Number(limit) || 200, 1000)}`;
  return db.prepare(sql).all(...params).map(toDto);
}

/** Customer booking: validates, auto-assigns the least busy free technician, sends WhatsApp. */
export async function createBooking(input, { customerId = null } = {}) {
  const customerName = str(input.customerName, 100);
  const address = str(input.address, 500);
  const phone = normalizePhone(input.phone);
  const serviceId = Number(input.serviceId);
  const slotId = Number(input.slotId);
  const date = str(input.date, 10);

  if (customerName.length < 2) throw new HttpError(400, 'Please enter your name');
  if (!isValidPhone(input.phone)) throw new HttpError(400, 'Please enter a valid mobile number');
  if (address.length < 8) throw new HttpError(400, 'Please enter your full address');
  if (!isDateStr(date)) throw new HttpError(400, 'Please choose a date');
  checkPhoneLimits(phone);

  const service = db.prepare('SELECT * FROM services WHERE id = ? AND active = 1').get(serviceId);
  if (!service) throw new HttpError(400, 'Please choose a service');
  const slot = db.prepare('SELECT * FROM time_slots WHERE id = ? AND active = 1').get(slotId);
  if (!slot) throw new HttpError(400, 'Please choose a time slot');

  const id = tx(() => {
    const check = slotsForDate(date, service.category).slots.find((s) => s.id === slotId);
    if (!check?.available) throw new HttpError(409, `Sorry, this slot is no longer available (${check?.reason || 'unavailable'}). Please pick another slot.`);

    const tech = freeTechnicians(date, slotId, service.category)[0];
    const settings = getSettings();
    // If the visit is sooner than the reminder window, the confirmation is enough.
    const reminderMs = Number(settings.reminder_hours_before || 0) * 3_600_000;
    const skipReminder = slotStartEpoch(date, slot) - Date.now() <= reminderMs;

    let ref;
    do ref = bookingRef(); while (db.prepare('SELECT 1 FROM bookings WHERE ref = ?').get(ref));

    const info = db.prepare(`
      INSERT INTO bookings (ref, customer_name, phone, address, landmark, pincode, service_id, brand, issue,
                            date, slot_id, technician_id, status, whatsapp_optin, reminder_sent_at, customer_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      ref, customerName, phone, address, str(input.landmark, 200), str(input.pincode, 10), serviceId,
      str(input.brand, 60), str(input.issue, 1000), date, slotId, tech?.id ?? null,
      tech ? 'confirmed' : 'pending', input.whatsappOptin === false ? 0 : 1,
      skipReminder ? new Date().toISOString() : null,
      customerId,
    );
    return Number(info.lastInsertRowid);
  });

  const booking = getBooking(id);
  // Fire-and-forget follow-ups so the customer gets an instant response
  (async () => {
    if (booking.whatsappOptin) await notify('confirmation', id);
    await notify('admin_new_booking', id);
    if (booking.technicianId) await notify('technician_job', id);
  })().catch((e) => console.error('[booking notify]', e));

  return booking;
}

/** Admin update: status, reschedule, (re)assign technician, notes. */
export async function updateBooking(id, input, { notifyCustomer = true } = {}) {
  const current = getBooking(id);
  if (!current) throw new HttpError(404, 'Booking not found');

  const next = {
    status: input.status ?? current.status,
    date: input.date ?? current.date,
    slotId: input.slotId != null ? Number(input.slotId) : current.slotId,
    technicianId: input.technicianId === undefined ? current.technicianId : input.technicianId ? Number(input.technicianId) : null,
    adminNotes: input.adminNotes ?? current.adminNotes,
    customerName: input.customerName != null ? str(input.customerName, 100) : current.customerName,
    address: input.address != null ? str(input.address, 500) : current.address,
    phone: input.phone != null ? normalizePhone(input.phone) : current.phone,
  };
  if (!STATUSES.includes(next.status)) throw new HttpError(400, 'Invalid status');
  if (!isDateStr(next.date)) throw new HttpError(400, 'Invalid date');
  if (!db.prepare('SELECT 1 FROM time_slots WHERE id = ?').get(next.slotId)) throw new HttpError(400, 'Invalid slot');

  const moved = next.date !== current.date || next.slotId !== current.slotId;
  const techChanged = next.technicianId !== current.technicianId;

  // If moved and the same technician is no longer free, keep checking below
  if (next.technicianId && (moved || techChanged) && next.status !== 'cancelled' && !input.force) {
    const free = freeTechnicians(next.date, next.slotId, current.category, { excludeBookingId: id });
    if (!free.some((t) => t.id === next.technicianId)) {
      const tech = db.prepare('SELECT name FROM technicians WHERE id = ?').get(next.technicianId);
      throw new HttpError(409, `${tech?.name || 'Technician'} is not available for that date/slot (leave, weekly off, busy or missing skill).`);
    }
  }

  // Keep status in sync with assignment
  if (next.status === 'pending' && next.technicianId) next.status = 'confirmed';
  if (next.status === 'confirmed' && !next.technicianId) next.status = 'pending';

  const nowIso = new Date().toISOString();
  db.prepare(`
    UPDATE bookings SET status = ?, date = ?, slot_id = ?, technician_id = ?, admin_notes = ?,
      customer_name = ?, address = ?, phone = ?,
      completed_at = CASE WHEN ? = 'completed' AND completed_at IS NULL THEN ? WHEN ? != 'completed' THEN NULL ELSE completed_at END,
      cancelled_at = CASE WHEN ? = 'cancelled' AND cancelled_at IS NULL THEN ? WHEN ? != 'cancelled' THEN NULL ELSE cancelled_at END,
      reminder_sent_at = CASE WHEN ? THEN NULL ELSE reminder_sent_at END,
      updated_at = ?
    WHERE id = ?`).run(
    next.status, next.date, next.slotId, next.technicianId, str(next.adminNotes, 2000),
    next.customerName, next.address, next.phone,
    next.status, nowIso, next.status,
    next.status, nowIso, next.status,
    moved ? 1 : 0,
    nowIso, id,
  );

  // Payment collected (optional): amountCollected = rupees, or null to clear
  if (input.amountCollected !== undefined) {
    const raw = input.amountCollected;
    const amount = raw === null || raw === '' ? null : Math.round(Number(raw));
    if (amount !== null && !(Number.isFinite(amount) && amount >= 0 && amount <= 10_000_000)) {
      throw new HttpError(400, 'Enter the amount collected in rupees');
    }
    const mode = amount === null ? null
      : PAYMENT_MODES.includes(input.paymentMode) ? input.paymentMode : current.paymentMode || 'cash';
    db.prepare(`UPDATE bookings SET amount_collected = ?, payment_mode = ?,
                 paid_at = CASE WHEN ? IS NULL THEN NULL ELSE COALESCE(paid_at, ?) END WHERE id = ?`)
      .run(amount, mode, amount, nowIso, id);
  }

  const updated = getBooking(id);
  const sent = [];
  const send = async (kind) => { const r = await notify(kind, id); if (r) sent.push({ kind, ...r }); };

  if (notifyCustomer && updated.whatsappOptin) {
    if (updated.status === 'cancelled' && current.status !== 'cancelled') await send('cancelled');
    else if (updated.status === 'in_progress' && current.status !== 'in_progress') await send('on_the_way');
    else if (moved && updated.status !== 'cancelled') await send('rescheduled');
    else if (techChanged && updated.technicianId) await send('technician_assigned');
  }
  if (updated.technicianId && (techChanged || moved) && updated.status !== 'cancelled') await send('technician_job');

  return { booking: updated, messages: sent };
}
