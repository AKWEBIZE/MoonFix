/**
 * WhatsApp follow-up.
 *
 * Providers (env WHATSAPP_PROVIDER):
 *   none   – message is saved with status "manual"; the admin panel shows a
 *            one-click wa.me link to send it from the business phone.
 *   cloud  – Meta WhatsApp Cloud API. Every automatic message is sent with its own
 *            approved template (see waTemplates.js); replies inside the 24-hour window
 *            (login codes) are plain text. Delivery receipts and customer replies arrive
 *            on the webhook (routes/whatsappWebhook.js).
 *   twilio – Twilio WhatsApp API (plain text).
 */
import { db, getSettings } from './db.js';
import { nowIso } from './util.js';
import { renderTemplate, TEMPLATE_LANG, templateValues, WA_TEMPLATES } from './waTemplates.js';

const provider = (process.env.WHATSAPP_PROVIDER || 'none').toLowerCase();

export function waLink(phone, text) {
  return `https://wa.me/${String(phone).replace(/\D/g, '')}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

/** kind -> (booking, settings, customText) => message text. Kept for callers that only need the text. */
export const TEMPLATES = Object.fromEntries(
  Object.entries(WA_TEMPLATES).map(([kind, def]) => [kind, (b, s, customText) => renderTemplate(def, templateValues(kind, b, s, customText))]),
);

export const KIND_LABELS = {
  confirmation: 'Booking confirmation',
  rescheduled: 'Reschedule update',
  technician_assigned: 'Technician assigned',
  reminder: 'Visit reminder',
  on_the_way: 'Technician on the way',
  completed_feedback: 'Feedback request',
  service_followup: 'Service follow-up',
  cancelled: 'Cancellation',
  technician_job: 'Job sent to technician',
  admin_new_booking: 'New booking alert (admin)',
  custom: 'Custom message',
  login_otp: 'Customer login code',
  login_help: 'Customer login help',
  inbound: 'Customer message',
};

// ---------- Providers ----------
/** Returns Meta's message id (wamid...) - delivery receipts are matched on it. */
async function sendViaCloud(phone, text, { template, forceText = false } = {}) {
  const token = process.env.WA_CLOUD_TOKEN;
  const phoneId = process.env.WA_CLOUD_PHONE_NUMBER_ID;
  const version = process.env.WA_CLOUD_API_VERSION || 'v21.0';
  if (!token || !phoneId) throw new Error('WA_CLOUD_TOKEN / WA_CLOUD_PHONE_NUMBER_ID not set');

  // forceText: replies to a message the customer just sent are inside Meta's free
  // 24-hour customer-service window, so plain text is allowed (no template needed).
  const payload = template && !forceText
    ? {
        messaging_product: 'whatsapp',
        to: phone,
        type: 'template',
        template: {
          name: template.name,
          language: { code: TEMPLATE_LANG },
          components: [{ type: 'body', parameters: template.params.map((text) => ({ type: 'text', text })) }],
        },
      }
    : { messaging_product: 'whatsapp', to: phone, type: 'text', text: { preview_url: false, body: text } };

  const base = process.env.WA_CLOUD_API_BASE || 'https://graph.facebook.com'; // overridable for tests
  const res = await fetch(`${base}/${version}/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });
  const raw = await res.text();
  if (!res.ok) {
    // Meta errors look like {"error":{"message":"...","code":132001,"error_data":{"details":"..."}}}
    let msg = raw.slice(0, 300);
    try {
      const e = JSON.parse(raw).error;
      msg = `${e.code ? `(#${e.code}) ` : ''}${e.error_data?.details || e.message}`;
    } catch { /* keep raw text */ }
    throw new Error(`WhatsApp: ${msg}`);
  }
  try { return JSON.parse(raw).messages?.[0]?.id || null; } catch { return null; }
}

async function sendViaTwilio(phone, text) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM;
  if (!sid || !token || !from) throw new Error('Twilio credentials not set');
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ From: from, To: `whatsapp:+${phone}`, Body: text }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return null;
}

async function deliver(phone, text, opts) {
  if (provider === 'cloud') return { id: await sendViaCloud(phone, text, opts) };
  if (provider === 'twilio') return { id: await sendViaTwilio(phone, text) };
  return 'manual';
}

/**
 * Sends (or queues for manual sending) and logs a message. Never throws.
 * `template` = { name, params } for the Cloud API; `body` is the same text for the log / manual mode.
 * `logBody` replaces the stored text (used to hide login codes from the log).
 */
