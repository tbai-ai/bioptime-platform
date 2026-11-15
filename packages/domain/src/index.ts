/* Shared Bioptime domain: the vocabulary every surface agrees on. Types, zod schemas and the small state machines
   the API enforces and the clients display. No I/O here. */
import { z } from 'zod';

/* ---------- roles and account states ---------- */
export const ROLES = ['member', 'coach', 'admin', 'owner'] as const;
export type Role = (typeof ROLES)[number];
export const PRIVILEGED_ROLES: Role[] = ['admin', 'owner'];

export const ACCOUNT_STATES = ['invited', 'pending_verification', 'onboarding', 'active', 'suspended', 'deactivated', 'deletion_requested', 'closed'] as const;
export type AccountState = (typeof ACCOUNT_STATES)[number];
/** Transitions a state may take, by anyone with the right to move it. Deactivating is how an administrator removes a
 *  coach or client (30 October 2026: sign-in blocked, records kept, reversible), so every account that has signed up can
 *  be deactivated. A closed account stays closed here; an administrator may reopen one only when no deletion request is
 *  on record (api/auth/service.ts setAccountState). */
export const ACCOUNT_TRANSITIONS: Record<AccountState, AccountState[]> = {
  invited: ['pending_verification', 'onboarding', 'closed'],
  pending_verification: ['onboarding', 'active', 'deactivated', 'closed'],
  onboarding: ['active', 'suspended', 'deactivated', 'closed'],
  active: ['suspended', 'deactivated', 'deletion_requested'],
  suspended: ['active', 'deactivated', 'closed'],
  deactivated: ['active', 'deletion_requested', 'closed'],
  deletion_requested: ['closed', 'active'],
  closed: [],
};

/* ---------- packages and entitlements ---------- */
export const PACKAGE_KINDS = ['package', 'programme', 'bespoke'] as const;
export const SERVICE_TYPES = ['bloodwork', 'consultation'] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];
export const ENTITLEMENT_STATES = ['available', 'exhausted', 'expired', 'cancelled'] as const;
export const ENTITLEMENT_TX_KINDS = ['grant', 'reserve', 'consume', 'release', 'expire', 'cancel', 'adjust'] as const;

export const ORDER_STATES = ['draft', 'pending_payment', 'paid', 'activated', 'failed', 'cancelled', 'refund_pending', 'refunded'] as const;
export type OrderState = (typeof ORDER_STATES)[number];
export const ORDER_TRANSITIONS: Record<OrderState, OrderState[]> = {
  draft: ['pending_payment', 'cancelled'],
  pending_payment: ['paid', 'failed', 'cancelled'],
  paid: ['activated', 'refund_pending'],
  activated: ['refund_pending'],
  failed: ['pending_payment', 'cancelled'],
  cancelled: [],
  refund_pending: ['refunded', 'activated'],
  refunded: [],
};
export const PAYMENT_STATES = ['created', 'authorised', 'captured', 'failed', 'refunded'] as const;

/* ---------- assignment ---------- */
export const ASSIGNMENT_REQUEST_STATES = ['open', 'assigned', 'exception', 'cancelled'] as const;
export const ASSIGNMENT_STATES = ['pending', 'active', 'paused', 'ended'] as const;
export const ASSIGNMENT_METHODS = ['rule', 'manual', 'override'] as const;

/* ---------- appointments ---------- */
export const APPOINTMENT_STATES = ['requested', 'scheduled', 'completed', 'cancelled', 'no_show'] as const;
export type AppointmentState = (typeof APPOINTMENT_STATES)[number];
export const APPOINTMENT_TRANSITIONS: Record<AppointmentState, AppointmentState[]> = {
  requested: ['scheduled', 'cancelled'],
  scheduled: ['completed', 'cancelled', 'no_show', 'scheduled'],
  completed: [],
  cancelled: [],
  no_show: ['scheduled'],
};
export const APPOINTMENT_KINDS = ['consultation', 'check_in', 'review'] as const;

