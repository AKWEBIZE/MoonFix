import { Directive, ElementRef, OnDestroy, OnInit, inject, input } from '@angular/core';

/**
 * Counts the number inside a text up from 0 when it scrolls into view.
 * Keeps any prefix/suffix, e.g. "5,000+" or "4.8★" or "30 days".
 * Usage: <b [countUp]="'5,000+'"></b>
 */
@Directive({ selector: '[countUp]' })
export class CountUpDirective implements OnInit, OnDestroy {
  private el = inject(ElementRef<HTMLElement>);
  countUp = input.required<string>();
  private io?: IntersectionObserver;
  private raf = 0;

  ngOnInit() {
    const node = this.el.nativeElement as HTMLElement;
    const text = this.countUp();
    const m = text.match(/^(\D*)([\d,]+(?:\.\d+)?)(.*)$/);
    if (
      !m ||
      typeof IntersectionObserver === 'undefined' ||
      matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      node.textContent = text;
      return;
    }
    const [, prefix, numStr, suffix] = m;
    const target = parseFloat(numStr.replace(/,/g, ''));
    const decimals = (numStr.split('.')[1] || '').length;
    const useCommas = numStr.includes(',');
    const fmt = (v: number) => {
      const fixed = v.toFixed(decimals);
      return useCommas
        ? Number(fixed).toLocaleString('en-IN', { minimumFractionDigits: decimals })
        : fixed;
    };
    node.textContent = `${prefix}${fmt(0)}${suffix}`;

    this.io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        this.io?.disconnect();
        const start = performance.now();
        const dur = 1600;
        const tick = (now: number) => {
          const p = Math.min(1, (now - start) / dur);
          const eased = 1 - Math.pow(1 - p, 3);
          node.textContent = `${prefix}${fmt(target * eased)}${suffix}`;
          if (p < 1) this.raf = requestAnimationFrame(tick);
        };
        this.raf = requestAnimationFrame(tick);
      },
      { threshold: 0.4 },
    );
    this.io.observe(node);
  }

  ngOnDestroy() {
    this.io?.disconnect();
    cancelAnimationFrame(this.raf);
  }
}
