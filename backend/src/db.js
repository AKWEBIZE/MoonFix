/**
 * Database layer - one API, two engines:
 *
 *   MySQL   when DB_HOST is set (Hostinger MySQL: DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD)
 *   SQLite  otherwise (local development; file at DB_FILE / ./data/app.db)
 *
 * Usage everywhere in the app (always awaited):
 *   const row  = await db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
 *   const rows = await db.prepare('SELECT ...').all(a, b);
 *   const info = await db.prepare('INSERT ...').run(a, b);   // { lastInsertRowid, changes }
 *
 * Write SQL that both engines understand: no engine-specific date functions (pass ISO strings
 * from JavaScript instead), quote the column `key`, and use db.upsert / db.insertIgnore.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config, hashPassword, nowIso } from './util.js';

export const dialect = config.db.host ? 'mysql' : 'sqlite';

// ---------------------------------------------------------------------------
// Engines
// ---------------------------------------------------------------------------
/** Wraps a query function `(sql, params) => { rows, info }` in the prepare/get/all/run API. */
function makeApi(query) {
  return {
    prepare(sql) {
      return {
        get: async (...p) => (await query(sql, p)).rows[0],
        all: async (...p) => (await query(sql, p)).rows,
        run: async (...p) => (await query(sql, p)).info,
      };
    },
    exec: async (sql) => {
      await query(sql, []);
    },
  };
}

let engine; // { api, tx(fn), hasColumn(table, col), close() }

