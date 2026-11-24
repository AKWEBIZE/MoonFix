import jwt from 'jsonwebtoken';
import { db } from './db.js';
import { config, HttpError, verifyPassword } from './util.js';

/**
 * Brute-force protection for the admin login. A login is refused while ANY of these is locked:
 *  - this IP + username:  5 wrong passwords -> locked 15 min
 *  - this username:      10 wrong passwords from any IPs -> locked 15 min (stops IP-hopping)
 *  - this IP:            20 wrong passwords for any usernames -> locked 15 min (stops guessing many names)
 */
const LOCK_MS = 15 * 60_000;
const RULES = [
  { key: (ip, user) => `pair:${ip}|${user}`, max: 5 },
  { key: (_ip, user) => `user:${user}`, max: 10 },
  { key: (ip) => `ip:${ip}`, max: 20 },
];
const failures = new Map(); // key -> { times: number[], lockedUntil }

function lockedFor(keys) {
  const now = Date.now();
  const until = Math.max(0, ...keys.map((k) => failures.get(k)?.lockedUntil || 0));
  return until > now ? Math.ceil((until - now) / 60_000) : 0;
}

function recordFailure(keys) {
  const now = Date.now();
  keys.forEach((k, i) => {
    const entry = failures.get(k) || { times: [], lockedUntil: 0 };
    entry.times = entry.times.filter((t) => now - t < LOCK_MS);
    entry.times.push(now);
    if (entry.times.length >= RULES[i].max) entry.lockedUntil = now + LOCK_MS;
    failures.set(k, entry);
  });
}

// Forget old entries
setInterval(() => {
  const now = Date.now();
  for (const [k, e] of failures) if (e.lockedUntil < now && e.times.every((t) => now - t > LOCK_MS)) failures.delete(k);
}, 10 * 60_000).unref();

export function login(username, password, ip) {
  const user = String(username || '').trim().toLowerCase();
  const keys = RULES.map((r) => r.key(ip, user));
  const mins = lockedFor(keys);
  if (mins) throw new HttpError(429, `Too many attempts. Try again in ${mins} minute(s).`);

  const admin = db.prepare('SELECT * FROM admins WHERE lower(username) = ?').get(user);
  if (!admin || !verifyPassword(String(password || ''), admin.password_hash)) {
    recordFailure(keys);
    throw new HttpError(401, 'Invalid username or password');
  }

  failures.delete(keys[0]); // a correct password clears this person's own counter only
  const token = jwt.sign({ sub: admin.id, username: admin.username, role: 'admin' }, config.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: '12h',
  });
  return { token, username: admin.username };
}

export function requireAdmin(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(new HttpError(401, 'Login required'));
  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    if (payload.role !== 'admin') throw new Error('not admin');
    req.admin = payload;
    next();
  } catch {
    next(new HttpError(401, 'Session expired, please login again'));
  }
}
