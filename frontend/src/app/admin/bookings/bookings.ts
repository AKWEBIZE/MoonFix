import { Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { AdminApiService } from '../../core/admin-api.service';
import { errMsg } from '../../core/api.service';
import { IconComponent } from '../../core/icon/icon';
import {
  Booking,
  BookingStatus,
  SendResult,
  STATUS_LABELS,
  Technician,
  TimeSlot,
  WaMessage,
} from '../../core/models';
import { PhonePipe, PrettyDatePipe, Time12Pipe, ToastService, localToday } from '../../core/ui';

type EditForm = {
  date: string;
  slotId: number;
  technicianId: number | null;
  status: BookingStatus;
  adminNotes: string;
  notify: boolean;
};

@Component({
  selector: 'app-bookings',
  imports: [FormsModule, IconComponent, Time12Pipe, PrettyDatePipe, PhonePipe, DatePipe],
  templateUrl: './bookings.html',
  styleUrl: './bookings.scss',
})
export class BookingsPage {
  private api = inject(AdminApiService);
  private toast = inject(ToastService);

  labels = STATUS_LABELS;
  statusKeys = Object.keys(STATUS_LABELS) as BookingStatus[];
  ranges = [
    { key: 'today', label: 'Today' },
    { key: 'upcoming', label: 'Upcoming' },
    { key: 'date', label: 'Pick date' },
    { key: 'all', label: 'All' },
  ];
  quickKinds = [
    { kind: 'confirmation', label: 'Confirmation' },
    { kind: 'reminder', label: 'Reminder' },
    { kind: 'technician_assigned', label: 'Technician details' },
    { kind: 'on_the_way', label: 'On the way' },
    { kind: 'completed_feedback', label: 'Feedback request' },
    { kind: 'service_followup', label: 'Service follow-up' },
  ];

  range = 'upcoming';
  date = localToday();
  status = '';
  q = '';

  list = signal<Booking[]>([]);
  loading = signal(false);
  sel = signal<Booking | null>(null);
  messages = signal<WaMessage[]>([]);
  slots = signal<TimeSlot[]>([]);
  free = signal<Technician[]>([]);
  allTechs = signal<Technician[]>([]);
  saving = signal(false);
  customText = '';
  edit: EditForm = {
    date: '',
    slotId: 0,
    technicianId: null,
    status: 'pending',
    adminNotes: '',
    notify: true,
  };

  constructor() {
    this.api.slots().subscribe((s) => this.slots.set(s));
    this.api.technicians().subscribe((t) => this.allTechs.set(t));
    this.load();
    const openId = Number(inject(ActivatedRoute).snapshot.queryParamMap.get('open'));
    if (openId) this.open(openId);
  }

  setRange(r: string) {
    this.range = r;
    this.load();
  }

  load() {
    const today = localToday();
    const f: Record<string, string> = { status: this.status, q: this.q.trim() };
    if (this.range === 'today') f['date'] = today;
    if (this.range === 'date') f['date'] = this.date;
    if (this.range === 'upcoming') f['from'] = today;
    this.loading.set(true);
    this.api.bookings(f).subscribe({
      next: (l) => {
        // Upcoming: soonest first
        this.list.set(
          this.range === 'upcoming'
            ? [...l].sort((a, b) => (a.date + a.slotStart).localeCompare(b.date + b.slotStart))
            : l,
        );
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  open(id: number) {
    this.api.booking(id).subscribe(({ booking, messages }) => {
      this.sel.set(booking);
      this.messages.set(messages);
      this.edit = {
        date: booking.date,
        slotId: booking.slotId,
        technicianId: booking.technicianId,
        status: booking.status,
        adminNotes: booking.adminNotes,
        notify: true,
      };
      this.loadFree();
    });
  }

  close() {
    this.sel.set(null);
  }

  loadFree() {
    const b = this.sel();
    if (!b || !this.edit.date) return;
    this.api
      .freeTechnicians(b.id, this.edit.date, this.edit.slotId)
      .subscribe((t) => this.free.set(t));
  }

  isFree = (id: number) => this.free().some((t) => t.id === id);
  techName = (id: number) => this.allTechs().find((t) => t.id === id)?.name ?? 'Technician';

  save(patch?: Partial<EditForm>) {
    const b = this.sel();
    if (!b) return;
    this.saving.set(true);
    this.api.updateBooking(b.id, { ...this.edit, ...patch }).subscribe({
      next: (r) => {
        this.saving.set(false);
        this.toast.ok('Booking updated');
        this.afterSend(r.messages);
        this.open(b.id);
        this.load();
      },
      error: (e) => {
        this.saving.set(false);
        this.toast.error(errMsg(e));
      },
    });
  }

  quickStatus(status: BookingStatus) {
    if (
      status === 'cancelled' &&
      !confirm('Cancel this booking? The customer will be notified on WhatsApp.')
    )
      return;
    this.edit.status = status;
    this.save({ status });
  }

  send(kind: string) {
    const b = this.sel();
    if (!b) return;
    this.api.sendWhatsapp(b.id, kind, kind === 'custom' ? this.customText : undefined).subscribe({
      next: (r) => {
        if (kind === 'custom') this.customText = '';
        this.afterSend([r]);
        this.open(b.id);
      },
      error: (e) => this.toast.error(errMsg(e)),
    });
  }

  /** In manual mode, open the first prepared customer message in WhatsApp straight away. */
  private afterSend(results: SendResult[]) {
    if (!results?.length) return;
    const manual = results.filter((r) => r.status === 'manual');
    const failed = results.filter((r) => r.status === 'failed');
    if (failed.length) this.toast.error(`WhatsApp failed: ${failed[0].error}`);
    else if (manual.length) {
      const w = window.open(manual[0].link, '_blank');
      if (w) {
        w.opener = null;
        this.api.markSent(manual[0].id).subscribe();
      } else this.toast.info('Popup blocked — use the "Open in WhatsApp" button below');
      if (manual.length > 1)
        this.toast.info(`${manual.length - 1} more message(s) ready in WhatsApp follow-ups`);
    } else this.toast.ok('WhatsApp message sent');
  }

  markSent(m: WaMessage) {
    this.api
      .markSent(m.id)
      .subscribe(() =>
        this.messages.update((l) => l.map((x) => (x.id === m.id ? { ...x, status: 'sent' } : x))),
      );
  }
}
