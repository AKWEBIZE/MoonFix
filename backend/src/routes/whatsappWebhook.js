/**
 * Meta WhatsApp Cloud API webhook: receives messages customers send to the
 * business number. Used for the free WhatsApp OTP login.
 *
 * Setup (Meta developer dashboard -> WhatsApp -> Configuration -> Webhook):
 *   Callback URL : https://<your-domain>/api/whatsapp/webhook
 *   Verify token : the value of WA_CLOUD_VERIFY_TOKEN in backend/.env
 *   Subscribe to : messages
 */
import crypto from 'node:crypto';
import { Router } from 'express';
import { handleInboundMessage } from '../customerAuth.js';
import { config } from '../util.js';

const r = Router();

// Meta calls this once to confirm the webhook belongs to us.
r.get('/', (req, res) => {
  const verifyToken = process.env.WA_CLOUD_VERIFY_TOKEN;
  if (verifyToken && req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === verifyToken) {
    return res.status(200).send(String(req.query['hub.challenge'] ?? ''));
  }
  res.sendStatus(403);
});

function validSignature(req) {
  const secret = process.env.WA_CLOUD_APP_SECRET;
  // Without the app secret we cannot tell Meta's calls from fake ones:
  // refuse on a live server (startup also refuses), accept only for local testing.
  if (!secret) return !config.isProduction;
  const header = String(req.headers['x-hub-signature-256'] || '');
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(req.rawBody || '').digest('hex');
  return header.length === expected.length && crypto.timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

r.post('/', (req, res) => {
  if (!validSignature(req)) return res.sendStatus(401);
  res.sendStatus(200); // answer Meta at once; process afterwards

  const messages = (req.body?.entry || [])
    .flatMap((e) => e.changes || [])
    .flatMap((c) => c.value?.messages || []);
  for (const m of messages) {
    const text = m.text?.body || m.button?.text || m.interactive?.button_reply?.title || '';
    handleInboundMessage(m.from, text).catch((e) => console.error('[webhook] inbound message failed', e));
  }
});

export default r;
