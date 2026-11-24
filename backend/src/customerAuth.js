/**
 * Customer login.
 *
 * 1. WhatsApp OTP (free):
 *    The website creates a login request for the customer's number and opens
 *    WhatsApp with a ready-made message to the business. The customer taps Send,
 *    our webhook receives it and replies with a 6-digit code. Because the customer
 *    messaged first, the reply falls in Meta's free customer-service window - no
 *    per-OTP charge. The sender number comes from WhatsApp itself, so a code is
 *    only ever delivered to the phone that owns that number.
 *
 * 2. Google sign-in:
 *    The browser gets an ID token from Google; we verify its signature with
 *    Google's public keys. The first time, the customer confirms their mobile
 *    number once with the WhatsApp OTP so their bookings can be shown.
 */
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { db, getSettings, tx } from './db.js';
import { sendMessage, waLink, whatsappProvider } from './whatsapp.js';
import { config, HttpError, isValidPhone, normalizePhone } from './util.js';
import { rateLimit } from './security.js';

const REQUEST_TTL_MS = 10 * 60_000; // time to send the WhatsApp message
const CODE_TTL_MS = 5 * 60_000; // time to type the code after it arrives
const MAX_SENDS = 3; // codes per request (customer can ask again)
const MAX_ATTEMPTS = 5; // wrong codes per request
const TOKEN_TTL = '30d';

/** How OTP login works on this server: whatsapp | dev | off */
export function otpMode() {
  if (whatsappProvider === 'cloud') return 'whatsapp';
  // Test mode (code shown on screen) is refused on a live server, whatever .env says
  if (config.customerOtpDev && !config.isProduction) return 'dev';
  return 'off';
}

const limit = (key, max, windowMs, message) => rateLimit(`otp-${key}`, max, windowMs, message);

const hashCode = (requestId, code) =>
  crypto.createHmac('sha256', config.jwtSecret).update(`${requestId}:${code}`).digest('hex');

const newCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

function shortRef() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return [...crypto.randomBytes(4)].map((b) => alphabet[b % alphabet.length]).join('');
}

