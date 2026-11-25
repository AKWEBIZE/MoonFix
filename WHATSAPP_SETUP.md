# WhatsApp Cloud API setup (Meta, direct)

This turns on **automatic** WhatsApp messages: booking confirmations, reminders, technician updates,
feedback requests, follow-ups, job details for technicians and new-booking alerts for you.
Until it is set up, the site keeps working in manual mode (you click **Send** for each message).

Plan for **1–3 days**: Meta reviews the templates (minutes to a day) and, optionally, your business.

> Meta changes its screens often. If a button has moved, search for the same words in the page.

---

## What you need first

- A **phone number for the API** that can receive an SMS or call for verification.
  - A number used with the API **cannot also be used in the normal WhatsApp / WhatsApp Business app**.
    If the number is on WhatsApp today, delete that WhatsApp account first (WhatsApp → Settings →
    Account → Delete account) — or use a new number.
  - Customers' replies will appear in the admin panel (**WhatsApp follow-ups → Customer messages**),
    not on a phone.
- A **Facebook account** (personal) to log in to Meta.
- A **debit/credit card** for Meta's per-message charges (small amount per message; see
  Meta's *WhatsApp pricing* page for India).
- Your business details (name, address, website `https://modern-deepskyblue-rhinoceros-94.hostingersite.com`).

---

## Step 1 — Create a Meta app with WhatsApp

1. Go to **developers.facebook.com** → log in → **My Apps** → **Create app**.
2. Choose the use case **“Connect with customers through WhatsApp”** (app type *Business*).
3. When asked, **create or select a Business portfolio** named *MoonFix*.
4. Open the app → **WhatsApp → API Setup**. Meta gives you a free **test number** first — ignore it for now.

## Step 2 — Add your real number

1. On **WhatsApp → API Setup**, click **Add phone number**.
2. Fill in the **display name** (e.g. *MoonFix*), category (*Home services* / *Other*), and verify the
   number with the SMS/voice code.
3. Back on **API Setup**, select your number and **note down** (you will need them later):
   - **Phone number ID** → goes into `WA_CLOUD_PHONE_NUMBER_ID`
   - **WhatsApp Business Account ID** → goes into `WA_CLOUD_WABA_ID`

## Step 3 — Permanent access token

The token shown on *API Setup* expires in 24 hours. Make a permanent one:

1. **business.facebook.com** → **Settings** (Business settings) → **Users → System users** → **Add**
   (name *moonfix-server*, role *Admin*).
2. Select the system user → **Assign assets**:
   - **Apps** → your app → *Full control*
   - **WhatsApp accounts** → your WhatsApp account → *Full control*
3. **Generate token** → choose your app → expiry **Never** → tick
   **`whatsapp_business_messaging`** and **`whatsapp_business_management`** → Generate.
4. Copy the token → goes into `WA_CLOUD_TOKEN`.
   **Keep it secret** (it can send messages as your business). Never put it in GitHub or a chat.

## Step 4 — Payment method

**WhatsApp Manager** (business.facebook.com → WhatsApp accounts → your account → *WhatsApp Manager*)
→ **Payment settings / Billing** → add your card.
Without it, business-started messages (confirmations, reminders …) are refused.

## Step 5 — Submit the 11 message templates (one command)

WhatsApp only lets a business start a conversation with **approved templates**. The site needs 11
(confirmation, reschedule, technician assigned, reminder, on the way, feedback, follow-up,
cancellation, technician job, admin alert, custom update). Their exact wording is in
`backend/src/waTemplates.js`; to see them all:

```powershell
cd G:\AC_Techinicain\doorstep-service\backend; npm run wa:templates
```

To submit them, put these two lines in **`backend/.env` on your computer** (this file is never uploaded):

```
WA_CLOUD_TOKEN=<token from step 3>
WA_CLOUD_WABA_ID=<WhatsApp Business Account ID from step 2>
```

then run:

```powershell
cd G:\AC_Techinicain\doorstep-service\backend; npm run wa:templates -- --create
```

Check the review later (usually minutes, sometimes up to a day):

```powershell
cd G:\AC_Techinicain\doorstep-service\backend; npm run wa:templates -- --status
```

- **APPROVED** – ready. **PENDING** – wait. **REJECTED** – the reason is shown; tell me and I will
  adjust the wording.
- `service_followup` is a **Marketing** template (a reminder to book again); the rest are **Utility**.
  Meta may move a template to Marketing — that only changes its price.
- Until a template is approved, that type of message shows as **failed** in the admin panel
  (you can still click **Send** to send it from a phone).

## Step 6 — Webhook (delivery ticks, customer replies, WhatsApp login)

1. Make up a random **verify token**, e.g. `moonfix-hook-7f3k9q2x` → goes into `WA_CLOUD_VERIFY_TOKEN`.
2. Meta app → **App settings → Basic** → **App secret** → *Show* → goes into `WA_CLOUD_APP_SECRET`.
3. Add the Hostinger settings from **Step 7** and **redeploy first** (Meta checks the URL immediately).
4. Meta app → **WhatsApp → Configuration → Webhook → Edit**:
   - **Callback URL**: `https://modern-deepskyblue-rhinoceros-94.hostingersite.com/api/whatsapp/webhook`
   - **Verify token**: the same value as `WA_CLOUD_VERIFY_TOKEN`
   - **Verify and save**, then under **Webhook fields** subscribe to **`messages`**.
5. Meta app → switch the app from **Development** to **Live** (top of the app dashboard). Meta asks for a
   **Privacy Policy URL** for this.

## Step 7 — Settings on Hostinger

Hostinger → your Node.js app → **Environment variables** → add:

```
WHATSAPP_PROVIDER=cloud
WA_CLOUD_TOKEN=<token from step 3>
WA_CLOUD_PHONE_NUMBER_ID=<phone number ID from step 2>
WA_CLOUD_WABA_ID=<WhatsApp Business Account ID from step 2>
WA_CLOUD_VERIFY_TOKEN=<your verify token from step 6>
WA_CLOUD_APP_SECRET=<app secret from step 6>
WA_CLOUD_TEMPLATE_LANG=en
```

Remove `CUSTOMER_OTP_DEV` if it is there. Save → **redeploy**.

## Step 8 — Settings in the admin panel

Admin panel → **Settings**:
- **Business WhatsApp number** = the API number (customers message this number, and the WhatsApp login uses it).
- **Send new-booking alerts to** = **your personal WhatsApp number**. It must be different: the API number
  cannot send messages to itself.

## Step 9 — Test

1. Make a test booking on the website with your own mobile number.
2. You should get the **booking confirmation** on WhatsApp, and the **new-booking alert** on your personal number.
3. Admin panel → **WhatsApp follow-ups**: the messages show **sent ✓**, then **delivered ✓✓** / **read ✓✓**.
4. Reply to the confirmation from your phone → it appears under **Customer messages**.

If something shows **failed**, the reason from Meta is shown under the message (for example
`(#132001) template does not exist` = template not approved yet; `(#131030)` = number not allowed while
the app is in Development mode).

---

## Limits to know

- New WhatsApp accounts start with a **daily limit** on how many different people the business can message
  first (Meta raises it automatically as you send good-quality messages, and faster after **business
  verification** in Business settings → Security center).
- Customers can **block or report** messages; keep messages useful and expected (they all relate to
  their own booking, except the follow-up).
- Free text (not a template) is allowed only within **24 hours of the customer's last message** — the
  site handles this itself (login codes are plain text replies).
