# Bioptime platform

One backend, one database and one set of business rules behind four surfaces: the public website, the coach workspace,
the admin workspace and the member mobile app. Everything here runs on a laptop in **demo mode**: synthetic people, a
payment simulator, a stand-in laboratory and a notification outbox. Since 24 October 2026 no screen carries a demo or
sample label (the owner's decision); the payment, receipt and laboratory screens each say plainly that they are
simulated. Nothing is deployed.

```
platform/
  apps/api          Fastify + TypeScript API, SQLite (node:sqlite), migrations, seed, jobs, OpenAPI, tests
  apps/dashboard    The portal: member (/client), coach (/coach) and admin (/admin) workspaces and the three sign-in pages (/login/client, /login/coach, /login/admin); one Vite + React app served by the API from /portal/
  apps/mobile       Member app (Expo SDK 58, React Native, TypeScript), Android and iOS from one codebase
  packages/domain   Shared rules and zod schemas (account states, order and lab status machines, entitlements, payloads)
  packages/design-system   Copies of the brand book tokens and components (source of truth: ~/Desktop/drive/brand/book)
  tools/            End-to-end checks in headless Chrome (e2e_dashboard.py, e2e_website.py, e2e_habits.py, e2e_modules.py,
                    e2e_growth.py), the portal motion check (check_portal_motion.py), visual baselines (visual_baseline.py)
                    and the app smoke scripts
  docs/             DECISIONS.md (the policies the code applies), openapi.json, PRODUCTION_READINESS.md
  .env.example      Every setting, with placeholders; copy to .env for anything other than the demo defaults
```

The website itself lives in `~/Desktop/drive` (its own build and checks); the API serves it at `/` so one local origin
carries all four surfaces.

## Requirements

- Node.js 22.16 or newer (built and tested with 24.22.0) and npm.
- Google Chrome, for the end-to-end checks.
- Python 3.9, for the website build and the end-to-end checks (the Xcode licence was accepted on 22 Oct 2026, so the
  plain `python3` shim works on this Mac).
- For the Android build: JDK 21 and the Android SDK with `platforms;android-36`, `build-tools;36.1.0` and `platform-tools`
  (see Mobile below). For the iOS build: Xcode 27.1 with its licence accepted, and CocoaPods (see Mobile below).

## Run everything locally

```bash
cd ~/Desktop/Bioptime/platform
npm install                      # api, dashboard and shared packages
npm run api:reset-demo           # creates ./apps/api/data/bioptime.sqlite, runs migrations, seeds the demo
npm run dashboard:build          # builds apps/dashboard/dist, which the API serves at /portal/ (and at /login/*, /client, /coach, /admin)
npm run api                      # API with reload on http://localhost:3000 (npm run api:start without reload)
```

Then open:

| Surface | URL |
|---|---|
| Website | http://localhost:3000/ (packages, bloodwork, bespoke, sign-in, register, checkout, account pages talk to the API; so do the growth pages /discovery-call, /package-finder, /corporate and /webinars, and the footer's newsletter block) |
| Member portal | http://localhost:3000/client (sign in at /login/client), plus the module pages whose switches are on (see Modules) |
| Coach workspace | http://localhost:3000/coach (sign in at /login/coach): Today, Clients, Calendar, Bloodwork, Messages, My profile (coach ID, designation, working hours), Settings, plus the module pages, client-record tabs and Today cards whose switches are on |
| Admin workspace | http://localhost:3000/admin (sign in at /login/admin, MFA required): Overview, Clients (invite, ledger adjustments), Coaches, Assignments, Packages (publish/unpublish, enrolment rules, coupons), Approvals, Bloodwork, Orders, Website content (incl. images and section visibility), Theme (roll back), Analytics, Operations, Modules (needs `modules.manage` to switch or `settings.manage` for module settings), Integrations › LabStack (needs the `labstack.manage` permission), Audit log, Users and permissions, Settings, plus the module pages whose switches are on and whose permission you hold |
| Member activation | http://localhost:3000/login/client/activate?token=… (the link an administrator's invitation sends) |
| Phone sign-in | http://localhost:3000/login/client/phone, linked from the member sign-in page while the `phone_sign_in` switch is on (see Phone sign-in) |
| Old entry points | /dashboard → the signed-in role's workspace; /dashboard/login → /login/coach; /login is the website's three-door chooser; /account → /client |
| API | http://localhost:3000/api, OpenAPI at http://localhost:3000/api/openapi.json (also `docs/openapi.json`) |
| Health | http://localhost:3000/api/health |

The portal can also run on its own dev server with `npm run dashboard` (http://localhost:5173, proxying `/api` to
http://localhost:3000).

### Demo accounts

All demo accounts live on the reserved `@demo.bioptime.test` domain and exist only in demo mode. They are synthetic.

| Role | Email | Password | Notes |
|---|---|---|---|
| Member | priya.nair@demo.bioptime.test (and 11 others, see `apps/api/src/seed/seed.ts`) | `Demo-Member-2026!` | Active with a package, a coach, a plan, a booking and a report |
| Coach | asha.menon@demo.bioptime.test (and 3 others) | `Demo-Coach-2026!` | Signs in at `/login/coach` with the email or the Coach ID on their profile (BPC-0001 …) |
| Admin | admin@demo.bioptime.test | `Demo-Admin-2026!` | MFA required |
| Owner | owner@demo.bioptime.test | `Demo-Owner-2026!` | MFA required |
| Owner | rohan@demo.bioptime.test, "Rohan (placeholder)" | `Demo-Rohan-2026!` | MFA required; placeholder until Rohan's real email |
| Owner | avinash@demo.bioptime.test, "Avinash (placeholder)" | `Demo-Avinash-2026!` | MFA required; placeholder until Avinash's real email |

Admin and owner use TOTP. In demo mode the secret is the fixed synthetic value in `seed.ts`
(`JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP`, usable in any authenticator app) and `GET /api/auth/demo/totp?email=owner@demo.bioptime.test`
returns the current code. Both exist only when `BIOPTIME_MODE=demo`. Two-factor authentication is mandatory for
administrators and owners: an account without an authenticator gets `MFA_ENROLMENT_REQUIRED` and enrols before anything
else. Real owner accounts are made with `npm run create-owner -w @bioptime/api -- --email <email> --name "<name>"`, which
takes no password (the owner sets it from a single-use link); see `docs/DECISIONS.md`.

The demo seed also switches phone sign-in on and confirms the seeded members' phone numbers (listed in `seed.ts`). No
text message is sent: on the phone sign-in page, **Fill in the preview code** reads the code from
`POST /api/auth/demo/phone-code`, which exists only in demo mode and answers only for a seeded member's confirmed number.
The per-number limits (3 codes in 15 minutes, 5 in 24 hours) always apply, even with `RATE_LIMITS=off`, so repeated tries
should use different seeded members.

### Modes and secrets

`BIOPTIME_MODE` is `demo` (default), `development` or `production`. The default applies only on a loopback `HOST`; a server bound to any other address must set the mode explicitly, because demo mode returns activation and reset links in API responses. Production refuses to start with placeholder
secrets, with `LABSTACK_MODE=live` but no key, with the simulator as the payment provider, with the email outbox, without an
https `PUBLIC_ORIGIN`, or with local private-file storage while a module that stores private files is switched on (see
Modules), and it refuses to switch phone sign-in on while SMS is the outbox (see Phone sign-in). No credential is
committed anywhere in this repository; `.env` is ignored by git. The demo mode endpoints (`/api/auth/demo/totp`,
`/api/payments/simulator/complete`, `/api/labstack/standin/step`) are not registered outside demo and development;
`POST /api/auth/demo/phone-code` is registered in demo mode only.

**Open preview (no sign-in, for now; owner decision of 30 October 2026).** With `BIOPTIME_MODE=demo` and
`OPEN_PREVIEW=1` every workspace opens without signing in: `GET /api/public/config` says `openPreview: true`, and
`POST /api/auth/open-preview { workspace: member | coach | admin }` opens Priya Nair, Asha Menon or Rohan (owner) on the
server and answers exactly as `/api/auth/login` (cookie for the web, token for the app), audited as
`auth.open_preview`. While it is on, the few administrative actions that could lock the owner out or leave a lasting
way in (new administrators, role changes, 2FA resets, staff and preview-account passwords, closing the preview
accounts) answer `403 OPEN_PREVIEW_RESTRICTED`; everything else works. Any other mode with `OPEN_PREVIEW=1` refuses to
start. To turn sign-in back on, unset `OPEN_PREVIEW` and restart: the route disappears (404) and the sessions the preview
opened are signed out at that start. The audit of every admin route and the full list are in `docs/DECISIONS.md`
("Open preview").

### Environment

The API reads `platform/.env` (never committed) and then the process environment, and validates both
(`apps/api/src/config.ts`). `.env.example` lists every variable with a placeholder. Relative paths resolve from `apps/api`.

| Variable | Default | What it sets |
|---|---|---|
| `BIOPTIME_MODE` | `demo` | `demo`, `development` or `production` (see Modes and secrets) |
| `PORT`, `HOST` | `3000`, `127.0.0.1` | Where the API listens |
| `PUBLIC_ORIGIN` | `http://localhost:3000` | Cookies, links in messages, webhook addresses; https in production |
| `CORS_ORIGINS` | `http://localhost:5173,http://localhost:8081` | Extra origins allowed by CORS (portal dev server, Expo) |
| `DATABASE_PATH` | `./data/bioptime.sqlite` | The SQLite file |
| `REPORTS_DIR`, `ASSETS_DIR` | `./data/reports`, `./data/assets` | Report documents; website images administrators upload |
| `PRIVATE_FILES_DIR` | `./data/private` | Progress photos, meal photos, message attachments and data exports, outside every static folder |
| `STORAGE_PROVIDER` | `local` | The only value; production refuses it while a module that stores private files is on |
| `SESSION_SECRET`, `TOKEN_SECRET` | demo values | Required outside demo (`openssl rand -hex 32`) |
| `WEBSITE_DIR`, `DASHBOARD_DIR` | `../../../../drive`, `../dashboard/dist` | The website and the portal build the API serves |
| `PAYMENT_PROVIDER`, `PAYMENT_WEBHOOK_SECRET` | `simulator`, demo value | The simulator is the only provider so far |
| `LABSTACK_MODE` | `standin` | `standin` or `live` (live needs `LABSTACK_API_KEY` and an agreed `LABSTACK_WEBHOOK_VALUE`) |
| `LABSTACK_BASE_URL`, `LABSTACK_API_KEY`, `LABSTACK_API_KEY_NEXT`, `LABSTACK_WEBHOOK_HEADER`, `LABSTACK_WEBHOOK_VALUE` | v1.3 integration URL, empty, empty, `key`, demo value | The LabStack connection and key rotation |
| `LABSTACK_STANDIN_SPEED`, `LABSTACK_SAFETY_NET_MINUTES`, `LABSTACK_CATALOGUE_SYNC_HOURS` | `fast`, `30`, `6` | Stand-in pace (`fast`, `realistic`, `manual`); safety-net and catalogue jobs |
| `LABSTACK_PARTNER_KEY` | empty | Optional; the admin LabStack page shows only whether it is set. No widget token is minted yet |
| `EMAIL_PROVIDER`, `SMS_PROVIDER`, `PUSH_PROVIDER`, `EMAIL_FROM` | `outbox` | The outbox is the only value: messages are recorded, never delivered (phone codes with the digits withheld) |
| `MEETING_PROVIDER`, `CALENDAR_PROVIDER`, `VIDEO_PROVIDER`, `AI_PROVIDER` | `none` | The only value until an adapter exists; Admin › Integrations names what is missing |
| `ASSIGNMENT_POLICY`, `ENTITLEMENT_UNIT` | `manual`, `collection` | Who confirms a coach assignment; what one bloodwork entitlement means |
| `SESSION_DAYS`, `ADMIN_SESSION_HOURS` | `30`, `12` | Session lifetimes |
| `GOOGLE_SIGN_IN_WEB_CLIENT_ID`, `GOOGLE_SIGN_IN_IOS_CLIENT_ID`, `GOOGLE_SIGN_IN_ANDROID_CLIENT_ID` | empty | Sign in with Google for members: the owner's Google Cloud OAuth client IDs (public identifiers, returned by `GET /public/config`); Google is offered once any is set |
| `APPLE_SIGN_IN_BUNDLE_IDS`, `APPLE_SIGN_IN_SERVICES_ID` | empty, empty | Sign in with Apple for members: the app's bundle IDs (comma list; the app's is `com.bioptime.app`, with Sign in with Apple enabled on it in the Apple Developer Program) and the Services ID for the web and Android flows. Apple is offered once either is set and Apple's signing keys can be fetched; with every default empty neither button is offered. Demo mode also offers the stand-in provider |
| `JOBS_ENABLED`, `RATE_LIMITS`, `TRUST_PROXY` | `true`, `on`, empty | Background jobs in the server process; per-IP limits; which proxies may set `X-Forwarded-For` |

The app reads `EXPO_PUBLIC_API_BASE` and `EXPO_PUBLIC_ALLOW_SERVER_OVERRIDE` (see Mobile app). The end-to-end scripts read
`BASE`, the server they drive.

## Modules

Fourteen feature-flagged modules sit on top of the core platform: the twelve of 23 October 2026, and `growth` and
`referrals`, added on 24 October. Each has one switch, a row in `feature_flags` named after the module, and one
descriptor per surface: `apps/api/src/modules/<key>.ts` (listed in `modules/index.ts`),
`apps/dashboard/src/modules/<key>/` and `apps/mobile/src/lib/modules/<key>.ts`. Production starts with every module off;
`npm run api:reset-demo` switches every module and part on in demo mode, and `phone_sign_in` too (see Phone sign-in),
but not `progressPhotos`, which an owner switches on. While a module is off its routes answer `403 FEATURE_DISABLED`,
and the portal and the app hide its pages, links, tabs and cards (they read the switches from `GET /api/public/config`).
Coach and member conversations, plans, bookings and reports are core and never switched.

| Module (switch) | Migrations | Member: portal · app | Coach and admin portal |
|---|---|---|---|
| Habits (`habits`) | `0009_habits.sql` | `/client/habits`, Home card · `habits.tsx` | Habits tab on the client record (admin: read only, `members.manage`); follow-up threshold on Modules |
| Progress (`progress`; photos also need `progressPhotos`) | `0010_progress.sql` | `/client/progress` gains Trends, Goals, Check-ins and Photos tabs · `progress.tsx`, `goals.tsx`, `checkin/[id].tsx`, `photos.tsx` (photos are added in the portal) | Goals and check-ins tab, Check-ins to review on Today, `/coach/checkin-templates`; `/admin/checkin-templates` (`library.manage`); photo retention on Modules |
| Billing (`billing`) | `0011_billing.sql` | `/client/billing` · `billing.tsx` | `/admin/billing` and a Billing tab on the client record (`orders.manage`), an Overview card; seller details and GST rate on Modules |
| Support (`support`; parts `support_requests`, `help_centre`, `imports`, each needing `support` too) | `0012_support.sql` | `/client/help` (articles, requests, the data export) · `help.tsx`, `support/[id].tsx` | `/coach/help`, onboarding card on Today; `/admin/support` (`operations.manage`), `/admin/help-articles` (`content.manage`), `/admin/imports` (`imports.manage`) |
| Nutrition (`nutrition`) | `0013_nutrition.sql`, `0025_nutrition_fixes.sql` | `/client/nutrition`, Home card · `nutrition.tsx`, `meal-log.tsx` (photos are added in the portal) | Nutrition tab, `/coach/meal-plans/:id`, `/coach/nutrition-library`; `/admin/nutrition-library` (`library.manage`) |
| Workouts (`workouts`) | `0014_workouts.sql`, `0026_workouts_fixes.sql` | `/client/workouts`, `/client/workouts/:id`, Home card · `workouts.tsx`, `workout/[id].tsx`, `workout-history.tsx` | Workouts tab, Today card, `/coach/exercise-library`, `/coach/workout-templates/:id`, `/coach/workout-programs/:id`; `/admin/exercise-library` (`library.manage`), Workouts tab (`members.manage`) |
| Lab follow-ups (`labFollowups`) | `0015_labFollowups.sql` | Next steps and a marker trend on the report page, Home card · `report/[id].tsx`, `lab-follow-ups.tsx` | Next steps on the report page, Lab next steps tab, Today card; `/admin/lab-follow-ups` (`reports.view`; changes need `integrations.manage`) |
| Live sessions (`sessions`; the public listing also needs `public_webinars`) | `0016_sessions.sql` | `/client/sessions`, Home card, calendar files and consultation summaries on Appointments · `sessions.tsx`, `session/[id].tsx` | `/coach/sessions`, Sessions tab, Today card, meeting link and summary on Appointments; `/admin/sessions` (`sessions.manage`) |
| Messaging (`messaging`: attachments and announcements) | `0017_messaging.sql` | Files in Messages, `/client/announcements`, Home card · `announcements.tsx` (the app opens files; adding them is portal only) | Files in Messages, `/coach/announcements`; `/admin/announcements` (`announcements.manage`) |
| Learning (`learning`) | `0018_learning.sql`, `0029_learning_fixes.sql` | `/client/learn` with course and lesson pages, Home card · `learn/index.tsx`, `learn/[lessonId].tsx` | `/coach/courses`, `/coach/training`, Learning tab; `/admin/learning` (`learning.manage`) |
| Coach AI (`ai`) | `0019_ai.sql` | `/client/coach-ai`, the member's own consent · `coach-ai.tsx` | `/coach/ai` and a Coach AI tab; `/admin/ai` usage counts (`ai.manage`); draft retention on Modules |
| LabStack operations (`labstackOps`) | none | none | Operations sections on Integrations › LabStack (`labstack.manage`) |
| Growth (`growth`) | `0031_growth_referrals_flags.sql` (the switch), `0033_growth.sql` | none: visitors without an account use the website's `/discovery-call`, `/package-finder`, `/calculators`, `/corporate` and `/webinars` pages and the footer newsletter block | `/coach/discovery-calls` (name, goals and times of the calls assigned to the coach, never the email or phone); `/admin/growth/discovery-calls` (with an Offered times tab) and `/:id`, `/admin/growth/corporate` and `/:id`, `/admin/growth/newsletter`, an Overview card (`growth.manage`) |
| Referrals (`referrals`) | `0031_growth_referrals_flags.sql` (the switch), `0034_referrals.sql` | `/client/refer` · `refer.tsx` (Me › Refer a friend); a referral code on registration (the website's `/register?ref=CODE`, the app's register screen) | `/admin/referrals` (`members.manage`) |

What each module may show to whom, and why, is in `docs/DECISIONS.md` (Modules).

### Phone sign-in

Members can sign in with a six-digit code sent to the phone number they confirmed. It is identity, not a module: one
switch of its own, `phone_sign_in` (`0035_phone_sign_in.sql`, off when it runs; `api/auth/phoneSignIn.ts`), listed on
Admin › Modules with the other stored switches. Pages: `/login/client/phone` and the app's `(auth)/phone.tsx`, linked
from the member sign-in screens while the switch is on; a member confirms their number on Profile in the portal and in the
app. Codes are stored only as HMACs, work once, for 10 minutes, with 5 attempts, and are limited per number (3 in 15
minutes, 5 in 24 hours) and per caller address. Asking for a code answers the same way for every number. SMS is the
outbox, which delivers nothing, and the answers say so; production refuses to switch it on (`SMS_NOT_CONFIGURED`) and its
routes answer `503 PHONE_SIGN_IN_UNAVAILABLE` there, whatever the switch says.

### Switching modules on and off

Sign in as the owner, or as an administrator who was granted `modules.manage` (not an administrator default), and open
**Admin › Modules** (`/admin/modules`). Each switch asks for a reason, which goes to the audit log
(`feature_flag.update`). A switch that is on can be narrowed to some roles, or to members holding chosen packages. An
administrator with `settings.manage` (a default) sees the module settings on the same page but no switches. Through the
API:

```bash
GET   /api/admin/modules             # switches and what each module registers (modules.manage)
PATCH /api/admin/modules             # { "key": "learning", "enabled": false, "reason": "…" }, optionally "audience": { "roles": […], "packageIds": […] }
GET   /api/admin/module-settings     # habit_followup_missed_days, progress_photo_retention_days, billing_entity, gst_rate_bp,
PATCH /api/admin/module-settings     # ai_draft_retention_days (settings.manage; { key, value, reason }; null means not decided)
```

Switching a module off deletes nothing it stored, and switching it back on brings everything back. While it is off:

- Its routes refuse at once, except the few that let people see or withdraw a consent or remove their own records:
  `GET|POST /me/ai/consent`, `POST /me/progress/photos/consent`, `DELETE /me/progress/photos/:id`,
  `DELETE /me/meal-logs/:id[/photo]`, `DELETE /conversations/:id/attachments/:attachmentId`,
  `POST /public/newsletter/unsubscribe` (leaving the newsletter), and the file links
  `POST /me/data-requests/:id/file-token` and `GET /billing/documents/file`. A portal or app already open may show its
  links until it reloads; the server still refuses.
- Its background jobs stop, except the privacy clean-up: `progress.photo_retention`, `messaging.attachments_cleanup`,
  `habits.habit_followup_privacy`, `ai.draft_retention` and `growth.privacy_retention`. Its event handlers do not run
  for events processed then.
- A reminder it queued that falls due is skipped (`skip_reason` `module_off`) and never sent later.
- Private files keep each module's own file rule: members still open their own photos; coaches open meal photos only
  while Nutrition is on, and progress photos only while Progress and `progressPhotos` are on.
- Production refuses to switch on Progress, Nutrition, Messaging or Support (they store private files) while
  `STORAGE_PROVIDER` is `local` (`STORAGE_NOT_CONFIGURED`), and refuses to start with one of them on.

### API surface by module

Paths are under `/api`; `{a,b}` means one route for each, and `[/:id]` one route with the segment and one without. The
running server describes every route at `/api/openapi.json`. `docs/openapi.json` (406 paths and 475 operations) was
last regenerated on 23 October 2026 and does not yet list the growth, referrals and phone sign-in routes;
`npm run openapi --workspace @bioptime/api` refreshes it. Every route below declares its module's switch (phone sign-in
its own), except the Foundation row, `POST /auth/register` (a core route) and the routes listed under Switching modules
on and off, which work while their module is off.

