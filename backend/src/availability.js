/**
 * Slot / technician availability.
 *
 * Everything needed for a date range is loaded in a handful of queries (loadContext),
 * then worked out in memory - fast even when the database is a separate MySQL server.
 */
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

export function slotStartEpoch(dateStr, slot) {
  return localToEpoch(dateStr, slot.start_time);
}

/** Loads technicians, slots, leaves, holidays and open bookings for [from, to]. */
async function loadContext(from, to = from) {
  const [techs, slots, leaves, blocked, bookings] = await Promise.all([
    db.prepare('SELECT * FROM technicians WHERE active = 1 ORDER BY name').all(),
    db.prepare('SELECT * FROM time_slots WHERE active = 1 ORDER BY start_time').all(),
    db.prepare('SELECT * FROM technician_leaves WHERE date BETWEEN ? AND ?').all(from, to),
    db.prepare('SELECT * FROM blocked_dates WHERE date BETWEEN ? AND ?').all(from, to),
    db.prepare(`SELECT b.id, b.ref, b.date, b.slot_id, b.technician_id, b.customer_name, b.status,
                       s.name AS service_name, s.category
                FROM bookings b JOIN services s ON s.id = b.service_id
                WHERE b.date BETWEEN ? AND ? AND b.status IN ${ACTIVE_STATUSES}`).all(from, to),
  ]);
  return { techs, slots, leaves, blocked, bookings, settings: getSettings() };
}

/** Why a date is closed for customers, or null if it is open. */
function closedReason(ctx, dateStr) {
  const today = todayStr();
  const s = ctx.settings;
  if (dateStr < today) return 'Past date';
  if (dateStr > addDays(today, Number(s.booking_window_days || 30))) return 'Beyond booking window';
  if (!csv(s.working_days).includes(String(dayOfWeek(dateStr)))) return 'Closed (weekly holiday)';
  const blocked = ctx.blocked.find((b) => b.date === dateStr);
  if (blocked) return blocked.reason || 'Holiday';
  return null;
}

/**
 * Technicians who can take a job of `category` at date+slot:
 * active, skilled, not on weekly off, not on leave, not already booked.
 * Sorted by fewest jobs that day so work is spread evenly.
 */
function freeTechs(ctx, dateStr, slotId, category, excludeBookingId = 0) {
  const onLeave = new Set(ctx.leaves
    .filter((l) => l.date === dateStr && (l.slot_id == null || l.slot_id === slotId))
    .map((l) => l.technician_id));
  const dayJobs = ctx.bookings.filter((b) => b.date === dateStr && b.technician_id != null && b.id !== excludeBookingId);
  const busy = new Set(dayJobs.filter((b) => b.slot_id === slotId).map((b) => b.technician_id));
  const load = {};
  for (const b of dayJobs) load[b.technician_id] = (load[b.technician_id] || 0) + 1;
  return ctx.techs
    .filter((t) => (!category || techHasSkill(t, category)) && !techWeeklyOff(t, dateStr) && !onLeave.has(t.id) && !busy.has(t.id))
    .sort((a, b) => (load[a.id] || 0) - (load[b.id] || 0));
}

/** Unassigned (pending) jobs at a slot still reserve capacity. */
function unassignedCount(ctx, dateStr, slotId, category) {
  return ctx.bookings.filter((b) => b.date === dateStr && b.slot_id === slotId && b.technician_id == null && b.category === category).length;
}

function slotsFor(ctx, dateStr, category) {
  const closed = closedReason(ctx, dateStr);
  const lead = Number(ctx.settings.min_lead_minutes || 0) * 60_000;
  return {
    date: dateStr,
    closedReason: closed,
    slots: ctx.slots.map((slot) => {
      let reason = closed;
      let remaining = 0;
      if (!reason && slotStartEpoch(dateStr, slot) - lead < Date.now()) reason = 'Time passed';
      if (!reason) {
        remaining = freeTechs(ctx, dateStr, slot.id, category).length - unassignedCount(ctx, dateStr, slot.id, category);
        if (remaining <= 0) reason = 'Fully booked';
      }
      return { id: slot.id, start: slot.start_time, end: slot.end_time, available: !reason, remaining: Math.max(0, remaining), reason };
    }),
  };
}

// ---------------------------------------------------------------------------
// Public API (async)
// ---------------------------------------------------------------------------
export async function freeTechnicians(dateStr, slotId, category, { excludeBookingId = 0 } = {}) {
  return freeTechs(await loadContext(dateStr), dateStr, Number(slotId), category, excludeBookingId);
}

/** Slot list for the customer booking page. */
export async function slotsForDate(dateStr, category) {
  return slotsFor(await loadContext(dateStr), dateStr, category);
}

/** Next N days with open/closed flag for the date picker (one load for the whole window). */
export async function upcomingDates(category) {
  const days = Number(getSettings().booking_window_days || 30);
  const today = todayStr();
  const ctx = await loadContext(today, addDays(today, days));
  const out = [];
  for (let i = 0; i <= days; i++) {
    const date = addDays(today, i);
    const reason = closedReason(ctx, date);
    let open = !reason;
    if (open && category) open = slotsFor(ctx, date, category).slots.some((s) => s.available);
    out.push({ date, open, reason: reason || (open ? null : 'Fully booked') });
  }
  return out;
}

export async function dateClosedReason(dateStr) {
  return closedReason(await loadContext(dateStr), dateStr);
}

/** Admin grid: every technician x every slot for one date. */
export async function availabilityGrid(dateStr) {
  const ctx = await loadContext(dateStr);
  const leaves = ctx.leaves;
  const bookings = ctx.bookings;
  return {
    date: dateStr,
    blocked: ctx.blocked[0] || null,
    closedReason: closedReason(ctx, dateStr),
    slots: ctx.slots.map((s) => ({ id: s.id, start: s.start_time, end: s.end_time })),
    technicians: ctx.techs.map((t) => {
      const fullLeave = leaves.find((l) => l.technician_id === t.id && l.slot_id == null) || null;
      return {
        id: t.id,
        name: t.name,
        skills: csv(t.skills),
        weeklyOff: techWeeklyOff(t, dateStr),
        fullDayLeave: fullLeave,
        cells: ctx.slots.map((s) => {
          const booking = bookings.find((b) => b.technician_id === t.id && b.slot_id === s.id);
          const leave = fullLeave || leaves.find((l) => l.technician_id === t.id && l.slot_id === s.id);
          let state = 'free';
          if (techWeeklyOff(t, dateStr)) state = 'weekly_off';
          if (leave) state = 'leave';
          if (booking) state = 'booked';
          return {
            slotId: s.id, state, leaveId: leave?.id ?? null, fullDay: !!fullLeave,
            booking: booking ? { id: booking.id, ref: booking.ref, customer_name: booking.customer_name, status: booking.status, service_name: booking.service_name } : null,
          };
        }),
      };
    }),
    unassigned: bookings.filter((b) => !b.technician_id)
      .map((b) => ({ id: b.id, ref: b.ref, slot_id: b.slot_id, customer_name: b.customer_name, service_name: b.service_name })),
  };
}
