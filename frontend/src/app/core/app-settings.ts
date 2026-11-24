/**
 * Hidden admin login.
 *
 * The admin panel is NOT linked anywhere on the public site. It is only
 * reachable by typing this secret path, e.g. https://yoursite.com/cc-control-7x92
 * Change it to your own hard-to-guess value before going live.
 * (The admin API is still protected by username/password + JWT.)
 */
export const ADMIN_PATH = 'cc-control-7x92';

/** API base. In dev the Angular proxy forwards /api to the Node server. */
export const API_BASE = '/api';
