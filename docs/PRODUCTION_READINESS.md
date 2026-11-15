# Production readiness

The maintained checklist lives at [../../docs/PRODUCTION_READINESS.md](../../docs/PRODUCTION_READINESS.md)
(the Bioptime documentation folder). This file keeps the blockers that depend on someone other than the engineer,
with an owner and a status, so the platform README can point at one place.

| Blocker | Owner | Status (22 Oct 2026) |
|---|---|---|
| LabStack API key, webhook secret and a test store | Bioptime ↔ LabStack | Not requested yet; the stand-in vendor runs; the integration page shows `pending_configuration` in production and `standin` otherwise. Nothing in the live adapter has been exercised against the real service |
| Payment provider keys and webhook registration | Bioptime | Simulator in use; captures are signature-verified by the simulator's own secret |
| Email, SMS and push credentials | Bioptime | Outbox only; the app hides the push switch and says so |
| Android upload keystore | Bioptime | The release APK is debug-signed and labelled so; no keystore was generated |
| Licensed photography and model releases | Bioptime | Existing site imagery has unconfirmed provenance (`drive/assets/README.md`); no stock or generated images were added |
| Legal review of terms and privacy; health-content reviewer | Bioptime | Draft notices on the site |
| First owner account with a real authenticator; demo accounts off | Bioptime | Seed runs in demo mode only |
| Owner-written website copy (about, services, testimonials) | Bioptime | CMS fields exist; testimonials were deliberately not seeded |
| Package prices and enrolment policy values | Bioptime | The seeded prices are placeholders, unlabelled on screen since 24 Oct 2026 (owner decision; the checkout says the payment is simulated); policies default to current behaviour (see DECISIONS.md) |
