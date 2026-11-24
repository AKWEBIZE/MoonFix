/**
 * Business reports for the admin panel.
 *
 * - Orders:      counted on the day the booking was PLACED (created_at)
 * - Completed:   counted on the day the job was marked completed
 * - Cancelled:   counted on the day it was cancelled
 * - Collections: money entered by staff (amount_collected), counted on the day it was recorded
 *
 * All dates use the business time zone (APP_TIMEZONE).
 */
import { db } from './db.js';
import { CATEGORIES } from './db.js';
import { addDays, dayOfWeek, todayStr } from './util.js';

const ACTIVE = ['pending', 'confirmed', 'in_progress'];
const GROUPS = { day: 14, week: 12, month: 12 }; // how many periods each view shows

const localDate = (iso) => (iso ? todayStr(Date.parse(iso)) : null);
const mondayOf = (date) => addDays(date, -((dayOfWeek(date) + 6) % 7));
const monthStart = (date) => `${date.slice(0, 7)}-01`;

function bucketOf(date, group) {
  if (!date) return null;
  if (group === 'week') return mondayOf(date);
  if (group === 'month') return monthStart(date);
  return date;
}

function previousBucket(key, group) {
  if (group === 'day') return addDays(key, -1);
  if (group === 'week') return addDays(key, -7);
  const [y, m] = key.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return d.toISOString().slice(0, 10);
}

function nextBucket(key, group) {
  if (group === 'day') return addDays(key, 1);
  if (group === 'week') return addDays(key, 7);
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
}

function labelOf(key, group) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const fmt = (o) => dt.toLocaleDateString('en-IN', { timeZone: 'UTC', ...o });
  if (group === 'month') return fmt({ month: 'short', year: 'numeric' });
  if (group === 'week') return `Week of ${fmt({ day: 'numeric', month: 'short' })}`;
  return fmt({ weekday: 'short', day: 'numeric', month: 'short' });
}

const sum = (list, f) => list.reduce((a, x) => a + (f(x) || 0), 0);
const avg = (list) => (list.length ? Math.round(sum(list, (x) => x) / list.length) : 0);

/** Least-squares straight line through the points; returns predict(x), never below 0. */
function trendLine(values) {
  const n = values.length;
  if (n < 2) return () => (values[0] || 0);
  const xs = values.map((_, i) => i);
  const mx = avg(xs.map((x) => x * 1000)) / 1000;
  const my = sum(values, (v) => v) / n;
  const sxy = sum(xs, (x) => (x - mx) * (values[x] - my));
  const sxx = sum(xs, (x) => (x - mx) ** 2);
  const slope = sxx ? sxy / sxx : 0;
  return (x) => Math.max(0, Math.round(my + slope * (x - mx)));
}

function loadRows() {
  return db.prepare(`
    SELECT b.id, b.created_at, b.date, b.status, b.completed_at, b.cancelled_at,
           b.amount_collected, b.payment_mode, b.paid_at, s.price, s.category
    FROM bookings b JOIN services s ON s.id = b.service_id`).all()
    .map((r) => ({
      ...r,
      orderedOn: localDate(r.created_at),
      completedOn: localDate(r.completed_at),
      cancelledOn: localDate(r.cancelled_at),
      paidOn: r.amount_collected != null ? localDate(r.paid_at || r.completed_at) : null,
    }));
}

/** Totals for one set of buckets (used for the chart rows and the KPI tiles). */
function tally(rows, inBucket) {
  const ordered = rows.filter((r) => inBucket(r.orderedOn));
  const paid = rows.filter((r) => r.amount_collected != null && inBucket(r.paidOn));
  return {
    orders: ordered.length,
    completed: rows.filter((r) => r.status === 'completed' && inBucket(r.completedOn)).length,
    cancelled: rows.filter((r) => r.status === 'cancelled' && inBucket(r.cancelledOn)).length,
    collections: sum(paid, (r) => r.amount_collected),
    paidJobs: paid.length,
  };
}

