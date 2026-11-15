/* One descriptor per integration: what runs today (the mode), whether it is live, simulated, on local disk or pending
   configuration, the names of the environment variables it reads, and exactly what is missing before it can go live.
   Values are never read out: only whether a required one is present. Shown at GET /admin/integrations
   (settings.manage). The laboratory row carries its detail only for administrators holding labstack.manage; everyone
   else is pointed at /admin/integrations/labstack, where LabStack is administered. */
import type { Ctx } from '../context.js';
import type { Services } from '../services.js';
import { hasPermission } from '../auth/permissions.js';
import { getSetting } from '../domain/settings.js';
import { MODULES } from '../modules/index.js';
import { providerRequirements } from './ai.js';

// Apple's published signing keys (api/auth/social.ts KEY_URLS.apple; written out here so this file, which the module
// registry imports, never imports the auth service)
const APPLE_KEYS_URL = 'https://appleid.apple.com/auth/keys';

// The two Coach AI requirements api/domain/ai.ts names beyond the provider's own (written out, not imported: that file
// sits in an import cycle with the module registry; a test keeps the wording equal to AI_CONSENT.missing there).
const AI_RETENTION_MISSING = 'An owner decision on how long drafts are kept: Coach AI draft retention on /admin/modules';
const AI_CONSENT_MISSING = 'Counsel-approved wording for the ai_processing consent, and the matching privacy notice update (owner decision)';

export type IntegrationKey = 'payments' | 'lab' | 'email' | 'sms' | 'push' | 'meetings' | 'calendar' | 'video' | 'ai' | 'storage' | 'identity';
export type IntegrationStatus = 'live' | 'simulated' | 'local' | 'pending_configuration';

export type IntegrationDescriptor = {
  key: IntegrationKey;
  label: string;
  /** The provider value in use (simulator, standin, outbox, none, local …). */
  mode: string;
  status: IntegrationStatus;
  configured: boolean;
  /** Environment variables this integration reads (names only). */
  variables: string[];
  /** Of those, the ones that may stay empty (names only). */
  optionalVariables?: string[];
  /** What is missing before it can go live, named exactly; empty when nothing is. */
  missing: string[];
  note: string;
  /** Modules that need it. */
  usedBy: string[];
};

export type RestrictedDescriptor = { key: 'lab'; label: string; restricted: true; managedUnder: string; permission: 'labstack.manage' };

const hasValue = (v: string | undefined) => !!v && !/demo|change-me/i.test(v);

/** The modules whose code sends on each messaging channel, as the code stands: the channels each passes to notify()
 *  and to the reminders queue (notify() without channels means in-app, email and push; a reminder without channels
 *  means in-app and push). Core features (sign-in, orders, appointments, bloodwork) use these channels whatever the
 *  modules do and are not listed. Keep in step with the code when a module changes its channels.
 *  - habits: a coach-added habit (in-app) and habit reminders (in-app, push).
 *  - progress: goals and check-ins (notify defaults; milestones in-app and push), the weekly check-in reminder.
 *  - billing: documents and refund decisions (in-app, push); approving a refund request starts the core refund,
 *    whose notice is sent in-app, by email and by push.
 *  - support: the data export is ready, a reply to a support request (notify defaults), import invitations (email).
 *  - nutrition, workouts, labFollowups, learning: notify defaults (labFollowups' preparation reminder: in-app, push).
 *  - sessions: registrations and summaries (notify defaults), a visitor's registration emails, session reminders
 *    (in-app, email, push).
 *  - messaging: announcements (in-app, push); attachments send nothing.
 *  - ai, labstackOps: send nothing.
 *  No module sends SMS. Phone sign-in (identity, not a module: api/auth/phoneSignIn.ts) sends its codes through the
 *  SMS adapter, and the SMS row's note says so. */
const MESSAGE_CHANNEL_USERS: Record<'email' | 'sms' | 'push', string[]> = {
  email: ['progress', 'billing', 'support', 'nutrition', 'workouts', 'labFollowups', 'sessions', 'learning'],
  sms: [],
  push: ['habits', 'progress', 'billing', 'support', 'nutrition', 'workouts', 'labFollowups', 'sessions', 'messaging', 'learning'],
};

