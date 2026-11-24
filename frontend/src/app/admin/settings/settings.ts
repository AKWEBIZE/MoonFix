import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AdminApiService } from '../../core/admin-api.service';
import { errMsg } from '../../core/api.service';
import { ADMIN_PATH } from '../../core/app-settings';
import { Settings } from '../../core/models';
import { ToastService } from '../../core/ui';

@Component({
  selector: 'app-settings',
  imports: [FormsModule],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
})
export class SettingsPage {
  private api = inject(AdminApiService);
  private toast = inject(ToastService);
  s = signal<Settings | null>(null);
  pw = { current: '', next: '', confirm: '' };
  adminUrl = `${location.origin}/${ADMIN_PATH}`;

  constructor() {
    this.api.settings().subscribe((s) => this.s.set(s));
  }

  flag = (e: Event) => ((e.target as HTMLInputElement).checked ? '1' : '0');

  save(s: Settings) {
    this.api.saveSettings(s).subscribe({
      next: (r) => {
        this.s.set(r);
        this.toast.ok('Settings saved');
      },
      error: (e) => this.toast.error(errMsg(e)),
    });
  }

  changePw() {
    this.api.changePassword(this.pw.current, this.pw.next).subscribe({
      next: () => {
        this.pw = { current: '', next: '', confirm: '' };
        this.toast.ok('Password updated');
        window.dispatchEvent(new Event('admin-password-changed'));
      },
      error: (e) => this.toast.error(errMsg(e)),
    });
  }
}
