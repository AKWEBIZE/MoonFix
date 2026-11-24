import {
  Component,
  ElementRef,
  NgZone,
  afterNextRender,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

/** Minimal typing for Google Identity Services (https://accounts.google.com/gsi/client). */
interface GoogleId {
  initialize(opts: {
    client_id: string;
    callback: (r: { credential: string }) => void;
    ux_mode?: 'popup' | 'redirect';
    auto_select?: boolean;
    cancel_on_tap_outside?: boolean;
  }): void;
  renderButton(el: HTMLElement, opts: Record<string, string | number>): void;
}
declare global {
  interface Window {
    google?: { accounts: { id: GoogleId } };
  }
}

let gisScript: Promise<void> | null = null;
function loadGis(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  return (gisScript ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      gisScript = null;
      reject(new Error('Google sign-in could not load'));
    };
    document.head.appendChild(s);
  }));
}

/** Official "Continue with Google" button. Emits the Google ID token (credential). */
@Component({
  selector: 'app-google-button',
  templateUrl: './google-button.html',
  styleUrl: './google-button.scss',
})
export class GoogleButton {
  clientId = input.required<string>();
  credential = output<string>();

  private zone = inject(NgZone);
  private host = viewChild.required<ElementRef<HTMLElement>>('host');
  failed = signal(false);

  constructor() {
    afterNextRender(() => {
      loadGis()
        .then(() => {
          const id = window.google!.accounts.id;
          id.initialize({
            client_id: this.clientId(),
            ux_mode: 'popup',
            cancel_on_tap_outside: true,
            callback: (r) => this.zone.run(() => this.credential.emit(r.credential)),
          });
          const el = this.host().nativeElement;
          id.renderButton(el, {
            type: 'standard',
            theme: 'outline',
            size: 'large',
            text: 'continue_with',
            shape: 'pill',
            logo_alignment: 'center',
            width: Math.min(Math.max(el.clientWidth, 220), 400),
          });
        })
        .catch(() => this.failed.set(true));
    });
  }
}