export function integrations(ctx: Ctx, services: Services): Array<IntegrationDescriptor | RestrictedDescriptor> {
  const c = ctx.config;
  const out: Array<IntegrationDescriptor | RestrictedDescriptor> = [];

  const payments = services.payments.name;
  out.push({
    key: 'payments', label: 'Payments', mode: payments, status: payments === 'simulator' ? 'simulated' : 'live', configured: payments !== 'simulator',
    variables: ['PAYMENT_PROVIDER', 'PAYMENT_WEBHOOK_SECRET'],
    missing: payments === 'simulator' ? ['A payment gateway adapter: PAYMENT_PROVIDER accepts only "simulator"', ...(hasValue(c.PAYMENT_WEBHOOK_SECRET) ? [] : ['PAYMENT_WEBHOOK_SECRET from the gateway'])] : [],
    note: payments === 'simulator' ? 'Checkouts and webhooks are simulated; no money moves. Production refuses the simulator.' : 'Captures are signature-verified before anything activates.',
    usedBy: ['billing'],
  });

  if (hasPermission(ctx, 'labstack.manage')) {
    const live = c.LABSTACK_MODE === 'live';
    const missing = [...(c.LABSTACK_API_KEY ? [] : ['LABSTACK_API_KEY']), ...(hasValue(c.LABSTACK_WEBHOOK_VALUE) ? [] : ['LABSTACK_WEBHOOK_VALUE agreed with LabStack'])];
    out.push({
      key: 'lab', label: 'Laboratory (LabStack)', mode: c.LABSTACK_MODE, status: live ? 'live' : 'simulated', configured: live && missing.length === 0,
      variables: ['LABSTACK_MODE', 'LABSTACK_BASE_URL', 'LABSTACK_API_KEY', 'LABSTACK_API_KEY_NEXT', 'LABSTACK_WEBHOOK_HEADER', 'LABSTACK_WEBHOOK_VALUE', 'LABSTACK_PARTNER_KEY'],
      // the partner key is for LabStack's widget: optional, server environment only; no widget token is minted yet
      optionalVariables: ['LABSTACK_PARTNER_KEY'],
      missing: live ? missing : ['LABSTACK_MODE=live', ...missing],
      note: 'Administered under /admin/integrations/labstack. LABSTACK_PARTNER_KEY is optional and stays in the server environment; no widget token is minted with it yet.', usedBy: ['labFollowups', 'labstackOps'],
    });
  } else {
    out.push({ key: 'lab', label: 'Laboratory (LabStack)', restricted: true, managedUnder: '/admin/integrations/labstack', permission: 'labstack.manage' });
  }

  const outbox = (key: 'email' | 'sms' | 'push', label: string, value: string, variables: string[], extraMissing: string[], usedBy: string[]): IntegrationDescriptor => ({
    key, label, mode: value, status: value === 'outbox' ? 'simulated' : 'live', configured: value !== 'outbox', variables,
    missing: value === 'outbox' ? [`A ${label.toLowerCase()} provider adapter: ${variables[0]} accepts only "outbox"`, ...extraMissing] : [],
    note: value === 'outbox' ? 'Recorded in the outbox (Operations), never delivered.' : 'Delivering.', usedBy,
  });
  out.push(outbox('email', 'Email', c.EMAIL_PROVIDER, ['EMAIL_PROVIDER', 'EMAIL_FROM'], [], MESSAGE_CHANNEL_USERS.email));
  const sms = outbox('sms', 'SMS', c.SMS_PROVIDER, ['SMS_PROVIDER'], [], MESSAGE_CHANNEL_USERS.sms);
  out.push({
    ...sms,
    note: c.SMS_PROVIDER === 'outbox'
      ? `${sms.note} No module sends SMS. Phone sign-in codes are recorded in the outbox with the digits withheld; production refuses phone sign-in until an SMS provider exists.`
      : 'Delivering. No module sends SMS; phone sign-in sends its codes this way.',
  });
  const devices = ctx.db.get<{ n: number }>('SELECT COUNT(*) n FROM push_devices WHERE revoked_at IS NULL')?.n ?? 0;
  out.push({ ...outbox('push', 'Push', c.PUSH_PROVIDER, ['PUSH_PROVIDER'], ['Push credentials (Expo push, FCM or APNs) and expo-notifications in the app'], MESSAGE_CHANNEL_USERS.push), note: `Device tokens are stored (${devices} registered); delivery is recorded in the outbox, never sent.` });

  const none = (key: 'meetings' | 'calendar' | 'video' | 'ai', label: string, variable: string, value: string, missing: string[], note: string, usedBy: string[]): IntegrationDescriptor => ({
    key, label, mode: value, status: 'pending_configuration', configured: false, variables: [variable], missing: [`${missing[0]}: ${variable} accepts only "none"`, ...missing.slice(1)], note, usedBy,
  });
  out.push(none('meetings', 'Video meetings', 'MEETING_PROVIDER', c.MEETING_PROVIDER, ['A video meeting provider'], 'No provider is chosen, so no meeting is created. A join link is one the coach or host types (https only, checked when saved), or nothing.', ['sessions']));
  out.push(none('calendar', 'Calendar sync', 'CALENDAR_PROVIDER', c.CALENDAR_PROVIDER, ['A calendar provider (Google or Microsoft)', 'An owner decision on feed tokens in URLs'], 'Not connected, and there is no subscribable calendar feed. While the sessions module is on, members and coaches can download a one-off calendar file (.ics) for a live session or a consultation.', ['sessions']));
  out.push(none('video', 'Course video hosting', 'VIDEO_PROVIDER', c.VIDEO_PROVIDER, ['A video hosting provider'], `Until one is configured, video lessons cannot be published. Exercise demonstration clips do not use it: this server serves them itself (EXERCISE_MEDIA=${c.EXERCISE_MEDIA}; api/domain/exerciseMedia.ts).`, ['learning', 'workouts']));
  // the same requirements the Coach AI pages name (api/adapters/ai.ts providerRequirements, api/domain/ai.ts): the
  // provider and model, its API key in the server environment, a data-processing agreement, the owner's retention
  // decision (while it is undecided) and counsel-approved consent wording (the wording in use is a draft pending review)
  const aiDecided = (() => { const v = getSetting<number | null>(ctx, 'ai_draft_retention_days'); return typeof v === 'number' && Number.isInteger(v) && v > 0; })();
  out.push({
    key: 'ai', label: 'Coach AI', mode: c.AI_PROVIDER, status: 'pending_configuration', configured: false, variables: ['AI_PROVIDER'],
    missing: [
      ...providerRequirements(c).map((r) => r.label),
      ...(aiDecided ? [] : [AI_RETENTION_MISSING]),
      AI_CONSENT_MISSING,
    ],
    note: 'Every drafting request is refused, and nothing is generated, until each of these is in place.', usedBy: ['ai'],
  });

  const local = c.STORAGE_PROVIDER === 'local';
  out.push({
    key: 'storage', label: 'Private file storage', mode: c.STORAGE_PROVIDER, status: local ? (c.isProduction ? 'pending_configuration' : 'local') : 'live', configured: !local,
    variables: ['STORAGE_PROVIDER', 'PRIVATE_FILES_DIR'],
    missing: local ? ['Production object storage with encryption at rest: STORAGE_PROVIDER accepts only "local"', 'Malware scanning for uploads'] : [],
    note: local ? (c.isProduction ? 'Production refuses local disk for private files.' : 'Local disk outside every public folder (not for production); files open only through 5-minute tokens.') : 'Object storage.',
    // the modules that store private files: those declaring a file-access resolver (billing renders its documents
    // from the database and stores none)
    usedBy: MODULES.filter((m) => Object.keys(m.fileAccess ?? {}).length > 0).map((m) => m.key),
  });

  // Sign in with Google / Apple for members (identity, not a module: api/auth/social.ts). The variables are public
  // identifiers (OAuth client IDs, bundle IDs, the Services ID), not secrets; what is missing is the owner's Google
  // Cloud OAuth clients and Apple Developer Program membership. Nothing is offered until the owner sets them (every
  // default is empty), and the row is live only once both providers are on: with one of them the status stays
  // pending_configuration while `mode` lists what is on. The keys' reachability is the last known state, never a fetch
  // from here.
  const google = Object.keys(c.googleClientIds).length > 0;
  const appleConfigured = c.appleAudiences.length > 0;
  const appleKeys = services.identity.state('apple');
  const apple = appleConfigured && appleKeys === 'fresh';
  const identityMissing = [
    ...(google ? [] : ['Google OAuth client IDs from the owner’s Google Cloud project (an iOS, an Android and a web client): GOOGLE_SIGN_IN_IOS_CLIENT_ID, GOOGLE_SIGN_IN_ANDROID_CLIENT_ID, GOOGLE_SIGN_IN_WEB_CLIENT_ID']),
    ...(appleConfigured ? [] : ['The app’s bundle ID (com.bioptime.app) with Sign in with Apple enabled on it (Apple Developer Program): APPLE_SIGN_IN_BUNDLE_IDS']),
    ...(c.APPLE_SIGN_IN_SERVICES_ID ? [] : ['An Apple Services ID for the web and Android flows (Apple Developer Program): APPLE_SIGN_IN_SERVICES_ID']),
    ...(appleConfigured && appleKeys !== 'fresh' ? [`Apple’s signing keys (${APPLE_KEYS_URL}) ${appleKeys === 'failed' ? 'could not be fetched from this server' : 'have not been fetched yet'}`] : []),
  ];
  const on = [google ? 'Google' : '', apple ? 'Apple' : ''].filter(Boolean);
  out.push({
    key: 'identity', label: 'Sign in with Google / Apple', mode: [google ? 'google' : '', apple ? 'apple' : '', c.isDemo ? 'standin' : ''].filter(Boolean).join(',') || 'none',
    status: google && apple ? 'live' : 'pending_configuration', configured: google && apple,
    variables: ['GOOGLE_SIGN_IN_WEB_CLIENT_ID', 'GOOGLE_SIGN_IN_IOS_CLIENT_ID', 'GOOGLE_SIGN_IN_ANDROID_CLIENT_ID', 'APPLE_SIGN_IN_BUNDLE_IDS', 'APPLE_SIGN_IN_SERVICES_ID'],
    optionalVariables: ['GOOGLE_SIGN_IN_WEB_CLIENT_ID', 'APPLE_SIGN_IN_SERVICES_ID'],
    missing: identityMissing,
    note: `Members only; ID tokens are verified on this server against the providers’ published keys, so no secret is needed. ${on.length === 2 ? 'Google and Apple are offered.' : on.length === 1 ? `Only ${on[0]} is offered so far.` : 'Neither button is offered yet.'} ${c.isDemo ? 'This copy also offers the stand-in provider, which behaves like a verified identity for any email.' : 'The stand-in provider is not offered on this server.'} The variables are public identifiers; values are never shown here all the same.`,
    usedBy: [],
  });
  return out;
}
