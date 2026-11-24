import { Router } from 'express';
import {
  changeCustomerPassword, customerDto, linkPhone, loginWithGoogle, loginWithPassword, loginWithPhone, otpStatus,
  registerWithPassword, requireCustomer, startOtp, updateName, verifyOtp,
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

// Mobile number + password
r.post('/register', (req, res) => {
  const { name, phone, password } = req.body || {};
  ok(res, registerWithPassword({ name, phone, password, ip: req.ip }), 201);
});

r.post('/login', (req, res) => {
  ok(res, loginWithPassword({ phone: req.body?.phone, password: req.body?.password, ip: req.ip }));
});

// ---------- Signed-in customer ----------
r.use(requireCustomer);

r.get('/me', (req, res) => ok(res, customerDto(req.customer)));

r.post('/password', (req, res) => {
  ok(res, changeCustomerPassword(req.customer.id, req.body?.currentPassword, req.body?.newPassword));
});

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

/**
 * The customer's bookings, newest first.
 * - Number proven with a WhatsApp code: every booking made with that number, plus ones made while logged in.
 * - Number only typed in at sign-up: just the bookings made while logged in to this account.
 */
const ownsBooking = (c, b) => b.customerId === c.id || (!!c.phone_verified && !!c.phone && b.phone === c.phone);

r.get('/bookings', (req, res) => {
  const c = req.customer;
  if (!c.phone && !c.password_hash) throw new HttpError(403, 'Please verify your mobile number to see your bookings.');
  const list = c.phone_verified
    ? listBookings({ owner: { customerId: c.id, phone: c.phone }, limit: 500 })
    : listBookings({ owner: { customerId: c.id }, limit: 500 });
  ok(res, list.map(orderDto));
});

r.post('/bookings/:ref/cancel', async (req, res) => {
  const b = getBookingByRef(req.params.ref);
  if (!b || !ownsBooking(req.customer, b)) throw new HttpError(404, 'Booking not found');
  if (!['pending', 'confirmed'].includes(b.status)) {
    throw new HttpError(400, 'This booking can no longer be cancelled online. Please contact us on WhatsApp.');
  }
  const { booking } = await updateBooking(b.id, {
    status: 'cancelled', adminNotes: `${b.adminNotes}\nCancelled by customer from My Orders.`.trim(),
  });
  ok(res, orderDto(booking));
});

export default r;