| Module | Member | Coach | Admin (permission) |
|---|---|---|---|
| Habits | `GET\|POST /me/habits`, `PATCH /me/habits/:id`, `POST /me/habits/:id/checkins`, `DELETE /me/habits/:id/checkins/:date` | `GET\|POST /coach/clients/:id/habits`, `PATCH /coach/habits/:id`, `POST /coach/habits/:id/archive` | `GET /admin/members/:id/habits` (`members.manage`) |
| Progress | `GET\|POST /me/goals`, `PATCH /me/goals/:id`, `POST /me/goals/:id/milestones`, `PATCH /me/goals/:id/milestones/:milestoneId`, `GET /me/checkins[/:id]`, `POST /me/checkins/:id/submit`, `GET /me/progress/series`, `GET /me/adherence`, `GET\|POST /me/progress/photos`, `PATCH\|DELETE /me/progress/photos/:id`, `POST /me/progress/photos/consent` | `GET\|POST /coach/clients/:id/goals`, `PATCH /coach/clients/:id/goals/:goalId`, `POST /coach/clients/:id/goals/:goalId/milestones`, `GET\|POST /coach/clients/:id/checkins`, `GET\|POST /coach/clients/:id/checkin-schedules`, `DELETE /coach/clients/:id/checkin-schedules/:scheduleId`, `GET /coach/checkins`, `POST /coach/checkins/:id/review`, `GET /coach/clients/:id/{progress/series,adherence,progress/photos}`, `GET\|POST /coach/checkin-templates` | `GET\|POST /admin/checkin-templates`, `PATCH /admin/checkin-templates/:id`, `POST /admin/checkin-templates/:id/publish` (`library.manage`); `GET /admin/members/:id/progress` (`members.manage`) |
| Billing | `GET /me/billing`, `GET /me/billing/documents/:id`, `POST /me/billing/documents/:id/file-token`, `POST /me/orders/:id/refund-request`, `POST /me/refund-requests/:id/withdraw`; the document link `GET /billing/documents/file` | none | `GET /admin/billing/summary`, `GET /admin/billing/documents[/:id]`, `POST /admin/billing/documents/:id/{file-token,void}`, `POST /admin/billing/orders/:id/issue`, `GET /admin/refund-requests`, `POST /admin/refund-requests/:id/decide` (`orders.manage`) |
| Support | Any signed-in user: `GET\|POST /support-requests`, `GET /support-requests/:id`, `POST /support-requests/:id/messages`, `GET /help/articles[/:slug]`. Member: `GET /me/data-exports`, `POST /me/data-requests/:id/file-token` | `GET /coach/onboarding` | `GET /admin/support-requests`, `GET\|PATCH /admin/support-requests/:id`, `POST /admin/support-requests/:id/messages` (`operations.manage`); `GET\|POST /admin/help-articles`, `GET\|PATCH /admin/help-articles/:id`, `POST /admin/help-articles/:id/{publish,unpublish}` (`content.manage`); `GET\|POST /admin/imports`, `GET /admin/imports/:id`, `POST /admin/imports/:id/{apply,send-invitations,cancel}` (`imports.manage`); `GET /admin/data-exports`, `POST /admin/data-exports/:id/generate` (`members.manage`) |
| Nutrition | `GET /me/nutrition`, `PUT /me/nutrition/profile`, `GET /me/meal-plan`, `GET\|POST /me/meal-logs`, `PATCH\|DELETE /me/meal-logs/:id`, `POST\|DELETE /me/meal-logs/:id/photo` | `GET /coach/clients/:id/nutrition`, `PUT /coach/clients/:id/nutrition/profile`, `POST /coach/meal-plans`, `GET\|PATCH /coach/meal-plans/:id`, `POST /coach/meal-plans/:id/{publish,archive}`, `GET /coach/nutrition-library`, `POST /coach/{foods,recipes}`, `POST /coach/meal-logs/:id/feedback` | `GET\|POST /admin/{foods,recipes}`, `PATCH /admin/{foods,recipes}/:id`, `POST /admin/{foods,recipes}/:id/status` (`library.manage`) |
| Workouts | `GET /me/workouts`, `GET /me/workouts/history`, `GET /me/workouts/:id`, `POST /me/workouts/:id/{complete,skip}` | `GET /coach/exercise-library`, `POST /coach/exercises`, `GET\|POST /coach/workout-templates`, `GET\|PATCH /coach/workout-templates/:id`, `GET\|POST /coach/workout-programs`, `GET\|PATCH /coach/workout-programs/:id`, `POST /coach/workout-programs/:id/{publish,archive}`, `GET /coach/clients/:id/workouts`, `GET /coach/workouts/recent`, `GET /coach/workouts/:id`, `POST /coach/workouts/:id/feedback` | `GET\|POST /admin/exercises`, `PATCH /admin/exercises/:id`, `POST /admin/exercises/:id/status`, `GET\|POST /admin/workout-templates`, `GET\|PATCH /admin/workout-templates/:id`, `POST /admin/workout-templates/:id/status` (`library.manage`); `GET /admin/members/:id/workouts`, `GET /admin/workouts/:id` (`members.manage`) |
| Lab follow-ups | `GET /me/lab-follow-ups`, `GET /me/lab-preparation` | `GET /coach/lab-follow-ups`, `GET /coach/clients/:id/lab-follow-ups`, `POST /coach/reports/:id/follow-ups`, `PATCH /coach/lab-follow-ups/:id` | `GET /admin/lab-follow-ups` (`reports.view`); `POST /admin/reports/:id/follow-ups`, `PATCH /admin/lab-follow-ups/:id` (`integrations.manage`) |
| Live sessions | `GET /me/sessions[/:id]`, `POST /me/sessions/:id/{register,cancel}`, `GET /me/sessions/:id/ics`, `GET /me/appointments/:id/ics`, `GET /me/consultation-summaries`. Public (also `public_webinars`): `GET /public/webinars`, `POST /public/webinars/:id/register` | `GET\|POST /coach/sessions`, `GET\|PATCH /coach/sessions/:id`, `POST /coach/sessions/:id/{publish,cancel,complete,attendance}`, `GET /coach/sessions/:id/{registrations,ics}`, `PATCH /coach/appointments/:id/meeting`, `GET\|POST /coach/appointments/:id/summary`, `GET /coach/appointments/:id/ics`, `GET /coach/consultation-follow-through`, `GET /coach/clients/:id/sessions` | `GET\|POST /admin/sessions`, `GET /admin/sessions/hosts`, `GET\|PATCH /admin/sessions/:id`, `POST /admin/sessions/:id/{publish,cancel,complete,attendance}`, `GET /admin/sessions/:id/{registrations,ics}`, `POST /admin/sessions/:id/registrations/:registrationId/cancel` (`sessions.manage`); `GET /admin/members/:id/sessions` (`members.manage`) |
| Messaging | Participants: `GET\|POST /conversations/:id/attachments`, `DELETE /conversations/:id/attachments/:attachmentId`, `POST /attachments/:id/file-token`. Member: `GET /me/announcements`, `POST /me/announcements/:id/read` | `GET\|POST /coach/announcements`, `POST /coach/announcements/:id/withdraw` | `GET\|POST /admin/announcements`, `GET /admin/announcements/options`, `PATCH /admin/announcements/:id`, `POST /admin/announcements/:id/{publish,withdraw}` (`announcements.manage`) |
| Learning | `GET /me/courses[/:id]`, `POST /me/courses/:id/{enroll,leave}`, `GET /me/lessons/:id`, `POST /me/lessons/:id/{start,complete}` | `GET /coach/courses[/:id]`, `GET /coach/lessons/:id`, `POST /coach/clients/:id/courses`, `GET /coach/clients/:id/learning`, `GET /coach/training[/:id]`, `POST /coach/training/:id/enroll`, `POST /coach/lessons/:id/{start,complete}` | `GET /admin/learning/options`, `GET\|POST /admin/courses`, `GET\|PATCH /admin/courses/:id`, `POST /admin/courses/:id/{publish,unpublish,archive,reorder,modules}`, `PATCH\|DELETE /admin/course-modules/:id`, `POST /admin/course-modules/:id/lessons`, `GET\|PATCH\|DELETE /admin/lessons/:id`, `POST /admin/lessons/:id/{publish,unpublish}` (`learning.manage`); `GET /admin/members/:id/learning` (`members.manage`) |
| Coach AI | `GET\|POST /me/ai/consent` (works while the module is off) | `GET /coach/ai/status`, `GET\|POST /coach/ai/drafts`, `GET /coach/ai/drafts/:id`, `POST /coach/ai/drafts/:id/{accept,discard}` | `GET /admin/ai/usage` (`ai.manage`) |
| LabStack operations | none | none | `GET /admin/integrations/labstack/operations` (`labstack.manage`) |
| Growth | Public, no account: `GET /public/discovery-calls/slots`, `POST /public/discovery-calls`, `POST /public/corporate-enquiries`, `POST /public/newsletter`, `POST /public/newsletter/{confirm,unsubscribe}` | `GET /coach/growth/discovery-calls` | `GET /admin/growth/{summary,assignees}`, `GET /admin/growth/discovery-calls[/:id]`, `PATCH /admin/growth/discovery-calls/:id`, `POST /admin/growth/discovery-calls/:id/notes`, `GET\|POST /admin/growth/slots`, `POST /admin/growth/slots/:id/withdraw`, `GET /admin/growth/corporate[/:id]`, `PATCH /admin/growth/corporate/:id`, `POST /admin/growth/corporate/:id/notes`, `GET /admin/growth/newsletter`, `GET /admin/growth/newsletter/export.csv`, `POST /admin/growth/newsletter/:id/unsubscribe` (`growth.manage`) |
| Referrals | `GET /me/referrals`; a code arrives with `POST /auth/register` (`referralCode`), recorded only while the module is on | none | `GET /admin/referrals` (`members.manage`) |
| Phone sign-in (switch `phone_sign_in`, not a module) | Signed out: `POST /auth/phone/{start,verify}`. Member: `POST /auth/phone/confirm/start`, `POST /auth/phone/confirm`. Demo mode only: `POST /auth/demo/phone-code` | none | none (the switch is on `/admin/modules`) |
| Foundation (no switch) | Any signed-in user: `POST /me/devices`, `DELETE /me/devices/:id`, `PUT /notification-preferences/quiet-hours`, `POST /files/:id/token`; `GET /files/download` takes the token instead | the same routes | `GET\|PATCH /admin/modules` (`modules.manage`); `GET\|PATCH /admin/module-settings`, `GET /admin/integrations` (`settings.manage`) |