if (dialect === 'mysql') {
  const mysql = await import('mysql2/promise');
  const baseOptions = {
    user: config.db.user,
    password: config.db.password,
    database: config.db.name,
    charset: 'utf8mb4',
    connectionLimit: 5,
    waitForConnections: true,
    decimalNumbers: true, // SUM()/AVG() as numbers, not strings
    supportBigNumbers: true,
  };

  // Ways to reach MySQL, tried in order. On shared hosting (e.g. Hostinger) database users are often
  // allowed only from 'localhost', which MySQL grants to socket connections, not TCP to 127.0.0.1 -
  // so with DB_HOST=localhost the local socket file is tried first, like PHP does.
  const SOCKET_PATHS = ['/var/lib/mysql/mysql.sock', '/var/run/mysqld/mysqld.sock', '/run/mysqld/mysqld.sock',
    '/tmp/mysql.sock', '/var/run/mysql/mysql.sock', '/var/lib/mysql/mysqld.sock'];
  const isSocket = (p) => { try { return fs.statSync(p).isSocket(); } catch { return false; } };
  const targets = [];
  if (config.db.socket) targets.push({ via: 'socket', socketPath: config.db.socket });
  else if (config.db.host.toLowerCase() === 'localhost') {
    const found = SOCKET_PATHS.find(isSocket);
    if (found) targets.push({ via: 'socket', socketPath: found });
  }
  targets.push({ via: 'tcp', host: config.db.host, port: config.db.port });

  // Fail with a clear, safe summary if no way works
  let pool = null;
  const attempts = [];
  for (const { via, ...where } of targets) {
    const candidate = mysql.createPool({ ...baseOptions, ...where, connectTimeout: 10_000 });
    try {
      await candidate.query('SELECT 1');
      pool = candidate;
      console.log(`[db] MySQL via ${via}${where.socketPath ? ` (${where.socketPath})` : ''}`);
      break;
    } catch (e) {
      await candidate.end().catch(() => {});
      // "Access denied for user 'x'@'127.0.0.1'": keep only the host part MySQL saw
      const seenAs = /'[^']*'@'([^']*)'/.exec(e.message || '')?.[1];
      attempts.push({ via, code: e.code || 'ERROR', ...(seenAs ? { mysqlSawYouAs: seenAs } : {}), error: e });
      console.error(`[db] MySQL via ${via} failed: ${e.message}`);
    }
  }
  if (!pool) {
    const last = attempts[attempts.length - 1].error;
    const pw = config.db.password;
    console.error(`[db] Cannot connect to MySQL at ${config.db.host}:${config.db.port} (database "${config.db.name}", user "${config.db.user}")`);
    // Safe hints only - never the password, user name or host name
    throw Object.assign(last, {
      details: {
        attempts: attempts.map(({ error, ...a }) => a),
        userHasHostingerPrefix: /^u\d+_/.test(config.db.user),
        databaseHasHostingerPrefix: /^u\d+_/.test(config.db.name),
        passwordLength: pw.length,
        passwordHasSpacesAtEnds: pw !== pw.trim(),
        socketsFound: SOCKET_PATHS.filter(isSocket).length,
      },
    });
  }
  const runOn = (conn) => async (sql, params) => {
    const [result] = await conn.query(sql, params);
    return Array.isArray(result)
      ? { rows: result, info: null }
      : { rows: [], info: { lastInsertRowid: result.insertId, changes: result.affectedRows } };
  };
  console.log(`[db] MySQL: ${config.db.user}@${config.db.host}:${config.db.port}/${config.db.name}`);
  engine = {
    api: makeApi(runOn(pool)),
    async tx(fn) {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const out = await fn(makeApi(runOn(conn)));
        await conn.commit();
        return out;
      } catch (e) {
        await conn.rollback().catch(() => {});
        throw e;
      } finally {
        conn.release();
      }
    },
    async hasColumn(table, column) {
      const [rows] = await pool.query(
        'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
        [table, column],
      );
      return rows.length > 0;
    },
    close: () => pool.end(),
  };
} else {
  const { DatabaseSync } = await import('node:sqlite');
  fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });
  const isNew = !fs.existsSync(config.dbFile);
  const sqlite = new DatabaseSync(config.dbFile);
  console.log(`[db] SQLite: ${config.dbFile}${isNew ? '  (NEW - created empty now)' : ''}`);
  sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const cache = new Map();
  const query = async (sql, params) => {
    if (!params.length && /^\s*(CREATE|PRAGMA|BEGIN|COMMIT|ROLLBACK)/i.test(sql)) {
      sqlite.exec(sql);
      return { rows: [], info: null };
    }
    let stmt = cache.get(sql);
    if (!stmt) cache.set(sql, (stmt = sqlite.prepare(sql)));
    if (/^\s*(SELECT|WITH|PRAGMA)/i.test(sql)) return { rows: stmt.all(...params), info: null };
    const r = stmt.run(...params);
    return { rows: [], info: { lastInsertRowid: Number(r.lastInsertRowid), changes: Number(r.changes) } };
  };
  const api = makeApi(query);
  engine = {
    api,
    async tx(fn) {
      // One SQLite connection: serialise transactions so they cannot interleave
      return withLock('__sqlite_tx', async () => {
        sqlite.exec('BEGIN IMMEDIATE');
        try {
          const out = await fn(api);
          sqlite.exec('COMMIT');
          return out;
        } catch (e) {
          sqlite.exec('ROLLBACK');
          throw e;
        }
      });
    },
    async hasColumn(table, column) {
      return !!sqlite.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(column);
    },
    close: async () => sqlite.close(),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const locks = new Map();
/**
 * Runs fn while holding a named in-process lock (one Node process serves the site).
 * Used so two people cannot book the last free technician at the same moment.
 */
export function withLock(name, fn) {
  const prev = locks.get(name) || Promise.resolve();
  const run = prev.then(() => fn(), () => fn());
  locks.set(name, run.catch(() => {}));
  return run;
}

const q = (col) => `\`${col}\``;

/** INSERT that skips rows whose unique key already exists. */
async function insertIgnore(table, row, api = engine.api) {
  const cols = Object.keys(row);
  const verb = dialect === 'mysql' ? 'INSERT IGNORE' : 'INSERT OR IGNORE';
  return api.prepare(`${verb} INTO ${table} (${cols.map(q).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .run(...Object.values(row));
}

/** INSERT, or UPDATE `updateCols` when the unique key `conflictCol` already exists. */
async function upsert(table, row, conflictCol, updateCols, api = engine.api) {
  const cols = Object.keys(row);
  const base = `INSERT INTO ${table} (${cols.map(q).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
  const tail = dialect === 'mysql'
    ? ` ON DUPLICATE KEY UPDATE ${updateCols.map((c) => `${q(c)} = VALUES(${q(c)})`).join(', ')}`
    : ` ON CONFLICT(${q(conflictCol)}) DO UPDATE SET ${updateCols.map((c) => `${q(c)} = excluded.${q(c)}`).join(', ')}`;
  return api.prepare(base + tail).run(...Object.values(row));
}

/** The app's database handle. */
export const db = {
  ...engine.api,
  /** Runs fn(t) in a transaction; use t.prepare(...) for the statements that must be atomic. */
  tx: (fn) => engine.tx(fn),
  insertIgnore,
  upsert,
  hasColumn: (table, column) => engine.hasColumn(table, column),
  close: () => engine.close(),
};

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
const MYSQL_TABLE = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';

const SCHEMA_MYSQL = [
  `CREATE TABLE IF NOT EXISTS admins (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    created_at VARCHAR(30) NOT NULL DEFAULT ''
  ) ${MYSQL_TABLE}`,
  `CREATE TABLE IF NOT EXISTS settings (
    \`key\` VARCHAR(64) PRIMARY KEY,
    value TEXT NOT NULL
  ) ${MYSQL_TABLE}`,
  `CREATE TABLE IF NOT EXISTS services (
    id INT AUTO_INCREMENT PRIMARY KEY,
    category VARCHAR(30) NOT NULL,
    name VARCHAR(150) NOT NULL,
    description VARCHAR(1000) NOT NULL DEFAULT '',
    price INT NOT NULL DEFAULT 0,
    duration_min INT NOT NULL DEFAULT 60,
    active TINYINT NOT NULL DEFAULT 1,
    sort_order INT NOT NULL DEFAULT 0
  ) ${MYSQL_TABLE}`,
  `CREATE TABLE IF NOT EXISTS time_slots (
    id INT AUTO_INCREMENT PRIMARY KEY,
    start_time VARCHAR(5) NOT NULL,
    end_time VARCHAR(5) NOT NULL,
    active TINYINT NOT NULL DEFAULT 1
  ) ${MYSQL_TABLE}`,
  `CREATE TABLE IF NOT EXISTS technicians (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    skills VARCHAR(100) NOT NULL DEFAULT 'AC',
    weekly_off VARCHAR(20) NOT NULL DEFAULT '',
    active TINYINT NOT NULL DEFAULT 1,
    created_at VARCHAR(30) NOT NULL DEFAULT ''
  ) ${MYSQL_TABLE}`,
  `CREATE TABLE IF NOT EXISTS technician_leaves (
    id INT AUTO_INCREMENT PRIMARY KEY,
    technician_id INT NOT NULL,
    date VARCHAR(10) NOT NULL,
    slot_id INT NULL,
    reason VARCHAR(200) NOT NULL DEFAULT '',
    INDEX idx_leaves_date (date),
    FOREIGN KEY (technician_id) REFERENCES technicians(id) ON DELETE CASCADE,
    FOREIGN KEY (slot_id) REFERENCES time_slots(id) ON DELETE CASCADE
  ) ${MYSQL_TABLE}`,
  `CREATE TABLE IF NOT EXISTS blocked_dates (
    id INT AUTO_INCREMENT PRIMARY KEY,
    date VARCHAR(10) NOT NULL UNIQUE,
    reason VARCHAR(200) NOT NULL DEFAULT ''
  ) ${MYSQL_TABLE}`,
  `CREATE TABLE IF NOT EXISTS customers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    phone VARCHAR(20) NULL UNIQUE,
    google_sub VARCHAR(64) NULL UNIQUE,
    email VARCHAR(255) NOT NULL DEFAULT '',
    name VARCHAR(100) NOT NULL DEFAULT '',
    picture VARCHAR(500) NOT NULL DEFAULT '',
    created_at VARCHAR(30) NOT NULL DEFAULT '',
    last_login_at VARCHAR(30) NULL,
    password_hash VARCHAR(255) NULL,
    phone_verified TINYINT NOT NULL DEFAULT 0
  ) ${MYSQL_TABLE}`,
  `CREATE TABLE IF NOT EXISTS bookings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ref VARCHAR(20) NOT NULL UNIQUE,
    customer_name VARCHAR(100) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    address VARCHAR(500) NOT NULL,
    pincode VARCHAR(10) NOT NULL DEFAULT '',
    landmark VARCHAR(200) NOT NULL DEFAULT '',
    service_id INT NOT NULL,
    brand VARCHAR(60) NOT NULL DEFAULT '',
    issue VARCHAR(1000) NOT NULL DEFAULT '',
    date VARCHAR(10) NOT NULL,
    slot_id INT NOT NULL,
    technician_id INT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'confirmed',
    admin_notes VARCHAR(2000) NOT NULL DEFAULT '',
    whatsapp_optin TINYINT NOT NULL DEFAULT 1,
    reminder_sent_at VARCHAR(30) NULL,
    feedback_sent_at VARCHAR(30) NULL,
    followup_sent_at VARCHAR(30) NULL,
    completed_at VARCHAR(30) NULL,
    cancelled_at VARCHAR(30) NULL,
    created_at VARCHAR(30) NOT NULL DEFAULT '',
    updated_at VARCHAR(30) NOT NULL DEFAULT '',
    customer_id INT NULL,
    amount_collected INT NULL,
    payment_mode VARCHAR(10) NULL,
    paid_at VARCHAR(30) NULL,
    INDEX idx_bookings_date_slot (date, slot_id),
    INDEX idx_bookings_phone (phone),
    INDEX idx_bookings_customer (customer_id),
    FOREIGN KEY (service_id) REFERENCES services(id),
    FOREIGN KEY (slot_id) REFERENCES time_slots(id),
    FOREIGN KEY (technician_id) REFERENCES technicians(id) ON DELETE SET NULL,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL
  ) ${MYSQL_TABLE}`,
  `CREATE TABLE IF NOT EXISTS whatsapp_messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    booking_id INT NULL,
    recipient_type VARCHAR(20) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    kind VARCHAR(40) NOT NULL,
    body TEXT NOT NULL,
    status VARCHAR(20) NOT NULL,
    provider VARCHAR(20) NOT NULL,
    error TEXT NULL,
    created_at VARCHAR(30) NOT NULL DEFAULT '',
    INDEX idx_msgs_booking (booking_id),
    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
  ) ${MYSQL_TABLE}`,
  `CREATE TABLE IF NOT EXISTS login_requests (
    id VARCHAR(64) PRIMARY KEY,
    ref VARCHAR(10) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    purpose VARCHAR(10) NOT NULL,
    customer_id INT NULL,
    status VARCHAR(10) NOT NULL DEFAULT 'waiting',
    code_hash VARCHAR(128) NULL,
    sends INT NOT NULL DEFAULT 0,
    attempts INT NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL,
    expires_at BIGINT NOT NULL,
    INDEX idx_login_requests_phone (phone, status)
  ) ${MYSQL_TABLE}`,
];

const SCHEMA_SQLITE = [
  `CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS settings (\`key\` TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    price INTEGER NOT NULL DEFAULT 0,
    duration_min INTEGER NOT NULL DEFAULT 60,
    active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS time_slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS technicians (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    skills TEXT NOT NULL DEFAULT 'AC',
    weekly_off TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS technician_leaves (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    technician_id INTEGER NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    slot_id INTEGER REFERENCES time_slots(id) ON DELETE CASCADE,
    reason TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE INDEX IF NOT EXISTS idx_leaves_date ON technician_leaves(date)`,
  `CREATE TABLE IF NOT EXISTS blocked_dates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL UNIQUE,
    reason TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT UNIQUE,
    google_sub TEXT UNIQUE,
    email TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL DEFAULT '',
    picture TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT '',
    last_login_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS bookings (
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
    status TEXT NOT NULL DEFAULT 'confirmed',
    admin_notes TEXT NOT NULL DEFAULT '',
    whatsapp_optin INTEGER NOT NULL DEFAULT 1,
    reminder_sent_at TEXT,
    feedback_sent_at TEXT,
    followup_sent_at TEXT,
    completed_at TEXT,
    cancelled_at TEXT,
    created_at TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE INDEX IF NOT EXISTS idx_bookings_date_slot ON bookings(date, slot_id)`,
  `CREATE INDEX IF NOT EXISTS idx_bookings_phone ON bookings(phone)`,
  `CREATE TABLE IF NOT EXISTS whatsapp_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id INTEGER REFERENCES bookings(id) ON DELETE CASCADE,
    recipient_type TEXT NOT NULL,
    phone TEXT NOT NULL,
    kind TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT NOT NULL,
    provider TEXT NOT NULL,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE INDEX IF NOT EXISTS idx_msgs_booking ON whatsapp_messages(booking_id)`,
  `CREATE TABLE IF NOT EXISTS login_requests (
    id TEXT PRIMARY KEY,
    ref TEXT NOT NULL,
    phone TEXT NOT NULL,
    purpose TEXT NOT NULL,
    customer_id INTEGER,
    status TEXT NOT NULL DEFAULT 'waiting',
    code_hash TEXT,
    sends INTEGER NOT NULL DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_login_requests_phone ON login_requests(phone, status)`,
];

for (const sql of dialect === 'mysql' ? SCHEMA_MYSQL : SCHEMA_SQLITE) await db.exec(sql);

// Columns added after the first release (older SQLite files). New MySQL tables already have them.
async function addColumn(table, column, definition, after) {
  if (await db.hasColumn(table, column)) return;
  await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  if (after) await db.exec(after);
}
await addColumn('customers', 'password_hash', 'TEXT');
await addColumn('customers', 'phone_verified', 'INTEGER NOT NULL DEFAULT 0',
  'UPDATE customers SET phone_verified = 1 WHERE phone IS NOT NULL'); // earlier accounts all used WhatsApp codes
await addColumn('bookings', 'customer_id', 'INTEGER REFERENCES customers(id) ON DELETE SET NULL');
await addColumn('bookings', 'amount_collected', 'INTEGER');
await addColumn('bookings', 'payment_mode', 'TEXT');
await addColumn('bookings', 'paid_at', 'TEXT');
if (dialect === 'sqlite') await db.exec('CREATE INDEX IF NOT EXISTS idx_bookings_customer ON bookings(customer_id)');
// WhatsApp Cloud API: Meta's message id (to match delivery receipts) and the template used (for Retry)
await addColumn('whatsapp_messages', 'provider_message_id', 'VARCHAR(100) NULL',
  'CREATE INDEX idx_msgs_provider_id ON whatsapp_messages (provider_message_id)');
await addColumn('whatsapp_messages', 'template_name', 'VARCHAR(60) NULL');
await addColumn('whatsapp_messages', 'template_params', 'TEXT NULL');

// ---------------------------------------------------------------------------
// Settings (kept in memory; only changed through updateSettings)
// ---------------------------------------------------------------------------
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
  // Where new-booking alerts go. Empty = the business number. With the WhatsApp API this must be a
  // DIFFERENT number (your personal one): the API number cannot send messages to itself.
  admin_alert_whatsapp: '',
  notify_technician: '1',
};

for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) await insertIgnore('settings', { key, value: String(value) });

let settingsCache = {};
async function loadSettings() {
  const rows = await db.prepare('SELECT `key`, value FROM settings').all();
  settingsCache = Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
await loadSettings();

/** Current settings (synchronous: served from memory). */
export function getSettings() {
  return { ...settingsCache };
}

export async function updateSettings(patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (key in DEFAULT_SETTINGS) await upsert('settings', { key, value: String(value) }, 'key', ['value']);
  }
  await loadSettings();
  return getSettings();
}

// ---------------------------------------------------------------------------
// Seed data (first start only)
// ---------------------------------------------------------------------------
if (!(await db.prepare('SELECT 1 AS x FROM admins LIMIT 1').get())) {
  await db.prepare('INSERT INTO admins (username, password_hash, created_at) VALUES (?, ?, ?)')
    .run(config.adminUsername, hashPassword(config.adminPassword), nowIso());
  console.log(`[seed] Admin user "${config.adminUsername}" created`);
}

if (!(await db.prepare('SELECT 1 AS x FROM services LIMIT 1').get())) {
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
  const ins = db.prepare('INSERT INTO services (category, name, description, price, duration_min, sort_order) VALUES (?, ?, ?, ?, ?, ?)');
  for (const [i, row] of seed.entries()) await ins.run(...row, i);
}

if (!(await db.prepare('SELECT 1 AS x FROM time_slots LIMIT 1').get())) {
  const ins = db.prepare('INSERT INTO time_slots (start_time, end_time) VALUES (?, ?)');
  for (const r of [['09:00', '11:00'], ['11:00', '13:00'], ['13:00', '15:00'], ['15:00', '17:00'], ['17:00', '19:00']]) await ins.run(...r);
}

if (!(await db.prepare('SELECT 1 AS x FROM technicians LIMIT 1').get())) {
  const ins = db.prepare('INSERT INTO technicians (name, phone, skills, weekly_off, created_at) VALUES (?, ?, ?, ?, ?)');
  await ins.run('Ravi Kumar', '919000000001', 'AC,FRIDGE', '0', nowIso());
  await ins.run('Suresh M', '919000000002', 'AC,WASHING_MACHINE', '0', nowIso());
  await ins.run('Prakash S', '919000000003', 'FRIDGE,WASHING_MACHINE', '2', nowIso());
  console.log('[seed] Sample technicians created — edit them in the admin panel');
}

export const CATEGORIES = {
  AC: 'Air Conditioner',
  FRIDGE: 'Refrigerator',
  WASHING_MACHINE: 'Washing Machine',
};