export function buildReport(groupParam = 'day') {
  const group = GROUPS[groupParam] ? groupParam : 'day';
  const rows = loadRows();
  const today = todayStr();

  // ---------- Periods for the charts and table ----------
  const keys = [bucketOf(today, group)];
  while (keys.length < GROUPS[group]) keys.unshift(previousBucket(keys[0], group));
  const periods = keys.map((key) => {
    const t = tally(rows, (d) => d && bucketOf(d, group) === key);
    return { key, label: labelOf(key, group), current: key === keys[keys.length - 1], ...t,
      avgBill: t.paidJobs ? Math.round(t.collections / t.paidJobs) : 0 };
  });

  // ---------- Today / this week / this month tiles ----------
  const weekKey = mondayOf(today);
  const monthKey = monthStart(today);
  const kpis = {
    today: tally(rows, (d) => d === today),
    week: tally(rows, (d) => d && mondayOf(d) === weekKey),
    month: tally(rows, (d) => d && monthStart(d) === monthKey),
  };

  // ---------- All-time figures ----------
  const paidRows = rows.filter((r) => r.amount_collected != null && r.amount_collected > 0);
  const overallAvgBill = avg(paidRows.map((r) => r.amount_collected));
  const allTime = {
    orders: rows.length,
    collections: sum(paidRows, (r) => r.amount_collected),
    avgBill: overallAvgBill,
    // Completed jobs where nobody has entered the amount yet
    unrecordedPayments: rows.filter((r) => r.status === 'completed' && r.amount_collected == null).length,
  };

  // ---------- Breakdown for the visible range ----------
  const rangeStart = keys[0];
  const inRange = (d) => d && d >= rangeStart && d <= today;
  const byCategory = Object.entries(CATEGORIES).map(([category, label]) => {
    const t = tally(rows.filter((r) => r.category === category), inRange);
    return { category, label, orders: t.orders, collections: t.collections };
  });
  const modes = ['cash', 'upi', 'card', 'other'];
  const byPaymentMode = modes.map((mode) => {
    const list = rows.filter((r) => r.amount_collected != null && (r.payment_mode || 'other') === mode && inRange(r.paidOn));
    return { mode, jobs: list.length, collections: sum(list, (r) => r.amount_collected) };
  });

  // ---------- Projection ----------
  // Expected value of a job = average bill for that appliance, else overall average, else the starting price.
  const avgByCategory = Object.fromEntries(Object.keys(CATEGORIES).map((c) => {
    const list = paidRows.filter((r) => r.category === c).map((r) => r.amount_collected);
    return [c, list.length >= 3 ? avg(list) : 0];
  }));
  const expectedValue = (r) => avgByCategory[r.category] || overallAvgBill || r.price || 0;
  const upcoming = rows.filter((r) => ACTIVE.includes(r.status) && r.date >= today);
  const pipeline = (days) => {
    const end = addDays(today, days - 1);
    const list = upcoming.filter((r) => r.date <= end);
    return { jobs: list.length, expected: sum(list, expectedValue) };
  };

  // This month: collected so far + the larger of (booked jobs left this month) and (recent daily average x days left)
  const nextMonth = nextBucket(monthKey, 'month');
  const daysLeft = Math.round((Date.parse(nextMonth) - Date.parse(today)) / 86_400_000) - 1; // after today
  const last28 = tally(rows, (d) => d && d > addDays(today, -28) && d <= today).collections;
  const dailyRate = last28 / 28;
  // Open jobs from today to month end (today's unfinished jobs still bring money in this month)
  const bookedRestOfMonth = sum(upcoming.filter((r) => r.date >= today && r.date < nextMonth), expectedValue);
  const runRateRestOfMonth = Math.round(dailyRate * daysLeft);
  const monthProjection = {
    collectedSoFar: kpis.month.collections,
    bookedRestOfMonth,
    runRateRestOfMonth,
    projectedTotal: kpis.month.collections + Math.max(bookedRestOfMonth, runRateRestOfMonth),
    daysLeft,
  };

  // Weekly trend: last 8 full weeks -> straight-line forecast for this week and the next 3
  const histKeys = [addDays(weekKey, -7)];
  while (histKeys.length < 8) histKeys.unshift(addDays(histKeys[0], -7));
  const history = histKeys.map((key) => {
    const t = tally(rows, (d) => d && mondayOf(d) === key);
    return { key, label: labelOf(key, 'week'), collections: t.collections, orders: t.orders };
  });
  const lineC = trendLine(history.map((h) => h.collections));
  const lineO = trendLine(history.map((h) => h.orders));
  const forecast = [0, 1, 2, 3].map((i) => {
    const key = addDays(weekKey, 7 * i);
    // Never project less than what is already booked for that week
    const booked = upcoming.filter((r) => mondayOf(r.date) === key);
    return {
      key, label: labelOf(key, 'week'),
      collections: Math.max(lineC(8 + i), sum(booked, expectedValue)),
      orders: Math.max(lineO(8 + i), booked.length),
      bookedJobs: booked.length,
    };
  });
  const historyJobs = sum(history, (h) => h.orders);

  return {
    group, today, periods, kpis, allTime, byCategory, byPaymentMode,
    projection: {
      next7: pipeline(7), next30: pipeline(30), month: monthProjection,
      weekly: { history, forecast },
      lowData: historyJobs < 5 || paidRows.length < 3,
    },
  };
}
