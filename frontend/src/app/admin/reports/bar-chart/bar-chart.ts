import { Component, computed, input, signal } from '@angular/core';

export interface ChartBar {
  /** Short label for the x-axis */
  label: string;
  /** Full label for the tooltip (defaults to label) */
  fullLabel?: string;
  value: number;
  /** Projected (forecast) bars are drawn darker with stripes and say "Projected" */
  projected?: boolean;
  /** Extra line in the tooltip, e.g. "3 jobs already booked" */
  note?: string;
}

/** Format rupees the Indian way: ₹1,25,000 (full) or ₹1.3L / ₹12k (compact, for axes). */
export function rupees(v: number, compact = false) {
  if (!compact) return '₹' + Math.round(v).toLocaleString('en-IN');
  if (v >= 10_000_000) return '₹' + +(v / 10_000_000).toFixed(1) + 'Cr';
  if (v >= 100_000) return '₹' + +(v / 100_000).toFixed(1) + 'L';
  if (v >= 1000) return '₹' + +(v / 1000).toFixed(1) + 'k';
  return '₹' + Math.round(v);
}

/** Round the axis top up to a "nice" number (1, 2, 2.5, 5 x 10^n). */
function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/**
 * Simple single-series bar chart (one measure per chart - never two scales).
 * Hover any column for its exact value; the tallest bar is labelled directly.
 */
@Component({
  selector: 'app-bar-chart',
  templateUrl: './bar-chart.html',
  styleUrl: './bar-chart.scss',
})
export class BarChart {
  bars = input.required<ChartBar[]>();
  kind = input<'count' | 'money'>('count');
  height = input(180);
  /** Accessible summary of what the chart shows */
  ariaLabel = input('Bar chart');

  hover = signal<number | null>(null);

  max = computed(() => {
    const top = Math.max(0, ...this.bars().map((b) => b.value));
    return this.kind() === 'count' ? Math.max(niceMax(top), 4) : niceMax(top);
  });
  /** Index of the tallest bar (the only one labelled directly) */
  peak = computed(() => {
    const list = this.bars();
    let best = -1;
    list.forEach((b, i) => {
      if (b.value > 0 && (best < 0 || b.value > list[best].value)) best = i;
    });
    return best;
  });
  /** Show every Nth x-axis label so they never collide */
  labelStep = computed(() => Math.ceil(this.bars().length / 8));
  ticks = computed(() => [1, 0.5, 0].map((f) => this.max() * f));

  /** Every Nth label, plus the last one; drop a label that would sit right next to the last */
  showLabel(i: number) {
    const last = this.bars().length - 1;
    const step = this.labelStep();
    if (i === last) return true;
    return i % step === 0 && last - i >= Math.max(2, step);
  }

  pct(v: number) {
    return Math.max(0, Math.min(100, (v / this.max()) * 100));
  }

  fmt(v: number, compact = false) {
    return this.kind() === 'money' ? rupees(v, compact) : Math.round(v).toLocaleString('en-IN');
  }
}
