import { HttpClient, HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, tap, throwError } from 'rxjs';
import { API_BASE } from './app-settings';
import { Customer, CustomerOrder, CustomerSession, OtpStart } from './models';

const KEY = 'svc_customer_session';

/** The signed-in customer (kept in localStorage so they stay logged in for 30 days). */
@Injectable({ providedIn: 'root' })
export class CustomerAuthService {
  private http = inject(HttpClient);
  private router = inject(Router);
  private base = `${API_BASE}/customer`;
  private session = signal<CustomerSession | null>(this.read());

  readonly customer = computed(() => this.session()?.customer ?? null);
  readonly loggedIn = computed(() => !!this.session());
  readonly firstName = computed(() => {
    const c = this.customer();
    return (c?.name || c?.email || '').split(/[\s@]/)[0] || 'Account';
  });
  get token() {
    return this.session()?.token ?? null;
  }

  private read(): CustomerSession | null {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const s = JSON.parse(raw) as CustomerSession;
      const payload = JSON.parse(atob(s.token.split('.')[1]));
      return payload.exp * 1000 > Date.now() ? s : null;
    } catch {
      return null;
    }
  }

  set(s: CustomerSession) {
    localStorage.setItem(KEY, JSON.stringify(s));
    this.session.set(s);
  }

  private updateCustomer(customer: Customer) {
    const s = this.session();
    if (s) this.set({ ...s, customer });
  }

  logout(redirect = true) {
    localStorage.removeItem(KEY);
    this.session.set(null);
    if (redirect) this.router.navigate(['/']);
  }

  // ---------- API ----------
  startOtp(phone: string, purpose: 'login' | 'link') {
    const url = purpose === 'login' ? `${this.base}/otp/start` : `${this.base}/phone/start`;
    return this.http.post<OtpStart>(url, { phone });
  }
  otpStatus(requestId: string) {
    return this.http.get<{ status: 'waiting' | 'sent' | 'used' | 'expired' }>(
      `${this.base}/otp/${requestId}/status`,
    );
  }
  verifyOtp(requestId: string, code: string, purpose: 'login' | 'link') {
    const url = purpose === 'login' ? `${this.base}/otp/verify` : `${this.base}/phone/verify`;
    return this.http.post<CustomerSession>(url, { requestId, code }).pipe(tap((s) => this.set(s)));
  }
  register(name: string, phone: string, password: string) {
    return this.http
      .post<CustomerSession>(`${this.base}/register`, { name, phone, password })
      .pipe(tap((s) => this.set(s)));
  }
  login(phone: string, password: string) {
    return this.http
      .post<CustomerSession>(`${this.base}/login`, { phone, password })
      .pipe(tap((s) => this.set(s)));
  }
  changePassword(currentPassword: string, newPassword: string) {
    return this.http
      .post<Customer>(`${this.base}/password`, { currentPassword, newPassword })
      .pipe(tap((c) => this.updateCustomer(c)));
  }
  google(credential: string) {
    return this.http
      .post<CustomerSession>(`${this.base}/google`, { credential })
      .pipe(tap((s) => this.set(s)));
  }
  refresh() {
    return this.http.get<Customer>(`${this.base}/me`).pipe(tap((c) => this.updateCustomer(c)));
  }
  saveName(name: string) {
    return this.http
      .patch<Customer>(`${this.base}/me`, { name })
      .pipe(tap((c) => this.updateCustomer(c)));
  }
  orders() {
    return this.http.get<CustomerOrder[]>(`${this.base}/bookings`);
  }
  cancel(ref: string) {
    return this.http.post<CustomerOrder>(`${this.base}/bookings/${ref}/cancel`, {});
  }
}

/**
 * Adds the customer token to /api/customer calls (logs out when it has expired), and to new
 * bookings so a booking made while logged in is saved to the customer's account.
 */
export const customerInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(CustomerAuthService);
  const router = inject(Router);
  const isCustomer = req.url.includes('/api/customer/');
  const isBooking = req.method === 'POST' && req.url.endsWith('/api/public/bookings');
  const token = auth.token;
  const r =
    (isCustomer || isBooking) && token
      ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
      : req;
  return next(r).pipe(
    catchError((e: HttpErrorResponse) => {
      if (isCustomer && token && e.status === 401) {
        auth.logout(false);
        router.navigate(['/login'], { queryParams: { next: location.pathname } });
      }
      return throwError(() => e);
    }),
  );
};

export const customerGuard: CanActivateFn = (_route, state) => {
  const auth = inject(CustomerAuthService);
  return auth.loggedIn()
    ? true
    : inject(Router).createUrlTree(['/login'], { queryParams: { next: state.url } });
};
