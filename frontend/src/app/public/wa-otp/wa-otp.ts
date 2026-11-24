import {
  Component,
  DestroyRef,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { errMsg } from '../../core/api.service';
import { CustomerAuthService } from '../../core/customer';
import { IconComponent } from '../../core/icon/icon';
import { CustomerSession, OtpStart } from '../../core/models';

type Step = 'phone' | 'whatsapp' | 'code';

/**
 * Free WhatsApp OTP:
 *  1. customer enters their number
 *  2. taps "Open WhatsApp" and sends the ready-made message to the business
 *  3. our WhatsApp replies with a 6-digit code, which they type here
 */
@Component({
  selector: 'app-wa-otp',
  imports: [FormsModule, IconComponent],
  templateUrl: './wa-otp.html',
  styleUrl: './wa-otp.scss',
})
export class WaOtp {
  /** login = sign in with the number; link = confirm the number for a Google account */
  purpose = input<'login' | 'link'>('login');
  submitLabel = input('Get OTP on WhatsApp');
  verified = output<CustomerSession>();

  private auth = inject(CustomerAuthService);
  private codeInput = viewChild<ElementRef<HTMLInputElement>>('codeInput');

  step = signal<Step>('phone');
  phone = '';
  code = '';
  busy = signal(false);
  error = signal('');
  start = signal<OtpStart | null>(null);
  codeArrived = signal(false);

  private poll?: ReturnType<typeof setInterval>;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stopPolling());
  }

  phoneLooksValid() {
    const d = this.phone.replace(/\D/g, '');
    return d.length >= 10 && d.length <= 15;
  }

  prettyPhone(p: string) {
    return p.length === 12 && p.startsWith('91') ? `+91 ${p.slice(2, 7)} ${p.slice(7)}` : `+${p}`;
  }

  requestCode() {
    this.error.set('');
    this.busy.set(true);
    this.auth.startOtp(this.phone, this.purpose()).subscribe({
      next: (s) => {
        this.busy.set(false);
        this.start.set(s);
        this.code = '';
        if (s.mode === 'dev') {
          this.codeArrived.set(true);
          this.goToCode();
        } else {
          this.codeArrived.set(false);
          this.step.set('whatsapp');
          this.startPolling(s.requestId);
        }
      },
      error: (e) => {
        this.busy.set(false);
        this.error.set(errMsg(e));
      },
    });
  }

  /** Watches for our WhatsApp reply so the code box opens by itself. */
  private startPolling(requestId: string) {
    this.stopPolling();
    this.poll = setInterval(() => {
      this.auth.otpStatus(requestId).subscribe({
        next: ({ status }) => {
          if (status === 'sent') {
            this.codeArrived.set(true);
            if (this.step() === 'whatsapp') this.goToCode();
          } else if (status === 'expired') {
            this.stopPolling();
            this.error.set('This request has expired. Please try again.');
            this.step.set('phone');
          }
        },
        error: () => {},
      });
    }, 2500);
  }

  private stopPolling() {
    clearInterval(this.poll);
    this.poll = undefined;
  }

  goToCode() {
    this.step.set('code');
    setTimeout(() => this.codeInput()?.nativeElement.focus(), 50);
  }

  onCodeInput() {
    this.code = this.code.replace(/\D/g, '').slice(0, 6);
    if (this.code.length === 6) this.verify();
  }

  verify() {
    const s = this.start();
    if (!s || this.code.length !== 6 || this.busy()) return;
    this.error.set('');
    this.busy.set(true);
    this.auth.verifyOtp(s.requestId, this.code, this.purpose()).subscribe({
      next: (session) => {
        this.busy.set(false);
        this.stopPolling();
        this.verified.emit(session);
      },
      error: (e) => {
        this.busy.set(false);
        this.code = '';
        this.error.set(errMsg(e));
      },
    });
  }

  changeNumber() {
    this.stopPolling();
    this.error.set('');
    this.code = '';
    this.start.set(null);
    this.step.set('phone');
  }
}