/* ---------- bloodwork: the seven shared statuses and LabStack's mapping ---------- */
export const LAB_STATUSES = ['confirmed', 'scheduled', 'sample_collected', 'processing', 'results_ready', 'completed', 'cancelled'] as const;
export type LabStatus = (typeof LAB_STATUSES)[number];
export const LAB_LABELS: Record<LabStatus, string> = {
  confirmed: 'Confirmed', scheduled: 'Scheduled', sample_collected: 'Sample collected', processing: 'Processing',
  results_ready: 'Results ready', completed: 'Completed', cancelled: 'Cancelled',
};
/** LabStack orderStatus → Bioptime status; null = date change only (engineering reference, Labs API v1.3). */
export const LABSTACK_STATUS_MAP: Record<string, LabStatus | null> = {
  PENDING: 'confirmed', CREATED: 'confirmed', ORDER_SCHEDULED: 'confirmed',
  PHLEBO_ASSIGNED: 'scheduled', PHLEBO_STARTED: 'scheduled', PATIENT_VISITED: 'scheduled', RESCHEDULED: null,
  PHLEBO_NO_SHOW: 'scheduled', PATIENT_MISSED: 'scheduled', SAMPLE_REJECTED: 'scheduled',
  SAMPLE_COLLECTED: 'sample_collected', SAMPLE_IN_TRANSIT: 'sample_collected', SAMPLE_DELIVERED: 'sample_collected',
  SAMPLE_PROCESSED: 'processing', PARTIAL_DELIVERED: 'processing', REPORT_DELIVERED: 'results_ready', CANCELED: 'cancelled',
};
export const LABSTACK_BACKWARDS_OK = new Set(['SAMPLE_REJECTED', 'PHLEBO_NO_SHOW', 'PATIENT_MISSED']);
export const LABSTACK_REBOOK_FLAGS = new Set(['SAMPLE_REJECTED', 'PHLEBO_NO_SHOW', 'PATIENT_MISSED']);

export function labRank(s: LabStatus): number { return LAB_STATUSES.indexOf(s); }

export type LabTransition = { changed: false; reason: string } | { changed: true; status: LabStatus; flag?: string };
/** A status only moves forward, except a rejected sample or a missed visit, which goes back to Scheduled. Cancelled can arrive at any point. */
export function applyLabStackStatus(current: LabStatus, labstackStatus: string): LabTransition {
  const next = LABSTACK_STATUS_MAP[labstackStatus];
  if (next === undefined) return { changed: false, reason: `unknown LabStack status ${labstackStatus}` };
  if (next === null) return { changed: false, reason: 'date change only' };
  if (current === 'cancelled' || current === 'completed') return { changed: false, reason: `order is ${current}` };
  if (next === current) {
    if (LABSTACK_REBOOK_FLAGS.has(labstackStatus)) return { changed: true, status: next, flag: 'rebook' };
    return { changed: false, reason: `already ${next}` };
  }
  if (labRank(next) < labRank(current) && !LABSTACK_BACKWARDS_OK.has(labstackStatus) && next !== 'cancelled') {
    return { changed: false, reason: `would move backwards (${current} → ${next})` };
  }
  return { changed: true, status: next, flag: LABSTACK_REBOOK_FLAGS.has(labstackStatus) ? 'rebook' : undefined };
}

/** Moves a member or the team may make without a vendor event. */
export const LAB_MANUAL_TRANSITIONS: Record<LabStatus, LabStatus[]> = {
  confirmed: ['cancelled'], scheduled: ['cancelled'], sample_collected: [], processing: [], results_ready: ['completed'], completed: [], cancelled: [],
};

