import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { errMsg } from '../../core/api.service';
import { CustomerAuthService } from '../../core/customer';
import { GoogleButton } from '../../core/google-button/google-button';
import { IconComponent } from '../../core/icon/icon';
import { CustomerSession } from '../../core/models';
import { SiteService } from '../../core/site.service';
import { ToastService } from '../../core/ui';
import { WaOtp } from '../wa-otp/wa-otp';

@Component({
  selector: 'app-login',
  imports: [RouterLink, IconComponent, GoogleButton, WaOtp],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class LoginPage {
  private auth = inject(CustomerAuthService);
  private router = inject(Router);
  private toast = inject(ToastService);
  site = inject(SiteService);

  private next = this.safeNext(inject(ActivatedRoute).snapshot.queryParamMap.get('next'));
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
    this.toast.ok(`Welcome${s.customer.name ? ', ' + s.customer.name.split(' ')[0] : ''}!`);
    // Google customers confirm their mobile number once on the My Orders page.
    this.router.navigateByUrl(s.customer.needsPhone ? '/account' : this.next);
  }
}
