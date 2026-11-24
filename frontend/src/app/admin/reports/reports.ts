import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AdminApiService } from '../../core/admin-api.service';
import { errMsg } from '../../core/api.service';
import { IconComponent } from '../../core/icon/icon';
import { PAYMENT_MODE_LABELS, Report, ReportGroup } from '../../core/models';
import { ToastService } from '../../core/ui';
import { BarChart, ChartBar, rupees } from './bar-chart/bar-chart';

/** Orders, collections and projections for the business. */
@Component({
  selector: 'app-reports',
  imports: [RouterLink, IconComponent, BarChart],
  templateUrl: './reports.html',
  styleUrl: './reports.scss',
})
export class ReportsPage {
  private api = inject(AdminApiService);
  private toast = inject(ToastService);

  groups: { key: ReportGroup; label: string; unit: string }[] = [
    { key: 'day', label: 'Daily', unit: 'day' },
    { key: 'week', label: 'Weekly', unit: 'week' },
    { key: 'month', label: 'Monthly', unit: 'month' },
  ];
  group = signal<ReportGroup>('day');
  report = signal<Report | null>(null);
  loading = signal(false);
  modeLabels = PAYMENT_MODE_LABELS;
  rupees = rupees;

  unit = computed(() => this.groups.find((g) => g.key === this.group())!.unit);

  orderBars = computed<ChartBar[]>(() =>
    (this.report()?.periods ?? []).map((p) => ({
      label: this.short(p.label),
      fullLabel: p.label,
      value: p.orders,
      note: `${p.completed} completed · ${p.cancelled} cancelled`,
    })),
  );
  collectionBars = computed<ChartBar[]>(() =>
    (this.report()?.periods ?? []).map((p) => ({
      label: this.short(p.label),
      fullLabel: p.label,
      value: p.collections,
      note: p.paidJobs
        ? `${p.paidJobs} paid job${p.paidJobs > 1 ? 's' : ''}`
        : 'No payments recorded',
    })),
  );
  /** Last 8 weeks actual + this week and the next 3 projected */
  forecastBars = computed<ChartBar[]>(() => {
    const w = this.report()?.projection.weekly;
    if (!w) return [];
    return [
      ...w.history.map((h) => ({
        label: this.short(h.label),
        fullLabel: h.label,
        value: h.collections,
        note: `${h.orders} orders`,
      })),
      ...w.forecast.map((f) => ({
        label: this.short(f.label),
        fullLabel: f.label,
        value: f.collections,
        projected: true,
        note: f.bookedJobs
          ? `${f.bookedJobs} job${f.bookedJobs > 1 ? 's' : ''} already booked`
          : 'Based on recent trend',
      })),
    ];
  });

  totals = computed(() => {
    const ps = this.report()?.periods ?? [];
    const t = ps.reduce(
      (a, p) => ({
        orders: a.orders + p.orders,
        completed: a.completed + p.completed,
        cancelled: a.cancelled + p.cancelled,
        collections: a.collections + p.collections,
        paidJobs: a.paidJobs + p.paidJobs,
      }),
      { orders: 0, completed: 0, cancelled: 0, collections: 0, paidJobs: 0 },
    );
    return { ...t, avgBill: t.paidJobs ? Math.round(t.collections / t.paidJobs) : 0 };
  });

  /** Newest period first in the table */
  rows = computed(() => [...(this.report()?.periods ?? [])].reverse());

  constructor() {
    this.load();
  }

  setGroup(g: ReportGroup) {
    if (g === this.group()) return;
    this.group.set(g);
    this.load();
  }

  load() {
    this.loading.set(true);
    this.api.reports(this.group()).subscribe({
      next: (r) => {
        this.report.set(r);
        this.loading.set(false);
      },
      error: (e) => {
        this.loading.set(false);
        this.toast.error(errMsg(e));
      },
    });
  }

  /** Shorter labels for chart axes ("Week of 23 Nov" -> "23 Nov") */
  short(label: string) {
    return label.replace('Week of ', '').replace(/^[A-Za-z]{3}, /, ''); // "Thu, 12 Nov" -> "12 Nov"
  }

  share(part: number, whole: number) {
    return whole ? Math.round((part / whole) * 100) : 0;
  }

  /** Download the period table as a CSV file (opens in Excel / Google Sheets). */
  exportCsv() {
    const r = this.report();
    if (!r) return;
    const head = [
      'Period',
      'Orders',
      'Completed',
      'Cancelled',
      'Collections (INR)',
      'Paid jobs',
      'Average bill (INR)',
    ];
    const lines = [
      head,
      ...r.periods.map((p) => [
        p.label,
        p.orders,
        p.completed,
        p.cancelled,
        p.collections,
        p.paidJobs,
        p.avgBill,
      ]),
    ];
    const csv = lines
      .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\r\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `moonfix-report-${r.group}-${r.today}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
