import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService, errMsg } from '../../core/api.service';
import { IconComponent } from '../../core/icon/icon';
import { PublicBooking, STATUS_LABELS } from '../../core/models';
import { SiteService } from '../../core/site.service';
import { PrettyDatePipe, Time12Pipe, ToastService } from '../../core/ui';

@Component({
  selector: 'app-track',
  imports: [FormsModule, RouterLink, IconComponent, PrettyDatePipe, Time12Pipe],
  templateUrl: './track.html',
  styleUrl: './track.scss',
})
export class TrackPage {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  site = inject(SiteService);
  statusLabels = STATUS_LABELS;

  ref = inject(ActivatedRoute).snapshot.queryParamMap.get('ref') ?? '';
  phone = '';
  loading = signal(false);
  error = signal('');
  booking = signal<PublicBooking | null>(null);

  timeline = [
    { key: 'pending', label: 'Booked' },
    { key: 'confirmed', label: 'Technician assigned' },
    { key: 'in_progress', label: 'On the way / in progress' },
    { key: 'completed', label: 'Completed' },
  ];
  progress = computed(() => this.timeline.findIndex((t) => t.key === this.booking()?.status));

  find() {
    this.loading.set(true);
    this.error.set('');
    this.api.track(this.ref.trim(), this.phone).subscribe({
      next: (b) => {
        this.booking.set(b);
        this.loading.set(false);
      },
      error: (e) => {
        this.booking.set(null);
        this.error.set(errMsg(e));
        this.loading.set(false);
      },
    });
  }

  cancel() {
    if (!confirm('Cancel this booking?')) return;
    this.loading.set(true);
    this.api.cancel(this.ref.trim(), this.phone).subscribe({
      next: (b) => {
        this.booking.set(b);
        this.loading.set(false);
        this.toast.ok('Your booking has been cancelled');
      },
      error: (e) => {
        this.loading.set(false);
        this.toast.error(errMsg(e));
      },
    });
  }
}