// ---------- OTP requests ----------
/** Step 1: customer entered their mobile number on the website. */
export function startOtp({ phone: rawPhone, purpose = 'login', customerId = null, ip }) {
  const mode = otpMode();
  if (mode === 'off') {
    throw new HttpError(503, 'WhatsApp login is not set up yet. Please contact us on WhatsApp.');
  }
  if (!isValidPhone(rawPhone)) throw new HttpError(400, 'Please enter a valid mobile number');
  const phone = normalizePhone(rawPhone);
  limit(`ip:${ip}`, 10, 15 * 60_000, 'Too many login attempts. Please try again in a few minutes.');
  limit(`phone:${phone}`, 5, 15 * 60_000, 'Too many codes requested for this number. Please try again in 15 minutes.');

  const now = Date.now();
  // Only the newest request for a number is valid
  db.prepare("UPDATE login_requests SET status = 'expired' WHERE phone = ? AND status IN ('waiting','sent')").run(phone);
  db.prepare('DELETE FROM login_requests WHERE expires_at < ?').run(now - 24 * 3_600_000);

  const id = crypto.randomBytes(16).toString('hex');
  const ref = shortRef();
  db.prepare(`INSERT INTO login_requests (id, ref, phone, purpose, customer_id, created_at, expires_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, ref, phone, purpose, customerId, now, now + REQUEST_TTL_MS);

  const business = getSettings().business_whatsapp;
  const out = {
    requestId: id,
    ref,
    phone,
    mode,
    expiresInSec: REQUEST_TTL_MS / 1000,
    waLink: waLink(business, `Hi! Please send my login code. (Ref: ${ref})`),
  };

  if (mode === 'dev') {
    // Local testing without WhatsApp: create the code now and show it on screen.
    const code = issueCode(id);
    console.log(`[login] DEV MODE code for +${phone}: ${code}`);
    out.devCode = code;
  }
  return out;
}

function issueCode(requestId) {
  const code = newCode();
  db.prepare(`UPDATE login_requests SET status = 'sent', code_hash = ?, sends = sends + 1, attempts = 0, expires_at = ?
              WHERE id = ?`).run(hashCode(requestId, code), Date.now() + CODE_TTL_MS, requestId);
  return code;
}

/** The website polls this to show "code sent - check WhatsApp". */
export function otpStatus(requestId) {
  const r = db.prepare('SELECT status, expires_at FROM login_requests WHERE id = ?').get(String(requestId || ''));
  if (!r) throw new HttpError(404, 'Login request not found. Please start again.');
  const status = ['waiting', 'sent'].includes(r.status) && r.expires_at < Date.now() ? 'expired' : r.status;
  return { status };
}

/**
 * Step 2 (webhook): a customer sent us a WhatsApp message.
 * Returns true if it was a login message we handled.
 */
export async function handleInboundMessage(fromRaw, text = '') {
  const phone = normalizePhone(fromRaw);
  const now = Date.now();
  const req = db.prepare(`SELECT * FROM login_requests WHERE phone = ? AND status IN ('waiting','sent') AND expires_at > ?
                          ORDER BY created_at DESC LIMIT 1`).get(phone, now);
  const s = getSettings();

  if (!req) {
    if (!/login|code|otp/i.test(text)) return false; // not about logging in: leave it for staff
    await sendMessage({
      recipientType: 'customer', phone, kind: 'login_help', forceText: true,
      body: `Hi! To log in to *${s.business_name}*, open our website, tap *Login*, enter this WhatsApp number ` +
        `and tap *Get OTP on WhatsApp*. Then send the message that opens here.`,
    });
    return true;
  }
  if (req.sends >= MAX_SENDS) return true; // stop someone using us to spam a number

  const code = issueCode(req.id);
  const body = `🔐 *${code}* is your ${s.business_name} login code.\n\n` +
    `It expires in ${CODE_TTL_MS / 60_000} minutes. Do not share this code with anyone - our team will never ask for it.`;
  await sendMessage({
    recipientType: 'customer', phone, kind: 'login_otp', forceText: true,
    body, logBody: body.replace(code, '••••••'),
  });
  return true;
}

/** Step 3: customer typed the code on the website. Returns the verified request. */
export function verifyOtp({ requestId, code }) {
  const req = db.prepare('SELECT * FROM login_requests WHERE id = ?').get(String(requestId || ''));
  if (!req || req.status === 'used' || req.status === 'expired') {
    throw new HttpError(400, 'This code has expired. Please request a new one.');
  }
  if (req.status !== 'sent') throw new HttpError(400, 'We have not sent your code yet. Please send the WhatsApp message first.');
  if (req.expires_at < Date.now()) {
    db.prepare("UPDATE login_requests SET status = 'expired' WHERE id = ?").run(req.id);
    throw new HttpError(400, 'This code has expired. Please request a new one.');
  }
  if (req.attempts >= MAX_ATTEMPTS) throw new HttpError(429, 'Too many wrong codes. Please request a new one.');

  const given = Buffer.from(hashCode(req.id, String(code || '').replace(/\D/g, '')), 'hex');
  const known = Buffer.from(req.code_hash, 'hex');
  if (!crypto.timingSafeEqual(given, known)) {
    db.prepare('UPDATE login_requests SET attempts = attempts + 1 WHERE id = ?').run(req.id);
    const left = MAX_ATTEMPTS - req.attempts - 1;
    throw new HttpError(400, left > 0 ? `Wrong code. ${left} attempt(s) left.` : 'Too many wrong codes. Please request a new one.');
  }
  db.prepare("UPDATE login_requests SET status = 'used' WHERE id = ?").run(req.id);
  return req;
}

// ---------- Customers ----------
export function customerDto(c) {
  return {
    id: c.id, name: c.name, email: c.email, phone: c.phone, picture: c.picture,
    hasGoogle: !!c.google_sub, needsPhone: !c.phone,
  };
}

const getCustomer = (id) => db.prepare('SELECT * FROM customers WHERE id = ?').get(id);

function lastBookingName(phone) {
  return db.prepare('SELECT customer_name FROM bookings WHERE phone = ? ORDER BY id DESC LIMIT 1').get(phone)?.customer_name || '';
}

function touch(id) {
  db.prepare("UPDATE customers SET last_login_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(id);
  return getCustomer(id);
}

export function session(customer) {
  const token = jwt.sign({ sub: customer.id, role: 'customer' }, config.jwtSecret, { algorithm: 'HS256', expiresIn: TOKEN_TTL });
  return { token, customer: customerDto(customer) };
}

/** WhatsApp OTP login: find or create the customer for this number. */
export function loginWithPhone(phone) {
  let c = db.prepare('SELECT * FROM customers WHERE phone = ?').get(phone);
  if (!c) {
    const info = db.prepare('INSERT INTO customers (phone, name) VALUES (?, ?)').run(phone, lastBookingName(phone));
    c = getCustomer(Number(info.lastInsertRowid));
  }
  return session(touch(c.id));
}

/** Google login: find or create the customer for this Google account. */
export async function loginWithGoogle(credential) {
  const g = await verifyGoogleCredential(credential);
  let c = db.prepare('SELECT * FROM customers WHERE google_sub = ?').get(g.sub);
  if (c) {
    db.prepare('UPDATE customers SET email = ?, picture = ?, name = CASE WHEN name = \'\' THEN ? ELSE name END WHERE id = ?')
      .run(g.email || '', g.picture || '', g.name || '', c.id);
  } else {
    const info = db.prepare('INSERT INTO customers (google_sub, email, name, picture) VALUES (?, ?, ?, ?)')
      .run(g.sub, g.email || '', g.name || '', g.picture || '');
    c = { id: Number(info.lastInsertRowid) };
  }
  return session(touch(c.id));
}

/**
 * A Google customer verified a mobile number. If that number already has an
 * account (from an earlier WhatsApp login), merge the two into one.
 */
export function linkPhone(customerId, phone) {
  const me = getCustomer(customerId);
  if (!me) throw new HttpError(401, 'Please log in again');
  if (me.phone === phone) return session(me);

  const owner = db.prepare('SELECT * FROM customers WHERE phone = ?').get(phone);
  if (owner && owner.id !== me.id) {
    if (owner.google_sub && owner.google_sub !== me.google_sub) {
      throw new HttpError(409, 'This mobile number is already linked to a different Google account.');
    }
    const merged = tx(() => {
      db.prepare('DELETE FROM customers WHERE id = ?').run(me.id);
      db.prepare(`UPDATE customers SET google_sub = ?, email = ?, picture = ?,
                  name = CASE WHEN name = '' THEN ? ELSE name END WHERE id = ?`)
        .run(me.google_sub, me.email, me.picture, me.name, owner.id);
      return owner.id;
    });
    return session(touch(merged));
  }
  db.prepare("UPDATE customers SET phone = ?, name = CASE WHEN name = '' THEN ? ELSE name END WHERE id = ?")
    .run(phone, lastBookingName(phone), me.id);
  return session(touch(me.id));
}

export function updateName(customerId, name) {
  db.prepare('UPDATE customers SET name = ? WHERE id = ?').run(String(name || '').trim().slice(0, 100), customerId);
  return customerDto(getCustomer(customerId));
}

/** Express middleware: requires a customer token; sets req.customer (fresh from the DB). */
export function requireCustomer(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(new HttpError(401, 'Please log in'));
  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    if (payload.role !== 'customer') throw new Error('not a customer');
    const c = getCustomer(payload.sub);
    if (!c) throw new Error('customer gone');
    req.customer = c;
    next();
  } catch {
    next(new HttpError(401, 'Your session has expired. Please log in again.'));
  }
}

// ---------- Google ID token verification ----------
let googleKeys = { keys: {}, fetchedAt: 0 };

async function googleKey(kid) {
  const stale = Date.now() - googleKeys.fetchedAt > 3_600_000;
  if (stale || !googleKeys.keys[kid]) {
    let res;
    try {
      res = await fetch('https://www.googleapis.com/oauth2/v3/certs', { signal: AbortSignal.timeout(10_000) });
    } catch {
      throw new HttpError(502, 'Could not reach Google. Please try again.');
    }
    if (!res.ok) throw new HttpError(502, 'Could not reach Google. Please try again.');
    const { keys } = await res.json();
    googleKeys = {
      keys: Object.fromEntries(keys.map((k) => [k.kid, crypto.createPublicKey({ key: k, format: 'jwk' })])),
      fetchedAt: Date.now(),
    };
  }
  return googleKeys.keys[kid];
}

export async function verifyGoogleCredential(credential) {
  if (!config.googleClientId) throw new HttpError(503, 'Google sign-in is not set up yet.');
  const decoded = jwt.decode(String(credential || ''), { complete: true });
  const key = decoded?.header?.kid && (await googleKey(decoded.header.kid));
  if (!key) throw new HttpError(401, 'Google sign-in failed. Please try again.');
  let p;
  try {
    p = jwt.verify(credential, key, {
      algorithms: ['RS256'],
      audience: config.googleClientId,
      issuer: ['accounts.google.com', 'https://accounts.google.com'],
    });
  } catch {
    throw new HttpError(401, 'Google sign-in failed or expired. Please try again.');
  }
  if (!p.email_verified) throw new HttpError(401, 'Please use a Google account with a verified email.');
  return p;
}
