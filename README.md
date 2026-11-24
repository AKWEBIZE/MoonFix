# Doorstep Service Booking — AC · Fridge · Washing Machine

A booking website where customers schedule a technician at their doorstep, with a **hidden admin panel**
for technician availability, time slots and **WhatsApp follow-ups**.

- **Frontend:** Angular 22 (standalone components, signals) — `frontend/`
- **Backend:** Node.js + Express 5 + SQLite (built into Node, nothing to install) — `backend/`

---

## Features

### Customer website
- Home page with AC, Refrigerator and Washing Machine services and prices
- 4-step booking: **Service → Date & time slot → Address details → Confirm**
- Live slot availability: a slot is open only if a technician with the right skill is free
  (not on leave, not on weekly off, not already booked)
- Automatic technician assignment (least busy technician that day)
- Track booking by Booking ID + mobile number, and cancel online
- **Customer login** (`/login`) with **Google** or a **free WhatsApp OTP**, and a **My Orders** page (`/account`)
  with upcoming and past bookings, track, cancel and “Book again”. See [Customer login](#customer-login).
- Floating “Chat on WhatsApp” button

### Hidden admin panel
Not linked anywhere on the site. Open it by typing the secret address:

```
http://localhost:4200/cc-control-7x92
```

Change the secret path in `frontend/src/app/core/app-settings.ts` (`ADMIN_PATH`).
The admin API is also protected by username/password + JWT, and logins lock for 15 minutes after 5 wrong attempts.

| Page | What it does |
|---|---|
| Dashboard | Today's jobs, unassigned bookings, the next 7 days, WhatsApp messages waiting to be sent |
| Bookings | Search/filter, reschedule, assign or reassign a technician, change status, send WhatsApp messages |
| Availability | Grid of technicians × time slots for any day. Click to mark a technician unavailable for a slot or the whole day. Plan leave across a date range. Add holidays |
| Technicians | Add/edit technicians, their skills (AC / Fridge / Washing Machine) and weekly off days |
| Time slots & days | Add/edit daily slots (e.g. 9–11 AM), working days, how far ahead customers can book, minimum notice |
| Services & prices | Add/edit services and starting prices, hide/show on the website |
| WhatsApp follow-ups | Log of every message, with one-click send, retry and mark as sent |
| Settings | Business name and WhatsApp number, follow-up timings, change password |

### WhatsApp follow-up
Sent automatically:

| When | To | Message |
|---|---|---|
| Booking created | Customer | Confirmation with Booking ID, date, slot and technician |
| Booking created | Admin | New booking alert |
| Technician assigned or changed | Technician | Job details with customer address and problem |
| Rescheduled / cancelled / on the way | Customer | Update |
| *N* hours before the visit (default 3) | Customer | Reminder |
| *N* hours after completion (default 2) | Customer | Feedback request (1–5 ⭐) |
| *N* days after completion (default 90) | Customer | Next-service follow-up, e.g. AC servicing |

Delivery modes (`WHATSAPP_PROVIDER` in `backend/.env`):

- **`none`** (default, free): messages are prepared and logged. In the admin panel, click **Send**:
  WhatsApp opens with the text pre-filled, and you send it from the business phone.
- **`cloud`**: [Meta WhatsApp Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api), fully automatic.
  Meta only allows free-text messages within 24 hours of the customer's last message. For other messages set
  `WA_CLOUD_USE_TEMPLATE=true` and create an approved template with one body variable `{{1}}`.
- **`twilio`**: Twilio WhatsApp API, fully automatic.

---

## Customer login

Customers can log in to see all their bookings. Bookings are matched by **mobile number**,
so every booking made with that number shows up, including ones made before they had an account.

### WhatsApp OTP (free)

Meta charges for OTP messages a business sends on its own, but **replies to a message the
customer sent are free**. So the customer messages first:

1. On `/login` the customer enters their mobile number and taps **Get OTP on WhatsApp**.
2. **Open WhatsApp** opens a chat with your business number, with a message ready to send
   (`Hi! Please send my login code. (Ref: K7P2)`). They tap **Send**.
3. Your server receives it (webhook) and replies with a **6-digit code** (valid 5 minutes).
   The website notices and opens the code box.
4. They type the code and they are logged in for 30 days.

The code only ever goes to the WhatsApp number that sent the message, so nobody can log in
as someone else. Limits: 5 wrong codes per request, a few requests per number / device per 15 minutes.
Codes are stored hashed, and are hidden (`••••••`) in the admin WhatsApp log.

**Setup** (needs `WHATSAPP_PROVIDER=cloud`; Twilio is not supported for login):

1. Set up the Meta WhatsApp Cloud API (see `WA_CLOUD_TOKEN` and `WA_CLOUD_PHONE_NUMBER_ID` above).
2. In `backend/.env` set `WA_CLOUD_VERIFY_TOKEN` (any long random text) and `WA_CLOUD_APP_SECRET`
   (Meta app → App settings → Basic → App secret).
3. Meta dashboard → WhatsApp → Configuration → Webhook:
   Callback URL `https://<your-domain>/api/whatsapp/webhook`, Verify token = `WA_CLOUD_VERIFY_TOKEN`,
   then subscribe to the **messages** field. The URL must be public HTTPS; to try it from your PC,
   expose port 4000 with a tunnel (e.g. VS Code port forwarding, set to Public).

**Local testing without WhatsApp:** `CUSTOMER_OTP_DEV=true` in `backend/.env` shows the code on
screen instead. It only works when `WHATSAPP_PROVIDER` is not `cloud`. **Set it to `false` before going live.**

### Google sign-in

1. Go to [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials),
   create an **OAuth client ID** of type **Web application** (set up the consent screen first if asked).
2. Under **Authorized JavaScript origins** add `http://localhost:4200`, `http://localhost` and your live
   site, e.g. `https://yourdomain.com`. No redirect URI is needed.
3. Put the Client ID in `backend/.env` as `GOOGLE_CLIENT_ID=...apps.googleusercontent.com` and restart
   the backend. The “Continue with Google” button appears on `/login` by itself.

The first time someone signs in with Google, My Orders asks them to **confirm their mobile number
once** with the WhatsApp OTP. If that number already has an account (from an earlier WhatsApp login),
the two are merged into one.

### API

| Method & path | Login | What it does |
|---|---|---|
| `POST /api/customer/otp/start` `{phone}` | – | Starts a WhatsApp login, returns `requestId` and the `wa.me` link |
| `GET /api/customer/otp/:id/status` | – | `waiting` / `sent` / `used` / `expired` (the page polls this) |
| `POST /api/customer/otp/verify` `{requestId, code}` | – | Returns `{token, customer}` |
| `POST /api/customer/google` `{credential}` | – | Verifies the Google ID token, returns `{token, customer}` |
| `GET /api/customer/me`, `PATCH /api/customer/me` `{name}` | ✓ | Profile |
| `POST /api/customer/phone/start` / `phone/verify` | ✓ | Google customers confirm their mobile number |
| `GET /api/customer/bookings` | ✓ | All bookings for the customer’s number |
| `POST /api/customer/bookings/:ref/cancel` | ✓ | Cancel a pending / confirmed booking |
| `GET`/`POST /api/whatsapp/webhook` | Meta | Webhook verification and incoming WhatsApp messages |

---

## Run locally

Requirements: **Node.js 22.13 or newer** (uses the built-in `node:sqlite`).

**1. Backend** (http://localhost:4000)

```powershell
cd backend
copy .env.example .env      # then edit .env: admin password, JWT secret, business WhatsApp number
npm install
npm run dev
```

On first start the database `backend/data/app.db` is created with sample services, five time slots,
three sample technicians and the admin user from `.env`.

**2. Frontend** (http://localhost:4200, `/api` is proxied to the backend)

```powershell
cd frontend
npm install
npm start
```

- Website: http://localhost:4200
- Admin: http://localhost:4200/cc-control-7x92 (default login `admin` / `ChangeMe@123`, from `.env`; change it in Settings)

## Production

From the project root (this is also what hosts like Hostinger run):

```powershell
npm install
npm run build   # installs the backend, then installs and builds the Angular frontend
npm start       # starts the backend, which serves the website and the API
```

On Hostinger (Node.js app from Git):
- Root directory: the repo root
- Build command: `npm run build`
- Start command: `npm start`
- Node.js version: 22 or newer
- Put the settings from `backend/.env.example` into the panel's environment variables.

When `frontend/dist/frontend/browser` exists, the Node server serves the website and the API together on one port
(`PORT`, default 4000). Put it behind Nginx/IIS with HTTPS, set `CORS_ORIGINS`, a long random `JWT_SECRET`, and back up
`backend/data/app.db`.

## Security

### Built in

| Protection | Where |
|---|---|
| **Live-server safety check.** With `NODE_ENV=production` the server refuses to start while: the default admin password is in use, `CUSTOMER_OTP_DEV=true`, `JWT_SECRET` is short, `WA_CLOUD_APP_SECRET` is missing in cloud mode, or `CORS_ORIGINS` is localhost. | `backend/src/security.js` |
| **Test login mode can't run live.** The on-screen login code (`CUSTOMER_OTP_DEV`) is ignored when `NODE_ENV=production`. | `customerAuth.js` |
| **Admin login lockout.** 5 wrong passwords from one IP for one user, 10 for one user from any IPs, or 20 from one IP for any users: locked for 15 minutes. | `auth.js` |
| **Real visitor IP only.** `X-Forwarded-For` is trusted only when `TRUST_PROXY` says a proxy is in front, so IP limits can't be dodged with a fake header. | `server.js`, `.env` |
| **Security headers** (helmet): Content-Security-Policy, HSTS (live only), X-Frame-Options DENY, nosniff, Referrer-Policy. | `security.js` |
| **WhatsApp webhook signatures.** Unsigned webhook calls are rejected on a live server. | `routes/whatsappWebhook.js` |
| **Booking spam limits.** Per number: 3 upcoming bookings and 5 new bookings a day. Per device: 6 an hour and 15 a day. Track/cancel: 30 lookups per 15 minutes. A hidden bot-trap field on the booking form. | `bookings.js`, `routes/public.js` |
| **Strong admin passwords.** At least 10 characters with letters and numbers, never the default. The admin panel shows a red warning while the default password is in use. | `routes/admin.js`, admin layout |
| Parameterised SQL, scrypt password hashing, hashed one-time codes, signed tokens pinned to HS256, verified Google tokens, and generic error messages. | throughout |

### Before going live

1. Change the admin password in **Admin → Settings**.
2. In `backend/.env`, set:
   - `NODE_ENV=production`
   - `CUSTOMER_OTP_DEV=false`
   - `CORS_ORIGINS=https://yourdomain.com`
   - `TRUST_PROXY=1` (behind Nginx)
   - and, when using Meta, `WA_CLOUD_APP_SECRET`.
3. Change the secret admin address `ADMIN_PATH` in `frontend/src/app/core/app-settings.ts`.
4. Serve over HTTPS only.
   - Keep port 4000 closed to the internet; only Nginx should reach it.
   - Run the app as a non-root user.
   - Make `backend/.env` readable only by that user.
5. Back up `backend/data/app.db` daily to another place and test a restore. Run `npm audit` before each release.

## Project structure

```
backend/src/
  server.js          Express app, serves API + Angular build
  db.js              SQLite schema, settings, first-run seed data
  availability.js    Slot / technician availability rules
  bookings.js        Create / update bookings, auto-assign technician
  whatsapp.js        Message templates + Meta Cloud / Twilio / manual providers
  scheduler.js       Reminders, feedback and follow-up (runs every minute)
  auth.js            Admin login (scrypt + JWT, brute-force lock)
  customerAuth.js    Customer login: WhatsApp OTP, Google token check, accounts, customer JWT
  routes/public.js   /api/public/*  (services, dates, slots, book, track, cancel)
  routes/customer.js /api/customer/* (login, profile, my bookings)
  routes/whatsappWebhook.js  /api/whatsapp/webhook (incoming WhatsApp messages from Meta)
  routes/admin.js    /api/admin/*   (everything the admin panel uses)
frontend/src/
  styles.scss        Global entry: imports the shared partials below
  styles/            Shared SCSS: _tokens (colours/fonts), _base, _buttons, _forms,
                     _animations, _page-banner, _admin, _breakpoints (mixins)
  app/
    core/            Services, auth guard/interceptor, models, pipes, directives
      icon/          <app-icon>        icon.ts · icon.html · icon.scss
      toasts/        <app-toasts>      toasts.ts · toasts.html · toasts.scss
      google-button/ <app-google-button> official “Continue with Google” button
      customer.ts    Customer session, API calls, interceptor and route guard
    public/          Customer website — one folder per component:
      site-layout/   header, footer, floating WhatsApp button
      home/          home page
      hero-art/      animated hero illustration
      wa-demo/       live WhatsApp phone demo
      appliance-anim/ small animated AC / fridge / washer icons
      book/          booking flow
      track/         track booking
      login/         customer login page (Google + WhatsApp OTP)
      wa-otp/        <app-wa-otp> WhatsApp OTP steps (used by login and My Orders)
      account/       My Orders page
    admin/           Hidden admin panel — admin-login/, admin-layout/, dashboard/,
                     bookings/, availability/, technicians/, slots/, services/,
                     messages/, settings/
```

Every component folder has the usual three files, e.g. `home/home.ts`, `home/home.html`,
`home/home.scss`. Component styles are scoped to that component. The colour theme (Dodger Blue + Black)
is a set of global `--theme-*` CSS variables in `src/styles/_tokens.scss` (e.g. `var(--theme-primary)`,
`var(--theme-black)`, `var(--theme-gradient)`). Change the values there to re-brand the whole site. To use the shared breakpoints in a
component, add `@use 'breakpoints' as bp;` and then `@include bp.down(bp.$mobile) { ... }`.
New components made with `ng generate component` use SCSS automatically.
