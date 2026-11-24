import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

/**
 * Where the SQLite database lives.
 * - DB_FILE set: use it.
 * - Live server (NODE_ENV=production): ~/moonfix-data/app.db in the hosting account's home folder,
 *   OUTSIDE the app folder. Hosts like Hostinger put every deploy in a fresh folder, so a database
 *   inside the app folder would be wiped on each redeploy.
 * - Local development: ./data/app.db
 */
function defaultDbFile() {
  if (process.env.DB_FILE) return path.resolve(process.env.DB_FILE);
  if (process.env.NODE_ENV === 'production') return path.join(os.homedir(), 'moonfix-data', 'app.db');
  return path.resolve('./data/app.db');
}

/**
 * TRUST_PROXY: how many proxies (e.g. Nginx) sit in front of this server.
 * Only then may the X-Forwarded-For header be trusted for the visitor's IP.
 * Leave it unset/false when the app is reached directly, or anyone can fake their IP.
 */
function parseTrustProxy(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s || s === 'false' || s === '0') return false;
  if (/^\d+$/.test(s)) return Number(s);
  return s; // e.g. "loopback" or a list of addresses
}

export const config = {
  isProduction: process.env.NODE_ENV === 'production',
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  port: Number(process.env.PORT || 4000),
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:4200').split(',').map((s) => s.trim()).filter(Boolean),
  tz: process.env.APP_TIMEZONE || 'Asia/Kolkata',
  dbFile: defaultDbFile(),
  // MySQL (e.g. Hostinger): used instead of the SQLite file when DB_HOST is set
  db: {
    host: (process.env.DB_HOST || '').trim(),
    port: Number(process.env.DB_PORT || 3306),
    name: (process.env.DB_NAME || '').trim(),
    user: (process.env.DB_USER || '').trim(),
    password: process.env.DB_PASSWORD || '',
    // Optional: MySQL socket file. When DB_HOST=localhost and this is empty, common locations are tried.
    socket: (process.env.DB_SOCKET || '').trim(),
  },
  jwtSecret: process.env.JWT_SECRET || 'dev-only-secret-change-me',
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || 'ChangeMe@123',
  businessName: process.env.BUSINESS_NAME || 'CoolCare Home Services',
  businessWhatsapp: (process.env.BUSINESS_WHATSAPP || '919876543210').replace(/\D/g, ''),
  defaultCountryCode: (process.env.DEFAULT_COUNTRY_CODE || '91').replace(/\D/g, ''),
  // Customer login
  googleClientId: (process.env.GOOGLE_CLIENT_ID || '').trim(),
  // Shows the OTP on screen instead of WhatsApp. For local testing only - never in production.
  customerOtpDev: String(process.env.CUSTOMER_OTP_DEV || '').toLowerCase() === 'true',
};

/** Current time as an ISO string, e.g. "2026-11-25T10:15:00.000Z" (stored in *_at columns). */
export const nowIso = () => new Date().toISOString();

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Express 5 forwards rejected promises automatically; this keeps handlers tidy. */
export const ok = (res, data, status = 200) => res.status(status).json(data);

// ---------- Phone helpers ----------
/** Normalises to digits with country code, e.g. "98765 43210" -> "919876543210". */
export function normalizePhone(input) {
  let digits = String(input || '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length === 10) digits = config.defaultCountryCode + digits;
  return digits;
}

export function isValidPhone(input) {
  const p = normalizePhone(input);
  return p.length >= 11 && p.length <= 15;
}

// ---------- Password hashing (scrypt, built in) ----------
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64);
  const known = Buffer.from(hash, 'hex');
  return known.length === test.length && crypto.timingSafeEqual(known, test);
}

export function bookingRef() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (const b of crypto.randomBytes(6)) out += alphabet[b % alphabet.length];
  return `BK${out}`;
}

// ---------- Time-zone aware date helpers ----------
const ymdFormatter = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: config.tz, year: 'numeric', month: '2-digit', day: '2-digit' });

/** Today's date (YYYY-MM-DD) in the business time zone. */
export function todayStr(epoch = Date.now()) {
  return ymdFormatter().format(new Date(epoch));
}

export function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function dayOfWeek(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
}

export function isDateStr(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

export function isTimeStr(s) {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

/** Offset (ms) of the business time zone from UTC at the given instant. */
function tzOffset(epoch) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: config.tz,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(epoch));
  const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+v.year, +v.month - 1, +v.day, +v.hour, +v.minute, +v.second);
  return asUtc - Math.floor(epoch / 1000) * 1000;
}

/** Converts a local date + "HH:MM" in the business time zone to epoch ms. */
export function localToEpoch(dateStr, timeStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  return guess - tzOffset(guess);
}

export function prettyDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

export function prettyTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function str(v, max = 500) {
  return String(v ?? '').trim().slice(0, max);
}
