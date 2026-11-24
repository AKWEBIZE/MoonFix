import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config, HttpError } from './util.js';
import './db.js';
import publicRoutes from './routes/public.js';
import adminRoutes from './routes/admin.js';
import customerRoutes from './routes/customer.js';
import whatsappWebhook from './routes/whatsappWebhook.js';
import { otpMode } from './customerAuth.js';
import { checkStartupSafety, securityHeaders } from './security.js';
import { startScheduler } from './scheduler.js';
import { whatsappProvider } from './whatsapp.js';

await checkStartupSafety(); // a live server (NODE_ENV=production) refuses to start if settings are unsafe

const app = express();
// Only trust X-Forwarded-For when a known proxy (e.g. Nginx) is in front. See TRUST_PROXY in .env.
app.set('trust proxy', config.trustProxy);
app.disable('x-powered-by');
app.use(securityHeaders());
app.use(cors({ origin: config.corsOrigins }));
app.use(express.json({
  limit: '100kb',
  // Keep the raw bytes for the WhatsApp webhook, to check Meta's signature
  verify: (req, _res, buf) => { if (req.originalUrl.startsWith('/api/whatsapp/webhook')) req.rawBody = buf; },
}));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/public', publicRoutes);
app.use('/api/customer', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); }, customerRoutes);
app.use('/api/whatsapp/webhook', whatsappWebhook);
app.use('/api/admin', (_req, res, next) => {
  // Keep admin API out of search engines and caches
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.set('Cache-Control', 'no-store');
  next();
}, adminRoutes);

app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));

// Serve the built Angular website from the same server.
// `ng build` (in frontend/) writes it to backend/public, so the backend folder alone is a complete
// deployable app (Hostinger: root directory "backend", no build command, entry file src/server.js).
// WEB_DIR can point somewhere else if needed.
const here = path.dirname(fileURLToPath(import.meta.url));
const webCandidates = [
  process.env.WEB_DIR,
  path.join(here, '../public'),
  path.join(here, '../../frontend/dist/frontend/browser'), // older build location
].filter(Boolean).map((p) => path.resolve(p));
const webDir = webCandidates.find((p) => fs.existsSync(path.join(p, 'index.html'))) || webCandidates[0];
if (fs.existsSync(path.join(webDir, 'index.html'))) {
  // Hashed JS/CSS files can be cached for a long time; index.html must always be fresh after a deploy
  app.use(express.static(webDir, {
    index: false,
    maxAge: '30d',
    setHeaders: (res, file) => { if (file.endsWith('.html')) res.set('Cache-Control', 'no-cache'); },
  }));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(webDir, 'index.html'));
  });
  console.log(`[web] Serving Angular build from ${webDir}`);
} else {
  console.warn(`[web] Website build not found at ${webDir} - run "npm run build" in the frontend folder (or the project root), then commit backend/public.`);
  app.get(/^(?!\/api).*/, (_req, res) =>
    res.status(503).type('text').send('The website files have not been built yet. Run "npm run build" in the frontend folder, then deploy again.'),
  );
}

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
  // Our own HttpErrors carry a message meant for the user; hide anything unexpected.
  const expected = err instanceof HttpError;
  if (status >= 500 && !expected) console.error(err);
  res.status(status).json({ message: status >= 500 && !expected ? 'Something went wrong. Please try again.' : err.message });
});

app.listen(config.port, () => {
  console.log(`[api] Listening on http://localhost:${config.port}  (WhatsApp provider: ${whatsappProvider})`);
  const mode = otpMode();
  console.log(`[login] Customer WhatsApp OTP: ${mode}  |  Google sign-in: ${config.googleClientId ? 'on' : 'off (set GOOGLE_CLIENT_ID)'}`);
  startScheduler();
});
