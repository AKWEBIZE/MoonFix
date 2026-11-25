import { ApplicationRef, Component, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService, errMsg } from '../../core/api.service';
import { CustomerAuthService } from '../../core/customer';
import { IconComponent } from '../../core/icon/icon';
import {
  CATEGORY_LABELS,
  Category,
  DateOption,
  PublicBooking,
  ServiceItem,
  SlotOption,
} from '../../core/models';
import { SiteService } from '../../core/site.service';
import { PrettyDatePipe, Time12Pipe, localToday, prettyDate, to12h } from '../../core/ui';
import { ApplianceAnim } from '../appliance-anim/appliance-anim';
import { ConfirmBurst, preloadConfirmBurst } from './confirm-burst/confirm-burst';
import { BookingCelebration } from './celebration/celebration';

type Step = 1 | 2 | 3 | 4;

@Component({
  selector: 'app-book',
  imports: [
    ConfirmBurst,
    BookingCelebration,
    FormsModule,
    RouterLink,
    IconComponent,
    DecimalPipe,
    Time12Pipe,
    PrettyDatePipe,
    ApplianceAnim,
  ],
  templateUrl: './book.html',
  styleUrl: './book.scss',
})
export class BookPage implements OnDestroy {
  private api = inject(ApiService);
  private appRef = inject(ApplicationRef);
  /** 3D "Booking confirmed" moment available (else the CSS confetti is used) */
  readonly has3d = (() => {
    try {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
      const c = document.createElement('canvas');
      return !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch {
      return false;
    }
  })();
  private route = inject(ActivatedRoute);
  site = inject(SiteService);
  account = inject(CustomerAuthService);

  labels = CATEGORY_LABELS;
  categories = Object.keys(CATEGORY_LABELS) as Category[];
  stepNames = ['Service', 'Date & time', 'Details', 'Confirm'];

  step = signal<Step>(1);
  category = signal<Category>('AC');
  service = signal<ServiceItem | null>(null);
  dates = signal<DateOption[]>([]);
  date = signal<string | null>(null);
  slots = signal<SlotOption[]>([]);
  slot = signal<SlotOption | null>(null);
  loadingSlots = signal(false);
  submitting = signal(false);
  error = signal('');
  done = signal<PublicBooking | null>(null);
  /** full-screen "Booking confirmed" celebration showing (closed -> the normal confirmed page) */
  celebrate = signal(false);
  match = signal<'idle' | 'searching' | 'found'>('idle');
  today = localToday();
  private matchTimer?: ReturnType<typeof setTimeout>;

  /** How far through the booking the customer is (drives the sidebar meter). */
  progress = computed(() => {
    if (this.done()) return 100;
    let p = 0;
    if (this.service()) p += 25;
    if (this.date()) p += 20;
    if (this.slot()) p += 25;
    if (this.step() >= 4) p += 20;
    return Math.min(p, 100);
  });

  techFreeText = computed(() => {
    const n = this.slot()?.remaining ?? 0;
    return n > 1 ? n + ' experts free in this slot' : 'An expert is free in this slot';
  });

  /** Confetti pieces for the success screen. */
  confetti = Array.from({ length: 36 }, (_, i) => ({
    x: (i * 37) % 100,
    c: [
      'var(--theme-primary)',
      'var(--theme-primary-light)',
      'var(--theme-black)',
      'var(--theme-primary-200)',
      'var(--theme-primary-dark)',
      'var(--theme-star)',
    ][i % 6],
    d: (i % 12) * 90,
    w: 6 + (i % 3) * 3,
    r: (i * 47) % 360,
  }));

  form = {
    customerName: '',
    phone: '',
    address: '',
    landmark: '',
    pincode: '',
    brand: '',
    issue: '',
    whatsappOptin: true,
    website: '', // bot trap (hidden field)
  };

  servicesInCategory = computed(() =>
    this.site.services().filter((s) => s.category === this.category()),
  );
  anySlot = computed(() => this.slots().some((s) => s.available));

  constructor() {
    // Signed-in customers: fill in their name and verified number, so the
    // booking shows up under My Orders.
    const me = this.account.customer();
    if (me) {
      this.form.customerName = me.name;
      if (me.phone)
        this.form.phone =
          me.phone.length === 12 && me.phone.startsWith('91') ? me.phone.slice(2) : me.phone;
    }

    // Short "matching technician" animation whenever a slot is chosen
    effect(() => {
      const sl = this.slot();
      clearTimeout(this.matchTimer);
      if (!sl) {
        this.match.set('idle');
        return;
      }
      this.match.set('searching');
      this.matchTimer = setTimeout(() => this.match.set('found'), 1200);
    });

    const qp = this.route.snapshot.queryParamMap;
    const cat = qp.get('category') as Category | null;
    if (cat && cat in CATEGORY_LABELS) this.category.set(cat);
    const wanted = Number(qp.get('service'));

    // Pre-select a service passed from the home page once services load
    effect(() => {
      const list = this.site.services();
      if (wanted && list.length && !this.service()) {
        const s = list.find((x) => x.id === wanted);
        if (s) {
          this.category.set(s.category);
          this.pickService(s);
        }
      }
    });
  }

  pickService(s: ServiceItem, ev?: Event) {
    if (ev && this.service()?.id !== s.id) {
      const from = (ev.target as HTMLElement).closest('label')?.querySelector<HTMLElement>('.option-body b') ?? null;
      return this.transition('pick', () => this.applyService(s), { from, to: 'service' });
    }
    this.applyService(s);
  }

  private applyService(s: ServiceItem) {
    const changedCategory = this.service()?.category !== s.category;
    this.service.set(s);
    if (changedCategory || !this.dates().length) {
      this.date.set(null);
      this.slot.set(null);
      this.slots.set([]);
      this.dates.set([]);
      this.api.dates(s.id).subscribe((d) => this.dates.set(d));
    }
  }

  pickDate(d: string, ev?: Event) {
    if (ev && this.date() !== d) {
      const from = (ev.currentTarget as HTMLElement | null) ?? null;
      return this.transition('pick', () => this.applyDate(d), { from, to: 'date' });
    }
    this.applyDate(d);
  }

  pickSlot(s: SlotOption, ev?: Event) {
    if (ev && this.slot()?.id !== s.id) {
      const from = (ev.currentTarget as HTMLElement | null) ?? null;
      return this.transition('pick', () => this.slot.set(s), { from, to: 'slot' });
    }
    this.slot.set(s);
  }

  private applyDate(d: string) {
    this.date.set(d);
    this.slot.set(null);
    this.loadSlots();
  }

  private loadSlots() {
    const d = this.date();
    const s = this.service();
    if (!d || !s) return;
    this.loadingSlots.set(true);
    this.api.slots(d, s.id).subscribe({
      next: (r) => {
        this.slots.set(r.slots);
        this.loadingSlots.set(false);
      },
      error: () => this.loadingSlots.set(false),
    });
  }

  goTo(step: Step) {
    if (step >= 2 && !this.service()) return;
    if (step >= 3 && !this.slot()) return;
    if (step === 4 && (!this.form.customerName || !this.form.phone || !this.form.address)) return;
    this.error.set('');
    if (step === 4) preloadConfirmBurst(); // 3D "confirmed" moment ready before they press Confirm
    if (step !== this.step()) {
      this.transition(step > this.step() ? 'step-fwd' : 'step-back', () => this.step.set(step));
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /**
   * Runs a change inside a browser view transition (see styles/_transitions.scss):
   *  - 'step-fwd' / 'step-back': the step pane slides out and the next one slides in
   *  - 'pick' with fly: the picked option flies into its row in the "Your booking" summary
   * Without browser support, or with "reduce motion", the change just happens.
   */
  private vtRunning = false;
  private transition(kind: 'step-fwd' | 'step-back' | 'pick', update: () => void, fly?: { from: HTMLElement | null; to: string }) {
    const doc = document as Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void>; ready: Promise<void>; skipTransition?: () => void } };
    // No support, reduced motion, or a transition still running (a quick second click):
    // just apply the change - never risk losing a pick by stacking transitions.
    if (!doc.startViewTransition || this.vtRunning || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      update();
      return;
    }
    this.vtRunning = true;
    const html = document.documentElement;
    html.dataset['vt'] = kind;
    if (fly?.from) fly.from.style.setProperty('view-transition-name', 'pick-fly');
    const target = () => (fly ? document.querySelector<HTMLElement>(`[data-fly="${fly.to}"]`) : null);
    const vt = doc.startViewTransition(() => {
      fly?.from?.style.removeProperty('view-transition-name');
      update();
      this.appRef.tick(); // render now, so the browser can capture the new state
      target()?.style.setProperty('view-transition-name', 'pick-fly');
    });
    // A transition can be skipped (tab hidden, or a new one started by a quick click): the change
    // still happens, but these promises reject - swallow that so it is not logged as an error.
    vt.ready.catch(() => {});
    // safety net: never let a stalled transition (e.g. a frozen background tab) block the next one
    const guard = setTimeout(() => vt.skipTransition?.(), 1500);
    vt.finished.catch(() => {}).finally(() => {
      clearTimeout(guard);
      this.vtRunning = false;
      delete html.dataset['vt'];
      target()?.style.removeProperty('view-transition-name');
    });
  }

  submit() {
    const s = this.service();
    const sl = this.slot();
    const d = this.date();
    if (!s || !sl || !d) return;
    this.submitting.set(true);
    this.error.set('');
    const started = Date.now();
    this.api.book({ ...this.form, serviceId: s.id, slotId: sl.id, date: d }).subscribe({
      next: (b) => {
        // let the "Confirming..." moment be seen (saving usually takes a split second)
        const motion = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        setTimeout(() => {
          this.done.set(b);
          this.submitting.set(false);
          this.celebrate.set(motion);
          window.scrollTo({ top: 0 });
        }, motion ? Math.max(0, 1000 - (Date.now() - started)) : 0);
      },
      error: (e) => {
        this.submitting.set(false);
        this.error.set(errMsg(e));
        if (e.status === 409) {
          this.slot.set(null);
          this.loadSlots();
          this.api.dates(s.id).subscribe((x) => this.dates.set(x));
        }
      },
    });
  }

  reset() {
    this.done.set(null);
    this.service.set(null);
    this.date.set(null);
    this.slot.set(null);
    this.dates.set([]);
    this.form = { ...this.form, brand: '', issue: '' };
    this.step.set(1);
  }

  ngOnDestroy() {
    clearTimeout(this.matchTimer);
  }

  scrollDates(dir: number) {
    document.querySelector('.date-scroll')?.scrollBy({ left: dir * 300, behavior: 'smooth' });
  }

  dow = (d: string) =>
    prettyDate(d, { weekday: 'short', day: undefined, month: undefined, year: undefined });
  dayNum = (d: string) => d.slice(8);
  mon = (d: string) =>
    prettyDate(d, { month: 'short', weekday: undefined, day: undefined, year: undefined });
  time = to12h;
}
