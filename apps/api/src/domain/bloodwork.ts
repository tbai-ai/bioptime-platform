/* Bloodwork: the catalogue, slots and bookings through the vendor adapter; the seven shared statuses moved only by
   vendor events, the coach's review or an owner override; idempotent webhooks; reports with role-checked access. */
import { LAB_MANUAL_TRANSITIONS, applyLabStackStatus, type LabStatus } from '@bioptime/domain';
import type { Ctx } from '../context.js';
import type { LabVendor, WebhookPayload, VendorOrder } from '../adapters/labstack/types.js';
import { VendorError } from '../adapters/labstack/types.js';
import { ids } from '../lib/ids.js';
import { errors } from '../lib/errors.js';
import { safeEqual, signToken, verifyToken, sha256 } from '../lib/crypto.js';
import { addHours, minutesBetween, toIstOffsetString, ageFromDob, istDayLabel } from '../lib/time.js';
import { j } from '../db/db.js';
import { nextReference } from '../db/seq.js';
import { audit, emit } from './audit.js';
import { notify, notifyPrivileged } from './notifications.js';
import { openTask } from './support.js';
import { getSetting } from './settings.js';
import * as entitlements from './entitlements.js';
import { activeCoachFor } from './assignments.js';
import { latestConsents } from './members.js';
import { coachHasMember } from '../auth/permissions.js';
import { liveAsset } from './assets.js';

export type BookingRow = { id: string; reference: string; member_id: string; programme_id: string | null; test_id: string; status: LabStatus; slot_at: string; lab_id: string | null; vendor: string; vendor_order_id: string | null; vendor_status: string | null; vendor_pending: number; patient: string; pincode: string; address: string; city: string; state: string; flag: string | null; entitlement_id: string | null; entitlement_tx_id: string | null; payment_order_id: string | null; expected_report_by: string | null; last_vendor_event_at: string | null; cancelled_reason: string | null; created_at: string; updated_at: string };

const slotCache = new Map<string, { at: number; slots: unknown }>();

/* ---------- catalogue ---------- */
export function listTests(ctx: Ctx, opts: { includeHidden?: boolean } = {}) {
  return ctx.db.all<Record<string, unknown>>(`SELECT * FROM bloodwork_tests WHERE active = 1 ${opts.includeHidden ? '' : 'AND hidden = 0 AND price_paise IS NOT NULL'} ORDER BY kind DESC, name`).map((t) => catalogueTest(ctx, t));
}
function presentTest(t: Record<string, unknown>) {
  return { id: t.id, vendorTestId: t.vendor_test_id, kind: t.kind, name: t.name, description: t.description, priceInr: t.price_paise === null ? null : Number(t.price_paise) / 100, fastingHours: t.fasting_hours, turnaround: t.turnaround, markers: t.markers, preparation: t.preparation, hidden: !!t.hidden };
}
/** A test in the catalogue lists, with the member app's card presentation (0043_presentation_fields.sql): a picture from
 *  the asset library (a deleted one reads as none), the tags the card shows, and whether the app features the test. */
function catalogueTest(ctx: Ctx, t: Record<string, unknown>) {
  const image = liveAsset(ctx, t.image_asset_id as string | null);
  return { ...presentTest(t), imageAssetId: image?.assetId ?? null, imageUrl: image?.url ?? null, tags: j.out<string[]>(t.tags, []), featured: !!t.featured };
}

export async function syncCatalogue(ctx: Ctx, vendor: LabVendor): Promise<{ added: number; updated: number; hidden: number }> {
  let added = 0, updated = 0, hidden = 0;
  try {
    const items = await vendor.getCatalogue();
    const now = ctx.now();
    const seen = new Set<string>();
    ctx.db.tx(() => {
      for (const it of items) {
        seen.add(it.vendorTestId);
        const existing = ctx.db.get<{ id: string; price_paise: number | null }>('SELECT id, price_paise FROM bloodwork_tests WHERE vendor_test_id = ?', [it.vendorTestId]);
        if (existing) { ctx.db.update('bloodwork_tests', existing.id, { name: it.name, kind: it.kind, description: it.description ?? '', fasting_hours: it.fastingHours, turnaround: it.turnaround, preparation: it.preparation ?? '', markers: it.markers ?? null, active: 1, updated_at: now }); updated++; }
        else { ctx.db.insert('bloodwork_tests', { id: ids.test(), vendor_test_id: it.vendorTestId, kind: it.kind, name: it.name, description: it.description ?? '', price_paise: null, fasting_hours: it.fastingHours, turnaround: it.turnaround, markers: it.markers ?? null, preparation: it.preparation ?? '', active: 1, hidden: 1, created_at: now, updated_at: now }); added++; } // new tests stay hidden until Bioptime sets a price
      }
      for (const t of ctx.db.all<{ id: string; vendor_test_id: string | null }>('SELECT id, vendor_test_id FROM bloodwork_tests WHERE active = 1 AND vendor_test_id IS NOT NULL')) {
        if (!seen.has(t.vendor_test_id!)) { ctx.db.update('bloodwork_tests', t.id, { hidden: 1, updated_at: now }); hidden++; } // withdrawn tests are hidden, never deleted
      }
      setIntegration(ctx, { lastCatalogueSync: now, catalogueCount: items.length });
    });
    audit(ctx, 'labstack.catalogue_sync', null, null, { added, updated, hidden });
  } catch (e) {
    // the failure record names the task that stands for it, so the operations view counts one incident once
    const taskId = openTask(ctx, { kind: 'vendor_sync_failure', title: 'Laboratory catalogue sync failed', detail: (e as Error).message, refType: 'integration', refId: 'labstack' });
    recordFailure(ctx, 'catalogue_sync', e, { taskId });
    throw e;
  }
  return { added, updated, hidden };
}

export function setTestPrice(ctx: Ctx, testId: string, priceInr: number | null | undefined, hidden?: boolean, reason?: string) {
  const t = ctx.db.get('SELECT * FROM bloodwork_tests WHERE id = ?', [testId]);
  if (!t) throw errors.notFound('Test');
  // an omitted price leaves the price as it is; only an explicit null withdraws it
  ctx.db.update('bloodwork_tests', testId, { price_paise: priceInr === undefined ? undefined : priceInr === null ? null : Math.round(priceInr * 100), hidden: hidden === undefined ? undefined : hidden ? 1 : 0, updated_at: ctx.now() });
  audit(ctx, 'bloodwork.test_price', { type: 'bloodwork_test', id: testId }, reason ?? null, { priceInr, hidden });
  return presentTest(ctx.db.get<Record<string, unknown>>('SELECT * FROM bloodwork_tests WHERE id = ?', [testId])!);
}

/** Set a test's card presentation: a picture from the asset library (null removes it), its tags (each 1 to 40
 *  characters, at most 12, the first spelling of a repeated tag kept) and whether the app features it. Omitted fields
 *  stay as they are; the catalogue sync never changes them. Audited without the tag text. */
export function setTestPresentation(ctx: Ctx, testId: string, input: { imageAssetId?: string | null; tags?: string[]; featured?: boolean }, reason?: string) {
  if (!ctx.db.get('SELECT 1 FROM bloodwork_tests WHERE id = ?', [testId])) throw errors.notFound('Test');
  if (input.imageAssetId && !ctx.db.get('SELECT 1 FROM assets WHERE id = ? AND deleted_at IS NULL', [input.imageAssetId])) throw errors.badRequest('That image is not in the asset library', 'ASSET_UNKNOWN');
  let tags: string[] | undefined;
  if (input.tags !== undefined) {
    const seen = new Set<string>();
    tags = input.tags.map((t) => t.trim()).filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()));
    if (tags.length > 12 || tags.some((t) => t.length > 40)) throw errors.badRequest('At most 12 tags of up to 40 characters each', 'TAGS_INVALID');
  }
  ctx.db.update('bloodwork_tests', testId, { image_asset_id: input.imageAssetId, tags: tags ? j.in(tags) : undefined, featured: input.featured === undefined ? undefined : input.featured ? 1 : 0, updated_at: ctx.now() });
  audit(ctx, 'bloodwork.test_presentation', { type: 'bloodwork_test', id: testId }, reason ?? null, { imageAssetId: input.imageAssetId, tags: tags?.length, featured: input.featured });
  return catalogueTest(ctx, ctx.db.get<Record<string, unknown>>('SELECT * FROM bloodwork_tests WHERE id = ?', [testId])!);
}

