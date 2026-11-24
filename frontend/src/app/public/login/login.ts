import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { errMsg } from '../../core/api.service';
import { CustomerAuthService } from '../../core/customer';
import { GoogleButton } from '../../core/google-button/google-button';
import { IconComponent } from '../../core/icon/icon';
import { CustomerSession } from '../../core/models';
import { SiteService } from '../../core/site.service';
import { ToastService } from '../../core/ui';
import { WaOtp } from '../wa-otp/wa-otp';

type Mode = 'login' | 'register';

@Component({
  selector: 'app-login',
  imports: [FormsModule, RouterLink, IconComponent, GoogleButton, WaOtp],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class LoginPage {
  private auth = inject(CustomerAuthService);
  private router = inject(Router);
  private toast = inject(ToastService);
  site = inject(SiteService);

  private route = inject(ActivatedRoute);
  private next = this.safeNext(this.route.snapshot.queryParamMap.get('next'));

  mode = signal<Mode>(
    this.route.snapshot.queryParamMap.get('mode') === 'register' ? 'register' : 'login',
  );
  form = { name: '', phone: '', password: '', confirm: '' };
  showPassword = signal(false);
  busy = signal(false);
  error = signal('');

  googleBusy = signal(false);
  googleError = signal('');

  constructor() {
    if (this.auth.loggedIn()) this.router.navigateByUrl(this.next);
  }

  /** Only allow returning to a page on this site. */
  private safeNext(n: string | null) {
    return n && n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/login')
      ? n
      : '/account';
  }

  setMode(m: Mode) {
    this.mode.set(m);
    this.error.set('');
    this.form.password = '';
    this.form.confirm = '';
  }

  /** Same rule as the server: 8+ characters with letters and numbers. */
  strongEnough(p: string) {
    return p.length >= 8 && /[A-Za-z]/.test(p) && /[0-9]/.test(p);
  }

  canSubmit() {
    const f = this.form;
    const phoneOk = f.phone.replace(/\D/g, '').length >= 10;
    if (this.mode() === 'login') return phoneOk && f.password.length > 0;
    return (
      phoneOk &&
      f.name.trim().length >= 2 &&
      this.strongEnough(f.password) &&
      f.password === f.confirm
    );
  }

  submit() {
    if (!this.canSubmit() || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    const f = this.form;
    const req =
      this.mode() === 'login'
        ? this.auth.login(f.phone, f.password)
        : this.auth.register(f.name.trim(), f.phone, f.password);
    req.subscribe({
      next: (s) => this.done(s),
      error: (e) => {
        this.busy.set(false);
        this.error.set(errMsg(e));
      },
    });
  }

  forgotLink() {
    const digits = this.form.phone.replace(/\D/g, '');
    return this.site.waLink(
      `Hi, I forgot my ${this.site.businessName()} login password.` +
        (digits ? ` My mobile number is ${digits}.` : ''),
    );
  }

  onGoogle(credential: string) {
    this.googleBusy.set(true);
    this.googleError.set('');
    this.auth.google(credential).subscribe({
      next: (s) => this.done(s),
      error: (e) => {
        this.googleBusy.set(false);
        this.googleError.set(errMsg(e));
      },
    });
  }

  done(s: CustomerSession) {
    this.busy.set(false);
    this.toast.ok(`Welcome${s.customer.name ? ', ' + s.customer.name.split(' ')[0] : ''}!`);
    // Google customers confirm their mobile number once on the My Orders page.
    this.router.navigateByUrl(s.customer.needsPhone ? '/account' : this.next);
  }
}