export async function sendMessage({ bookingId = null, recipientType, phone, kind, body, logBody, template = null, forceText = false }) {
  let status = 'sent';
  let error = null;
  let providerId = null;
  try {
    const r = await deliver(phone, body, { template, forceText });
    if (r === 'manual') status = 'manual';
    else providerId = r.id;
  } catch (e) {
    status = 'failed';
    error = String(e.message || e);
    console.error(`[whatsapp] ${kind} -> ${phone} failed: ${error}`);
  }
  const stored = logBody ?? body;
  const info = await db.prepare(
    `INSERT INTO whatsapp_messages (booking_id, recipient_type, phone, kind, body, status, provider, error, created_at,
       provider_message_id, template_name, template_params) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(bookingId, recipientType, phone, kind, stored, status, provider, error, nowIso(),
    providerId, template?.name ?? null, template ? JSON.stringify(template.params) : null);
  return { id: Number(info.lastInsertRowid), status, error, link: waLink(phone, stored) };
}

/** Sends a logged message again with exactly the same template and values (admin "Retry"). */
export async function resendMessage(m) {
  let template = null;
  if (m.template_name) {
    try { template = { name: m.template_name, params: JSON.parse(m.template_params || '[]') }; } catch { /* plain text */ }
  }
  return sendMessage({ bookingId: m.booking_id, recipientType: m.recipient_type, phone: m.phone, kind: m.kind, body: m.body, template });
}

export async function loadBookingForMessage(id) {
  return db.prepare(`
    SELECT b.*, s.name AS service_name, s.category, t.start_time, t.end_time,
           tech.name AS technician_name, tech.phone AS technician_phone
    FROM bookings b
    JOIN services s ON s.id = b.service_id
    JOIN time_slots t ON t.id = b.slot_id
    LEFT JOIN technicians tech ON tech.id = b.technician_id
    WHERE b.id = ?`).get(id);
}

/** Fire a templated event for a booking. Recipient is chosen by the template kind. */
export async function notify(kind, bookingId, { customText } = {}) {
  const b = await loadBookingForMessage(bookingId);
  if (!b) return null;
  const s = getSettings();
  const def = WA_TEMPLATES[kind];
  if (!def) throw new Error(`Unknown message kind: ${kind}`);
  if (kind === 'custom' && !String(customText || '').trim()) return null;

  const params = templateValues(kind, b, s, String(customText || '').slice(0, 1000));
  const message = { bookingId, kind, body: renderTemplate(def, params), template: { name: def.name, params } };

  if (kind === 'technician_job') {
    if (!b.technician_phone || s.notify_technician !== '1') return null;
    return sendMessage({ ...message, recipientType: 'technician', phone: b.technician_phone });
  }
  if (kind === 'admin_new_booking') {
    const to = s.admin_alert_whatsapp || s.business_whatsapp;
    if (s.notify_admin_new_booking !== '1' || !to) return null;
    return sendMessage({ ...message, recipientType: 'admin', phone: to });
  }
  return sendMessage({ ...message, recipientType: 'customer', phone: b.phone });
}

// ---------- Webhook: delivery receipts and customer replies ----------
const RANK = { manual: 0, failed: 0, sent: 1, delivered: 2, read: 3 };

/** Meta status update for a message we sent: sent -> delivered -> read, or failed (with the reason). */
export async function updateDeliveryStatus({ id, status, errors }) {
  if (!id || !(status in RANK)) return;
  const m = await db.prepare('SELECT id, status FROM whatsapp_messages WHERE provider_message_id = ?').get(String(id));
  if (!m) return;
  if (status === 'failed') {
    const e = errors?.[0] || {};
    const reason = `WhatsApp: ${e.code ? `(#${e.code}) ` : ''}${e.error_data?.details || e.message || e.title || 'Not delivered'}`;
    await db.prepare("UPDATE whatsapp_messages SET status = 'failed', error = ? WHERE id = ?").run(reason.slice(0, 500), m.id);
    return;
  }
  // Receipts can arrive out of order; never go backwards (read -> delivered)
  if ((RANK[status] ?? 0) > (RANK[m.status] ?? 0) || m.status === 'failed') {
    await db.prepare('UPDATE whatsapp_messages SET status = ?, error = NULL WHERE id = ?').run(status, m.id);
  }
}

/**
 * A customer wrote to the business number. With the Cloud API the number is not in a phone's
 * WhatsApp app, so the message is kept in the admin log (WhatsApp follow-ups > Customer messages),
 * linked to the customer's latest booking.
 */
export async function logInbound({ phone, text, wamid }) {
  if (wamid && await db.prepare('SELECT 1 AS x FROM whatsapp_messages WHERE provider_message_id = ?').get(wamid)) return; // Meta retries
  const latest = await db.prepare('SELECT id FROM bookings WHERE phone = ? ORDER BY id DESC LIMIT 1').get(phone);
  await db.prepare(
    `INSERT INTO whatsapp_messages (booking_id, recipient_type, phone, kind, body, status, provider, error, created_at, provider_message_id)
     VALUES (?, 'customer', ?, 'inbound', ?, 'received', ?, NULL, ?, ?)`,
  ).run(latest?.id ?? null, phone, String(text || '').slice(0, 4000), provider, nowIso(), wamid || null);
}

export const whatsappProvider = provider;