/* ---------- slots ---------- */
export async function slots(ctx: Ctx, vendor: LabVendor, date: string, pincode: string) {
  const key = `${date}:${pincode}`;
  const cached = slotCache.get(key);
  if (cached && Date.now() - cached.at < 5 * 60_000) return cached.slots;
  try {
    const list = await vendor.getSlots(date, pincode);
    const out = { date, pincode, slots: list, vendor: vendor.mode, note: vendor.mode === 'standin' ? 'Stand-in slots, not a real laboratory' : undefined };
    slotCache.set(key, { at: Date.now(), slots: out });
    return out;
  } catch (e) {
    recordFailure(ctx, 'getSlots', e);
    throw errors.upstream('We could not fetch collection slots just now. Try again in a minute.', { vendor: (e as Error).message });
  }
}

/* ---------- booking ---------- */
export async function book(ctx: Ctx, vendor: LabVendor, input: { memberId: string; testId: string; slotAt: string; labId?: string; pincode: string; address: string; city: string; state: string; idempotencyKey?: string; overrideEntitlement?: boolean }) {
  if (input.idempotencyKey) {
    // keys are the member's own: a key string reused by someone else can never hand them another member's booking
    const existing = ctx.db.get<BookingRow>('SELECT * FROM bloodwork_bookings WHERE idempotency_key = ? AND member_id = ?', [`${input.memberId}:${input.idempotencyKey}`, input.memberId]);
    if (existing) return presentBooking(ctx, existing);
  }
  const member = ctx.db.get<{ id: string; name: string; email: string; phone: string | null; state: string; gender: string | null; date_of_birth: string | null }>('SELECT u.id, u.name, u.email, u.phone, u.state, p.gender, p.date_of_birth FROM users u LEFT JOIN member_profiles p ON p.user_id = u.id WHERE u.id = ?', [input.memberId]);
  if (!member) throw errors.notFound('Member');
  if (member.state !== 'active' && member.state !== 'onboarding') throw errors.forbidden('This account cannot book tests', 'ACCOUNT_STATE');
  const consents = latestConsents(ctx, input.memberId);
  if (!consents.lab_consent?.granted) throw errors.state('Consent to share your details with the laboratory is needed before booking. You can give it under Privacy and sharing in your profile.', { code: 'LAB_CONSENT_REQUIRED' });
  if (!member.gender || !member.date_of_birth) throw errors.state('The laboratory needs your gender and date of birth; add them in your profile first.', { code: 'PROFILE_INCOMPLETE' });
  const mobile = (member.phone ?? '').replace(/\D/g, '').replace(/^91(\d{10})$/, '$1');
  if (!/^\d{10}$/.test(mobile)) throw errors.state('The laboratory needs a 10-digit Indian mobile number on your profile.', { code: 'MOBILE_REQUIRED' });
  const test = ctx.db.get<{ id: string; vendor_test_id: string; kind: string; name: string; price_paise: number | null; turnaround: string; hidden: number }>('SELECT * FROM bloodwork_tests WHERE id = ? AND active = 1', [input.testId]);
  if (!test || test.hidden) throw errors.notFound('Test');
  if (input.slotAt <= addHours(ctx.now(), 2)) throw errors.badRequest('Pick a collection slot at least two hours from now', 'TOO_SOON');
  const programme = ctx.db.get<{ id: string }>("SELECT id FROM programmes WHERE member_id = ? AND status = 'active' ORDER BY start_at DESC LIMIT 1", [input.memberId]);

  // 1. the booking and the entitlement reservation, in one transaction
  const booking = ctx.db.tx(() => {
    const id = ids.booking();
    const reference = nextReference(ctx.db, 'BIO');
    let txId: string | null = null, entitlementId: string | null = null;
    try {
      const r = entitlements.reserve(ctx, input.memberId, 'bloodwork', { type: 'booking', id }, `reserve:booking:${input.memberId}:${input.idempotencyKey ?? id}`);
      txId = r.txId; entitlementId = r.entitlementId;
    } catch (e) {
      if (!input.overrideEntitlement) throw errors.state('Your package has no blood test left. Tests are booked against the blood tests a package includes; a test is not sold on its own yet.', { code: 'NO_ENTITLEMENT', priceInr: (test.price_paise ?? 0) / 100 });
    }
    const now = ctx.now();
    const patient = { name: member.name, email: member.email, mobile, gender: member.gender, dateOfBirth: member.date_of_birth, age: ageFromDob(member.date_of_birth!, now) };
    ctx.db.insert('bloodwork_bookings', { id, reference, member_id: input.memberId, programme_id: programme?.id ?? null, test_id: test.id, status: 'confirmed', slot_at: input.slotAt, lab_id: input.labId ?? null, vendor: 'labstack', vendor_pending: 1, patient: j.in(patient), pincode: input.pincode, address: input.address, city: input.city, state: input.state, flag: 'waiting for the lab', entitlement_id: entitlementId, entitlement_tx_id: txId, idempotency_key: input.idempotencyKey ? `${input.memberId}:${input.idempotencyKey}` : null, created_at: now, updated_at: now });
    ctx.db.insert('booking_events', { id: ids.bookingEvent(), booking_id: id, at: now, from_status: null, to_status: 'confirmed', vendor_status: null, source: 'member', actor_id: ctx.actor?.id ?? null, note: 'Booking received; placing the order with the laboratory' });
    emit(ctx, 'BookingCreated', { type: 'booking', id }, { memberId: input.memberId, reference });
    audit(ctx, 'booking.create', { type: 'booking', id }, null, { reference, testId: test.id, slotAt: input.slotAt, consumes: !!txId });
    return ctx.db.get<BookingRow>('SELECT * FROM bloodwork_bookings WHERE id = ?', [id])!;
  });

  // 2. place the order with the vendor; a timeout never books twice (lookup by reference before any retry)
  await placeWithVendor(ctx, vendor, booking);
  const fresh = ctx.db.get<BookingRow>('SELECT * FROM bloodwork_bookings WHERE id = ?', [booking.id])!;
  if (fresh.status !== 'cancelled') notify(ctx, { userId: input.memberId, category: 'bloodwork', title: fresh.vendor_order_id ? 'Blood test booked' : 'Booking received', body: fresh.vendor_order_id ? `${test.name}: home collection on ${istDayLabel(fresh.slot_at)}. ${fastingLine(test.id, ctx)}` : `${test.name}: we are confirming your slot with the laboratory.`, data: { bookingId: fresh.id, reference: fresh.reference }, sensitive: false });
  return presentBooking(ctx, fresh);
}

function fastingLine(testId: string, ctx: Ctx): string {
  const t = ctx.db.get<{ fasting_hours: number }>('SELECT fasting_hours FROM bloodwork_tests WHERE id = ?', [testId]);
  return t?.fasting_hours ? `Fast for ${t.fasting_hours} hours before; water is fine.` : 'No fasting needed.';
}

