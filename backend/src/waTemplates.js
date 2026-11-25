/**
 * WhatsApp message templates - ONE place for the wording of every automatic message.
 *
 * Used for:
 *   - Meta WhatsApp Cloud API: each message type is sent with its own approved template
 *     (name + values for {{1}}, {{2}}, ...). Business-started messages MUST use approved templates.
 *   - Manual mode / the admin log: the same text with the values filled in.
 *   - scripts/whatsapp-templates.js: submits these templates to Meta for approval.
 *
 * Meta rules followed here:
 *   - a value ({{n}}) may not start or end the message, and two values may not touch
 *   - values may not contain line breaks / tabs / 4+ spaces (cleaned by `clean`)
 *   - every value needs a sample when the template is submitted (built from SAMPLE below)
 * If you change a body here, submit the template again in Meta (it must be re-approved).
 */
import { prettyDate, prettyTime } from './util.js';

/** Template language registered in Meta (WA_CLOUD_TEMPLATE_LANG, default "en"). */
export const TEMPLATE_LANG = process.env.WA_CLOUD_TEMPLATE_LANG || 'en';

/** Meta refuses empty values and values with line breaks. */
export function clean(v) {
  const t = String(v ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {4,}/g, '   ').trim();
  return (t || '-').slice(0, 500);
}

const day = (b) => prettyDate(b.date);
const time = (b) => `${prettyTime(b.start_time)} - ${prettyTime(b.end_time)}`;
const plus = (phone) => (phone ? `+${phone}` : '-');
const address = (b) => [b.address, b.landmark, b.pincode].filter(Boolean).join(', ');

/**
 * kind -> { name (in Meta), category, body (with {{1}}..), params(b, s, customText) -> values in order }
 * b = booking row (with service_name, start_time, technician_name ...), s = settings
 */
