import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../../core/icon/icon';
import { CATEGORY_LABELS, Category } from '../../core/models';
import { RevealDirective } from '../../core/reveal';
import { SiteService } from '../../core/site.service';
import { CountUpDirective } from '../../core/count-up';
import { ApplianceAnim } from '../appliance-anim/appliance-anim';
import { HeroArt } from '../hero-art/hero-art';
import { WaDemo } from '../wa-demo/wa-demo';
import { ScrollStory } from './scroll-story/scroll-story';

// ---------------------------------------------------------------------------
// Marketing content — EDIT THESE before going live.
// The numbers and reviews below are placeholders: replace them with your
// real figures and genuine customer reviews.
// ---------------------------------------------------------------------------
const STATS = [
  { value: '5,000+', label: 'Happy customers' },
  { value: '4.8★', label: 'Average rating' },
  { value: '60 min', label: 'Fastest response' },
  { value: '30 days', label: 'Service warranty' },
];

const REVIEWS = [
  {
    name: 'Customer name',
    area: 'Area, City',
    text: 'Replace this with a real customer review about your AC service.',
    color: 'var(--theme-primary)',
  },
  {
    name: 'Customer name',
    area: 'Area, City',
    text: 'Replace this with a real customer review about your fridge repair.',
    color: 'var(--theme-black-3)',
  },
  {
    name: 'Customer name',
    area: 'Area, City',
    text: 'Replace this with a real customer review about your washing machine service.',
    color: 'var(--theme-primary-dark)',
  },
];

const BRANDS = [
  'LG',
  'Samsung',
  'Voltas',
  'Daikin',
  'Whirlpool',
  'Godrej',
  'Blue Star',
  'Haier',
  'Panasonic',
  'Hitachi',
  'Carrier',
  'IFB',
  'Bosch',
  'Lloyd',
];

const FAQS = [
  {
    q: 'How soon can a technician visit?',
    a: 'Pick any open slot on the booking page — often the same day. Slots shown as available have a technician free for that time.',
  },
  {
    q: 'Do I pay before the visit?',
    a: 'No. You pay only after the job is done. The price shown is the starting/visiting charge; the technician confirms the final quote before starting any work.',
  },
  {
    q: 'Will I get updates on WhatsApp?',
    a: 'Yes. You get a confirmation as soon as you book, technician details, a reminder before the visit and a quick feedback request after the service.',
  },
  {
    q: 'Can I reschedule or cancel?',
    a: 'Yes. Use “Track booking” with your Booking ID and mobile number to cancel, or message us on WhatsApp to reschedule.',
  },
  {
    q: 'Which brands do you service?',
    a: 'All major brands of split & window ACs, single/double-door refrigerators and front-load, top-load & semi-automatic washing machines.',
  },
];

@Component({
  selector: 'app-home',
  imports: [
    RouterLink,
    ScrollStory,
    IconComponent,
    DecimalPipe,
    RevealDirective,
    HeroArt,
    CountUpDirective,
    ApplianceAnim,
    WaDemo,
  ],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class HomePage implements OnInit, OnDestroy {
  site = inject(SiteService);
  tab = signal<Category | 'ALL'>('ALL');
  activeStep = signal(0);
  private stepTimer?: ReturnType<typeof setInterval>;

  waFeatures = [
    {
      icon: 'check',
      title: 'Instant confirmation',
      text: 'Booking ID, date and time slot the moment you book',
    },
    { icon: 'user', title: 'Technician details', text: 'Know who is coming before they arrive' },
    { icon: 'clock', title: 'Visit reminder', text: 'A heads-up shortly before your slot' },
    {
      icon: 'star',
      title: 'Feedback & next service',
      text: 'Rate the job, and a reminder when servicing is due',
    },
  ];

  ngOnInit() {
    this.stepTimer = setInterval(
      () => this.activeStep.update((i) => (i + 1) % this.steps.length),
      2400,
    );
  }

  ngOnDestroy() {
    clearInterval(this.stepTimer);
  }

  categories = (Object.keys(CATEGORY_LABELS) as Category[]).map((key) => ({
    key,
    label: CATEGORY_LABELS[key],
    sub: {
      AC: 'Service · Repair · Gas',
      FRIDGE: 'Repair · Gas refill',
      WASHING_MACHINE: 'Repair · Service',
    }[key],
  }));
  stats = STATS;
  reviews = REVIEWS;
  faqs = FAQS;
  brandsLoop = [...BRANDS, ...BRANDS]; // doubled for a seamless marquee

  steps = [
    {
      icon: 'tool',
      title: 'Choose a service',
      text: 'AC, fridge or washing machine — repair, service or installation.',
    },
    {
      icon: 'calendar',
      title: 'Pick date & time',
      text: 'See live availability and choose a 2-hour slot that fits your day.',
    },
    {
      icon: 'whatsapp',
      title: 'Get WhatsApp updates',
      text: 'Instant confirmation, technician details and a visit reminder.',
    },
    {
      icon: 'home',
      title: 'Fixed at your door',
      text: 'Our expert fixes it at home. Pay only after the job is done.',
    },
  ];

  whys = [
    {
      icon: 'shield',
      title: 'Verified technicians',
      text: 'Background-checked and trained on all major brands.',
    },
    {
      icon: 'rupee',
      title: 'Upfront pricing',
      text: 'Know the price before work starts. No hidden charges.',
    },
    {
      icon: 'clock',
      title: 'On-time visits',
      text: 'Choose your slot — we show up on time, every time.',
    },
    {
      icon: 'star',
      title: 'Genuine spare parts',
      text: 'Quality parts with a warranty on every repair.',
    },
  ];

  visibleServices = computed(() => {
    const t = this.tab();
    const all = this.site.services();
    return t === 'ALL' ? all : all.filter((s) => s.category === t);
  });

  /** The clicked card's appliance picture morphs into the booking page banner (page view transition). */
  morphCard(ev: Event) {
    const card = (ev.currentTarget as HTMLElement).closest('.svc-card');
    card?.querySelector<HTMLElement>('app-appliance-anim')?.style.setProperty('view-transition-name', 'svc-morph');
  }
}