export async function placeWithVendor(ctx: Ctx, vendor: LabVendor, b: BookingRow): Promise<void> {
  if (b.vendor_order_id || b.status === 'cancelled') return;
  const test = ctx.db.get<{ vendor_test_id: string; kind: string; turnaround: string }>('SELECT vendor_test_id, kind, turnaround FROM bloodwork_tests WHERE id = ?', [b.test_id])!;
  const patient = j.out<{ name: string; email: string; mobile: string; gender: string; dateOfBirth: string; age: number }>(b.patient, { name: '', email: '', mobile: '', gender: '', dateOfBirth: '', age: 0 });
  const req = { referenceId: b.reference, uniqueId: b.member_id, orderType: 'HOME_SAMPLE' as const, appointment: toIstOffsetString(b.slot_at), name: patient.name, email: patient.email, mobile: patient.mobile, address: b.address, city: b.city, state: b.state, pincode: b.pincode, gender: patient.gender, age: patient.age, dateOfBirth: patient.dateOfBirth, ...(test.kind === 'package' ? { packageIds: [test.vendor_test_id] } : { testIds: [test.vendor_test_id] }), labId: b.lab_id ?? undefined };
  try {
    // before any retry: did a lost request already place it?
    const existing = await vendor.getOrderDetails(b.reference).catch(() => null);
    const result = existing ? { orderId: existing.orderId, orderStatus: existing.orderStatus, duplicate: true } : await vendor.placeOrder(req);
    const now = ctx.now();
    if (result.labError) {
      ctx.db.update('bloodwork_bookings', b.id, { vendor_order_id: result.orderId || null, vendor_status: result.orderStatus, vendor_pending: 1, flag: 'waiting for the lab: ' + result.labError, updated_at: now });
      openTask(ctx, { kind: 'failed_booking', title: `Laboratory has not accepted ${b.reference}`, detail: result.labError, refType: 'booking', refId: b.id });
      return;
    }
    ctx.db.update('bloodwork_bookings', b.id, { vendor_order_id: result.orderId, vendor_status: result.orderStatus, vendor_pending: 0, flag: null, last_vendor_event_at: now, expected_report_by: expectedBy(b.slot_at, test.turnaround), updated_at: now });
    ctx.db.insert('booking_events', { id: ids.bookingEvent(), booking_id: b.id, at: now, from_status: 'confirmed', to_status: 'confirmed', vendor_status: result.orderStatus, source: 'vendor', note: result.duplicate ? 'Order already existed at the laboratory (matched by booking number)' : 'Order placed with the laboratory' });
    audit(ctx, 'booking.placed', { type: 'booking', id: b.id }, null, { vendorOrderId: result.orderId, duplicate: result.duplicate });
    applyVendorStatus(ctx, b.id, result.orderStatus, 'vendor', 'order placed');
  } catch (e) {
    const kind = e instanceof VendorError ? e.kind : 'network';
    if (kind === 'rejected') {
      recordFailure(ctx, 'placeOrder', e, { bookingId: b.id }); // refused outright: the booking is cancelled, no task
      cancelInternal(ctx, b.id, `The laboratory refused the order: ${(e as Error).message}`, 'system');
      notify(ctx, { userId: b.member_id, category: 'bloodwork', title: 'Booking could not be placed', body: 'The laboratory could not accept this slot. Nothing is charged; your test allowance is restored. Pick another slot.', data: { bookingId: b.id } });
      return;
    }
    if (kind === 'auth') { setIntegration(ctx, { keyRejectedAt: ctx.now() }); notifyPrivileged(ctx, { category: 'operations', title: 'LabStack rejected the API key', body: 'New lab bookings are paused until the key is fixed.' }); }
    ctx.db.update('bloodwork_bookings', b.id, { vendor_pending: 1, flag: 'waiting for the lab: ' + (e as Error).message, updated_at: ctx.now() });
    const taskId = openTask(ctx, { kind: 'failed_booking', title: `Could not place ${b.reference} with the laboratory`, detail: `${(e as Error).message}. The safety net retries; the member sees "confirming your slot".`, refType: 'booking', refId: b.id });
    recordFailure(ctx, 'placeOrder', e, { bookingId: b.id, taskId });
  }
}

/** Hours in the laboratory's turnaround text ("12 hours", "2 days", "1 week"): the first number and unit; null when the
 *  text carries none. */
export function turnaroundHours(turnaround: string | null | undefined): number | null {
  const m = /(\d+)\s*(hour|day|week)/i.exec(turnaround ?? '');
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2]!.toLowerCase();
  return unit.startsWith('hour') ? n : unit.startsWith('day') ? n * 24 : n * 24 * 7;
}
/** The four hours added to the laboratory's turnaround before a report counts as expected. */
export const REPORT_MARGIN_HOURS = 4;
/** When the report is expected for a collection at slotAt: the slot plus the test's turnaround plus four hours (null
 *  when the turnaround text gives no number). The order sets expected_report_by with it, a reschedule recomputes it from
 *  the new slot, and the LabStack operations view (modules/labstackOps.ts) measures report deadlines with it. */
export function expectedBy(slotAt: string, turnaround: string | null | undefined): string | null {
  const hours = turnaroundHours(turnaround);
  return hours === null ? null : addHours(slotAt, hours + REPORT_MARGIN_HOURS);
}

/* ---------- status changes ---------- */
export function applyVendorStatus(ctx: Ctx, bookingId: string, vendorStatus: string, source: 'vendor' | 'system', note?: string): { changed: boolean; status: LabStatus; reason?: string } {
  return ctx.db.tx(() => {
    const b = ctx.db.get<BookingRow>('SELECT * FROM bloodwork_bookings WHERE id = ?', [bookingId]);
    if (!b) throw errors.notFound('Booking');
    const t = applyLabStackStatus(b.status, vendorStatus);
    const now = ctx.now();
    ctx.db.update('bloodwork_bookings', bookingId, { vendor_status: vendorStatus, last_vendor_event_at: now, updated_at: now });
    if (!t.changed) return { changed: false, status: b.status, reason: t.reason };
    const flag = t.flag === 'rebook' ? 'rebook: the team arranges a new visit' : vendorStatus === 'PENDING' ? 'waiting for the lab' : null;
    ctx.db.update('bloodwork_bookings', bookingId, { status: t.status, flag, vendor_pending: 0, cancelled_reason: t.status === 'cancelled' ? (b.cancelled_reason ?? 'Cancelled by the laboratory') : undefined });
    ctx.db.insert('booking_events', { id: ids.bookingEvent(), booking_id: bookingId, at: now, from_status: b.status, to_status: t.status, vendor_status: vendorStatus, source, note: note ?? null });
    emit(ctx, 'BookingUpdated', { type: 'booking', id: bookingId }, { from: b.status, to: t.status, vendorStatus, flag });
    // the held unit is spent once the sample exists, even when a catch-up skips straight past sample_collected (consume is idempotent)
    if (b.entitlement_tx_id && ['sample_collected', 'processing', 'results_ready', 'completed'].includes(t.status)) entitlements.consume(ctx, b.entitlement_tx_id, 'sample collected');
    if (t.status === 'cancelled' && b.entitlement_tx_id && b.status !== 'sample_collected' && b.status !== 'processing' && b.status !== 'results_ready') entitlements.release(ctx, b.entitlement_tx_id, 'cancelled by the laboratory');
    memberStatusNotification(ctx, b, t.status, flag);
    // members have no reschedule control and the old slot is inside the cut-off: the team arranges the new visit
    if (t.flag === 'rebook') openTask(ctx, { kind: 'collection_rebook', title: `${b.reference} needs a new collection visit`, detail: `The laboratory reported ${vendorStatus.replace(/_/g, ' ').toLowerCase()}. Contact the member and arrange a new slot; the test stays reserved.`, refType: 'booking', refId: bookingId });
    if (t.flag === 'rebook') { const coach = activeCoachFor(ctx, b.member_id); if (coach && coachCanReview(ctx, b.member_id)) notify(ctx, { userId: coach.coachId, category: 'bloodwork', title: 'Collection needs rebooking', body: `${b.reference}: ${vendorStatus.replace(/_/g, ' ').toLowerCase()}.`, data: { bookingId, memberId: b.member_id }, channels: ['in_app'] }); }
    return { changed: true, status: t.status };
  });
}

