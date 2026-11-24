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

checkStartupSafety(); // a live server (NODE_ENV=production) stops here if settings are unsafe

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

// Optional: serve the built Angular app from the same server in production
const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(here, '../../frontend/dist/frontend/browser');
if (fs.existsSync(webDir)) {
  app.use(express.static(webDir, { index: false, maxAge: '1h' }));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(webDir, 'index.html')));
  console.log(`[web] Serving Angular build from ${webDir}`);
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
