import { afterNextRender, Component, DestroyRef, ElementRef, inject, signal, viewChild } from '@angular/core';
import type { ConfirmScene } from '../../three/confirm-scene';

/**
 * "Booking confirmed" tick. Shows the drawn tick at once; on devices with 3D (and without
 * "reduce motion") a glossy 3D badge spins in over it with a burst of 3D confetti.
 * Place it inside a positioned card: the confetti canvas covers the top of that card.
 */
@Component({
  selector: 'app-confirm-burst',
  templateUrl: './confirm-burst.html',
  styleUrl: './confirm-burst.scss',
})
export class ConfirmBurst {
  private canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private mark = viewChild.required<ElementRef<SVGElement>>('mark');
  threeOn = signal(false);
  private scene: ConfirmScene | null = null;
  private raf = 0;

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !webgl()) return;
      import('../../three/confirm-scene').then(({ createConfirmScene }) => {
        const canvas = this.canvas().nativeElement;
        if (!canvas.isConnected) return;
        this.scene = createConfirmScene(canvas);
        this.fit();
        this.threeOn.set(true);
        const start = performance.now();
        const loop = (now: number) => {
          if (!this.scene) return;
          if (this.scene.frame((now - start) / 1000)) this.raf = requestAnimationFrame(loop);
        };
        this.raf = requestAnimationFrame(loop);
      });
    });
    destroyRef.onDestroy(() => {
      cancelAnimationFrame(this.raf);
      this.scene?.dispose();
      this.scene = null;
    });
  }

  /** badge goes exactly where the drawn tick is */
  private fit() {
    const c = this.canvas().nativeElement.getBoundingClientRect();
    const m = this.mark().nativeElement.getBoundingClientRect();
    this.scene?.resize(c.width, c.height, m.left + m.width / 2 - c.left, m.top + m.height / 2 - c.top);
  }
}

/** Preload the 3D code (e.g. on the review step) so the moment is instant after "Confirm". */
export function preloadConfirmBurst() {
  if (webgl()) import('../../three/confirm-scene');
}

function webgl() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}