function memberStatusNotification(ctx: Ctx, b: BookingRow, status: LabStatus, flag: string | null, reviewed = false): void {
  const copy: Record<LabStatus, [string, string] | null> = {
    confirmed: ['Booking confirmed', `Home collection on ${istDayLabel(b.slot_at)}.`],
    scheduled: flag ? ['A new visit is needed', 'The collection could not be completed. The Bioptime team will contact you to arrange a new visit; the test you booked stays reserved.'] : ['Collection scheduled', `A phlebotomist will visit on ${istDayLabel(b.slot_at)}.`],
    sample_collected: ['Sample on its way', 'Your sample is on its way to the laboratory.'],
    processing: ['Processing', 'The laboratory is processing your sample.'],
    results_ready: ['Results received', coachCanReview(ctx, b.member_id) ? 'Your results are in. Your coach is reviewing them and will add notes.' : 'Your results are in. The Bioptime team is reviewing them and will add notes.'],
    // 'completed' says notes were added only when it comes from a review; an override that completes a booking says no more than that
    completed: reviewed ? ['Results reviewed', ctx.actor?.role === 'coach' ? 'Your coach has added notes to your report.' : 'The Bioptime team has added notes to your report.'] : ['Booking complete', 'Your blood test booking is marked complete.'],
    cancelled: ['Booking cancelled', b.cancelled_reason ?? 'The booking was cancelled.'],
  };
  const c = copy[status];
  if (c) notify(ctx, { userId: b.member_id, category: 'bloodwork', title: c[0], body: c[1], data: { bookingId: b.id, status }, sensitive: status === 'results_ready' || status === 'completed' });
}

/* ---------- the webhook ---------- */
export async function handleWebhook(ctx: Ctx, vendor: LabVendor, headers: Record<string, string | string[] | undefined>, payload: WebhookPayload): Promise<{ outcome: string }> {
  const headerName = ctx.config.LABSTACK_WEBHOOK_HEADER.toLowerCase();
  const got = headers[headerName];
  const value = Array.isArray(got) ? got[0] : got;
  if (!value || !safeEqual(String(value), ctx.config.LABSTACK_WEBHOOK_VALUE)) { audit(ctx, 'labstack.webhook_rejected', null, 'wrong or missing header'); throw errors.unauthorised('Webhook header did not match', 'BAD_WEBHOOK_HEADER'); }
  const now = ctx.now();
  setIntegration(ctx, { lastWebhook: now });
  const dedupe = sha256(JSON.stringify({ o: payload.orderId, r: payload.referenceId, s: payload.orderStatus, e: payload.events }));
  const already = ctx.db.get('SELECT 1 FROM vendor_events WHERE dedupe_key = ?', [`labstack:${dedupe}`]);
  const b = ctx.db.get<BookingRow>('SELECT * FROM bloodwork_bookings WHERE reference = ? OR vendor_order_id = ?', [payload.referenceId, payload.orderId]);
  ctx.db.insert('vendor_events', { id: ids.vendorEvent(), vendor: 'labstack', kind: 'order_webhook', vendor_order_id: payload.orderId, reference: payload.referenceId, status: payload.orderStatus, dedupe_key: already ? null : `labstack:${dedupe}`, payload: j.in(payload), received_at: now, processed_at: now, outcome: b ? (already ? 'repeat' : 'applied') : 'unknown_order' });
  if (!b) { openTask(ctx, { kind: 'unknown_webhook', title: `Laboratory update for an unknown order ${payload.orderId}`, detail: `referenceId ${payload.referenceId}, status ${payload.orderStatus}`, refType: 'vendor_order', refId: payload.orderId }); return { outcome: 'unknown_order' }; }
  if (!b.vendor_order_id && payload.orderId) ctx.db.update('bloodwork_bookings', b.id, { vendor_order_id: payload.orderId, vendor_pending: 0, updated_at: now });
  if (already) return { outcome: 'repeat' }; // a byte-identical redelivery is logged above and changes nothing: no second transition, no second notification
  if (b.status === 'cancelled' && payload.orderStatus !== 'CANCELED') {
    // the laboratory still holds an order we cancelled locally: ask it to cancel, never revive the booking
    try { const r = await vendor.cancelOrder(payload.orderId || b.vendor_order_id || ''); if (!r.accepted) openTask(ctx, { kind: 'failed_booking', title: `Laboratory still holds cancelled booking ${b.reference}`, detail: `Vendor status ${payload.orderStatus}; cancel refused: ${r.message ?? 'no reason'}`, refType: 'booking', refId: b.id }); }
    catch (e) { const taskId = openTask(ctx, { kind: 'failed_booking', title: `Laboratory still holds cancelled booking ${b.reference}`, detail: `Vendor status ${payload.orderStatus}; cancel call failed`, refType: 'booking', refId: b.id }); recordFailure(ctx, 'cancelOrder', e, { bookingId: b.id, taskId }); }
    return { outcome: 'cancelled_locally' };
  }
  const r = applyVendorStatus(ctx, b.id, payload.orderStatus, 'vendor', 'webhook');
  for (const ev of payload.events ?? []) {
    if (ev.event === 'REPORTS_CHANGED' && ev.link) recordReport(ctx, b, ev.link, !!ev.partial);
    if (ev.event === 'HARMONIZED_VALUES_CHANGED') await loadRawValues(ctx, vendor, b.id);
    if (ev.event === 'RESCHEDULED' || payload.orderStatus === 'RESCHEDULED') { /* a date change; the reschedule path already updated slot_at */ }
  }
  return { outcome: r.changed ? 'applied' : 'no_change' };
}

function recordReport(ctx: Ctx, b: BookingRow, link: string, partial: boolean): string {
  const existing = ctx.db.get<{ id: string }>('SELECT id FROM report_metadata WHERE booking_id = ?', [b.id]);
  const now = ctx.now();
  if (existing) { ctx.db.update('report_metadata', existing.id, { vendor_link: link, delivered_at: now }); return existing.id; }
  const test = ctx.db.get<{ markers: number | null }>('SELECT markers FROM bloodwork_tests WHERE id = ?', [b.test_id]);
  const id = ids.report();
  ctx.db.insert('report_metadata', { id, booking_id: b.id, member_id: b.member_id, vendor_link: link, storage_path: null, delivered_at: now, released_at: null, reviewed_at: null, reviewed_by: null, coach_note: null, flagged: j.in([]), markers: test?.markers ?? null, values_status: 'pending', created_at: now });
  emit(ctx, 'ReportDelivered', { type: 'report', id }, { memberId: b.member_id, bookingId: b.id, partial });
  const coach = activeCoachFor(ctx, b.member_id);
  if (coach && coachCanReview(ctx, b.member_id)) notify(ctx, { userId: coach.coachId, category: 'report', title: 'Report to review', body: `${b.reference}: the laboratory report is in. Review it to release it to the member.`, data: { reportId: id, memberId: b.member_id, bookingId: b.id }, channels: ['in_app', 'email'], sensitive: true });
  else openTask(ctx, { kind: 'missing_report_notification', title: `Report for ${b.reference} has no coach to review it`, detail: !coach ? 'The member has no active coach. Assign one, or release the report from Bloodwork → Reports with a note for the member.' : coach.status !== 'active' ? 'The member’s coach is away. Release the report from Bloodwork → Reports with a note for the member, or reassign them.' : 'The member keeps coach sharing off, so their coach cannot open the report. Release it from Bloodwork → Reports with a note for the member.', refType: 'report', refId: id });
  return id;
}

async function loadRawValues(ctx: Ctx, vendor: LabVendor, bookingId: string): Promise<void> {
  const b = ctx.db.get<BookingRow>('SELECT * FROM bloodwork_bookings WHERE id = ?', [bookingId]);
  const report = b ? ctx.db.get<{ id: string; values_status: string }>('SELECT id, values_status FROM report_metadata WHERE booking_id = ?', [b.id]) : undefined;
  if (!b || !report || !b.vendor_order_id || report.values_status === 'ready') return;
  try {
    const r = await vendor.getReportRawValues(b.vendor_order_id);
    if (r.failed) { ctx.db.update('report_metadata', report.id, { values_status: 'failed' }); openTask(ctx, { kind: 'report_values_failed', title: `Marker values for ${b.reference} need LabStack support`, detail: 'getReportRawValues returned 400; the PDF stays available, trends will not.', refType: 'report', refId: report.id }); return; }
    if (!r.ready) return;
    ctx.db.tx(() => {
      ctx.db.run('DELETE FROM report_values WHERE report_id = ?', [report.id]);
      const flagged: string[] = [];
      for (const v of r.values) {
        const marker = markerKeyFor(v.testId);
        const n = Number(v.value);
        const flag = v.flag ?? (Number.isFinite(n) && v.ranges ? (v.ranges.low !== undefined && n < v.ranges.low ? 'low' : v.ranges.high !== undefined && n > v.ranges.high ? 'high' : null) : null);
        if (flag) flagged.push(`${v.name} ${v.value}${v.units ? ' ' + v.units : ''} (${flag})`);
        ctx.db.insert('report_values', { id: ids.reportValue(), report_id: report.id, marker_key: marker, vendor_test_id: v.testId, label: v.name, value: v.value, units: v.units ?? null, range_low: v.ranges?.low ?? null, range_high: v.ranges?.high ?? null, matched_range: v.matchedRange ?? null, flag, unmapped: marker ? 0 : 1 });
      }
      ctx.db.update('report_metadata', report.id, { values_status: 'ready', flagged: j.in(flagged), markers: r.values.length });
    });
  } catch (e) {
    recordFailure(ctx, 'getReportRawValues', e);
  }
}

