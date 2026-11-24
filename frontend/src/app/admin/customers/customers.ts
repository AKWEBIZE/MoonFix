import { Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminApiService } from '../../core/admin-api.service';
import { errMsg } from '../../core/api.service';
import { IconComponent } from '../../core/icon/icon';
import { AdminCustomer } from '../../core/models';
import { PhonePipe, ToastService } from '../../core/ui';

/** Website customer accounts: search, and reset a forgotten password. */
@Component({
  selector: 'app-customers',
  imports: [FormsModule, DatePipe, IconComponent, PhonePipe],
  templateUrl: './customers.html',
  styleUrl: './customers.scss',
})
export class CustomersPage {
  private api = inject(AdminApiService);
  private toast = inject(ToastService);

  list = signal<AdminCustomer[]>([]);
  loading = signal(false);
  q = '';
  /** Result of the last password reset, shown once so it can be sent to the customer */
  reset = signal<{ customer: AdminCustomer; tempPassword: string; waLink: string } | null>(null);

  constructor() {
    this.load();
  }

  load() {
    this.loading.set(true);
    this.api.customers(this.q.trim()).subscribe({
      next: (l) => {
        this.list.set(l);
        this.loading.set(false);
      },
      error: (e) => {
        this.loading.set(false);
        this.toast.error(errMsg(e));
      },
    });
  }

  resetPassword(c: AdminCustomer) {
    const who = `${c.name || 'this customer'}${c.phone ? ' (+' + c.phone + ')' : ''}`;
    if (!confirm(`Reset the password for ${who}? Their old password will stop working.`)) return;
    this.api.resetCustomerPassword(c.id).subscribe({
      next: (r) => {
        this.reset.set({ customer: c, ...r });
        this.load();
      },
      error: (e) => this.toast.error(errMsg(e)),
    });
  }

  copy(text: string) {
    navigator.clipboard?.writeText(text).then(
      () => this.toast.ok('Copied'),
      () => this.toast.error('Could not copy'),
    );
  }

  loginMethods(c: AdminCustomer) {
    const m: string[] = [];
    if (c.hasPassword) m.push('Password');
    if (c.phoneVerified) m.push('WhatsApp');
    if (c.hasGoogle) m.push('Google');
    return m.join(' · ') || '—';
  }
}