/* ---------- custom plans ---------- */
export const CUSTOM_PLAN_STATES = ['enquiry_received', 'under_review', 'scoping', 'awaiting_professional_input', 'awaiting_internal_approval', 'proposal_sent', 'accepted', 'declined', 'expired', 'payment_pending', 'activated', 'completed'] as const;
export type CustomPlanState = (typeof CUSTOM_PLAN_STATES)[number];
export const CUSTOM_PLAN_TRANSITIONS: Record<CustomPlanState, CustomPlanState[]> = {
  enquiry_received: ['under_review', 'declined'],
  under_review: ['scoping', 'declined'],
  scoping: ['awaiting_professional_input', 'awaiting_internal_approval', 'declined'],
  awaiting_professional_input: ['awaiting_internal_approval', 'scoping', 'declined'],
  awaiting_internal_approval: ['proposal_sent', 'scoping', 'declined'],
  proposal_sent: ['accepted', 'declined', 'expired'],
  accepted: ['payment_pending', 'declined', 'expired'],
  declined: [],
  expired: ['scoping'],
  payment_pending: ['activated', 'expired', 'declined'],
  activated: ['completed'],
  completed: [],
};
export function canMoveCustomPlan(from: CustomPlanState, to: CustomPlanState): boolean { return CUSTOM_PLAN_TRANSITIONS[from].includes(to); }

/* ---------- coaching plans ---------- */
export const PLAN_STATES = ['draft', 'published', 'archived'] as const;
export const TASK_STATES = ['pending', 'done', 'skipped'] as const;
export const PROGRESS_METRICS = ['weight_kg', 'waist_cm', 'resting_hr_bpm', 'sleep_hours', 'steps', 'energy_1_5', 'wellbeing_1_5', 'habit_adherence_pct', 'workout_minutes', 'water_ml'] as const;
export type ProgressMetric = (typeof PROGRESS_METRICS)[number];
/** Where a progress value came from; every series point carries its label. import is migrated history (M4). */
export const PROGRESS_SOURCES = ['member', 'coach', 'device', 'import'] as const;
export type ProgressSource = (typeof PROGRESS_SOURCES)[number];
export const PROGRESS_SOURCE_LABELS: Record<ProgressSource, string> = { member: 'Self-reported', coach: 'Entered by your coach', device: 'From a connected device', import: 'Imported' };
/** Metrics counted over a day (PUT /me/progress/daily): each source keeps one total per India date, updated in place,
 *  and the day's value is the largest across its sources, never their sum. */
export const DAILY_TOTAL_METRICS = ['steps', 'water_ml'] as const satisfies readonly ProgressMetric[];
export type DailyTotalMetric = (typeof DAILY_TOTAL_METRICS)[number];
/** The device apps a daily total may come from: phone, the step counter of the phone the member uses Bioptime on. */
export const PROGRESS_PROVIDERS = ['phone'] as const;
export type ProgressProvider = (typeof PROGRESS_PROVIDERS)[number];
export const PROGRESS_PROVIDER_LABELS: Record<ProgressProvider, string> = { phone: 'From this phone' };
/** The sources each daily metric accepts: water is only ever logged by the member. */
export const DAILY_TOTAL_SOURCES: Record<DailyTotalMetric, readonly ('device' | 'member')[]> = { steps: ['device', 'member'], water_ml: ['member'] };
/** How far back a daily total may be written or corrected, in days before today (India). */
export const DAILY_TOTAL_MAX_DAYS_BACK = 30;

/* ---------- notifications ---------- */
/** notifications.category is free text; this list is descriptive. The foundation (M0) adds every module's categories at once. */
export const NOTIFICATION_CATEGORIES = ['welcome', 'verification', 'coach_assignment', 'appointment', 'appointment_reminder', 'bloodwork', 'report', 'programme', 'custom_plan', 'payment', 'package_expiry', 'message', 'operations', 'security',
  'habit_reminder', 'checkin', 'goal', 'refund', 'support', 'nutrition', 'workout', 'lab_followup', 'lab_preparation', 'session', 'session_reminder', 'announcement', 'learning'] as const;
