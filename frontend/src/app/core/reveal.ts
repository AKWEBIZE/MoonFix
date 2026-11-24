import { Directive, ElementRef, OnDestroy, OnInit, inject, input } from '@angular/core';

/** Fades/slides an element in when it scrolls into view. Usage: <div reveal [revealDelay]="100"> */
@Directive({ selector: '[reveal]', host: { class: 'reveal' } })
export class RevealDirective implements OnInit, OnDestroy {
  private el = inject(ElementRef<HTMLElement>);
  revealDelay = input(0);
  private io?: IntersectionObserver;

  ngOnInit() {
    const node = this.el.nativeElement as HTMLElement;
    node.style.transitionDelay = `${this.revealDelay()}ms`;
    if (typeof IntersectionObserver === 'undefined') {
      node.classList.add('in');
      return;
    }
    this.io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            node.classList.add('in');
            this.io?.disconnect();
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' },
    );
    this.io.observe(node);
  }

  ngOnDestroy() {
    this.io?.disconnect();
  }
}