export const WA_TEMPLATES = {
  confirmation: {
    name: 'booking_confirmed',
    category: 'UTILITY',
    body:
      'Hi {{1}}, thank you for choosing {{2}}! ✅\n\nYour doorstep service is booked.\n' +
      'Booking ID: *{{3}}*\nService: {{4}}\nDate: {{5}}\nTime: {{6}}\n\n' +
      'Our technician will reach you within the time slot. Reply to this message for any help.',
    params: (b, s) => [b.customer_name, s.business_name, b.ref, b.service_name, day(b), time(b)],
  },

  rescheduled: {
    name: 'booking_rescheduled',
    category: 'UTILITY',
    body:
      'Hi {{1}}, your {{2}} booking *{{3}}* has been updated. 🔄\n\n' +
      'Service: {{4}}\nDate: {{5}}\nTime: {{6}}\nTechnician: {{7}}\n\n' +
      'Reply to this message if this time does not suit you.',
    params: (b, s) => [b.customer_name, s.business_name, b.ref, b.service_name, day(b), time(b),
      b.technician_name ? `${b.technician_name} (${plus(b.technician_phone)})` : 'To be assigned'],
  },

  technician_assigned: {
    name: 'technician_assigned',
    category: 'UTILITY',
    body:
      'Hi {{1}}, this is {{2}}. Technician *{{3}}* ({{4}}) has been assigned to your booking *{{5}}* ' +
      'on {{6}}, {{7}}.\n\nThe technician will call you before arriving.',
    params: (b, s) => [b.customer_name, s.business_name, b.technician_name, plus(b.technician_phone), b.ref, day(b), time(b)],
  },

  reminder: {
    name: 'visit_reminder',
    category: 'UTILITY',
    body:
      '⏰ Reminder from {{1}}\n\nHi {{2}}, your {{3}} visit is coming up soon.\n' +
      'Booking ID: *{{4}}*\nDate: {{5}}\nTime: {{6}}\nTechnician: {{7}}\n\n' +
      'Please keep the appliance accessible. Reply here to reschedule.',
    params: (b, s) => [s.business_name, b.customer_name, b.service_name, b.ref, day(b), time(b),
      b.technician_name ? `${b.technician_name} (${plus(b.technician_phone)})` : 'Will be shared soon'],
  },

  on_the_way: {
    name: 'technician_on_the_way',
    category: 'UTILITY',
    body:
      'Hi {{1}}, our technician {{2}} from {{3}} is on the way for your booking *{{4}}*. 🚐\n\n' +
      'Please keep your phone reachable.',
    params: (b, s) => [b.customer_name, b.technician_name || 'our technician', s.business_name, b.ref],
  },

  completed_feedback: {
    name: 'service_feedback',
    category: 'UTILITY',
    body:
      'Hi {{1}}, thank you for using {{2}}! 🙏\n\nYour {{3}} (Booking {{4}}) is complete.\n' +
      'How was our service? Please reply with a rating from 1 to 5 stars. Your feedback helps us improve.',
    params: (b, s) => [b.customer_name, s.business_name, b.service_name, b.ref],
  },

  service_followup: {
    name: 'service_followup',
    category: 'MARKETING', // a reminder to book again is promotional in Meta's rules
    body:
      'Hi {{1}}, it has been a while since your last {{2}} with {{3}}.\n\n' +
      'Regular servicing keeps your appliance efficient and saves electricity. 💡\n' +
      'Reply *BOOK* or visit our website to schedule your next doorstep service.',
    params: (b, s) => [b.customer_name, b.service_name, s.business_name],
  },

  cancelled: {
    name: 'booking_cancelled',
    category: 'UTILITY',
    body:
      'Hi {{1}}, your {{2}} booking *{{3}}* for {{4}} has been cancelled.\n\n' +
      'If this was a mistake or you want a new slot, just reply to this message.',
    params: (b, s) => [b.customer_name, s.business_name, b.ref, day(b)],
  },

  technician_job: {
    name: 'technician_new_job',
    category: 'UTILITY',
    body:
      '🛠 New job assigned by {{1}}\n\nBooking ID: *{{2}}*\nService: {{3}}\nDate: {{4}}\nTime: {{5}}\n' +
      'Customer: {{6}} ({{7}})\nAddress: {{8}}\nBrand: {{9}}\nIssue: {{10}}\n\n' +
      'Please call the customer before you leave.',
    params: (b, s) => [s.business_name, b.ref, b.service_name, day(b), time(b), b.customer_name, plus(b.phone),
      address(b), b.brand, b.issue],
  },

  admin_new_booking: {
    name: 'admin_new_booking',
    category: 'UTILITY',
    body:
      '📥 New booking *{{1}}* on the website\n\nService: {{2}}\nDate: {{3}}\nTime: {{4}}\n' +
      'Customer: {{5}} ({{6}})\nAddress: {{7}}\nTechnician: {{8}}\n\n' +
      'Open the admin panel to manage this booking.',
    params: (b) => [b.ref, b.service_name, day(b), time(b), b.customer_name, plus(b.phone), address(b),
      b.technician_name || 'Not assigned yet'],
  },

  custom: {
    name: 'booking_update',
    category: 'UTILITY',
    body: 'Hello {{1}}, here is an update about your booking {{2}}: {{3}}\n\nReply to this message if you need any help.',
    params: (b, _s, customText) => [b.customer_name, b.ref, customText],
  },
};

/** Fills {{n}} with the (cleaned) values. */
export function renderTemplate(def, values) {
  return def.body.replace(/\{\{(\d+)\}\}/g, (_, n) => values[Number(n) - 1] ?? '-');
}

/** Values for a message, cleaned for Meta. */
export function templateValues(kind, b, s, customText) {
  const def = WA_TEMPLATES[kind];
  return def ? def.params(b, s, customText).map(clean) : null;
}

/** Sample booking used for the examples Meta asks for when a template is submitted. */
export const SAMPLE = {
  booking: {
    customer_name: 'Priya', ref: 'MF2611AB', service_name: 'AC General Service', date: '2026-11-26',
    start_time: '09:00', end_time: '11:00', technician_name: 'Ravi Kumar', technician_phone: '919000000001',
    phone: '919876543210', address: '12, 2nd Street, Anna Nagar', landmark: 'Near park', pincode: '600040',
    brand: 'LG', issue: 'Not cooling',
  },
  settings: { business_name: 'MoonFix' },
  customText: 'Your technician will arrive 30 minutes late due to heavy traffic.',
};
