import { Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { errMsg } from '../../core/api.service';
import { CustomerAuthService } from '../../core/customer';
import { IconComponent } from '../../core/icon/icon';
import { CustomerOrder, CustomerSession, STATUS_LABELS } from '../../core/models';
import { SiteService } from '../../core/site.service';
import { PhonePipe, PrettyDatePipe, Time12Pipe, ToastService, localToday } from '../../core/ui';
import { WaOtp } from '../wa-otp/wa-otp';

const ACTIVE = ['pending', 'confirmed', 'in_progress'];

@Component({
  selector: 'app-account',
  imports: [
    FormsModule,
    RouterLink,
    DecimalPipe,
    IconComponent,
    PrettyDatePipe,
    Time12Pipe,
    PhonePipe,
    WaOtp,
  ],
  templateUrl: './account.html',
  styleUrl: './account.scss',
})
export class AccountPage {
  auth = inject(CustomerAuthService);
  site = inject(SiteService);
  private toast = inject(ToastService);
  statusLabels = STATUS_LABELS;

  me = this.auth.customer;
  orders = signal<CustomerOrder[]>([]);
  loading = signal(false);
  error = signal('');
  tab = signal<'upcoming' | 'past'>('upcoming');
  cancelling = signal<string | null>(null);
  editingName = signal(false);
  nameDraft = '';

  private today = localToday();
  upcoming = computed(() =>
    this.orders()
      .filter((o) => ACTIVE.includes(o.status) && o.date >= this.today)
      .sort((a, b) => (a.date + a.slotStart).localeCompare(b.date + b.slotStart)),
  );
  past = computed(() => this.orders().filter((o) => !this.upcoming().includes(o)));
  shown = computed(() => (this.tab() === 'upcoming' ? this.upcoming() : this.past()));

  constructor() {
    // Refresh the profile (it may have changed on another device), then load orders.
    this.auth.refresh().subscribe({ next: () => this.load(), error: () => {} });
  }

  load() {
    if (this.me()?.needsPhone) return;
    this.loading.set(true);
    this.error.set('');
    this.auth.orders().subscribe({
      next: (list) => {
        this.orders.set(list);
        this.loading.set(false);
        if (!this.upcoming().length && list.length) this.tab.set('past');
      },
      error: (e) => {
        this.loading.set(false);
        this.error.set(errMsg(e));
      },
    });
  }

  phoneLinked(s: CustomerSession) {
    this.toast.ok('Mobile number confirmed');
    if (!s.customer.name) this.startEditName();
    this.load();
  }

  cancel(o: CustomerOrder) {
    if (!confirm(`Cancel booking ${o.ref} for ${o.serviceName}?`)) return;
    this.cancelling.set(o.ref);
    this.auth.cancel(o.ref).subscribe({
      next: (updated) => {
        this.cancelling.set(null);
        this.orders.update((list) => list.map((x) => (x.ref === o.ref ? updated : x)));
        this.toast.ok('Your booking has been cancelled');
      },
      error: (e) => {
        this.cancelling.set(null);
        this.toast.error(errMsg(e));
      },
    });
  }

  startEditName() {
    this.nameDraft = this.me()?.name ?? '';
    this.editingName.set(true);
  }

  saveName() {
    this.auth.saveName(this.nameDraft).subscribe({
      next: () => {
        this.editingName.set(false);
        this.toast.ok('Name saved');
      },
      error: (e) => this.toast.error(errMsg(e)),
    });
  }

  canCancel = (o: CustomerOrder) => o.status === 'pending' || o.status === 'confirmed';
}
