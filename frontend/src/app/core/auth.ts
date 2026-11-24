import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { ADMIN_PATH } from './app-settings';

const KEY = 'svc_admin_session';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private router = inject(Router);
  private session = signal<{ token: string; username: string } | null>(this.read());

  readonly loggedIn = computed(() => !!this.session());
  readonly username = computed(() => this.session()?.username ?? '');
  get token() {
    return this.session()?.token ?? null;
  }

  private read() {
    try {
      const raw = sessionStorage.getItem(KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      const payload = JSON.parse(atob(s.token.split('.')[1]));
      return payload.exp * 1000 > Date.now() ? s : null;
    } catch {
      return null;
    }
  }

  set(token: string, username: string) {
    const s = { token, username };
    sessionStorage.setItem(KEY, JSON.stringify(s));
    this.session.set(s);
  }

  logout(redirect = true) {
    sessionStorage.removeItem(KEY);
    this.session.set(null);
    if (redirect) this.router.navigate(['/', ADMIN_PATH]);
  }
}

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const isAdmin = req.url.includes('/api/admin/') && !req.url.endsWith('/login');
  const token = auth.token;
  const r =
    isAdmin && token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;
  return next(r).pipe(
    catchError((e: HttpErrorResponse) => {
      if (isAdmin && e.status === 401) auth.logout();
      return throwError(() => e);
    }),
  );
};

export const adminGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.loggedIn() ? true : inject(Router).createUrlTree(['/', ADMIN_PATH]);
};
