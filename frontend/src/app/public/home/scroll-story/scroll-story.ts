import { afterNextRender, Component, computed, DestroyRef, ElementRef, inject, signal, viewChild } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { SiteService } from '../../../core/site.service';
import { Category, ServiceItem } from '../../../core/models';
import { card, chapterAt, CHAPTER_SPAN, clamp01, ease, local, outroAt, seg, words } from './story-timeline';
import type { StoryScene } from './story-scene';

interface Chapter {
  key: Category;
  short: string;
  title: string;
  tagline: string;
  left: string;
  right: string;
  items: ServiceItem[];
}

const CHAPTER_TEXT: Omit<Chapter, 'items'>[] = [
  { key: 'AC', short: 'AC', title: 'Air conditioners', tagline: 'Service, gas refill, repair and installation for split & window ACs.', left: 'Cool', right: 'again.' },
  { key: 'FRIDGE', short: 'Fridge', title: 'Refrigerators', tagline: 'Cooling problems, gas charging and repairs for single & double door fridges.', left: 'Fresh', right: 'again.' },
  { key: 'WASHING_MACHINE', short: 'Washer', title: 'Washing machines', tagline: 'Front load, top load and semi-automatic: repairs and full servicing.', left: 'Clean', right: 'again.' },
];

/**
 * 3D scroll story on the home page: the visitor scrolls and an AC, a fridge and a washing machine
 * (real 3D, Three.js) turn, open and move while big words, service cards and colour wipes follow.
 * The Three.js code is only downloaded when the section comes near the screen. People who prefer
 * reduced motion, or whose device has no WebGL, get a simple static version instead.
 */
@Component({
  selector: 'app-scroll-story',
  imports: [RouterLink, DecimalPipe],
  templateUrl: './scroll-story.html',
  styleUrl: './scroll-story.scss',
})
export class ScrollStory {
  private site = inject(SiteService);
  private host = inject(ElementRef<HTMLElement>);
  private section = viewChild<ElementRef<HTMLElement>>('section');
  private canvas = viewChild<ElementRef<HTMLCanvasElement>>('canvas');

  /** 'loading' until we know whether 3D can run, then '3d' or 'static' */
  mode = signal<'loading' | '3d' | 'static'>('loading');

  chapters = computed<Chapter[]>(() => {
    const all = this.site.services();
    return CHAPTER_TEXT.map((c) => ({ ...c, items: all.filter((s) => s.category === c.key).slice(0, 3) }));
  });

