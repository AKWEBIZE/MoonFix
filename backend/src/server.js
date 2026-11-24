/**
 * Entry file (Hostinger: src/server.js).
 *
 * Starts the real app (app.js). If it cannot start - for example the MySQL settings are wrong -
 * a tiny fallback server answers every request with a short, safe reason instead of the host's
 * blank "503 Service Unavailable", so the problem can be seen from the browser.
 * Passwords, user names and host names are never shown; the full details are in the server log.
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

// No top-level await in this file: Hostinger (LiteSpeed) loads the entry file with require(),
// which cannot load a module that uses top-level await. import() below has no such limit.
import('./app.js').catch((e) => {
  const code = String(e?.code || 'STARTUP_FAILED').replace(/[^A-Z0-9_]/gi, '').slice(0, 40);
  console.error('[startup] The app could not start:', e);
  const body = JSON.stringify({
    message: 'The server could not start.',
    code,
    hint: HINTS[code] || 'See the server log for details.',
    ...(code === 'UNSAFE_SETTINGS' && Array.isArray(e.details) ? { settingsToFix: e.details } : {}),
    fix: 'Correct the setting in the hosting panel, then restart or redeploy the app.',
  }, null, 2);
  http.createServer((_req, res) => {
    res.writeHead(503, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' });
    res.end(body);
  }).listen(process.env.PORT || 4000, () => console.error(`[startup] Fallback server is showing the error code ${code}`));
});