### Migrations

`apps/api/src/db/migrations/`. The server applies every file not yet recorded in `schema_migrations`, in name order and
each in its own transaction, when it starts (`npm run api:migrate` does the same without starting). An applied file is
never edited; a change is a new, additive file.

| File | What it adds |
|---|---|
| `0001_init.sql` | The core schema: identity, packages, orders, entitlements, assignments, appointments, plans, bloodwork, messaging, notifications |
| `0002_coach_notes.sql` | Coach notes about a client |
| `0003_cms_permissions.sql` | Website content, theme tokens, administrator permissions, coupons, package visibility, the append-only audit log |
| `0004_identity_notes.sql` | Coach and member codes, coach designation, note visibility |
| `0005_assets_packages.sql` | Uploaded website images, package enrolment rules |
| `0006_review_fixes.sql` | A bespoke approval binds to the terms it approved |
| `0007_withdraw_stale_invitations.sql` | Withdraws coach invitations whose account is no longer invited |
| `0008_foundation.sql` | Feature flags, the reminder queue, push devices, quiet hours, private-file references, consent and progress-source rebuilds, the `SUP` and `CRN` sequences |
| `0009_habits.sql` … `0019_ai.sql` | One per module: habits, progress, billing, support, nutrition, workouts, labFollowups, sessions, messaging, learning, ai |
| `0020_integration_core.sql` | `reminders.skip_reason` (why a due reminder was skipped) |
| `0021_integration_admin.sql` | The team's note on a data request, kept apart from the member's note |
| `0025_nutrition_fixes.sql` | A meal plan revision's title stays on the draft until it is published |
| `0026_workouts_fixes.sql` | A workout programme revision's title and start date stay on the draft until it is published |
| `0029_learning_fixes.sql` | When a coach's assignment of a course began (`course_enrollments.assigned_at`) |
| `0031_growth_referrals_flags.sql` | The `growth` and `referrals` switches, off (24 October 2026) |
| `0033_growth.sql` | Growth: offered call times, discovery call requests, corporate enquiries, newsletter subscribers (double opt-in), the team's notes; the `DC` and `CE` reference sequences |
| `0034_referrals.sql` | Referrals: each member's referral code, and the members who joined with one |
| `0035_phone_sign_in.sql` | The `phone_sign_in` switch, off, and phone sign-in codes (stored only as HMACs of the number and the code) |

