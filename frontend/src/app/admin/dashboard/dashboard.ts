import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AdminApiService } from '../../core/admin-api.service';
import { IconComponent } from '../../core/icon/icon';
import { Dashboard, STATUS_LABELS } from '../../core/models';
import { PhonePipe, PrettyDatePipe, Time12Pipe, shiftDate } from '../../core/ui';

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, IconComponent, Time12Pipe, PrettyDatePipe, PhonePipe],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class DashboardPage {
  private api = inject(AdminApiService);
  d = signal<Dashboard | null>(null);
  labels = STATUS_LABELS;

  week = computed(() => {
    const d = this.d();
    if (!d) return [];
    return Array.from({ length: 7 }, (_, i) => {
      const date = shiftDate(d.today, i);
      const [y, m, dd] = date.split('-').map(Number);
      return {
        date,
        c: d.next7.find((x) => x.date === date)?.c ?? 0,
        label: new Date(y, m - 1, dd).toLocaleDateString('en-IN', { weekday: 'short' }),
      };
    });
  });
  maxDay = computed(() => Math.max(1, ...this.week().map((w) => w.c)));

  constructor() {
    this.load();
  }
  load() {
    this.api.dashboard().subscribe((d) => this.d.set(d));
  }
}
