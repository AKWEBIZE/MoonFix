import {
  afterNextRender, Component, DestroyRef, ElementRef, HostListener, inject, input, output, signal, viewChild,
} from '@angular/core';
import { PublicBooking } from '../../../core/models';
import { PrettyDatePipe, Time12Pipe } from '../../../core/ui';
import type { ConfirmScene } from '../../three/confirm-scene';

const FLAP_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
const AUTO_CLOSE_MS = 9000;

/**
 * Full-screen "Booking confirmed" celebration shown right after the customer confirms:
 * 3D tick badge + 3D confetti, the title rising in, the booking ID flipping in like a departure
 * board, a ticket with a "CONFIRMED" stamp, a van driving to the house, and status lines.
 * "View booking details" (or Esc, a click outside, or 9 s) closes it and reveals the normal page.
 * Not shown to people who prefer reduced motion (the booking page skips it).
 */
@Component({
  selector: 'app-booking-celebration',
  imports: [PrettyDatePipe, Time12Pipe],
  templateUrl: './celebration.html',
  styleUrl: './celebration.scss',
})
export class BookingCelebration {
  booking = input.required<PublicBooking>();
  closed = output<void>();

  private canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private badge = viewChild.required<ElementRef<HTMLElement>>('badge');
  private dialog = viewChild.required<ElementRef<HTMLElement>>('dialog');

  titleWords = ['Booking', 'confirmed!'];
  three = signal(false);
  closing = signal(false);
  flaps = signal<{ ch: string; set: boolean }[]>([]);

  private scene: ConfirmScene | null = null;
  private raf = 0;
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden'; // no page scrolling behind the celebration
      this.dialog().nativeElement.focus();
      this.startFlaps();
      this.start3d();
      this.timers.push(setTimeout(() => this.close(), AUTO_CLOSE_MS));
      destroyRef.onDestroy(() => {
        document.body.style.overflow = prevOverflow;
      });
    });
    destroyRef.onDestroy(() => {
      this.timers.forEach(clearTimeout);
      cancelAnimationFrame(this.raf);
      this.scene?.dispose();
      this.scene = null;
    });
  }

  @HostListener('document:keydown.escape')
  close() {
    if (this.closing()) return;
    this.closing.set(true);
    this.timers.push(setTimeout(() => this.closed.emit(), 420)); // after the closing animation
  }

  /** Booking ID: each letter flickers through random characters, then lands (left to right) */
  private startFlaps() {
    const ref = this.booking().ref.split('');
    const start = performance.now();
    const tick = () => {
      const t = performance.now() - start;
      let done = true;
      this.flaps.set(
        ref.map((ch, i) => {
          if (t > 1500 + i * 110) return { ch, set: true };
          done = false;
          return { ch: t < 1250 ? ' ' : FLAP_CHARS[Math.floor(Math.random() * FLAP_CHARS.length)], set: false };
        }),
      );
      if (!done) this.timers.push(setTimeout(tick, 55));
    };
    tick();
  }

  private start3d() {
    if (!webgl()) return; // the drawn tick stays
    import('../../three/confirm-scene').then(({ createConfirmScene }) => {
      const canvas = this.canvas().nativeElement;
      if (!canvas.isConnected) return;
      this.scene = createConfirmScene(canvas);
      const fit = () => {
        const b = this.badge().nativeElement.getBoundingClientRect();
        this.scene?.resize(window.innerWidth, window.innerHeight, b.left + b.width / 2, b.top + b.height / 2, Math.min(150, b.height));
      };
      fit();
      window.addEventListener('resize', fit);
      this.timers.push(setTimeout(() => window.removeEventListener('resize', fit), 12000));
      this.three.set(true);
      const start = performance.now();
      const loop = (now: number) => {
        if (!this.scene) return;
        if (this.scene.frame((now - start) / 1000)) this.raf = requestAnimationFrame(loop);
      };
      this.raf = requestAnimationFrame(loop);
    });
  }
}

function webgl() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}