There is no file numbered 0022 to 0024, 0027, 0028, 0030 or 0032.

## Checks

```bash
npm run typecheck                                   # api, dashboard, shared packages
npm run api:test                                    # 438 unit and integration tests in 41 files (table below)
BASE=http://127.0.0.1:<port> /Library/Developer/CommandLineTools/usr/bin/python3 -I tools/e2e_dashboard.py   # coach, owner and member journeys through the three workspaces
BASE=http://127.0.0.1:<port> /Library/Developer/CommandLineTools/usr/bin/python3 -I tools/e2e_website.py     # visitor to paid member
BASE=http://127.0.0.1:<port> /Library/Developer/CommandLineTools/usr/bin/python3 -I tools/e2e_habits.py      # Habits: member, coach with and without sharing, owner
BASE=http://127.0.0.1:<port> /Library/Developer/CommandLineTools/usr/bin/python3 -I tools/e2e_modules.py     # the twelve modules of 23 October
BASE=http://127.0.0.1:<port> /Library/Developer/CommandLineTools/usr/bin/python3 -I tools/e2e_growth.py      # the growth pages on the website, the admin and coach pages
BASE=http://127.0.0.1:<port> /Library/Developer/CommandLineTools/usr/bin/python3 -I tools/check_portal_motion.py   # the portal's 3D and motion layer runs, stands down and stays usable
/Library/Developer/CommandLineTools/usr/bin/python3 -I tools/test_visual_baseline.py   # the visual baseline tool's options (no browser)
cd ~/Desktop/drive && python3 tools/check_site.py   # the website's own suite (crawl, SEO, headers, 3 widths, contrast…)
cd ~/Desktop/drive && python3 tools/check_motion3d.py   # the website's 3D and depth layer
cd apps/mobile && npx tsc --noEmit                  # the app
```

