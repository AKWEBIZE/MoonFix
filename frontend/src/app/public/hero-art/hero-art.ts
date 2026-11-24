import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { IconComponent } from '../../core/icon/icon';

/** A booking's journey, cycled live in the hero status card. */
const JOURNEY = [
  { icon: 'check', title: 'Booking confirmed', sub: 'Today · 11:00 AM – 1:00 PM', tone: 'ok' },
  { icon: 'user', title: 'Technician assigned', sub: 'AC expert · 4.9★ rated', tone: 'brand' },
  { icon: 'tool', title: 'Service in progress', sub: 'Cleaning filters & coils', tone: 'accent' },
  { icon: 'star', title: 'Job completed', sub: 'Cooling restored · Pay now', tone: 'violet' },
];

const WA_MESSAGES = [
  'Booking confirmed ✅',
  'Technician details sent',
  'Reminder: visit at 11 AM',
  'How was our service? ⭐',
];

/** Animated hero: AC cooling down, fridge frost, spinning washer with bubbles, a service van, and live status cards. */
@Component({
  selector: 'app-hero-art',
  imports: [IconComponent],
  templateUrl: './hero-art.html',
  styleUrl: './hero-art.scss',
})
export class HeroArt implements OnInit, OnDestroy {
  journey = JOURNEY;
  step = signal(0);
  stage = computed(() => JOURNEY[this.step()]);
  temp = signal(26);
  eta = signal(20);
  waIndex = signal(0);
  waMsg = computed(() => WA_MESSAGES[this.waIndex()]);
  waCount = computed(() => this.waIndex() + 1);

  private timers: ReturnType<typeof setInterval>[] = [];

  ngOnInit() {
    // Booking journey: advance every 2.6s, loop
    this.timers.push(setInterval(() => this.step.update((s) => (s + 1) % JOURNEY.length), 2600));
    // AC cools down from 26°C to 18°C, then restarts
    this.timers.push(setInterval(() => this.temp.update((t) => (t <= 18 ? 26 : t - 1)), 900));
    // ETA counts down
    this.timers.push(setInterval(() => this.eta.update((m) => (m <= 2 ? 20 : m - 1)), 1500));
    // WhatsApp messages rotate
    this.timers.push(
      setInterval(() => this.waIndex.update((i) => (i + 1) % WA_MESSAGES.length), 3200),
    );
  }

  ngOnDestroy() {
    this.timers.forEach(clearInterval);
  }
}