const MARKER_KEYS: Record<string, string> = { CHOL: 'total_cholesterol', HDL: 'hdl', LDL: 'ldl', TRIG: 'triglycerides', HBA1C: 'hba1c', VITD: 'vitamin_d', B12: 'vitamin_b12', T3: 't3', T4: 't4', TSH: 'tsh', HSCRP: 'hs_crp', HB: 'haemoglobin', WBC: 'wbc', PLT: 'platelets', GLU: 'fasting_glucose' };
function markerKeyFor(vendorTestId: string): string | null { return MARKER_KEYS[vendorTestId] ?? null; }

/* ---------- member and team actions ---------- */
export async function cancel(ctx: Ctx, vendor: LabVendor, bookingId: string, reason: string): Promise<ReturnType<typeof presentBooking>> {
  const b = ctx.db.get<BookingRow>('SELECT * FROM bloodwork_bookings WHERE id = ?', [bookingId]);
  if (!b) throw errors.notFound('Booking');
  if (!LAB_MANUAL_TRANSITIONS[b.status].includes('cancelled')) throw errors.state(`A booking that is ${b.status} cannot be cancelled from here`);
  const cutoff = Number(getSetting(ctx, 'cancellation_cutoff_minutes'));
  if (ctx.actor?.role === 'member' && minutesBetween(ctx.now(), b.slot_at) < cutoff) throw errors.state(`Bookings can be cancelled until ${cutoff} minutes before the slot.`, { code: 'CUTOFF' });
  if (b.vendor_order_id) { // the laboratory may hold this order (even mid-reschedule or after a lab error): always tell it; 'unknown order' is the one answer that means a local cancel is enough
    try {
      const r = await vendor.cancelOrder(b.vendor_order_id);
      if (!r.accepted && r.message !== 'unknown order') throw refused(ctx, 'cancel', r.message);
      if (r.pending) { ctx.db.update('bloodwork_bookings', bookingId, { vendor_pending: 1, flag: 'cancellation pending at the lab', updated_at: ctx.now() }); audit(ctx, 'booking.cancel_pending', { type: 'booking', id: bookingId }, reason); return presentBooking(ctx, ctx.db.get<BookingRow>('SELECT * FROM bloodwork_bookings WHERE id = ?', [bookingId])!); }
    } catch (e) { if (e instanceof VendorError) { recordFailure(ctx, 'cancelOrder', e); throw errors.upstream('We could not reach the laboratory to cancel. Try again in a minute.'); } throw e; }
  }
  cancelInternal(ctx, bookingId, reason, ctx.actor?.role === 'member' ? 'member' : ctx.actor?.role === 'coach' ? 'coach' : 'admin');
  return presentBooking(ctx, ctx.db.get<BookingRow>('SELECT * FROM bloodwork_bookings WHERE id = ?', [bookingId])!);
}

/** A change the laboratory refused. The team reads the laboratory's own answer; a member reads what it means for them
 *  and what to do (the laboratory's words stay in the error's details). */
function refused(ctx: Ctx, change: 'cancel' | 'move', vendorMessage: string | undefined) {
  const detail = vendorMessage ?? 'no reason given';
  if (ctx.actor?.role !== 'member') return errors.state(change === 'move' ? `The laboratory refused the new slot: ${detail}` : `The laboratory refused the cancellation: ${detail}`, { code: 'LAB_REFUSED', vendorMessage: detail });
  return errors.state(change === 'move'
    ? 'The laboratory could not move this collection to that slot. Pick another slot, or ask us in Help and support and we will arrange it.'
    : 'The laboratory could not cancel this collection from here. Ask us in Help and support and we will cancel it for you.', { code: 'LAB_REFUSED', vendorMessage: detail });
}

function cancelInternal(ctx: Ctx, bookingId: string, reason: string, source: 'member' | 'coach' | 'admin' | 'system'): void {
  ctx.db.tx(() => {
    const b = ctx.db.get<BookingRow>('SELECT * FROM bloodwork_bookings WHERE id = ?', [bookingId])!;
    if (b.status === 'cancelled') return;
    const now = ctx.now();
    ctx.db.update('bloodwork_bookings', bookingId, { status: 'cancelled', flag: null, vendor_pending: 0, cancelled_reason: reason, updated_at: now });
    ctx.db.insert('booking_events', { id: ids.bookingEvent(), booking_id: bookingId, at: now, from_status: b.status, to_status: 'cancelled', vendor_status: b.vendor_status, source, actor_id: ctx.actor?.id ?? null, note: reason });
    if (b.entitlement_tx_id) entitlements.release(ctx, b.entitlement_tx_id, `cancelled: ${reason}`);
    emit(ctx, 'BookingUpdated', { type: 'booking', id: bookingId }, { from: b.status, to: 'cancelled', reason });
    audit(ctx, 'booking.cancel', { type: 'booking', id: bookingId }, reason);
    if (source !== 'member') notify(ctx, { userId: b.member_id, category: 'bloodwork', title: 'Booking cancelled', body: reason, data: { bookingId } });
  });
}

export async function reschedule(ctx: Ctx, vendor: LabVendor, bookingId: string, slotAt: string, labId?: string) {
  const b = ctx.db.get<BookingRow>('SELECT * FROM bloodwork_bookings WHERE id = ?', [bookingId]);
  if (!b) throw errors.notFound('Booking');
  if (b.status !== 'confirmed' && b.status !== 'scheduled') throw errors.state(`A booking that is ${b.status} cannot be moved`);
  const cutoff = Number(getSetting(ctx, 'cancellation_cutoff_minutes'));
  if (ctx.actor?.role === 'member' && minutesBetween(ctx.now(), b.slot_at) < cutoff) throw errors.state(`Bookings can be moved until ${cutoff} minutes before the slot.`, { code: 'CUTOFF' });
  if (slotAt <= addHours(ctx.now(), 2)) throw errors.badRequest('Pick a slot at least two hours from now', 'TOO_SOON');
  let pending = false;
  if (b.vendor_order_id) {
    try {
      const r = await vendor.rescheduleOrder(b.vendor_order_id, toIstOffsetString(slotAt));
      if (!r.accepted) throw refused(ctx, 'move', r.message);
      pending = r.pending;
    } catch (e) { if (e instanceof VendorError) { recordFailure(ctx, 'rescheduleOrder', e); throw errors.upstream('We could not reach the laboratory to move the booking. Try again in a minute.'); } throw e; }
  }
  const now = ctx.now();
  const test = ctx.db.get<{ turnaround: string }>('SELECT turnaround FROM bloodwork_tests WHERE id = ?', [b.test_id]);
  // the report is expected from the NEW slot, by the formula the order used (expectedBy). A booking not yet placed with
  // the laboratory has no expected time yet: placing it computes one from the slot it then holds.
  const expectedReportBy = b.vendor_order_id || b.expected_report_by ? expectedBy(slotAt, test?.turnaround) : b.expected_report_by;
  ctx.db.tx(() => {
    // a booking still waiting to be placed stays waiting (the safety net places it at the new slot); a placed one is
    // pending only while the laboratory confirms the move
    ctx.db.update('bloodwork_bookings', bookingId, { slot_at: slotAt, lab_id: labId ?? b.lab_id, flag: pending ? 'new slot pending at the lab' : (b.flag?.startsWith('rebook') ? null : b.flag), vendor_pending: b.vendor_order_id ? (pending ? 1 : 0) : b.vendor_pending, expected_report_by: expectedReportBy, updated_at: now });
    ctx.db.insert('booking_events', { id: ids.bookingEvent(), booking_id: bookingId, at: now, from_status: b.status, to_status: b.status, vendor_status: 'RESCHEDULED', source: ctx.actor?.role === 'member' ? 'member' : 'admin', actor_id: ctx.actor?.id ?? null, note: `Moved from ${b.slot_at} to ${slotAt}` });
    // the status does not change; the event lets the handlers that follow the slot (the labFollowups preparation
    // reminder) move at once instead of on their next periodic sync
    emit(ctx, 'BookingUpdated', { type: 'booking', id: bookingId }, { from: b.status, to: b.status, rescheduled: true, slotFrom: b.slot_at, slotTo: slotAt });
    audit(ctx, 'booking.reschedule', { type: 'booking', id: bookingId }, null, { from: b.slot_at, to: slotAt, pending, expectedReportBy });
    // a member who moves their own booking sees it at once; a move by the team is told, as a cancellation by the team is
    if (ctx.actor?.role !== 'member') notify(ctx, { userId: b.member_id, category: 'bloodwork', title: 'Collection moved', body: pending ? `The laboratory is confirming a new visit on ${istDayLabel(slotAt)}.` : `A phlebotomist will now visit on ${istDayLabel(slotAt)}.`, data: { bookingId } });
  });
  return presentBooking(ctx, ctx.db.get<BookingRow>('SELECT * FROM bloodwork_bookings WHERE id = ?', [bookingId])!);
}