export const NOTIFICATION_CHANNELS = ['in_app', 'email', 'sms', 'push'] as const;
/** support_tasks.kind is free text; this list is descriptive. coach_follow_up is a coach's own follow-up (owner: the coach). */
export const SUPPORT_TASK_KINDS = ['unassigned_member', 'failed_booking', 'payment_mismatch', 'vendor_sync_failure', 'missing_report_notification', 'custom_plan_approval', 'overdue_appointment', 'capacity_issue', 'integration_error', 'unknown_webhook', 'report_values_failed', 'data_request',
  'coach_follow_up'] as const;
export const SUPPORT_TASK_STATES = ['open', 'in_progress', 'resolved', 'dismissed'] as const;

/* ---------- zod schemas for API payloads shared by clients ---------- */
export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const passwordSchema = z.string().min(10, 'Use at least 10 characters').max(200);
export const phoneSchema = z.string().trim().regex(/^\+?[1-9]\d{7,14}$/, 'Enter the number with its country code, like +919812345678');
export const pincodeSchema = z.string().trim().regex(/^\d{6}$/, 'Enter a 6-digit PIN code');
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  // a real calendar day: '2026-99-99' is refused here (400) instead of failing later in date arithmetic (500)
  .refine((v) => { const d = new Date(`${v}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v; }, 'Use a real date');
export const isoDateTimeSchema = z.string().datetime({ offset: true });

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().trim().min(2).max(120),
  phone: phoneSchema.optional(),
  acceptTerms: z.literal(true, { errorMap: () => ({ message: 'You need to accept the terms to continue' }) }),
  acceptPrivacy: z.literal(true, { errorMap: () => ({ message: 'You need to accept the privacy notice to continue' }) }),
  termsVersion: z.string().min(1),
  marketingConsent: z.boolean().optional().default(false),
});
export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(200), mfaCode: z.string().regex(/^\d{6}$/).optional() });
/** A coach's Coach ID as shown on their profile (coach_profiles.coach_code, BPC-0001): matched without regard to letter
 *  case, with surrounding spaces trimmed. Coach ID sign-in: POST /auth/login { coachId, password, workspace: 'coach' }. */
export const coachIdSchema = z.string().trim().min(1, 'Enter your Coach ID').max(40);
/** Six digits from an authenticator app. */
export const totpCodeSchema = z.string().trim().regex(/^\d{6}$/, 'Enter the six-digit code');

export const onboardingStepSchema = z.object({
  step: z.enum(['profile', 'goals', 'programme_info', 'how_it_works', 'consents', 'done']),
  data: z.record(z.unknown()).optional().default({}),
});

export const memberProfileSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  phone: phoneSchema.optional(),
  gender: z.enum(['female', 'male', 'other', 'prefer_not_to_say']).optional(),
  dateOfBirth: isoDateSchema.optional(),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
  pincode: pincodeSchema.optional(),
  address: z.string().trim().max(400).optional(),
  goals: z.array(z.string().trim().min(1).max(80)).max(8).optional(),
  preferences: z.record(z.unknown()).optional(),
  timezone: z.string().max(64).optional(),
});

/* ---------- consents ---------- */
/** Every kind member_consents accepts (0008_foundation.sql; assistant_processing from 0044_member_assistant.sql, the
 *  member assistant's own consent, recorded only through its own route and never through POST /me/consents). */
export const CONSENT_KINDS = ['terms', 'privacy', 'health_data', 'coach_sharing', 'lab_consent', 'marketing', 'push', 'progress_photos', 'ai_processing', 'community', 'assistant_processing'] as const;
export type ConsentKind = (typeof CONSENT_KINDS)[number];
/** Kinds the database accepts but no screen may record yet: their wording and the privacy notice changes need counsel
 *  and the owner first. The module that needs one (M2 photos, M11 Coach AI, community) opens it with approved wording. */
export const RESERVED_CONSENT_KINDS = ['progress_photos', 'ai_processing', 'community'] as const satisfies readonly ConsentKind[];
/** The kinds members record today (POST /me/consents). */
export const MEMBER_CONSENT_KINDS = ['terms', 'privacy', 'health_data', 'coach_sharing', 'lab_consent', 'marketing', 'push'] as const satisfies readonly ConsentKind[];

export const consentSchema = z.object({
  kind: z.enum(MEMBER_CONSENT_KINDS),
  version: z.string().min(1).max(40),
  granted: z.boolean(),
});

export const checkoutCreateSchema = z.object({ packageId: z.string().min(1), idempotencyKey: z.string().min(8).max(120).optional(), couponCode: z.string().trim().min(3).max(24).optional() });

export const bookingCreateSchema = z.object({
  testId: z.string().min(1),
  slotAt: isoDateTimeSchema,
  labId: z.string().optional(),
  pincode: pincodeSchema,
  address: z.string().trim().min(5).max(400),
  city: z.string().trim().min(2).max(80),
  state: z.string().trim().min(2).max(80),
  idempotencyKey: z.string().min(8).max(120).optional(),
});

export const appointmentCreateSchema = z.object({
  coachId: z.string().optional(),
  startAt: isoDateTimeSchema,
  kind: z.enum(APPOINTMENT_KINDS).default('consultation'),
  note: z.string().max(500).optional(),
  idempotencyKey: z.string().min(8).max(120).optional(),
});

/** A message: text, up to five files uploaded to the conversation first (M9, POST /conversations/:id/attachments), or
 *  both. The text may be empty only when a file is attached. */
export const messageCreateSchema = z.object({
  body: z.string().trim().max(4000).default(''),
  attachmentIds: z.array(z.string().min(1).max(64)).max(5).optional(),
}).refine((m) => m.body.length > 0 || (m.attachmentIds?.length ?? 0) > 0, { message: 'Write a message or add a file', path: ['body'] });

export const progressEntrySchema = z.object({
  metric: z.enum(PROGRESS_METRICS),
  value: z.number().finite(),
  at: isoDateTimeSchema.optional(),
  note: z.string().max(300).optional(),
});

/** PUT /me/progress/daily: one source's total for one India date (today, or up to DAILY_TOTAL_MAX_DAYS_BACK days
 *  before). A device total names its provider; a member's own total names none. */
export const progressDailySchema = z.object({
  metric: z.enum(DAILY_TOTAL_METRICS),
  date: isoDateSchema,
  value: z.number().finite().min(0),
  source: z.enum(['device', 'member']),
  provider: z.enum(PROGRESS_PROVIDERS).optional(),
}).superRefine((v, ctx) => {
  if (v.source === 'device' && !v.provider) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['provider'], message: 'A device total names its provider (phone)' });
  if (v.source === 'member' && v.provider) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['provider'], message: 'A total you enter yourself has no provider' });
  if (!DAILY_TOTAL_SOURCES[v.metric].includes(v.source)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['source'], message: `${v.metric} is logged by ${DAILY_TOTAL_SOURCES[v.metric].join(' or ')} only` });
});

export const enquirySchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: emailSchema,
  phone: phoneSchema.optional(),
  purpose: z.enum(['general', 'bespoke', 'partnership', 'support']).default('general'),
  message: z.string().trim().min(5).max(3000),
  website: z.string().max(0).optional(), // honeypot
});

export const customPlanRequestSchema = z.object({
  goals: z.string().trim().min(5).max(2000),
  duration: z.string().trim().max(80).optional(),
  budgetInr: z.number().int().positive().optional(),
  notes: z.string().max(2000).optional(),
});

/* ---------- modules ---------- */
/** The module registry's keys (api/modules, portal/modules, the app's lib/modules). Each module may add its shared
 *  rules as packages/domain/src/modules/<key>.ts, imported as '@bioptime/domain/modules/<key>'. */
export const MODULE_KEYS = ['habits', 'progress', 'billing', 'support', 'nutrition', 'workouts', 'labFollowups', 'sessions', 'messaging', 'learning', 'ai', 'labstackOps', 'growth', 'referrals'] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

export type ApiError = { error: { code: string; message: string; details?: unknown } };
export type Page<T> = { items: T[]; nextCursor: string | null; total?: number };