Every end-to-end script and `check_portal_motion.py` writes records or sessions, so each runs against a scratch server
only: its own `DATABASE_PATH`, seeded with `reset-demo`, serving a portal build through `DASHBOARD_DIR` (built with
`npx vite build --outDir <scratch>/dist` in `apps/dashboard`, never into `dist` while the demo runs). All of them refuse
the live demo's ports 3000, 3100 and 3101. `e2e_dashboard.py`, `e2e_website.py`, `e2e_habits.py` and `e2e_modules.py`
go further and accept only an explicit port on 127.0.0.1, localhost, [::1], `*.localhost` or `*.test`, so with `BASE`
unset they stop at once and say why. The five `e2e_*` scripts take `E2E_OUT` (screenshots, report and Chrome profile;
defaults `.local/e2e/`, `.local/e2e-web/`, `.local/e2e/habits/`, `.local/e2e/modules/`, `.local/e2e-growth/`) and
`E2E_CDP_PORT` (defaults 9343, 9345, 9351, 9470 and 9560), so parallel runs never share a Chrome profile or DevTools
port. `check_portal_motion.py` takes `PORTAL_MOTION_OUT` (default `.local/portal-motion/`) and `CDP_PORT` (default 9495),
and `PORTAL_MOTION_ONLY=phone,motion` runs only the named profiles (motion, reduced, nowebgl, lowpower, phone, phonelink;
a full run names none). Its phone profile checks the sign-in and activation pages at 390x844, 375x667 and 360x640: the
scene is live, sits under the card, never covers it, and, comparing two lossless screenshots, changes no pixel on the
card while it lights the screen around it. Do not build the portal into `dist` while a script runs.
`npm run api:reset-demo` puts the default database back to the seeded state at any time.

