import { db, getSettings } from './db.js';
import { addDays, dayOfWeek, localToEpoch, todayStr } from './util.js';

const ACTIVE_STATUSES = "('pending','confirmed','in_progress')";

const csv = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

export function techHasSkill(tech, category) {
  return csv(tech.skills).includes(category);
}

export function techWeeklyOff(tech, dateStr) {
  return csv(tech.weekly_off).includes(String(dayOfWeek(dateStr)));
}

/** Why a date is closed for customers, or null if it is open. */
export function dateClosedReason(dateStr, settings = getSettings()) {
  const today = todayStr();
  if (dateStr < today) return 'Past date';
  if (dateStr > addDays(today, Number(settings.booking_window_days || 30))) return 'Beyond booking window';
  if (!csv(settings.working_days).includes(String(dayOfWeek(dateStr)))) return 'Closed (weekly holiday)';
  const blocked = db.prepare('SELECT reason FROM blocked_dates WHERE date = ?').get(dateStr);
  if (blocked) return blocked.reason || 'Holiday';
  return null;
}

/**
 * Technicians who can take a job of `category` at date+slot:
 * active, skilled, not on weekly off, not on leave, not already booked.
 * Sorted by fewest jobs that day so work is spread evenly.
 */
export function freeTechnicians(dateStr, slotId, category, { excludeBookingId = 0 } = {}) {
  const techs = db.prepare('SELECT * FROM technicians WHERE active = 1').all();
  const onLeave = new Set(
    db.prepare('SELECT technician_id FROM technician_leaves WHERE date = ? AND (slot_id IS NULL OR slot_id = ?)')
      .all(dateStr, slotId).map((r) => r.technician_id),
  );
  const busy = new Set(
    db.prepare(`SELECT technician_id FROM bookings WHERE date = ? AND slot_id = ? AND technician_id IS NOT NULL
                AND status IN ${ACTIVE_STATUSES} AND id != ?`)
      .all(dateStr, slotId, excludeBookingId).map((r) => r.technician_id),
  );
  const load = Object.fromEntries(
    db.prepare(`SELECT technician_id, COUNT(*) AS c FROM bookings WHERE date = ? AND technician_id IS NOT NULL
                AND status IN ${ACTIVE_STATUSES} GROUP BY technician_id`)
      .all(dateStr).map((r) => [r.technician_id, r.c]),
  );
  return techs
    .filter((t) => (!category || techHasSkill(t, category)) && !techWeeklyOff(t, dateStr) && !onLeave.has(t.id) && !busy.has(t.id))
    .sort((a, b) => (load[a.id] || 0) - (load[b.id] || 0));
}

/** Unassigned (pending) jobs at a slot still reserve capacity. */
function unassignedCount(dateStr, slotId, category) {
  return db.prepare(`SELECT COUNT(*) AS c FROM bookings b JOIN services s ON s.id = b.service_id
                     WHERE b.date = ? AND b.slot_id = ? AND b.technician_id IS NULL
                     AND b.status IN ${ACTIVE_STATUSES} AND s.category = ?`)
    .get(dateStr, slotId, category).c;
}

export function slotStartEpoch(dateStr, slot) {
  return localToEpoch(dateStr, slot.start_time);
}

/** Slot list for the customer booking page. */
export function slotsForDate(dateStr, category) {
  const settings = getSettings();
  const closed = dateClosedReason(dateStr, settings);
  const slots = db.prepare('SELECT * FROM time_slots WHERE active = 1 ORDER BY start_time').all();
  const lead = Number(settings.min_lead_minutes || 0) * 60_000;
  return {
    date: dateStr,
    closedReason: closed,
    slots: slots.map((slot) => {
      let reason = closed;
      let remaining = 0;
      if (!reason && slotStartEpoch(dateStr, slot) - lead < Date.now()) reason = 'Time passed';
      if (!reason) {
        remaining = freeTechnicians(dateStr, slot.id, category).length - unassignedCount(dateStr, slot.id, category);
        if (remaining <= 0) reason = 'Fully booked';
      }
      return {
        id: slot.id,
        start: slot.start_time,
        end: slot.end_time,
        available: !reason,
        remaining: Math.max(0, remaining),
        reason,
      };
    }),
  };
}

/** Next N days with open/closed flag for the date picker. */
export function upcomingDates(category) {
  const settings = getSettings();
  const days = Number(settings.booking_window_days || 30);
  const today = todayStr();
  const out = [];
  for (let i = 0; i <= days; i++) {
    const date = addDays(today, i);
    const closedReason = dateClosedReason(date, settings);
    let hasSlots = !closedReason;
    if (hasSlots && category) hasSlots = slotsForDate(date, category).slots.some((s) => s.available);
    out.push({ date, open: hasSlots, reason: closedReason || (hasSlots ? null : 'Fully booked') });
  }
  return out;
}

/** Admin grid: every technician x every slot for one date. */
export function availabilityGrid(dateStr) {
  const techs = db.prepare('SELECT * FROM technicians WHERE active = 1 ORDER BY name').all();
  const slots = db.prepare('SELECT * FROM time_slots WHERE active = 1 ORDER BY start_time').all();
  const leaves = db.prepare('SELECT * FROM technician_leaves WHERE date = ?').all(dateStr);
  const bookings = db.prepare(`SELECT b.id, b.ref, b.slot_id, b.technician_id, b.customer_name, b.status, s.name AS service_name
                               FROM bookings b JOIN services s ON s.id = b.service_id
                               WHERE b.date = ? AND b.status IN ${ACTIVE_STATUSES}`).all(dateStr);
  const blocked = db.prepare('SELECT * FROM blocked_dates WHERE date = ?').get(dateStr) || null;

  return {
    date: dateStr,
    blocked,
    closedReason: dateClosedReason(dateStr),
    slots: slots.map((s) => ({ id: s.id, start: s.start_time, end: s.end_time })),
    technicians: techs.map((t) => {
      const fullLeave = leaves.find((l) => l.technician_id === t.id && l.slot_id == null) || null;
      return {
        id: t.id,
        name: t.name,
        skills: csv(t.skills),
        weeklyOff: techWeeklyOff(t, dateStr),
        fullDayLeave: fullLeave,
        cells: slots.map((s) => {
          const booking = bookings.find((b) => b.technician_id === t.id && b.slot_id === s.id);
          const leave = fullLeave || leaves.find((l) => l.technician_id === t.id && l.slot_id === s.id);
          let state = 'free';
          if (techWeeklyOff(t, dateStr)) state = 'weekly_off';
          if (leave) state = 'leave';
          if (booking) state = 'booked';
          return { slotId: s.id, state, leaveId: leave?.id ?? null, fullDay: !!fullLeave, booking: booking || null };
        }),
      };
    }),
    unassigned: bookings.filter((b) => !b.technician_id),
  };
}
