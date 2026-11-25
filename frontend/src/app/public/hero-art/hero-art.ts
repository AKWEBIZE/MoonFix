import { Component, ElementRef, OnDestroy, OnInit, afterNextRender, computed, effect, signal, viewChild } from '@angular/core';
import { IconComponent } from '../../core/icon/icon';
import type { HeroScene } from '../three/hero-scene';

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

  // ---------- live 3D version ----------
  private canvas = viewChild<ElementRef<HTMLCanvasElement>>('canvas');
  private art = viewChild<ElementRef<HTMLElement>>('art');
  /** true once the 3D scene is drawing (the flat drawing then fades out) */
  threeOn = signal(false);
  private scene: HeroScene | null = null;
  private running = false;
  private raf = 0;
  private visible = true;
  private cleanups: (() => void)[] = [];

  constructor() {
    afterNextRender(() => {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduced || !this.webgl()) return; // keep the flat animated drawing
      // load after the page itself has finished loading, so the hero text shows instantly
      const later = () => ('requestIdleCallback' in window ? requestIdleCallback(() => this.load3d(), { timeout: 2500 }) : setTimeout(() => this.load3d(), 600));
      if (document.readyState === 'complete') later();
      else window.addEventListener('load', later, { once: true });
    });
    // the 3D AC display follows the same cooling countdown as the drawing
    effect(() => {
      const t = this.temp();
      if (this.threeOn()) this.scene?.setTemp(t);
    });
  }

  private webgl() {
    try {
      const c = document.createElement('canvas');
      return !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch {
      return false;
    }
  }

  private async load3d() {
    const canvas = this.canvas()?.nativeElement;
    const art = this.art()?.nativeElement;
    if (!canvas || !art || !canvas.isConnected) return;
    const { createHeroScene } = await import('../three/hero-scene');
    if (!canvas.isConnected) return;
    this.scene = createHeroScene(canvas);
    const fit = () => this.scene?.resize(canvas.clientWidth, canvas.clientHeight);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(canvas);
    // draw only while the hero is on screen
    const io = new IntersectionObserver(([e]) => {
      this.visible = e.isIntersecting;
      if (this.visible) this.run();
    });
    io.observe(art);
    // follow the mouse over the page, or the phone's tilt
    const onMove = (ev: PointerEvent) => {
      const r = art.getBoundingClientRect();
      this.scene?.look(((ev.clientX - r.left) / r.width) * 2 - 1, ((ev.clientY - r.top) / r.height) * 2 - 1);
    };
    const onTilt = (ev: DeviceOrientationEvent) => {
      if (ev.gamma == null || ev.beta == null) return;
      this.scene?.look(ev.gamma / 35, (ev.beta - 45) / 40);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('deviceorientation', onTilt, { passive: true });
    this.cleanups.push(() => {
      ro.disconnect();
      io.disconnect();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('deviceorientation', onTilt);
    });
    this.scene.setTemp(this.temp());
    this.run();
    this.threeOn.set(true);
  }

  private run() {
    if (this.running || !this.scene) return;
    this.running = true;
    const start = performance.now();
    const loop = (now: number) => {
      if (!this.visible || !this.scene) {
        this.running = false;
        return;
      }
      this.scene.frame((now - start) / 1000);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

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
    cancelAnimationFrame(this.raf);
    this.cleanups.forEach((fn) => fn());
    this.scene?.dispose();
    this.scene = null;
  }
}
