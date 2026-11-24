import { Component, ElementRef, OnDestroy, OnInit, inject, input, signal } from '@angular/core';
import { IconComponent } from '../../core/icon/icon';

interface ChatMsg {
  text: string;
  time: string;
  from: 'biz' | 'me';
}

/** Example of the automatic WhatsApp follow-ups, typed out live on a phone mockup. Loops while visible. */
const SCRIPT: ChatMsg[] = [
  {
    from: 'biz',
    time: '10:02 AM',
    text: '✅ Booking confirmed!\nAC General Service\nToday, 11:00 AM – 1:00 PM',
  },
  {
    from: 'biz',
    time: '10:03 AM',
    text: '👨‍🔧 Your technician has been assigned. They will call before arriving.',
  },
  { from: 'me', time: '10:05 AM', text: 'Great, thank you! 🙏' },
  {
    from: 'biz',
    time: '10:45 AM',
    text: '⏰ Reminder: your visit is coming up soon. Please keep the AC accessible.',
  },
  { from: 'biz', time: '11:10 AM', text: '🚐 Technician is on the way!' },
  { from: 'biz', time: '1:05 PM', text: '🎉 Service completed. How was it? Reply 1–5 ⭐' },
  { from: 'me', time: '1:06 PM', text: '⭐⭐⭐⭐⭐' },
];

@Component({
  selector: 'app-wa-demo',
  imports: [IconComponent],
  templateUrl: './wa-demo.html',
  styleUrl: './wa-demo.scss',
})
export class WaDemo implements OnInit, OnDestroy {
  businessName = input('CoolCare Home Services');
  shown = signal<ChatMsg[]>([]);
  typing = signal(false);

  private el = inject(ElementRef<HTMLElement>);
  private io?: IntersectionObserver;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private idx = 0;
  private visible = false;

  ngOnInit() {
    if (typeof IntersectionObserver === 'undefined') {
      this.shown.set(SCRIPT);
      return;
    }
    this.io = new IntersectionObserver(
      (entries) => {
        this.visible = entries.some((e) => e.isIntersecting);
        if (this.visible && !this.timer) this.next();
      },
      { threshold: 0.25 },
    );
    this.io.observe(this.el.nativeElement);
  }

  private next() {
    if (!this.visible) {
      this.timer = null;
      return;
    }
    if (this.idx >= SCRIPT.length) {
      // pause, then restart the conversation
      this.timer = setTimeout(() => {
        this.idx = 0;
        this.shown.set([]);
        this.next();
      }, 3500);
      return;
    }
    const msg = SCRIPT[this.idx];
    const typingMs = msg.from === 'biz' ? 1100 : 600;
    this.typing.set(msg.from === 'biz');
    this.timer = setTimeout(() => {
      this.typing.set(false);
      this.shown.update((l) => [...l, msg]);
      this.idx++;
      this.timer = setTimeout(() => this.next(), 900);
    }, typingMs);
  }

  ngOnDestroy() {
    this.io?.disconnect();
    if (this.timer) clearTimeout(this.timer);
  }
}
