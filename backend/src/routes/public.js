import { Router } from 'express';
import { CATEGORIES, db, getSettings } from '../db.js';
import { slotsForDate, upcomingDates } from '../availability.js';
import { createBooking, getBookingByRef, updateBooking } from '../bookings.js';
import { customerIdFromRequest, otpMode } from '../customerAuth.js';
import { config, HttpError, isDateStr, normalizePhone, ok } from '../util.js';
import { limitByIp } from '../security.js';

const r = Router();

// Spam protection (per visitor IP). Per-number limits are in bookings.js.
const bookingHourly = limitByIp('book-hour', 6, 60 * 60_000, 'Too many bookings from this device. Please call or WhatsApp us.');
const bookingDaily = limitByIp('book-day', 15, 24 * 3_600_000, 'Too many bookings from this device today. Please call or WhatsApp us.');
const lookupLimit = limitByIp('track', 30, 15 * 60_000, 'Too many lookups. Please wait a few minutes and try again.');

/** Bot trap: the booking form has a hidden "website" field that people never see or fill in. */
function honeypot(req, _res, next) {
  if (String(req.body?.website || '').trim()) return next(new HttpError(400, 'Could not complete the booking. Please WhatsApp us.'));
  next();
}

const serviceDto = (s) => ({
  id: s.id, category: s.category, categoryLabel: CATEGORIES[s.category] || s.category,
  name: s.name, description: s.description, price: s.price, durationMin: s.duration_min,
});

r.get('/config', async (_req, res) => {
  const s = getSettings();
  ok(res, {
    businessName: s.business_name,
    businessWhatsapp: s.business_whatsapp,
    workingDays: s.working_days.split(',').map(Number),
    bookingWindowDays: Number(s.booking_window_days),
    categories: CATEGORIES,
    googleClientId: config.googleClientId || null,
    otpMode: otpMode(),
  });
});

r.get('/services', async (_req, res) => {
  ok(res, (await db.prepare('SELECT * FROM services WHERE active = 1 ORDER BY sort_order, id').all()).map(serviceDto));
});

async function categoryOf(serviceId) {
  const s = await db.prepare('SELECT category FROM services WHERE id = ? AND active = 1').get(Number(serviceId));
  if (!s) throw new HttpError(400, 'Invalid service');
  return s.category;
}

r.get('/dates', async (req, res) => {
  ok(res, await upcomingDates(req.query.serviceId ? await categoryOf(req.query.serviceId) : null));
});

r.get('/slots', async (req, res) => {
  const { date, serviceId } = req.query;
  if (!isDateStr(date)) throw new HttpError(400, 'Invalid date');
  ok(res, await slotsForDate(date, await categoryOf(serviceId)));
});

r.post('/bookings', honeypot, bookingHourly, bookingDaily, async (req, res) => {
  const b = await createBooking(req.body || {}, { customerId: await customerIdFromRequest(req) });
  ok(res, publicView(b), 201);
});

function publicView(b) {
  return {
    ref: b.ref, customerName: b.customerName, serviceName: b.serviceName, date: b.date,
    slotStart: b.slotStart, slotEnd: b.slotEnd, status: b.status, address: b.address,
    technicianName: b.technicianName, price: b.price,
  };
}

async function findOwn(ref, phone) {
  const b = await getBookingByRef(ref || '');
  if (!b || b.phone !== normalizePhone(phone)) throw new HttpError(404, 'No booking found for this ID and mobile number');
  return b;
}

r.post('/bookings/track', lookupLimit, async (req, res) => {
  ok(res, publicView(await findOwn(req.body?.ref, req.body?.phone)));
});

r.post('/bookings/cancel', lookupLimit, async (req, res) => {
  const b = await findOwn(req.body?.ref, req.body?.phone);
  if (!['pending', 'confirmed'].includes(b.status)) throw new HttpError(400, 'This booking can no longer be cancelled online. Please contact us on WhatsApp.');
  const { booking } = await updateBooking(b.id, { status: 'cancelled', adminNotes: `${b.adminNotes}\nCancelled by customer online.`.trim() });
  ok(res, publicView(booking));
});

export default r;
