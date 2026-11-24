import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Meta } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { AdminApiService } from '../../core/admin-api.service';
import { errMsg } from '../../core/api.service';
import { ADMIN_PATH } from '../../core/app-settings';
import { AuthService } from '../../core/auth';
import { IconComponent } from '../../core/icon/icon';

@Component({
  selector: 'app-admin-login',
  imports: [FormsModule, IconComponent],
  templateUrl: './admin-login.html',
  styleUrl: './admin-login.scss',
})
export class AdminLogin implements OnInit, OnDestroy {
  private api = inject(AdminApiService);
  private auth = inject(AuthService);
  private router = inject(Router);
  private meta = inject(Meta);

  username = '';
  password = '';
  loading = signal(false);
  error = signal('');

  ngOnInit() {
    // Hidden page: ask search engines not to index it
    this.meta.updateTag({ name: 'robots', content: 'noindex, nofollow' });
    if (this.auth.loggedIn()) this.router.navigate(['/', ADMIN_PATH, 'panel']);
  }
  ngOnDestroy() {
    this.meta.removeTag('name="robots"');
  }

  submit() {
    this.loading.set(true);
    this.error.set('');
    this.api.login(this.username.trim(), this.password).subscribe({
      next: (r) => {
        this.auth.set(r.token, r.username);
        this.router.navigate(['/', ADMIN_PATH, 'panel']);
      },
      error: (e) => {
        this.error.set(errMsg(e));
        this.loading.set(false);
      },
    });
  }
}
