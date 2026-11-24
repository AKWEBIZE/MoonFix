import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AdminApiService } from '../../core/admin-api.service';
import { errMsg } from '../../core/api.service';
import { IconComponent } from '../../core/icon/icon';
import { CATEGORY_LABELS, Category, Technician, WEEKDAYS } from '../../core/models';
import { PhonePipe, ToastService } from '../../core/ui';

const blank = (): Partial<Technician> => ({
  name: '',
  phone: '',
  skills: ['AC'],
  weeklyOff: [0],
  active: true,
});

@Component({
  selector: 'app-technicians',
  imports: [FormsModule, IconComponent, PhonePipe],
  templateUrl: './technicians.html',
  styleUrl: './technicians.scss',
})
export class TechniciansPage {
  private api = inject(AdminApiService);
  private toast = inject(ToastService);
  labels = CATEGORY_LABELS;
  categories = Object.keys(CATEGORY_LABELS) as Category[];
  weekdays = WEEKDAYS;
  list = signal<Technician[]>([]);
  edit = signal<Partial<Technician> | null>(null);
  blankTech = blank;

  constructor() {
    this.load();
  }
  load() {
    this.api.technicians().subscribe((l) => this.list.set(l));
  }

  copy = (t: Technician): Partial<Technician> => ({
    ...t,
    skills: [...t.skills],
    weeklyOff: [...t.weeklyOff],
  });
  offText = (days: number[]) => (days.length ? days.map((d) => WEEKDAYS[d]).join(', ') : '—');

  toggle<T>(arr: T[], v: T) {
    const i = arr.indexOf(v);
    if (i >= 0) arr.splice(i, 1);
    else arr.push(v);
  }

  save(t: Partial<Technician>) {
    this.api.saveTechnician(t).subscribe({
      next: () => {
        this.toast.ok('Technician saved');
        this.edit.set(null);
        this.load();
      },
      error: (e) => this.toast.error(errMsg(e)),
    });
  }

  remove(t: Technician) {
    if (!confirm(`Remove ${t.name}?`)) return;
    this.api.deleteTechnician(t.id).subscribe({
      next: (r) => {
        this.toast.ok(
          r.deactivated
            ? 'Technician marked inactive (kept for booking history)'
            : 'Technician deleted',
        );
        this.load();
      },
      error: (e) => this.toast.error(errMsg(e)),
    });
  }
}
