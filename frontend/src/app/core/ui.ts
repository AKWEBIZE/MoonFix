import { Injectable, Pipe, PipeTransform, signal } from '@angular/core';

// ---------- Formatting ----------
export function to12h(hhmm: string | null | undefined): string {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

export function prettyDate(
  date: string | null | undefined,
  opts: Intl.DateTimeFormatOptions = {},
): string {
  if (!date) return '';
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...opts,
  });
}

export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

@Pipe({ name: 'time12' })
export class Time12Pipe implements PipeTransform {
  transform(v: string | null | undefined) {
    return to12h(v);
  }
}

@Pipe({ name: 'prettyDate' })
export class PrettyDatePipe implements PipeTransform {
  transform(v: string | null | undefined, style: 'long' | 'short' = 'long') {
    return style === 'short' ? prettyDate(v, { year: undefined }) : prettyDate(v);
  }
}

@Pipe({ name: 'phone' })
export class PhonePipe implements PipeTransform {
  transform(v: string | null | undefined) {
    if (!v) return '';
    return v.length === 12 && v.startsWith('91') ? `+91 ${v.slice(2, 7)} ${v.slice(7)}` : `+${v}`;
  }
}

// ---------- Toasts ----------
export interface Toast {
  id: number;
  text: string;
  type: 'ok' | 'error' | 'info';
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<Toast[]>([]);
  private seq = 0;

  show(text: string, type: Toast['type'] = 'ok', ms = 3500) {
    const id = ++this.seq;
    this.toasts.update((t) => [...t, { id, text, type }]);
    setTimeout(() => this.dismiss(id), ms);
  }
  ok(text: string) {
    this.show(text, 'ok');
  }
  error(text: string) {
    this.show(text, 'error', 6000);
  }
  info(text: string) {
    this.show(text, 'info');
  }
  dismiss(id: number) {
    this.toasts.update((t) => t.filter((x) => x.id !== id));
  }
}
