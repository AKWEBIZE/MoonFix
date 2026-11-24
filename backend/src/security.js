/**
 * Security helpers:
 *  - startup safety checks (a live server refuses to start with unsafe settings)
 *  - a small in-memory rate limiter shared by all routes
 *  - HTTP security headers (helmet + Content-Security-Policy)
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import helmet from 'helmet';
import { db } from './db.js';
import { config, HttpError, verifyPassword } from './util.js';

/** The password that .env.example ships with. A live server must never accept it. */
export const DEFAULT_ADMIN_PASSWORD = 'ChangeMe@123';

export async function usesDefaultPassword(adminId) {
  const admin = await db.prepare('SELECT password_hash FROM admins WHERE id = ?').get(adminId);
  return !!admin && verifyPassword(DEFAULT_ADMIN_PASSWORD, admin.password_hash);
}

/**
 * Checks settings at startup.
 * Production (NODE_ENV=production): any problem stops the server.
 * Development: problems are printed as warnings.
 */
export async function checkStartupSafety() {
  const problems = [];
  const provider = (process.env.WHATSAPP_PROVIDER || 'none').toLowerCase();

  if (config.customerOtpDev) {
    problems.push('CUSTOMER_OTP_DEV=true shows customer login codes on screen. Anyone could log in as any customer.');
  }
  if (!process.env.JWT_SECRET || config.jwtSecret.length < 32 || /replace-with|dev-only/.test(config.jwtSecret)) {
    problems.push('JWT_SECRET must be a long random value (at least 32 characters).');
  }
  const admins = await db.prepare('SELECT id, username FROM admins').all();
  const weak = [];
  for (const a of admins) if (await usesDefaultPassword(a.id)) weak.push(a.username);
  if (weak.length) {
    problems.push(`Admin "${weak.join('", "')}" still uses the default password. Change it in Admin > Settings.`);
  }
  if (provider === 'cloud' && !process.env.WA_CLOUD_APP_SECRET) {
    problems.push('WA_CLOUD_APP_SECRET is missing, so fake WhatsApp webhook calls cannot be detected.');
  }
  if (config.isProduction && config.corsOrigins.some((o) => /localhost|127\.0\.0\.1/.test(o))) {
    problems.push('CORS_ORIGINS still points at localhost. Set it to your real website address.');
  }

  // A database inside the app folder is wiped by hosts that deploy every version into a fresh folder
  const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  if (config.isProduction && path.resolve(config.dbFile).startsWith(appDir + path.sep)) {
    console.warn(`[security] DB_FILE (${config.dbFile}) is inside the app folder. If your host deploys each version into
  a new folder, every redeploy starts with an EMPTY database. Point DB_FILE outside the app, e.g. ~/moonfix-data/app.db`);
  }

  if (!problems.length) return;
  if (config.isProduction) {
    console.error('\n[security] The server will not start until these are fixed:\n  - ' + problems.join('\n  - ') + '\n');
    // The app is not running while this is shown, so listing the settings exposes nothing usable.
    throw Object.assign(new Error('Unsafe settings for a live server'), { code: 'UNSAFE_SETTINGS', details: problems });
  }
  console.warn('[security] Fine for local testing, but fix before going live:\n  - ' + problems.join('\n  - '));
}

// ---------- Rate limiting ----------
const buckets = new Map();

/**
 * Allows `max` hits per `windowMs` for a key, otherwise throws 429.
 * Keys are things like `login-ip:1.2.3.4` or `booking-phone:919876543210`.
 */
export function rateLimit(key, max, windowMs, message) {
  const now = Date.now();
  const list = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (list.length >= max) throw new HttpError(429, message);
  list.push(now);
  buckets.set(key, list);
}

/** Express middleware version, keyed by the visitor's IP address. */
export const limitByIp = (name, max, windowMs, message) => (req, _res, next) => {
  try {
    rateLimit(`${name}:${req.ip}`, max, windowMs, message);
    next();
  } catch (e) {
    next(e);
  }
};

// Forget old entries so memory cannot grow without limit
setInterval(() => {
  const cutoff = Date.now() - 24 * 3_600_000;
  for (const [key, list] of buckets) {
    const fresh = list.filter((t) => t > cutoff);
    if (fresh.length) buckets.set(key, fresh);
    else buckets.delete(key);
  }
}, 10 * 60_000).unref();

// ---------- HTTP security headers ----------
export function securityHeaders() {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
        // Google sign-in button script
        scriptSrc: ["'self'", 'https://accounts.google.com/gsi/client'],
        // Angular component styles are inline <style> tags; fonts come from Google Fonts
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://accounts.google.com/gsi/style'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        // Google profile pictures on the My Orders page
        imgSrc: ["'self'", 'data:', 'https://*.googleusercontent.com'],
        connectSrc: ["'self'", 'https://accounts.google.com/gsi/'],
        frameSrc: ['https://accounts.google.com/gsi/'],
        // Nobody may show our pages inside a frame (stops click-jacking of the admin panel)
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        ...(config.isProduction ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    // Google sign-in opens a popup that must be able to talk back to the page
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    // HTTPS-only for a year once the site is served over HTTPS (browsers ignore this on http://)
    strictTransportSecurity: config.isProduction ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    xFrameOptions: { action: 'deny' },
  });
}
