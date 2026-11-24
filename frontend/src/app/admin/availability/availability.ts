import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AdminApiService } from '../../core/admin-api.service';
import { errMsg } from '../../core/api.service';
import { IconComponent } from '../../core/icon/icon';
import {
  AvailabilityGrid,
  BlockedDate,
  CATEGORY_LABELS,
  GridCell,
  Leave,
  Technician,
  TimeSlot,
} from '../../core/models';
import { PrettyDatePipe, Time12Pipe, ToastService, localToday, shiftDate } from '../../core/ui';

@Component({
  selector: 'app-availability',
  imports: [FormsModule, IconComponent, Time12Pipe, PrettyDatePipe],
  templateUrl: './availability.html',
  styleUrl: './availability.scss',
})
export class AvailabilityPage {
  private api = inject(AdminApiService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  today = localToday();
  date = this.today;
  grid = signal<AvailabilityGrid | null>(null);
  techs = signal<Technician[]>([]);
  slots = signal<TimeSlot[]>([]);
  leaves = signal<Leave[]>([]);
  holidays = signal<BlockedDate[]>([]);

  leave: {
    technicianId: number | null;
    date: string;
    toDate: string;
    slotId: number | null;
    reason: string;
  } = {
    technicianId: null,
    date: this.today,
    toDate: this.today,
    slotId: null,
    reason: '',
  };
  holiday = { date: '', reason: '' };

  constructor() {
    this.loadGrid();
    this.loadLists();
    this.api.technicians().subscribe((t) => {
      this.techs.set(t.filter((x) => x.active));
      this.leave.technicianId = this.techs()[0]?.id ?? null;
    });
    this.api.slots().subscribe((s) => this.slots.set(s.filter((x) => x.active)));
  }

  skillText = (skills: string[]) =>
    skills.map((s) => CATEGORY_LABELS[s as keyof typeof CATEGORY_LABELS] ?? s).join(', ');

  move(days: number) {
    this.date = shiftDate(this.date, days);
    this.loadGrid();
  }

  loadGrid() {
    if (!this.date) return;
    this.api.availability(this.date).subscribe((g) => this.grid.set(g));
  }

  loadLists() {
    this.api.leaves(this.today, shiftDate(this.today, 90)).subscribe((l) => this.leaves.set(l));
    this.api
      .blockedDates()
      .subscribe((h) => this.holidays.set(h.filter((x) => x.date >= this.today)));
  }

  private refresh() {
    this.loadGrid();
    this.loadLists();
  }

  cellClick(techId: number, c: GridCell) {
    if (c.state === 'booked' && c.booking) return this.openBooking(c.booking.id);
    if (c.state === 'leave' && c.leaveId) {
      if (c.fullDay && !confirm('This removes the full-day leave. Continue?')) return;
      return this.removeLeave(c.leaveId);
    }
    if (c.state === 'free') this.addLeave(techId, c.slotId);
  }

  addLeave(technicianId: number, slotId: number | null) {
    this.api.addLeave({ technicianId, date: this.date, slotId }).subscribe({
      next: (r) => {
        if (r.clashes.length)
          this.toast.error(
            `Technician already has job(s) ${r.clashes.join(', ')} — please reassign them.`,
          );
        this.refresh();
      },
      error: (e) => this.toast.error(errMsg(e)),
    });
  }

  planLeave() {
    const l = this.leave;
    if (!l.technicianId) return;
    this.api
      .addLeave({
        technicianId: l.technicianId,
        date: l.date,
        toDate: l.toDate,
        slotId: l.slotId,
        reason: l.reason,
      })
      .subscribe({
        next: (r) => {
          this.toast.ok(`Leave added for ${r.created.length} day(s)`);
          if (r.clashes.length)
            this.toast.error(`Existing job(s) need reassignment: ${r.clashes.join(', ')}`);
          this.leave.reason = '';
          this.refresh();
        },
        error: (e) => this.toast.error(errMsg(e)),
      });
  }

  removeLeave(id: number) {
    this.api.deleteLeave(id).subscribe(() => this.refresh());
  }

  blockDay() {
    const reason = prompt('Reason for closing this day (shown to customers)', 'Holiday');
    if (reason === null) return;
    this.api.addBlockedDate(this.date, reason).subscribe((r) => {
      if (r.existingBookings)
        this.toast.error(`Note: ${r.existingBookings} booking(s) already exist on this day.`);
      this.refresh();
    });
  }

  addHoliday() {
    this.api.addBlockedDate(this.holiday.date, this.holiday.reason).subscribe((r) => {
      this.toast.ok('Holiday added');
      if (r.existingBookings)
        this.toast.error(`Note: ${r.existingBookings} booking(s) already exist on that day.`);
      this.holiday = { date: '', reason: '' };
      this.refresh();
    });
  }

  unblock(id: number) {
    this.api.deleteBlockedDate(id).subscribe(() => this.refresh());
  }

  openBooking(id: number) {
    this.router.navigate(['../bookings'], { relativeTo: this.route, queryParams: { open: id } });
  }
}
