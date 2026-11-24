/**
 * WhatsApp follow-up.
 *
 * Providers (env WHATSAPP_PROVIDER):
 *   none   – message is saved with status "manual"; the admin panel shows a
 *            one-click wa.me link to send it from the business phone.
 *   cloud  – Meta WhatsApp Cloud API.
 *   twilio – Twilio WhatsApp API.
 */
import { db, getSettings } from './db.js';
import { prettyDate, prettyTime } from './util.js';

const provider = (process.env.WHATSAPP_PROVIDER || 'none').toLowerCase();

export function waLink(phone, text) {
  return `https://wa.me/${String(phone).replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
}

// ---------- Message templates ----------
function details(b) {
  return [
    `Booking ID: *${b.ref}*`,
    `Service: ${b.service_name}`,
    `Date: ${prettyDate(b.date)}`,
    `Time: ${prettyTime(b.start_time)} - ${prettyTime(b.end_time)}`,
  ].join('\n');
}

export const TEMPLATES = {
  confirmation: (b, s) =>
    `Hi ${b.customer_name}, thank you for choosing *${s.business_name}*! ✅\n\nYour doorstep service is booked.\n${details(b)}` +
    (b.technician_name ? `\nTechnician: ${b.technician_name}` : '') +
    `\n\nOur technician will reach you within the time slot. Reply to this message for any help.`,

  rescheduled: (b, s) =>
    `Hi ${b.customer_name}, your *${s.business_name}* booking has been updated. 🔄\n\n${details(b)}` +
    (b.technician_name ? `\nTechnician: ${b.technician_name} (${b.technician_phone})` : ''),

  technician_assigned: (b, s) =>
    `Hi ${b.customer_name}, technician *${b.technician_name}* (${b.technician_phone}) has been assigned to your booking *${b.ref}*.\n` +
    `${prettyDate(b.date)}, ${prettyTime(b.start_time)} - ${prettyTime(b.end_time)}\n\n- ${s.business_name}`,

  reminder: (b, s) =>
    `⏰ Reminder from *${s.business_name}*\n\nHi ${b.customer_name}, your ${b.service_name} visit is coming up soon.\n${details(b)}` +
    (b.technician_name ? `\nTechnician: ${b.technician_name} (${b.technician_phone})` : '') +
    `\n\nPlease keep the appliance accessible. Reply here to reschedule.`,

  on_the_way: (b, s) =>
    `Hi ${b.customer_name}, our technician ${b.technician_name || ''} is on the way for booking *${b.ref}*. 🚐\n- ${s.business_name}`,

  completed_feedback: (b, s) =>
    `Hi ${b.customer_name}, thank you for using *${s.business_name}*! 🙏\n\nYour ${b.service_name} (Booking ${b.ref}) is complete.\n` +
    `How was our service? Please reply with a rating from 1 ⭐ to 5 ⭐⭐⭐⭐⭐ — your feedback helps us improve.`,

  service_followup: (b, s) =>
    `Hi ${b.customer_name}, it's been a while since your last ${b.service_name} with *${s.business_name}*.\n\n` +
    `Regular servicing keeps your appliance efficient and saves electricity. 💡\nReply *BOOK* or visit our website to schedule your next doorstep service.`,

  cancelled: (b, s) =>
    `Hi ${b.customer_name}, your *${s.business_name}* booking *${b.ref}* for ${prettyDate(b.date)} has been cancelled.\n` +
    `If this was a mistake or you want a new slot, just reply to this message.`,

  technician_job: (b) =>
    `🛠 New job assigned\n\n${details(b)}\nCustomer: ${b.customer_name} (+${b.phone})\nAddress: ${b.address}` +
    (b.landmark ? `, ${b.landmark}` : '') + (b.pincode ? ` - ${b.pincode}` : '') +
    (b.brand ? `\nBrand: ${b.brand}` : '') + (b.issue ? `\nIssue: ${b.issue}` : ''),

  admin_new_booking: (b) =>
    `📥 New booking ${b.ref}\n${b.service_name}\n${prettyDate(b.date)} ${prettyTime(b.start_time)}\n` +
    `${b.customer_name} (+${b.phone})\n${b.address}` + (b.technician_name ? `\nAuto-assigned: ${b.technician_name}` : '\n⚠ No technician assigned'),
};

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
};

