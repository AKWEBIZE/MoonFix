import { Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AdminApiService } from '../../core/admin-api.service';
import { errMsg } from '../../core/api.service';
import { IconComponent } from '../../core/icon/icon';
import { WaMessage } from '../../core/models';
import { PhonePipe, ToastService } from '../../core/ui';

@Component({
  selector: 'app-messages',
  imports: [FormsModule, RouterLink, IconComponent, DatePipe, PhonePipe],
  templateUrl: './messages.html',
  styleUrl: './messages.scss',
})
export class MessagesPage {
  private api = inject(AdminApiService);
  private toast = inject(ToastService);
  list = signal<WaMessage[]>([]);
  provider = signal('none');
  status = 'manual';
  filtersList = [
    { key: 'manual', label: 'To send' },
    { key: 'received', label: 'Customer messages' },
    { key: 'failed', label: 'Failed' },
    { key: 'sent', label: 'Sent' },
    { key: '', label: 'All' },
  ];
  statusLabels: Record<WaMessage['status'], string> = {
    manual: 'to send',
    sent: 'sent ✓',
    delivered: 'delivered ✓✓',
    read: 'read ✓✓',
    failed: 'failed',
    received: 'received',
  };

  constructor() {
    this.api.me().subscribe((m) => {
      this.provider.set(m.whatsappProvider);
      if (m.whatsappProvider !== 'none' && this.status === 'manual') {
        this.status = '';
        this.load();
      }
    });
    this.load();
  }

  load() {
    this.api.messages(this.status).subscribe((l) => this.list.set(l));
  }

  markSent(m: WaMessage) {
    this.api.markSent(m.id).subscribe(() => {
      this.list.update((l) =>
        this.status === 'manual'
          ? l.filter((x) => x.id !== m.id)
          : l.map((x) => (x.id === m.id ? { ...x, status: 'sent' as const } : x)),
      );
    });
  }

  resend(m: WaMessage) {
    this.api.resend(m.id).subscribe({
      next: (r) => {
        r.status === 'sent' ? this.toast.ok('Sent') : this.toast.error(r.error || 'Failed again');
        this.load();
      },
      error: (e) => this.toast.error(errMsg(e)),
    });
  }
}
