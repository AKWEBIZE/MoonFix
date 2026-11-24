import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { API_BASE } from './app-settings';
import {
  BookingRequest,
  DateOption,
  PublicBooking,
  PublicConfig,
  ServiceItem,
  SlotOption,
} from './models';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);
  private base = `${API_BASE}/public`;

  config() {
    return this.http.get<PublicConfig>(`${this.base}/config`);
  }
  services() {
    return this.http.get<ServiceItem[]>(`${this.base}/services`);
  }
  dates(serviceId: number) {
    return this.http.get<DateOption[]>(`${this.base}/dates`, { params: { serviceId } });
  }
  slots(date: string, serviceId: number) {
    return this.http.get<{ date: string; closedReason: string | null; slots: SlotOption[] }>(
      `${this.base}/slots`,
      {
        params: { date, serviceId },
      },
    );
  }
  book(req: BookingRequest) {
    return this.http.post<PublicBooking>(`${this.base}/bookings`, req);
  }
  track(ref: string, phone: string) {
    return this.http.post<PublicBooking>(`${this.base}/bookings/track`, { ref, phone });
  }
  cancel(ref: string, phone: string) {
    return this.http.post<PublicBooking>(`${this.base}/bookings/cancel`, { ref, phone });
  }
}

/** Extracts a readable message from an HttpErrorResponse. */
export function errMsg(e: unknown): string {
  const err = e as { error?: { message?: string }; status?: number; message?: string };
  if (err?.status === 0) return 'Cannot reach the server. Please check your internet connection.';
  return err?.error?.message || err?.message || 'Something went wrong';
}