// ---------- Providers ----------
async function sendViaCloud(phone, text, { forceText = false } = {}) {
  const token = process.env.WA_CLOUD_TOKEN;
  const phoneId = process.env.WA_CLOUD_PHONE_NUMBER_ID;
  const version = process.env.WA_CLOUD_API_VERSION || 'v21.0';
  if (!token || !phoneId) throw new Error('WA_CLOUD_TOKEN / WA_CLOUD_PHONE_NUMBER_ID not set');

  // forceText: replies to a message the customer just sent are inside Meta's free
  // 24-hour customer-service window, so plain text is allowed (no template needed).
  const useTemplate = !forceText && String(process.env.WA_CLOUD_USE_TEMPLATE).toLowerCase() === 'true';
  const payload = useTemplate
    ? {
        messaging_product: 'whatsapp',
        to: phone,
        type: 'template',
        template: {
          name: process.env.WA_CLOUD_TEMPLATE_NAME || 'service_update',
          language: { code: process.env.WA_CLOUD_TEMPLATE_LANG || 'en' },
          // Template variables may not contain new lines
          components: [{ type: 'body', parameters: [{ type: 'text', text: text.replace(/\s*\n+\s*/g, ' | ').slice(0, 1000) }] }],
        },
      }
    : { messaging_product: 'whatsapp', to: phone, type: 'text', text: { preview_url: false, body: text } };

  const res = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Cloud API ${res.status}: ${(await res.text()).slice(0, 300)}`);
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
}

async function deliver(phone, text, opts) {
  if (provider === 'cloud') return sendViaCloud(phone, text, opts);
  if (provider === 'twilio') return sendViaTwilio(phone, text);
  return 'manual';
}

/**
 * Sends (or queues for manual sending) and logs a message. Never throws.
 * `logBody` replaces the stored text (used to hide login codes from the log).
 */
export async function sendMessage({ bookingId = null, recipientType, phone, kind, body, logBody, forceText = false }) {
  let status = 'sent';
  let error = null;
  try {
    const r = await deliver(phone, body, { forceText });
    if (r === 'manual') status = 'manual';
  } catch (e) {
    status = 'failed';
    error = String(e.message || e);
    console.error(`[whatsapp] ${kind} -> ${phone} failed: ${error}`);
  }
  const stored = logBody ?? body;
  const info = db.prepare(
    'INSERT INTO whatsapp_messages (booking_id, recipient_type, phone, kind, body, status, provider, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(bookingId, recipientType, phone, kind, stored, status, provider, error);
  return { id: Number(info.lastInsertRowid), status, error, link: waLink(phone, stored) };
}

export function loadBookingForMessage(id) {
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
  const b = loadBookingForMessage(bookingId);
  if (!b) return null;
  const s = getSettings();

  if (kind === 'technician_job') {
    if (!b.technician_phone || s.notify_technician !== '1') return null;
    return sendMessage({ bookingId, recipientType: 'technician', phone: b.technician_phone, kind, body: TEMPLATES.technician_job(b, s) });
  }
  if (kind === 'admin_new_booking') {
    if (s.notify_admin_new_booking !== '1' || !s.business_whatsapp) return null;
    return sendMessage({ bookingId, recipientType: 'admin', phone: s.business_whatsapp, kind, body: TEMPLATES.admin_new_booking(b, s) });
  }
  const body = kind === 'custom' ? String(customText || '').slice(0, 2000) : TEMPLATES[kind]?.(b, s);
  if (!body) throw new Error(`Unknown message kind: ${kind}`);
  return sendMessage({ bookingId, recipientType: 'customer', phone: b.phone, kind, body });
}

export const whatsappProvider = provider;
