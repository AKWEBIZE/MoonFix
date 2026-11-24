import { Router } from 'express';
import {
  customerDto, linkPhone, loginWithGoogle, loginWithPhone, otpStatus, requireCustomer, startOtp, updateName, verifyOtp,
} from '../customerAuth.js';
import { getBookingByRef, listBookings, updateBooking } from '../bookings.js';
import { HttpError, ok } from '../util.js';

const r = Router();

// ---------- Login (public) ----------
r.post('/otp/start', (req, res) => {
  ok(res, startOtp({ phone: req.body?.phone, purpose: 'login', ip: req.ip }));
});

r.get('/otp/:id/status', (req, res) => {
  ok(res, otpStatus(req.params.id));
});

r.post('/otp/verify', (req, res) => {
  const request = verifyOtp({ requestId: req.body?.requestId, code: req.body?.code });
  if (request.purpose !== 'login') throw new HttpError(400, 'This code was for a different action. Please start again.');
  ok(res, loginWithPhone(request.phone));
});

r.post('/google', async (req, res) => {
  ok(res, await loginWithGoogle(req.body?.credential));
});

// ---------- Signed-in customer ----------
r.use(requireCustomer);

r.get('/me', (req, res) => ok(res, customerDto(req.customer)));

r.patch('/me', (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (name.length < 2) throw new HttpError(400, 'Please enter your name');
  ok(res, updateName(req.customer.id, name));
});

// Google customers confirm their mobile number once, so their bookings can be found.
r.post('/phone/start', (req, res) => {
  ok(res, startOtp({ phone: req.body?.phone, purpose: 'link', customerId: req.customer.id, ip: req.ip }));
});

r.post('/phone/verify', (req, res) => {
  const request = verifyOtp({ requestId: req.body?.requestId, code: req.body?.code });
  if (request.purpose !== 'link' || request.customer_id !== req.customer.id) {
    throw new HttpError(400, 'This code was for a different action. Please start again.');
  }
  ok(res, linkPhone(req.customer.id, request.phone));
});

const orderDto = (b) => ({
  ref: b.ref, serviceId: b.serviceId, serviceName: b.serviceName, category: b.category, price: b.price,
  date: b.date, slotStart: b.slotStart, slotEnd: b.slotEnd, status: b.status,
  technicianName: b.technicianName, address: b.address, landmark: b.landmark, pincode: b.pincode,
  brand: b.brand, issue: b.issue, createdAt: b.createdAt,
});

/** All bookings made with the customer's verified mobile number, newest first. */
r.get('/bookings', (req, res) => {
  if (!req.customer.phone) throw new HttpError(403, 'Please verify your mobile number to see your bookings.');
  ok(res, listBookings({ phone: req.customer.phone, limit: 500 }).map(orderDto));
});

r.post('/bookings/:ref/cancel', async (req, res) => {
  const b = getBookingByRef(req.params.ref);
  if (!b || !req.customer.phone || b.phone !== req.customer.phone) throw new HttpError(404, 'Booking not found');
  if (!['pending', 'confirmed'].includes(b.status)) {
    throw new HttpError(400, 'This booking can no longer be cancelled online. Please contact us on WhatsApp.');
  }
  const { booking } = await updateBooking(b.id, {
    status: 'cancelled', adminNotes: `${b.adminNotes}\nCancelled by customer from My Orders.`.trim(),
  });
  ok(res, orderDto(booking));
});

export default r;
