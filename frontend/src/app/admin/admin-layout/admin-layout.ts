import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { Meta } from '@angular/platform-browser';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AdminApiService } from '../../core/admin-api.service';
import { AuthService } from '../../core/auth';
import { IconComponent } from '../../core/icon/icon';

@Component({
  selector: 'app-admin-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, IconComponent],
  templateUrl: './admin-layout.html',
  styleUrl: './admin-layout.scss',
})
export class AdminLayout implements OnInit, OnDestroy {
  auth = inject(AuthService);
  private meta = inject(Meta);
  navOpen = signal(false);
  /** True while the admin still uses the default password from .env.example */
  defaultPassword = signal(false);
  private api = inject(AdminApiService);

  links = [
    { path: 'dashboard', label: 'Dashboard', icon: 'grid' },
    { path: 'bookings', label: 'Bookings', icon: 'list' },
    { path: 'availability', label: 'Availability', icon: 'calendar' },
    { path: 'reports', label: 'Reports', icon: 'chart' },
    { path: 'customers', label: 'Customers', icon: 'user' },
    { path: 'technicians', label: 'Technicians', icon: 'users' },
    { path: 'slots', label: 'Time slots & days', icon: 'clock' },
    { path: 'services', label: 'Services & prices', icon: 'tool' },
    { path: 'whatsapp', label: 'WhatsApp follow-ups', icon: 'whatsapp' },
    { path: 'settings', label: 'Settings', icon: 'settings' },
  ];

  ngOnInit() {
    this.meta.updateTag({ name: 'robots', content: 'noindex, nofollow' });
    this.refreshPasswordWarning();
    // Settings page tells us when the password has been changed
    window.addEventListener('admin-password-changed', this.onPasswordChanged);
  }
  private onPasswordChanged = () => this.refreshPasswordWarning();

  ngOnDestroy() {
    window.removeEventListener('admin-password-changed', this.onPasswordChanged);
    this.meta.removeTag('name="robots"');
  }

  refreshPasswordWarning() {
    this.api
      .me()
      .subscribe({ next: (m) => this.defaultPassword.set(!!m.defaultPassword), error: () => {} });
  }
}