The app has its own end-to-end check, `BASE=http://127.0.0.1:<port> /Library/Developer/CommandLineTools/usr/bin/python3 -I
tools/e2e_app.py`, which drives the Expo web build of `apps/mobile` in headless Chrome through `tools/app_harness.py`
(start and stop of `npx expo start --web --port <APP_PORT> --clear` in its own process group with
`EXPO_PUBLIC_API_BASE=<BASE>`, in-app navigation that keeps the in-memory session, clicks by text, inputs by label,
console errors, screenshots, a sign-in per workspace). `BASE` is a scratch API started with
`CORS_ORIGINS=http://localhost:<APP_PORT>` (the check refuses to start otherwise); `APP_PORT` defaults to 8121,
`APP_URL=http://localhost:<port>` drives an Expo server that is already running, `APP_DIR` points at a copy of the app,
`E2E_APP_ONLY=member,auth,coach,admin` picks sections, `E2E_OUT` defaults to `.local/e2e/app/` and `E2E_CDP_PORT` to 9580.
The member section signs in as Priya and opens every member screen (her laboratory report, check-in and workout screens
open as Ananya, whom the seed gives those records); auth covers sign-out, the reset flow, the registration form's
validation, the phone code with the preview code, the chooser, the coach and administrator sign-ins (WRONG_WORKSPACE,
MFA_REQUIRED, the preview authenticator code) and the stand-in Google / Apple sign-in with its finish-the-account step;
coach and admin sign in and check the workspace shells, and run `tools/e2e_app_coach.py` / `tools/e2e_app_admin.py`
(`run(app, ctx)`) when those exist. A screen the tree does not have yet is a `skip … not built yet` line, never a
failure. The check refuses to start when `E2E_CDP_PORT` or `APP_PORT` is already in use, and stops its Expo process
group and Chrome whatever fails after they started. Last run on 29 October 2026 against a freshly seeded scratch API:
148 checks, 0 failed, 0 skipped, 96 s in all (Expo up in 8 s, first screen 9 s, member 50 s, auth 22 s, coach 3 s,
admin 3 s). A full run makes twelve `POST /auth/login` calls, all counted by the server's limit of about 20 per
10 minutes, so two full runs inside ten minutes reach it: run one section at a time (`E2E_APP_ONLY`) when iterating, or
restart the scratch API.

