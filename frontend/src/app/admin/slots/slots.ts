import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AdminApiService } from '../../core/admin-api.service';
import { errMsg } from '../../core/api.service';
import { IconComponent } from '../../core/icon/icon';
import { Settings, TimeSlot, WEEKDAYS } from '../../core/models';
import { Time12Pipe, ToastService } from '../../core/ui';

@Component({
  selector: 'app-slots',
  imports: [FormsModule, IconComponent, Time12Pipe],
  templateUrl: './slots.html',
  styleUrl: './slots.scss',
})
export class SlotsPage {
  private api = inject(AdminApiService);
  private toast = inject(ToastService);
  weekdays = WEEKDAYS;
  slots = signal<TimeSlot[]>([]);
  settings = signal<Settings | null>(null);
  days: number[] = [];
  editId = signal<number | null>(null);
  draft: Partial<TimeSlot> = {};
  newSlot = { start: '', end: '' };

  constructor() {
    this.load();
    this.api.settings().subscribe((s) => {
      this.settings.set(s);
      this.days = s.working_days.split(',').filter(Boolean).map(Number);
    });
  }

  load() {
    this.api.slots().subscribe((s) => this.slots.set(s));
  }

  startEdit(s: TimeSlot) {
    this.draft = { ...s };
    this.editId.set(s.id);
  }

  save() {
    this.api.saveSlot(this.draft).subscribe({
      next: () => {
        this.editId.set(null);
        this.load();
        this.toast.ok('Slot saved');
      },
      error: (e) => this.toast.error(errMsg(e)),
    });
  }

  add() {
    this.api.saveSlot({ ...this.newSlot, active: true }).subscribe({
      next: () => {
        this.newSlot = { start: '', end: '' };
        this.load();
        this.toast.ok('Slot added');
      },
      error: (e) => this.toast.error(errMsg(e)),
    });
  }

  remove(s: TimeSlot) {
    if (!confirm('Delete this slot?')) return;
    this.api.deleteSlot(s.id).subscribe((r) => {
      this.toast.ok(
        r.deactivated ? 'Slot has bookings, so it was made inactive instead' : 'Slot deleted',
      );
      this.load();
    });
  }

  toggleDay(d: number) {
    this.days = this.days.includes(d) ? this.days.filter((x) => x !== d) : [...this.days, d].sort();
  }

  saveRules(st: Settings) {
    this.api
      .saveSettings({
        working_days: this.days.join(','),
        booking_window_days: String(st.booking_window_days),
        min_lead_minutes: String(st.min_lead_minutes),
      })
      .subscribe({
        next: (s) => {
          this.settings.set(s);
          this.toast.ok('Booking rules saved');
        },
        error: (e) => this.toast.error(errMsg(e)),
      });
  }
}
