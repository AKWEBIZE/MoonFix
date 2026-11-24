import { Routes } from '@angular/router';
import { ADMIN_PATH } from './core/app-settings';
import { adminGuard } from './core/auth';
import { customerGuard } from './core/customer';

export const routes: Routes = [
  // ---------- Public website ----------
  {
    path: '',
    loadComponent: () => import('./public/site-layout/site-layout').then((m) => m.SiteLayout),
    children: [
      {
        path: '',
        loadComponent: () => import('./public/home/home').then((m) => m.HomePage),
        title: 'Doorstep AC, Fridge & Washing Machine Service',
      },
      {
        path: 'book',
        loadComponent: () => import('./public/book/book').then((m) => m.BookPage),
        title: 'Book a Technician',
      },
      {
        path: 'track',
        loadComponent: () => import('./public/track/track').then((m) => m.TrackPage),
        title: 'Track Your Booking',
      },
      {
        path: 'login',
        loadComponent: () => import('./public/login/login').then((m) => m.LoginPage),
        title: 'Login',
      },
      {
        path: 'account',
        canActivate: [customerGuard],
        loadComponent: () => import('./public/account/account').then((m) => m.AccountPage),
        title: 'My Orders',
      },
    ],
  },

  // ---------- Hidden admin (no links anywhere on the site) ----------
  {
    path: ADMIN_PATH,
    loadComponent: () => import('./admin/admin-login/admin-login').then((m) => m.AdminLogin),
    title: 'Sign in',
  },
  {
    path: `${ADMIN_PATH}/panel`,
    canActivate: [adminGuard],
    loadComponent: () => import('./admin/admin-layout/admin-layout').then((m) => m.AdminLayout),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        loadComponent: () => import('./admin/dashboard/dashboard').then((m) => m.DashboardPage),
        title: 'Dashboard',
      },
      {
        path: 'bookings',
        loadComponent: () => import('./admin/bookings/bookings').then((m) => m.BookingsPage),
        title: 'Bookings',
      },
      {
        path: 'availability',
        loadComponent: () =>
          import('./admin/availability/availability').then((m) => m.AvailabilityPage),
        title: 'Availability',
      },
      {
        path: 'technicians',
        loadComponent: () =>
          import('./admin/technicians/technicians').then((m) => m.TechniciansPage),
        title: 'Technicians',
      },
      {
        path: 'slots',
        loadComponent: () => import('./admin/slots/slots').then((m) => m.SlotsPage),
        title: 'Time slots',
      },
      {
        path: 'services',
        loadComponent: () => import('./admin/services/services').then((m) => m.ServicesPage),
        title: 'Services',
      },
      {
        path: 'whatsapp',
        loadComponent: () => import('./admin/messages/messages').then((m) => m.MessagesPage),
        title: 'WhatsApp follow-ups',
      },
      {
        path: 'settings',
        loadComponent: () => import('./admin/settings/settings').then((m) => m.SettingsPage),
        title: 'Settings',
      },
    ],
  },

  { path: '**', redirectTo: '' },
];
