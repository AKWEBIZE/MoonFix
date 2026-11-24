import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { API_BASE } from './app-settings';
import {
  AdminCustomer,
  AvailabilityGrid,
  BlockedDate,
  Booking,
  Dashboard,
  Leave,
  SendResult,
  ServiceItem,
  Settings,
  Technician,
  TimeSlot,
  WaMessage,
} from './models';

@Injectable({ providedIn: 'root' })
export class AdminApiService {
  private http = inject(HttpClient);
  private base = `${API_BASE}/admin`;

  login(username: string, password: string) {
    return this.http.post<{ token: string; username: string }>(`${this.base}/login`, {
      username,
      password,
    });
  }
  me() {
    return this.http.get<{ username: string; whatsappProvider: string; defaultPassword: boolean }>(
      `${this.base}/me`,
    );
  }
  changePassword(currentPassword: string, newPassword: string) {
    return this.http.post(`${this.base}/change-password`, { currentPassword, newPassword });
  }
  dashboard() {
    return this.http.get<Dashboard>(`${this.base}/dashboard`);
  }

  // Bookings
  bookings(filter: Record<string, string>) {
    const params: Record<string, string> = {};
    Object.entries(filter).forEach(([k, v]) => v && (params[k] = v));
    return this.http.get<Booking[]>(`${this.base}/bookings`, { params });
  }
  booking(id: number) {
    return this.http.get<{ booking: Booking; messages: WaMessage[] }>(
      `${this.base}/bookings/${id}`,
    );
  }
  updateBooking(id: number, patch: Partial<Booking> & { notify?: boolean; force?: boolean }) {
    return this.http.patch<{ booking: Booking; messages: (SendResult & { kind: string })[] }>(
      `${this.base}/bookings/${id}`,
      patch,
    );
  }
  freeTechnicians(id: number, date: string, slotId: number) {
    return this.http.get<Technician[]>(`${this.base}/bookings/${id}/technicians`, {
      params: { date, slotId },
    });
  }
  sendWhatsapp(id: number, kind: string, text?: string) {
    return this.http.post<SendResult>(`${this.base}/bookings/${id}/whatsapp`, { kind, text });
  }

  // Availability
  availability(date: string) {
    return this.http.get<AvailabilityGrid>(`${this.base}/availability`, { params: { date } });
  }
  leaves(from: string, to: string) {
    return this.http.get<Leave[]>(`${this.base}/leaves`, { params: { from, to } });
  }
  addLeave(body: {
    technicianId: number;
    date: string;
    toDate?: string;
    slotId?: number | null;
    reason?: string;
  }) {
    return this.http.post<{ created: string[]; clashes: string[] }>(`${this.base}/leaves`, body);
  }
  deleteLeave(id: number) {
    return this.http.delete(`${this.base}/leaves/${id}`);
  }
  blockedDates() {
    return this.http.get<BlockedDate[]>(`${this.base}/blocked-dates`);
  }
  addBlockedDate(date: string, reason: string) {
    return this.http.post<{ ok: boolean; existingBookings: number }>(`${this.base}/blocked-dates`, {
      date,
      reason,
    });
  }
  deleteBlockedDate(id: number) {
    return this.http.delete(`${this.base}/blocked-dates/${id}`);
  }

  // Technicians
  technicians() {
    return this.http.get<Technician[]>(`${this.base}/technicians`);
  }
  saveTechnician(t: Partial<Technician>) {
    return t.id
      ? this.http.put<Technician>(`${this.base}/technicians/${t.id}`, t)
      : this.http.post<Technician>(`${this.base}/technicians`, t);
  }
  deleteTechnician(id: number) {
    return this.http.delete<{ ok: boolean; deactivated: boolean }>(
      `${this.base}/technicians/${id}`,
    );
  }

  // Slots
  slots() {
    return this.http.get<TimeSlot[]>(`${this.base}/slots`);
  }
  saveSlot(s: Partial<TimeSlot>) {
    return s.id
      ? this.http.put<TimeSlot>(`${this.base}/slots/${s.id}`, s)
      : this.http.post<TimeSlot>(`${this.base}/slots`, s);
  }
  deleteSlot(id: number) {
    return this.http.delete<{ ok: boolean; deactivated: boolean }>(`${this.base}/slots/${id}`);
  }

  // Services
  services() {
    return this.http.get<ServiceItem[]>(`${this.base}/services`);
  }
  saveService(s: Partial<ServiceItem>) {
    return s.id
      ? this.http.put<ServiceItem>(`${this.base}/services/${s.id}`, s)
      : this.http.post<ServiceItem>(`${this.base}/services`, s);
  }
  deleteService(id: number) {
    return this.http.delete<{ ok: boolean; deactivated: boolean }>(`${this.base}/services/${id}`);
  }

  // Settings
  settings() {
    return this.http.get<Settings>(`${this.base}/settings`);
  }
  saveSettings(s: Partial<Settings>) {
    return this.http.put<Settings>(`${this.base}/settings`, s);
  }

  // Customers (website accounts)
  customers(q = '') {
    return this.http.get<AdminCustomer[]>(`${this.base}/customers`, { params: q ? { q } : {} });
  }
  resetCustomerPassword(id: number) {
    return this.http.post<{ tempPassword: string; waLink: string }>(
      `${this.base}/customers/${id}/reset-password`,
      {},
    );
  }

  // WhatsApp log
  messages(status = '') {
    return this.http.get<WaMessage[]>(`${this.base}/messages`, {
      params: status ? { status } : {},
    });
  }
  resend(id: number) {
    return this.http.post<SendResult>(`${this.base}/messages/${id}/resend`, {});
  }
  markSent(id: number) {
    return this.http.post(`${this.base}/messages/${id}/mark-sent`, {});
  }
}