/** Owner override: any status, with a reason, audited. The only path that ignores the forward-only rule. */
export function override(ctx: Ctx, bookingId: string, status: LabStatus, reason: string) {
  if (!reason) throw errors.badRequest('A reason is required for an override', 'REASON_REQUIRED');
  return ctx.db.tx(() => {
    const b = ctx.db.get<BookingRow>('SELECT * FROM bloodwork_bookings WHERE id = ?', [bookingId]);
    if (!b) throw errors.notFound('Booking');
    if (b.status === status) throw errors.state(`The booking is already ${status}`);
    if (b.status === 'cancelled') throw errors.state('A cancelled booking cannot be revived by override: its held unit was given back. Book again instead.', { code: 'CANCELLED_IS_FINAL' });
    const now = ctx.now();
    ctx.db.update('bloodwork_bookings', bookingId, { status, flag: null, vendor_pending: 0, cancelled_reason: status === 'cancelled' ? reason : b.cancelled_reason, updated_at: now });
    ctx.db.insert('booking_events', { id: ids.bookingEvent(), booking_id: bookingId, at: now, from_status: b.status, to_status: status, vendor_status: b.vendor_status, source: 'admin', actor_id: ctx.actor?.id ?? null, note: `Override: ${reason}` });
    if (status === 'cancelled' && b.entitlement_tx_id && !['sample_collected', 'processing', 'results_ready', 'completed'].includes(b.status)) entitlements.release(ctx, b.entitlement_tx_id, `override: ${reason}`);
    if (b.entitlement_tx_id && ['sample_collected', 'processing', 'results_ready', 'completed'].includes(status)) entitlements.consume(ctx, b.entitlement_tx_id, `override: ${reason}`);
    audit(ctx, 'booking.override', { type: 'booking', id: bookingId }, reason, { from: b.status, to: status });
    emit(ctx, 'BookingUpdated', { type: 'booking', id: bookingId }, { from: b.status, to: status, override: true });
    memberStatusNotification(ctx, { ...b, cancelled_reason: status === 'cancelled' ? reason : b.cancelled_reason }, status, null);
    return presentBooking(ctx, ctx.db.get<BookingRow>('SELECT * FROM bloodwork_bookings WHERE id = ?', [bookingId])!);
  });
}

/** The coach's review releases the report to the member and completes the booking. */
export function reviewReport(ctx: Ctx, reportId: string, input: { coachNote: string; flagged?: string[] }) {
  return ctx.db.tx(() => {
    const r = ctx.db.get<{ id: string; booking_id: string; member_id: string; reviewed_at: string | null }>('SELECT * FROM report_metadata WHERE id = ?', [reportId]);
    if (!r) throw errors.notFound('Report');
    if (!input.coachNote?.trim()) throw errors.badRequest('Add a note for the member before releasing the report', 'NOTE_REQUIRED');
    if ((r as { released_at?: string | null }).released_at) throw errors.state('This report has already been released', { code: 'ALREADY_RELEASED' }); // a released note is never overwritten
    const b = ctx.db.get<BookingRow>('SELECT * FROM bloodwork_bookings WHERE id = ?', [r.booking_id])!;
    const now = ctx.now();
    ctx.db.update('report_metadata', reportId, { reviewed_at: now, reviewed_by: ctx.actor?.id ?? null, coach_note: input.coachNote, released_at: now, flagged: input.flagged ? j.in(input.flagged) : undefined });
    if (b.status === 'results_ready') {
      ctx.db.update('bloodwork_bookings', b.id, { status: 'completed', flag: null, updated_at: now });
      ctx.db.insert('booking_events', { id: ids.bookingEvent(), booking_id: b.id, at: now, from_status: 'results_ready', to_status: 'completed', vendor_status: b.vendor_status, source: ctx.actor?.role === 'coach' ? 'coach' : 'admin', actor_id: ctx.actor?.id ?? null, note: 'Report reviewed and released' });
      memberStatusNotification(ctx, b, 'completed', null, true);
    } else {
      notify(ctx, { userId: b.member_id, category: 'report', title: 'Your report has notes', body: ctx.actor?.role === 'coach' ? 'Your coach has added notes to your report.' : 'The Bioptime team has added notes to your report.', data: { reportId }, sensitive: true });
    }
    emit(ctx, 'ReportReleased', { type: 'report', id: reportId }, { memberId: r.member_id, bookingId: b.id });
    audit(ctx, 'report.review', { type: 'report', id: reportId }, null, { bookingId: b.id });
    return getReport(ctx, reportId);
  });
}

/** Who reviews (or reviewed) a member's report, for the wording members see: their coach, or the Bioptime team. */
export function reviewerKind(ctx: Ctx, memberId: string, reviewerRole?: string | null): 'coach' | 'team' {
  if (reviewerRole !== undefined) return reviewerRole === 'coach' ? 'coach' : 'team';
  return coachCanReview(ctx, memberId) ? 'coach' : 'team';
}

/** Whether the member's assigned coach can review this member's reports: an active coach and coach sharing on. */
export function coachCanReview(ctx: Ctx, memberId: string): boolean {
  const coach = activeCoachFor(ctx, memberId);
  if (!coach || coach.status !== 'active') return false;
  const consent = ctx.db.get<{ granted: number }>("SELECT granted FROM member_consents WHERE user_id = ? AND kind = 'coach_sharing' ORDER BY at DESC LIMIT 1", [memberId]);
  return !!consent?.granted;
}

/** An administrator releases a report that no coach can review (no active coach, or the member keeps coach sharing off),
    so a member is never left without results they paid for. The coach stays the reviewer whenever one can review. */
export function releaseWithoutCoach(ctx: Ctx, reportId: string, input: { note: string; reason: string }) {
  const r = ctx.db.get<{ member_id: string; released_at: string | null }>('SELECT member_id, released_at FROM report_metadata WHERE id = ?', [reportId]);
  if (!r) throw errors.notFound('Report');
  if (r.released_at) throw errors.state('This report has already been released', { code: 'ALREADY_RELEASED' });
  if (coachCanReview(ctx, r.member_id)) throw errors.state('The member’s coach reviews this report', { code: 'COACH_REVIEWS' });
  const out = reviewReport(ctx, reportId, { coachNote: input.note });
  audit(ctx, 'report.released_without_coach', { type: 'report', id: reportId }, input.reason, { memberId: r.member_id });
  return out;
}