  private scene: StoryScene | null = null;
  private loading: Promise<void> | null = null;
  private running = false;
  private raf = 0;
  private progress = 0; // smoothed
  private start = performance.now();
  private last = performance.now();
  private observer?: IntersectionObserver;
  private resizeObs?: ResizeObserver;

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.mode.set(reduced || !this.webglAvailable() ? 'static' : '3d');
      if (this.mode() === '3d') queueMicrotask(() => this.watch());
    });
    destroyRef.onDestroy(() => {
      this.stop();
      this.observer?.disconnect();
      this.resizeObs?.disconnect();
      this.scene?.dispose();
    });
  }

  private webglAvailable() {
    try {
      const c = document.createElement('canvas');
      return !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch {
      return false;
    }
  }

  /** Start loading the 3D scene when the section is near, run the loop only while it is on screen */
  private watch() {
    const el = this.section()?.nativeElement;
    if (!el) return;
    this.observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          this.load().then(() => this.run());
        } else this.stop();
      },
      { rootMargin: '600px 0px' },
    );
    this.observer.observe(el);
  }

  private load() {
    this.loading ??= import('./story-scene').then(({ createStoryScene }) => {
      const canvas = this.canvas()!.nativeElement;
      this.scene = createStoryScene(canvas);
      const fit = () => this.scene?.resize(canvas.clientWidth, canvas.clientHeight);
      fit();
      this.resizeObs = new ResizeObserver(fit);
      this.resizeObs.observe(canvas);
      this.host.nativeElement.classList.add('ready');
    });
    return this.loading;
  }

  private run() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const frame = (now: number) => {
      if (!this.running) return;
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      // ease toward the scroll position: gives the soft, weighty motion of the video
      const target = this.scrollProgress();
      this.progress += (target - this.progress) * Math.min(1, dt * 5);
      if (Math.abs(target - this.progress) < 0.0002) this.progress = target;
      this.paint(this.progress);
      this.scene?.update(this.progress, (now - this.start) / 1000);
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  private stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private scrollProgress() {
    const el = this.section()!.nativeElement;
    const total = el.offsetHeight - window.innerHeight;
    return total > 0 ? clamp01(-el.getBoundingClientRect().top / total) : 0;
  }

  /** Page layer: colour wipes, sliding words, cards, counters, outro, chapter dots */
  private paint(p: number) {
    const root = this.section()!.nativeElement;
    const q = (sel: string) => root.querySelectorAll<HTMLElement>(sel);

    // colour wipe spreading out from the appliance at the end of each chapter
    q('.bg-wipe').forEach((bg, k) => {
      const r = ease(seg(p, (k + 1) * CHAPTER_SPAN - 0.035, (k + 1) * CHAPTER_SPAN + 0.02)) * 150;
      bg.style.clipPath = `circle(${r.toFixed(2)}% at 50% 48%)`;
    });

    q('.words').forEach((w) => {
      const i = Number(w.dataset['ch']);
      const v = words(local(p, i));
      w.style.visibility = v > 0.001 ? 'visible' : 'hidden';
      const [l, r] = Array.from(w.children) as HTMLElement[];
      l.style.transform = `translate3d(${((1 - v) * -60).toFixed(2)}vw,0,0)`;
      r.style.transform = `translate3d(${((1 - v) * 60).toFixed(2)}vw,0,0)`;
      l.style.opacity = r.style.opacity = v.toFixed(3);
    });

    q('.cards').forEach((group) => {
      const i = Number(group.dataset['ch']);
      const lq = local(p, i);
      group.style.visibility = lq > 0.3 && lq < 1 ? 'visible' : 'hidden';
      Array.from(group.children).forEach((c, k) => {
        const el = c as HTMLElement;
        const v = card(lq, k);
        el.style.opacity = v.toFixed(3);
        el.style.transform = `translate3d(${((1 - v) * 48).toFixed(1)}px, ${((1 - v) * 18).toFixed(1)}px, 0)`;
        el.style.pointerEvents = v > 0.6 ? 'auto' : 'none';
        // price counts up as the card arrives
        const num = el.querySelector<HTMLElement>('[data-to]');
        if (num) {
          const to = Number(num.dataset['to']);
          const shown = Math.round(to * ease(seg(lq, 0.46 + k * 0.07, 0.64 + k * 0.07)));
          const txt = shown.toLocaleString('en-IN');
          if (num.textContent !== txt) num.textContent = txt;
        }
      });
    });

    const o = outroAt(p);
    const outro = root.querySelector<HTMLElement>('.outro');
    if (outro) {
      outro.style.opacity = o.toFixed(3);
      outro.style.transform = `translate3d(0, ${((1 - o) * 40).toFixed(1)}px, 0)`;
      outro.style.pointerEvents = o > 0.6 ? 'auto' : 'none';
    }

    const active = p >= 0.9 ? -1 : chapterAt(p);
    q('.dots button').forEach((b, i) => b.classList.toggle('active', i === active));
    const hint = root.querySelector<HTMLElement>('.scroll-hint');
    if (hint) hint.style.opacity = (1 - seg(p, 0, 0.03)).toFixed(3);
  }

  /** Chapter buttons: jump to the moment the big words are showing */
  goTo(i: number) {
    const el = this.section()!.nativeElement;
    const total = el.offsetHeight - window.innerHeight;
    const top = el.getBoundingClientRect().top + window.scrollY + (i * CHAPTER_SPAN + CHAPTER_SPAN * 0.24) * total;
    window.scrollTo({ top, behavior: 'smooth' });
  }
}
