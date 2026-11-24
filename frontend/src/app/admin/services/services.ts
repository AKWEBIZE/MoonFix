import { Component, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminApiService } from '../../core/admin-api.service';
import { errMsg } from '../../core/api.service';
import { IconComponent } from '../../core/icon/icon';
import { CATEGORY_LABELS, Category, ServiceItem } from '../../core/models';
import { ToastService } from '../../core/ui';

@Component({
  selector: 'app-services',
  imports: [FormsModule, IconComponent, DecimalPipe],
  templateUrl: './services.html',
  styleUrl: './services.scss',
})
export class ServicesPage {
  private api = inject(AdminApiService);
  private toast = inject(ToastService);
  labels = CATEGORY_LABELS;
  categories = Object.keys(CATEGORY_LABELS) as Category[];
  list = signal<ServiceItem[]>([]);
  edit = signal<Partial<ServiceItem> | null>(null);

  constructor() {
    this.load();
  }
  load() {
    this.api.services().subscribe((l) => this.list.set(l));
  }

  save(s: Partial<ServiceItem>) {
    this.api.saveService(s).subscribe({
      next: () => {
        this.toast.ok('Service saved');
        this.edit.set(null);
        this.load();
      },
      error: (e) => this.toast.error(errMsg(e)),
    });
  }

  remove(s: ServiceItem) {
    if (!confirm(`Delete "${s.name}"?`)) return;
    this.api.deleteService(s.id).subscribe((r) => {
      this.toast.ok(
        r.deactivated ? 'Service has bookings, so it was hidden instead' : 'Service deleted',
      );
      this.load();
    });
  }
}
