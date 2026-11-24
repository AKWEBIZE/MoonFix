import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiService } from './api.service';
import { PublicConfig, ServiceItem } from './models';

/** Public config + services, loaded once and shared by public pages. */
@Injectable({ providedIn: 'root' })
export class SiteService {
  private api = inject(ApiService);
  readonly config = signal<PublicConfig | null>(null);
  readonly services = signal<ServiceItem[]>([]);
  readonly loaded = signal(false);

  readonly businessName = computed(() => this.config()?.businessName ?? 'CoolCare Home Services');
  readonly whatsappLink = computed(() =>
    this.waLink('Hi, I would like to book a doorstep service.'),
  );

  constructor() {
    this.api.config().subscribe({ next: (c) => this.config.set(c), error: () => {} });
    this.api.services().subscribe({
      next: (s) => {
        this.services.set(s);
        this.loaded.set(true);
      },
      error: () => this.loaded.set(true),
    });
  }

  waLink(text: string) {
    const n = this.config()?.businessWhatsapp ?? '';
    return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
  }

  phoneDisplay = computed(() => {
    const n = this.config()?.businessWhatsapp ?? '';
    return n.startsWith('91') && n.length === 12
      ? `+91 ${n.slice(2, 7)} ${n.slice(7)}`
      : n
        ? `+${n}`
        : '';
  });
}
