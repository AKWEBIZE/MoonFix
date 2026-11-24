/**
 * Automatic WhatsApp follow-ups, checked every minute:
 *  - reminder N hours before the slot
 *  - feedback request N hours after the job is completed
 *  - periodic service follow-up N days after completion
 */
import { db, getSettings } from './db.js';
import { localToEpoch } from './util.js';
import { notify } from './whatsapp.js';

let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    const s = getSettings();
    const now = Date.now();
    const nowIso = new Date(now).toISOString();

    // 1) Reminders
    const reminderMs = Number(s.reminder_hours_before || 0) * 3_600_000;
    if (reminderMs > 0) {
      const candidates = db.prepare(`
        SELECT b.id, b.date, t.start_time FROM bookings b JOIN time_slots t ON t.id = b.slot_id
        WHERE b.status IN ('pending','confirmed') AND b.reminder_sent_at IS NULL AND b.whatsapp_optin = 1
          AND b.date BETWEEN date('now','-1 day') AND date('now','+3 day')`).all();
      for (const c of candidates) {
        const start = localToEpoch(c.date, c.start_time);
        if (start > now && start - now <= reminderMs) {
          db.prepare('UPDATE bookings SET reminder_sent_at = ? WHERE id = ?').run(nowIso, c.id);
          await notify('reminder', c.id);
        }
      }
    }

    // 2) Feedback after completion
    const feedbackMs = Number(s.feedback_delay_hours || 0) * 3_600_000;
    const feedbackDue = db.prepare(`
      SELECT id, completed_at FROM bookings
      WHERE status = 'completed' AND feedback_sent_at IS NULL AND completed_at IS NOT NULL AND whatsapp_optin = 1`).all();
    for (const b of feedbackDue) {
      if (Date.parse(b.completed_at) + feedbackMs <= now) {
        db.prepare('UPDATE bookings SET feedback_sent_at = ? WHERE id = ?').run(nowIso, b.id);
        await notify('completed_feedback', b.id);
      }
    }

    // 3) Periodic service follow-up (e.g. AC service every 90 days)
    const followDays = Number(s.followup_days || 0);
    if (followDays > 0) {
      const followDue = db.prepare(`
        SELECT id, completed_at FROM bookings
        WHERE status = 'completed' AND followup_sent_at IS NULL AND completed_at IS NOT NULL AND whatsapp_optin = 1`).all();
      for (const b of followDue) {
        if (Date.parse(b.completed_at) + followDays * 86_400_000 <= now) {
          db.prepare('UPDATE bookings SET followup_sent_at = ? WHERE id = ?').run(nowIso, b.id);
          await notify('service_followup', b.id);
        }
      }
    }
  } catch (e) {
    console.error('[scheduler]', e);
  } finally {
    running = false;
  }
}

export function startScheduler() {
  setTimeout(tick, 5_000);
  setInterval(tick, 60_000);
  console.log('[scheduler] WhatsApp follow-up scheduler started');
}
