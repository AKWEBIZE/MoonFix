import { Component, HostListener, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { CustomerAuthService } from '../../core/customer';
import { IconComponent } from '../../core/icon/icon';
import { SiteService } from '../../core/site.service';

@Component({
  selector: 'app-site-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, IconComponent],
  templateUrl: './site-layout.html',
  styleUrl: './site-layout.scss',
})
export class SiteLayout {
  site = inject(SiteService);
  account = inject(CustomerAuthService);
  menu = signal(false);
  scrolled = signal(false);
  year = new Date().getFullYear();

  @HostListener('window:scroll')
  onScroll() {
    this.scrolled.set(window.scrollY > 8);
  }
}
