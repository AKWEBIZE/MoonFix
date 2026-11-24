/**
 * Entry file (Hostinger: src/server.js).
 *
 * Starts listening at once, then loads the real app (app.js: database, routes, website).
 * Until it is ready, every request gets a short status instead of the host's blank 503:
 *   - "starting"  while the database connects and the tables are prepared
 *   - an error code + hint if loading failed (for example wrong MySQL settings)
 * Passwords, user names and host names are never shown; the full details are in the server log.
 *
 * No top-level await in this file: Hostinger (LiteSpeed) loads the entry file with require(),
 * which cannot load a module that uses top-level await. import() below has no such limit.
 */
import http from 'node:http';

const HINTS = {
  ER_ACCESS_DENIED_ERROR: 'MySQL refused the login. Check DB_USER and DB_PASSWORD (full names, e.g. u123456_moonfix).',
  ER_DBACCESS_DENIED_ERROR: 'This MySQL user has no access to the database. Check that DB_USER belongs to DB_NAME in hPanel.',
  ER_BAD_DB_ERROR: 'Database not found. Check DB_NAME (full name, e.g. u123456_moonfix).',
  ENOTFOUND: 'MySQL host not found. Check DB_HOST (use the "MySQL host" shown in hPanel > Databases).',
  EAI_AGAIN: 'MySQL host not found. Check DB_HOST (use the "MySQL host" shown in hPanel > Databases).',
  ECONNREFUSED: 'MySQL is not accepting connections at that address. Check DB_HOST and DB_PORT.',
  ETIMEDOUT: 'Timed out reaching MySQL. Check DB_HOST and DB_PORT.',
  UNSAFE_SETTINGS: 'Live-mode safety check failed. Fix the settings listed below.',
};

const startedAt = Date.now();

function sendStatus(res, data) {
  res.writeHead(503, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' });
  res.end(JSON.stringify(data, null, 2));
}

// Until app.js is ready, answer with "starting"
let handler = (_req, res) => {
  res.setHeader('retry-after', '5');
  sendStatus(res, {
    message: 'The server is starting. Please try again in a few seconds.',
    code: 'STARTING',
    secondsSinceStart: Math.round((Date.now() - startedAt) / 1000),
  });
};

const server = http.createServer((req, res) => handler(req, res));
server.listen(process.env.PORT || 4000, () => console.log(`[api] Listening on port ${process.env.PORT || 4000}, loading the app...`));

import('./app.js').then(
  ({ default: app, onReady }) => {
    handler = app;
    onReady();
  },
  (e) => {
    const code = String(e?.code || 'STARTUP_FAILED').replace(/[^A-Z0-9_]/gi, '').slice(0, 40);
    console.error('[startup] The app could not start:', e);
    const body = {
      message: 'The server could not start.',
      code,
      hint: HINTS[code] || 'See the server log for details.',
      ...(code === 'UNSAFE_SETTINGS' && Array.isArray(e.details) ? { settingsToFix: e.details } : {}),
      // Safe MySQL checks from db.js (never the password, user name or host name)
      ...(code !== 'UNSAFE_SETTINGS' && e.details && typeof e.details === 'object' ? { checks: e.details } : {}),
      fix: 'Correct the setting in the hosting panel, then restart or redeploy the app.',
    };
    handler = (_req, res) => sendStatus(res, body);
    console.error(`[startup] Showing the error code ${code} to visitors`);
  },
);