Last runs reported on 24 October 2026, each against its own freshly seeded scratch server and portal build:
`e2e_dashboard.py` 138 of 138, `e2e_website.py` 55 of 55, `e2e_habits.py` 28 of 28, `e2e_modules.py` 270 of 270,
`e2e_growth.py` 83 of 83 and `check_portal_motion.py` 158 of 158. Later changes that day were not re-run through them.

`npm run api:test` on 24 October 2026: 438 tests in 41 files; 437 passed and one failed, `portalShared` "modules page:
each part switch is listed under its module…", which does not yet expect the stored `phone_sign_in` switch.

| Suite | Tests | Suite | Tests |
|---|---|---|---|
| `unit/rules` | 8 | `integration/habits` | 14 |
| `unit/entitlements` | 4 | `integration/progress` | 15 |
| `unit/payments` | 4 | `integration/billing` | 14 |
| `unit/assignment-appointments` | 5 | `integration/support` | 18 |
| `unit/theme` | 5 | `integration/nutrition` | 15 |
| `unit/habits` | 10 | `integration/workouts` | 16 |
| `integration/auth` | 6 | `integration/labFollowups` | 15 |
| `integration/journeys` | 7 | `integration/sessions` | 16 |
| `integration/coach-access` | 8 | `integration/messaging` | 11 |
| `integration/admin-controls` | 8 | `integration/learning` | 12 |
| `integration/theme` | 2 | `integration/ai` | 14 |
| `integration/portal` | 11 | `integration/labstackOps` | 6 |
| `integration/review-fixes` | 9 | `integration/foundation` | 13 |
| `integration/review-round2` | 32 | `integration/portalShared` | 16 |
| `integration/motionLayer` | 15 | `integration/integration-core` | 12 |
| `integration/round7-core` | 9 | `integration/integration-admin` | 5 |
| `integration/round7-privacy` | 4 | `integration/consentsAi` | 8 |
| `integration/final-fixes` | 3 | `integration/growth` | 13 |
| `integration/referrals` | 8 | `integration/phone-sign-in` | 17 |
| `integration/round8-labels` | 9 | `integration/round8-leftovers` | 8 |
| `integration/appRound8` (the app's source checks and depth maths) | 13 | | |

## Mobile app

```bash
cd apps/mobile
npm install
npx expo start            # Metro; press a for the Android emulator, i for the iOS simulator (needs Xcode)
```

The app reads the API address from `EXPO_PUBLIC_API_BASE` (see `.env.example`); unset, the Android emulator uses
`http://10.0.2.2:3000` and the iOS simulator `http://localhost:3000`. In development builds, and in builds made with
`EXPO_PUBLIC_ALLOW_SERVER_OVERRIDE=1` (the demo APK), a tester can change it in the app under **Me › Server**; store
builds ignore any override. The session token lives in the device's secure store; the server requires the `X-Bioptime-Client: mobile`
header for every call.

Android build without EAS:

```bash
export JAVA_HOME=$(/usr/libexec/java_home -v 21)   # or your JDK 21 home
export ANDROID_HOME=$HOME/Library/Android/sdk
cd apps/mobile/android                    # android/ is kept by hand and is part of the sources: never run
./gradlew assembleDebug                   # expo prebuild for Android (apps/mobile/README.md, Build); app/build/outputs/apk/debug/app-debug.apk
```

`./gradlew assembleRelease` writes `android/app/build/outputs/apk/release/app-release.apk`: the standalone build with the
JavaScript bundled, which is what `artifacts/bioptime-0.1.0-android-demo-release.apk` is (checksums in
`artifacts/SHA256SUMS`). To build a release APK that starts on your own server, set its address when you build:
`EXPO_PUBLIC_API_BASE=<your server URL> ./gradlew :app:createBundleReleaseJsAndAssets --rerun assembleRelease`
(the address is a Gradle input of the bundle, and `--rerun` forces a fresh bundle). Without the
variable the release build starts on the emulator's `http://10.0.2.2:3000`. Both variants are signed with the Android debug key: they install on emulators and test phones
but are not store builds. The debug variant needs Metro running (`npx expo start`, `adb reverse tcp:8081 tcp:8081`).
A store build needs an upload keystore created and kept by the owner, an HTTPS API address and cleartext turned off
(`docs/PRODUCTION_READINESS.md`). `sh tools/emulator_smoke.sh [apk]` installs an APK on the running emulator, signs in
as the demo member and screenshots the tabs into `.local/emulator/`.
iOS: `npx expo prebuild --platform ios`, then `npx expo run:ios --configuration Release --no-bundler --device <simulator
udid>` builds the standalone app and installs it on the iOS Simulator (done on this Mac on 22 Oct 2026 with Xcode 27.1;
`open ios/Bioptime.xcworkspace` works too). CocoaPods here is installed on the system Ruby without sudo or Homebrew
(`apps/mobile/README.md` has the pinned-gem recipe); export `PATH="$HOME/.gem/ruby/2.6.0/bin:$PATH"` and
`LANG=en_US.UTF-8` first. Simulator builds need no certificate; a device or TestFlight build needs the owner's Apple
Developer account and was not made. `sh tools/ios_smoke/simulator_smoke.sh` signs in on the booted simulator through
the real UI (an XCUITest that targets the installed app) and screenshots the tabs into `.local/simulator/`.

## How the pieces fit

- `packages/domain` holds the rules every surface shares: account states, order transitions, the seven laboratory
  statuses and the LabStack mapping, the custom-plan state machine, entitlement semantics and the request schemas.
- The API owns all state. Orders become paid only through a signature-verified provider webhook; activation creates the
  programme and its entitlements exactly once; the hybrid assignment engine recommends a coach and the policy decides
  whether a person confirms; laboratory bookings move only on vendor events, a coach's review or an audited owner override.
- The dashboard and the app are thin: they call the API, show what it returns, and say plainly where payments and the
  laboratory are simulated. The website's public pages are static and gain live prices, the catalogue, sign-in, checkout,
  the account page and the growth forms when served by (or pointed at) the API.
- Every mutation writes an audit event; domain events go through an outbox with retries; notifications are recorded,
  and email, SMS and push are "logged" until a provider is configured.
- Each module is one descriptor per surface. In the API it brings its routes, jobs, event handlers, private-file rules,
  adherence provider, data export sections and demo data, and its switch gates them, with the exceptions listed under
  Switching modules on and off. Coach payloads
  pass the field policy's safety net, which strips and reports any restricted key a presenter left in.