/* ---------- reading ---------- */
export function presentBooking(ctx: Ctx, b: BookingRow) {
  const test = ctx.db.get<Record<string, unknown>>('SELECT * FROM bloodwork_tests WHERE id = ?', [b.test_id]);
  const timeline = ctx.db.all('SELECT at, from_status, to_status, vendor_status, source, note FROM booking_events WHERE booking_id = ? ORDER BY at', [b.id]);
  const report = ctx.db.get<{ id: string; released_at: string | null; reviewed_at: string | null; values_status: string; reviewer_role: string | null }>('SELECT r.id, r.released_at, r.reviewed_at, r.values_status, u.role AS reviewer_role FROM report_metadata r LEFT JOIN users u ON u.id = r.reviewed_by WHERE r.booking_id = ?', [b.id]);
  const member = ctx.db.get<{ name: string }>('SELECT name FROM users WHERE id = ?', [b.member_id]);
  const cutoff = Number(getSetting(ctx, 'cancellation_cutoff_minutes'));
  return {
    id: b.id, reference: b.reference, memberId: b.member_id, memberName: member?.name ?? null, programmeId: b.programme_id, test: test ? presentTest(test) : null, status: b.status, statusLabel: b.status.replace(/_/g, ' '),
    slotAt: b.slot_at, labId: b.lab_id, vendor: b.vendor, vendorOrderId: b.vendor_order_id, vendorStatus: b.vendor_status, vendorPending: !!b.vendor_pending, flag: b.flag,
    address: { line: b.address, city: b.city, state: b.state, pincode: b.pincode }, consumesEntitlement: !!b.entitlement_tx_id, expectedReportBy: b.expected_report_by, cancelledReason: b.cancelled_reason,
    canCancel: LAB_MANUAL_TRANSITIONS[b.status].includes('cancelled') && minutesBetween(ctx.now(), b.slot_at) >= cutoff,
    canReschedule: (b.status === 'confirmed' || b.status === 'scheduled') && minutesBetween(ctx.now(), b.slot_at) >= cutoff,
    report: report ? { id: report.id, released: !!report.released_at, reviewed: !!report.reviewed_at, valuesStatus: report.values_status, reviewerKind: reviewerKind(ctx, b.member_id, report.reviewed_at ? report.reviewer_role : undefined) } : null,
    timeline, createdAt: b.created_at, updatedAt: b.updated_at, simulated: ctx.config.LABSTACK_MODE === 'standin',
  };
}

/** SQL fragment: the member's latest coach_sharing consent is an explicit grant (no row = not shared). */
export const SHARED_WITH_COACH = (alias: string) => `EXISTS (SELECT 1 FROM member_consents c WHERE c.user_id = ${alias}.member_id AND c.kind = 'coach_sharing' AND c.granted = 1 AND c.at = (SELECT MAX(at) FROM member_consents WHERE user_id = c.user_id AND kind = 'coach_sharing'))`;

export function listBookings(ctx: Ctx, opts: { memberId?: string; status?: string; coachId?: string; limit: number }) {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (opts.memberId) { where.push('b.member_id = ?'); params.push(opts.memberId); }
  if (opts.status) { where.push('b.status = ?'); params.push(opts.status); }
  if (opts.coachId) { where.push("b.member_id IN (SELECT member_id FROM coach_assignments WHERE coach_id = ? AND status IN ('active','paused'))"); params.push(opts.coachId); where.push(SHARED_WITH_COACH('b')); }
  return ctx.db.all<BookingRow>(`SELECT b.* FROM bloodwork_bookings b ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY b.created_at DESC LIMIT ?`, [...params, opts.limit]).map((b) => presentBooking(ctx, b));
}

export function getBooking(ctx: Ctx, id: string) {
  const b = ctx.db.get<BookingRow>('SELECT * FROM bloodwork_bookings WHERE id = ? OR reference = ?', [id, id]);
  if (!b) throw errors.notFound('Booking');
  return presentBooking(ctx, b);
}

export function getReport(ctx: Ctx, reportId: string) {
  const r = ctx.db.get<Record<string, unknown>>('SELECT r.*, b.reference, b.slot_at, b.test_id, u.name AS reviewer_name, u.role AS reviewer_role, m.name AS member_name FROM report_metadata r JOIN bloodwork_bookings b ON b.id = r.booking_id LEFT JOIN users u ON u.id = r.reviewed_by LEFT JOIN users m ON m.id = r.member_id WHERE r.id = ?', [reportId]);
  if (!r) throw errors.notFound('Report');
  const values = ctx.db.all('SELECT marker_key, vendor_test_id, label, value, units, range_low, range_high, matched_range, flag, unmapped FROM report_values WHERE report_id = ? ORDER BY rowid', [reportId]);
  const test = ctx.db.get<Record<string, unknown>>('SELECT * FROM bloodwork_tests WHERE id = ?', [r.test_id as string]);
  return { id: r.id, bookingId: r.booking_id, reference: r.reference, memberId: r.member_id, memberName: r.member_name ?? null, test: test ? presentTest(test) : null, collectedAt: r.slot_at, deliveredAt: r.delivered_at, released: !!r.released_at, releasedAt: r.released_at, reviewed: !!r.reviewed_at, reviewedAt: r.reviewed_at, reviewerName: r.reviewer_name ?? null, reviewerKind: reviewerKind(ctx, r.member_id as string, r.reviewed_at ? (r.reviewer_role as string | null) : undefined), coachNote: r.coach_note, flagged: j.out(r.flagged, []), markers: r.markers, valuesStatus: r.values_status, values, hasFile: !!r.vendor_link || !!r.storage_path, provenance: 'Values and ranges as reported by the laboratory; the review note is Bioptime commentary, not a medical opinion.', simulated: ctx.config.LABSTACK_MODE === 'standin' };
}

/** Who may read a report: the member once released, their assigned coach with sharing consent, admins. */
export function assertReportAccess(ctx: Ctx, reportId: string): { memberId: string; released: boolean } {
  const r = ctx.db.get<{ member_id: string; released_at: string | null }>('SELECT member_id, released_at FROM report_metadata WHERE id = ?', [reportId]);
  if (!r) throw errors.notFound('Report');
  const actor = ctx.actor;
  if (!actor) throw errors.unauthorised();
  if (actor.role === 'admin' || actor.role === 'owner') return { memberId: r.member_id, released: !!r.released_at };
  if (actor.role === 'member') { if (actor.id !== r.member_id) throw errors.forbidden(); if (!r.released_at) throw errors.forbidden(`This report is being reviewed by ${coachCanReview(ctx, r.member_id) ? 'your coach' : 'the Bioptime team'} and will open once released`, 'NOT_RELEASED'); return { memberId: r.member_id, released: true }; }
  if (actor.role === 'coach') {
    if (!coachHasMember(ctx, actor.id, r.member_id)) throw errors.forbidden();
    audit(ctx, 'health.viewed', { type: 'user', id: r.member_id }, null, { by: 'coach', what: 'report', reportId });
    const consent = ctx.db.get<{ granted: number }>("SELECT granted FROM member_consents WHERE user_id = ? AND kind = 'coach_sharing' ORDER BY at DESC LIMIT 1", [r.member_id]);
    if (!consent?.granted) throw errors.forbidden('This member has not shared their reports with their coach', 'NOT_SHARED');
    return { memberId: r.member_id, released: !!r.released_at };
  }
  throw errors.forbidden();
}

export function reportFileToken(ctx: Ctx, reportId: string): { token: string; expiresInSeconds: number } {
  const access = assertReportAccess(ctx, reportId);
  audit(ctx, 'report.file_access', { type: 'report', id: reportId }, null, { memberId: access.memberId });
  return { token: signToken(ctx.config.TOKEN_SECRET, { r: reportId, u: ctx.actor!.id }, 300), expiresInSeconds: 300 };
}

export function verifyReportFileToken(ctx: Ctx, token: string): string | null {
  const p = verifyToken<{ r: string; u: string }>(ctx.config.TOKEN_SECRET, token);
  return p?.r ?? null;
}

