import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config, hashPassword } from './util.js';

fs.mkdirSync(path.dirname(path.resolve(config.dbFile)), { recursive: true });

export const db = new DatabaseSync(config.dbFile);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,              -- AC | FRIDGE | WASHING_MACHINE
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL DEFAULT 0,     -- starting price (visiting / service charge)
  duration_min INTEGER NOT NULL DEFAULT 60,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS time_slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  start_time TEXT NOT NULL,             -- HH:MM
  end_time TEXT NOT NULL,               -- HH:MM
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS technicians (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  skills TEXT NOT NULL DEFAULT 'AC',    -- comma separated categories
  weekly_off TEXT NOT NULL DEFAULT '',  -- comma separated weekdays, 0 = Sunday
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A leave without slot_id = whole day off
CREATE TABLE IF NOT EXISTS technician_leaves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  technician_id INTEGER NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  slot_id INTEGER REFERENCES time_slots(id) ON DELETE CASCADE,
  reason TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_leaves_date ON technician_leaves(date);

-- Holidays / shop closed
CREATE TABLE IF NOT EXISTS blocked_dates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  reason TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  pincode TEXT NOT NULL DEFAULT '',
  landmark TEXT NOT NULL DEFAULT '',
  service_id INTEGER NOT NULL REFERENCES services(id),
  brand TEXT NOT NULL DEFAULT '',
  issue TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,
  slot_id INTEGER NOT NULL REFERENCES time_slots(id),
  technician_id INTEGER REFERENCES technicians(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'confirmed', -- pending | confirmed | in_progress | completed | cancelled
  admin_notes TEXT NOT NULL DEFAULT '',
  whatsapp_optin INTEGER NOT NULL DEFAULT 1,
  reminder_sent_at TEXT,
  feedback_sent_at TEXT,
  followup_sent_at TEXT,
  completed_at TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_bookings_date_slot ON bookings(date, slot_id);
CREATE INDEX IF NOT EXISTS idx_bookings_phone ON bookings(phone);

CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER REFERENCES bookings(id) ON DELETE CASCADE,
  recipient_type TEXT NOT NULL,         -- customer | technician | admin
  phone TEXT NOT NULL,
  kind TEXT NOT NULL,                   -- confirmation | reminder | ...
  body TEXT NOT NULL,
  status TEXT NOT NULL,                 -- sent | failed | manual
  provider TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_msgs_booking ON whatsapp_messages(booking_id);

-- Customer accounts. A customer logs in with a WhatsApp OTP (phone) and/or Google.
-- Bookings are matched to a customer by phone number.
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT UNIQUE,                    -- digits with country code; NULL until verified
  google_sub TEXT UNIQUE,               -- Google account id
  email TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  picture TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_login_at TEXT
);

-- WhatsApp OTP login requests (customer messages the business first, so replies are free)
CREATE TABLE IF NOT EXISTS login_requests (
  id TEXT PRIMARY KEY,                  -- random id held by the browser
  ref TEXT NOT NULL,                    -- short code shown in the WhatsApp message
  phone TEXT NOT NULL,
  purpose TEXT NOT NULL,                -- login | link
  customer_id INTEGER,                  -- for "link": the signed-in Google customer
  status TEXT NOT NULL DEFAULT 'waiting', -- waiting | sent | used | expired
  code_hash TEXT,
  sends INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,          -- epoch ms
  expires_at INTEGER NOT NULL           -- epoch ms
);
CREATE INDEX IF NOT EXISTS idx_login_requests_phone ON login_requests(phone, status);
`);

// ---------- Settings ----------
const DEFAULT_SETTINGS = {
  business_name: config.businessName,
  business_whatsapp: config.businessWhatsapp,
  working_days: '1,2,3,4,5,6', // Mon-Sat (0 = Sunday)
  booking_window_days: '30', // how far ahead customers can book
  min_lead_minutes: '120', // earliest booking = now + lead time
  reminder_hours_before: '3', // WhatsApp reminder before slot
  feedback_delay_hours: '2', // feedback request after completion
  followup_days: '90', // periodic service follow-up (0 = off)
  notify_admin_new_booking: '1',
  notify_technician: '1',
};

const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insertSetting.run(k, String(v));

export function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export function updateSettings(patch) {
  const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const [k, v] of Object.entries(patch)) {
    if (k in DEFAULT_SETTINGS) stmt.run(k, String(v));
  }
  return getSettings();
}

// ---------- Seed data (first start only) ----------
if (!db.prepare('SELECT 1 FROM admins LIMIT 1').get()) {
  db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run(
    config.adminUsername,
    hashPassword(config.adminPassword),
  );
  console.log(`[seed] Admin user "${config.adminUsername}" created`);
}

if (!db.prepare('SELECT 1 FROM services LIMIT 1').get()) {
  const s = db.prepare('INSERT INTO services (category, name, description, price, duration_min, sort_order) VALUES (?, ?, ?, ?, ?, ?)');
  const seed = [
    ['AC', 'AC General Service', 'Filter cleaning, coil wash, drain check and performance test for split & window AC.', 499, 60],
    ['AC', 'AC Repair', 'Not cooling, water leakage, noise, PCB or remote issues — diagnosis at your doorstep.', 299, 60],
    ['AC', 'AC Gas Refill', 'Leak check and gas top-up / full refill with pressure test.', 2499, 90],
    ['AC', 'AC Installation / Uninstallation', 'Safe mounting, piping and vacuuming for split & window AC.', 1299, 120],
    ['FRIDGE', 'Refrigerator Repair', 'Not cooling, ice build-up, noise, compressor or thermostat issues.', 299, 60],
    ['FRIDGE', 'Refrigerator Gas Refill', 'Leak detection and gas charging for single & double door fridges.', 1999, 90],
    ['WASHING_MACHINE', 'Washing Machine Repair', 'Not spinning, draining or starting — front load, top load & semi-auto.', 299, 60],
    ['WASHING_MACHINE', 'Washing Machine Service', 'Drum cleaning, descaling and full check-up.', 599, 60],
  ];
  seed.forEach((row, i) => s.run(...row, i));
}

if (!db.prepare('SELECT 1 FROM time_slots LIMIT 1').get()) {
  const t = db.prepare('INSERT INTO time_slots (start_time, end_time) VALUES (?, ?)');
  [['09:00', '11:00'], ['11:00', '13:00'], ['13:00', '15:00'], ['15:00', '17:00'], ['17:00', '19:00']].forEach((r) => t.run(...r));
}

if (!db.prepare('SELECT 1 FROM technicians LIMIT 1').get()) {
  const t = db.prepare('INSERT INTO technicians (name, phone, skills, weekly_off) VALUES (?, ?, ?, ?)');
  t.run('Ravi Kumar', '919000000001', 'AC,FRIDGE', '0');
  t.run('Suresh M', '919000000002', 'AC,WASHING_MACHINE', '0');
  t.run('Prakash S', '919000000003', 'FRIDGE,WASHING_MACHINE', '2');
  console.log('[seed] Sample technicians created — edit them in the admin panel');
}

export const CATEGORIES = {
  AC: 'Air Conditioner',
  FRIDGE: 'Refrigerator',
  WASHING_MACHINE: 'Washing Machine',
};

/** Runs fn inside a transaction (node:sqlite is synchronous, so this is safe). */
export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