export function listReports(ctx: Ctx, opts: { memberId?: string; coachId?: string; unreviewed?: boolean; limit: number }) {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (opts.memberId) { where.push('r.member_id = ?'); params.push(opts.memberId); }
  if (opts.coachId) { where.push("r.member_id IN (SELECT member_id FROM coach_assignments WHERE coach_id = ? AND status IN ('active','paused'))"); params.push(opts.coachId); where.push(SHARED_WITH_COACH('r')); }
  if (opts.unreviewed) where.push('r.reviewed_at IS NULL');
  if (ctx.actor?.role === 'member') where.push('r.released_at IS NOT NULL');
  return ctx.db.all<{ id: string }>(`SELECT r.id FROM report_metadata r ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY r.delivered_at DESC LIMIT ?`, [...params, opts.limit]).map((r) => getReport(ctx, r.id));
}

export function markerTrend(ctx: Ctx, memberId: string, markerKey: string) {
  return ctx.db.all('SELECT v.value, v.units, v.range_low, v.range_high, v.flag, b.slot_at AS at, r.id AS report_id FROM report_values v JOIN report_metadata r ON r.id = v.report_id JOIN bloodwork_bookings b ON b.id = r.booking_id WHERE r.member_id = ? AND v.marker_key = ? AND r.released_at IS NOT NULL ORDER BY b.slot_at', [memberId, markerKey]);
}

/* ---------- integration health and jobs ---------- */
export function setIntegration(ctx: Ctx, patch: Record<string, unknown>): void {
  const cur = j.out<Record<string, unknown>>(ctx.db.get<{ status: string }>("SELECT status FROM integration_status WHERE integration = 'labstack'")?.status, {});
  ctx.db.run("INSERT INTO integration_status (integration, status, updated_at) VALUES ('labstack', ?, ?) ON CONFLICT(integration) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at", [j.in({ ...cur, ...patch }), ctx.now()]);
}

/** One failed call to the laboratory, kept in integration_status (the last 50). When the failure opened or joined an
 *  operations task, the record names it (taskId), and the booking it concerned (bookingId), so the LabStack operations
 *  view counts the incident once: under its task while that is open, and not at all once the task is closed. */
export type LabFailure = { at: string; call: string; message: string; bookingId?: string; taskId?: string };
function recordFailure(ctx: Ctx, call: string, e: unknown, link: { bookingId?: string; taskId?: string } = {}): void {
  const cur = j.out<{ failures?: LabFailure[] }>(ctx.db.get<{ status: string }>("SELECT status FROM integration_status WHERE integration = 'labstack'")?.status, {});
  const entry: LabFailure = { at: ctx.now(), call, message: (e as Error).message, ...(link.bookingId ? { bookingId: link.bookingId } : {}), ...(link.taskId ? { taskId: link.taskId } : {}) };
  const failures = [...(cur.failures ?? []), entry].slice(-50);
  setIntegration(ctx, { failures, lastFailureAt: ctx.now() });
}

export function integrationStatus(ctx: Ctx, vendor: LabVendor) {
  const s = j.out<Record<string, unknown> & { failures?: Array<{ at: string }> }>(ctx.db.get<{ status: string }>("SELECT status FROM integration_status WHERE integration = 'labstack'")?.status, {});
  const dayAgo = addHours(ctx.now(), -24);
  const open = ctx.db.get<{ n: number }>("SELECT COUNT(*) n FROM bloodwork_bookings WHERE status NOT IN ('completed','cancelled')")?.n ?? 0;
  const silent = ctx.db.get<{ n: number }>("SELECT COUNT(*) n FROM bloodwork_bookings WHERE status NOT IN ('completed','cancelled','results_ready') AND (last_vendor_event_at IS NULL OR last_vendor_event_at < ?) AND created_at < ?", [dayAgo, dayAgo])?.n ?? 0;
  const failed = (s.failures ?? []).filter((f) => f.at > dayAgo).length;
  const state = vendor.mode === 'live' ? 'connected' : ctx.config.isProduction ? 'pending_configuration' : 'standin';
  return { state, configured: vendor.mode === 'live', mode: vendor.mode, vendor: vendor.name, lastCatalogueSync: s.lastCatalogueSync ?? null, lastWebhook: s.lastWebhook ?? null, lastSafetyNet: s.lastSafetyNet ?? null, openOrders: open, silent24h: silent, failedCalls24h: failed, keyExpiresAt: vendor.keyExpiry(), keyRejectedAt: s.keyRejectedAt ?? null, catalogueCount: s.catalogueCount ?? null, webhookAddress: `${ctx.config.PUBLIC_ORIGIN}/api/integrations/labstack/webhook`, note: vendor.mode === 'standin' ? 'Stand-in: orders are simulated inside this server; no laboratory is involved.' : 'Live: calls go to LabStack with the configured key.' };
}

/** Every 30 minutes: missed webhooks, bookings not yet placed, orders silent too long. */
export async function safetyNet(ctx: Ctx, vendor: LabVendor): Promise<{ checked: number; applied: number; placed: number }> {
  let applied = 0, placed = 0;
  const since = addHours(ctx.now(), -(ctx.config.LABSTACK_SAFETY_NET_MINUTES / 60) * 2);
  let orders: VendorOrder[] = [];
  try { orders = await vendor.getOrders(since); } catch (e) { recordFailure(ctx, 'getOrders', e); }
  for (const o of orders) {
    const b = ctx.db.get<BookingRow>('SELECT * FROM bloodwork_bookings WHERE reference = ? OR vendor_order_id = ?', [o.referenceId, o.orderId]);
    if (!b) continue;
    if (!b.vendor_order_id) ctx.db.update('bloodwork_bookings', b.id, { vendor_order_id: o.orderId, vendor_pending: 0 });
    if (b.status === 'cancelled' && o.orderStatus !== 'CANCELED') {
      try { const c = await vendor.cancelOrder(o.orderId); if (!c.accepted) openTask(ctx, { kind: 'failed_booking', title: `Laboratory still holds cancelled booking ${b.reference}`, detail: `Vendor status ${o.orderStatus}`, refType: 'booking', refId: b.id }); } catch (e) { recordFailure(ctx, 'cancelOrder', e); }
      continue;
    }
    const r = applyVendorStatus(ctx, b.id, o.orderStatus, 'system', 'safety net');
    if (r.changed) applied++;
    // a missed REPORT_DELIVERED must also bring the report itself, or the member is told results are in while nothing exists
    if ((r.status === 'results_ready' || o.orderStatus === 'REPORT_DELIVERED') && !ctx.db.get('SELECT 1 FROM report_metadata WHERE booking_id = ?', [b.id])) {
      const fresh = ctx.db.get<BookingRow>('SELECT * FROM bloodwork_bookings WHERE id = ?', [b.id])!;
      if (o.reportLinks?.[0]) { recordReport(ctx, fresh, o.reportLinks[0], false); await loadRawValues(ctx, vendor, b.id); }
      else if (!ctx.db.get("SELECT 1 FROM support_tasks WHERE kind = 'missing_report_notification' AND ref_id = ? AND status IN ('open','in_progress')", [b.id])) openTask(ctx, { kind: 'missing_report_notification', title: `Results ready for ${b.reference} but no report link from the laboratory`, detail: 'Fetch the report from the vendor portal or ask the laboratory to resend the webhook.', refType: 'booking', refId: b.id });
    }
  }
  for (const b of ctx.db.all<BookingRow>("SELECT * FROM bloodwork_bookings WHERE vendor_order_id IS NULL AND status = 'confirmed' AND vendor_pending = 1")) { await placeWithVendor(ctx, vendor, b); if (ctx.db.get('SELECT 1 FROM bloodwork_bookings WHERE id = ? AND vendor_order_id IS NOT NULL', [b.id])) placed++; }
  setIntegration(ctx, { lastSafetyNet: ctx.now() });
  const s = integrationStatus(ctx, vendor);
  if (s.openOrders > 0 && s.lastWebhook && s.lastWebhook < addHours(ctx.now(), -6) && !ctx.db.get("SELECT 1 FROM support_tasks WHERE kind = 'integration_error' AND ref_id = 'webhook_silence' AND status IN ('open','in_progress')")) openTask(ctx, { kind: 'integration_error', title: 'No laboratory webhook for 6 hours while orders are open', detail: `Last webhook ${s.lastWebhook}; ${s.openOrders} open orders.`, refType: 'integration', refId: 'webhook_silence' });
  return { checked: orders.length, applied, placed };
}
