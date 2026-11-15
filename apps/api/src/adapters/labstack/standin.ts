/* The LabStack stand-in: a practice copy of the published API that runs inside the server. It walks each order through
   the statuses and delivers webhooks to the local route exactly as LabStack would, so the booking flow is exercised
   end to end without a key. Nothing here is a real laboratory; every surface that shows its data says so.
   At 'fast' and 'realistic' speed an order moves on by itself, but never past PHLEBO_ASSIGNED before its appointment:
   the sample is collected at the visit (release round, 5 Nov 2026: a booking two days ahead read "results ready" within
   a minute, with cancel and move gone). The team can still step an order on at once (POST /labstack/standin/step). */
import { randomToken } from '../../lib/crypto.js';
import { addMinutes, zonedToIso } from '../../lib/time.js';
import type { ChangeResult, LabVendor, PlaceOrderRequest, PlaceOrderResult, RawValue, VendorOrder, VendorSlot, VendorTest, WebhookPayload } from './types.js';

export const STANDIN_CATALOGUE: VendorTest[] = [
  { vendorTestId: 'LS-FBE', kind: 'package', name: 'Full Body Checkup, Essential', pricePaise: 199900, fastingHours: 12, turnaround: '12 hours', markers: 61, preparation: 'Fast for 12 hours; water is fine.' },
  { vendorTestId: 'LS-FBA', kind: 'package', name: 'Full Body Checkup, Advanced', pricePaise: 349900, fastingHours: 12, turnaround: '24 hours', markers: 88, preparation: 'Fast for 12 hours; water is fine.' },
  { vendorTestId: 'LS-CBC', kind: 'test', name: 'Complete Blood Count (CBC)', pricePaise: 39900, fastingHours: 0, turnaround: '12 hours', markers: 24 },
  { vendorTestId: 'LS-LIPID', kind: 'test', name: 'Lipid Profile', pricePaise: 59900, fastingHours: 12, turnaround: '12 hours', markers: 8, preparation: 'Fast for 12 hours.' },
  { vendorTestId: 'LS-HSCRP', kind: 'test', name: 'hs-CRP', pricePaise: 69900, fastingHours: 0, turnaround: '24 hours', markers: 1 },
  { vendorTestId: 'LS-HBA1C', kind: 'test', name: 'HbA1c', pricePaise: 54900, fastingHours: 0, turnaround: '12 hours', markers: 1 },
  { vendorTestId: 'LS-THY', kind: 'test', name: 'Thyroid Profile (T3, T4, TSH)', pricePaise: 54900, fastingHours: 0, turnaround: '24 hours', markers: 3 },
  { vendorTestId: 'LS-VITD', kind: 'test', name: 'Vitamin D (25-OH)', pricePaise: 119900, fastingHours: 0, turnaround: '24 hours', markers: 1 },
  { vendorTestId: 'LS-B12', kind: 'test', name: 'Vitamin B12', pricePaise: 99900, fastingHours: 0, turnaround: '24 hours', markers: 1 },
];

const SAMPLE_VALUES: Record<string, RawValue[]> = {
  'LS-LIPID': [
    { testId: 'CHOL', name: 'Total cholesterol', value: '182', units: 'mg/dL', ranges: { high: 200 } }, { testId: 'HDL', name: 'HDL cholesterol', value: '48', units: 'mg/dL', ranges: { low: 40 } },
    { testId: 'LDL', name: 'LDL cholesterol', value: '112', units: 'mg/dL', ranges: { high: 100 }, flag: 'high' }, { testId: 'TRIG', name: 'Triglycerides', value: '96', units: 'mg/dL', ranges: { high: 150 } },
  ],
  'LS-HBA1C': [{ testId: 'HBA1C', name: 'HbA1c', value: '5.4', units: '%', ranges: { high: 5.7 } }],
  'LS-VITD': [{ testId: 'VITD', name: 'Vitamin D (25-OH)', value: '24', units: 'ng/mL', ranges: { low: 30, high: 100 }, flag: 'low' }],
  'LS-B12': [{ testId: 'B12', name: 'Vitamin B12', value: '410', units: 'pg/mL', ranges: { low: 200, high: 900 } }],
  'LS-THY': [{ testId: 'T3', name: 'T3', value: '1.1', units: 'ng/mL', ranges: { low: 0.8, high: 2.0 } }, { testId: 'T4', name: 'T4', value: '7.8', units: 'µg/dL', ranges: { low: 5.1, high: 14.1 } }, { testId: 'TSH', name: 'TSH', value: '2.1', units: 'µIU/mL', ranges: { low: 0.4, high: 4.0 } }],
  'LS-HSCRP': [{ testId: 'HSCRP', name: 'hs-CRP', value: '0.9', units: 'mg/L', ranges: { high: 3 } }],
  'LS-CBC': [{ testId: 'HB', name: 'Haemoglobin', value: '13.8', units: 'g/dL', ranges: { low: 12, high: 16 } }, { testId: 'WBC', name: 'White cells', value: '6.2', units: '10³/µL', ranges: { low: 4, high: 11 } }, { testId: 'PLT', name: 'Platelets', value: '240', units: '10³/µL', ranges: { low: 150, high: 400 } }],
};
SAMPLE_VALUES['LS-FBE'] = [...SAMPLE_VALUES['LS-LIPID']!, ...SAMPLE_VALUES['LS-HBA1C']!, ...SAMPLE_VALUES['LS-VITD']!, ...SAMPLE_VALUES['LS-CBC']!, { testId: 'GLU', name: 'Fasting glucose', value: '92', units: 'mg/dL', ranges: { low: 70, high: 99 } }];
SAMPLE_VALUES['LS-FBA'] = [...SAMPLE_VALUES['LS-FBE'], ...SAMPLE_VALUES['LS-B12']!, ...SAMPLE_VALUES['LS-THY']!, ...SAMPLE_VALUES['LS-HSCRP']!];

const PROGRESSION = ['CREATED', 'PHLEBO_ASSIGNED', 'SAMPLE_COLLECTED', 'SAMPLE_PROCESSED', 'REPORT_DELIVERED'];

type StandinOrder = { orderId: string; referenceId: string; orderStatus: string; appointment: string; updatedAt: string; req: PlaceOrderRequest; stepTimer?: NodeJS.Timeout; cancelled?: boolean; holding?: number };

/** The longest single wait for an appointment (a timer cannot run longer than about 24 days; the hold re-checks). */
const HOLD_RECHECK_MS = 6 * 60 * 60_000;

/** An order this process did not place, known from the database at start (StandinLabStack.adopt): the seed's orders and
 *  those placed before a restart. */
export type AdoptedOrder = { orderId: string; referenceId: string; orderStatus: string; appointment: string; req: PlaceOrderRequest; cancelled?: boolean };

export class StandinLabStack implements LabVendor {
  readonly name = 'LabStack stand-in';
  readonly mode = 'standin' as const;
  private orders = new Map<string, StandinOrder>();
  private byReference = new Map<string, string>();
  private seq = 88000;
  constructor(private readonly opts: { speed: 'fast' | 'realistic' | 'manual'; deliver: (payload: WebhookPayload, header: { name: string; value: string }) => Promise<void>; webhookHeader: string; webhookValue: string }) {}

  async getCatalogue(): Promise<VendorTest[]> { return STANDIN_CATALOGUE.map((t) => ({ ...t })); }

  async getSlots(date: string, pincode: string): Promise<VendorSlot[]> {
    if (!/^\d{6}$/.test(pincode)) return [];
    if (pincode.startsWith('99')) return []; // a pincode the stand-in does not serve, for the error path
    const labs = [{ labId: 'LAB-BLR-1', labName: 'Stand-in Lab A' }, { labId: 'LAB-BLR-2', labName: 'Stand-in Lab B' }];
    const out: VendorSlot[] = [];
    for (const lab of labs) for (let m = 6 * 60; m <= 11 * 60; m += 30) {
      if (lab.labId === 'LAB-BLR-2' && m < 7 * 60) continue;
      const hh = String(Math.floor(m / 60)).padStart(2, '0'), mm = String(m % 60).padStart(2, '0');
      out.push({ labId: lab.labId, labName: lab.labName, time: `${hh}:${mm}`, startAt: zonedToIso(date, m) });
    }
    return out;
  }

  async placeOrder(req: PlaceOrderRequest): Promise<PlaceOrderResult> {
    const existing = this.byReference.get(req.referenceId);
    if (existing) return { orderId: existing, orderStatus: this.orders.get(existing)!.orderStatus, duplicate: true };
    if (req.pincode.startsWith('98')) return { orderId: `LS-${++this.seq}`, orderStatus: 'PENDING', duplicate: false, labError: 'No lab serves this pincode' }; // the lab-error path
    const orderId = `LS-${++this.seq}`;
    const order: StandinOrder = { orderId, referenceId: req.referenceId, orderStatus: 'PENDING', appointment: req.appointment, updatedAt: new Date().toISOString(), req };
    this.orders.set(orderId, order);
    this.byReference.set(req.referenceId, orderId);
    this.schedule(order, 0);
    return { orderId, orderStatus: 'PENDING', duplicate: false };
  }

  private schedule(order: StandinOrder, step: number): void {
    if (this.opts.speed === 'manual' || order.cancelled || step >= PROGRESSION.length) return;
    const delay = this.opts.speed === 'fast' ? 400 + step * 350 : 60_000 * (step + 1);
    order.holding = undefined;
    // a sample is collected at the visit, never before it: at any speed the order waits at PHLEBO_ASSIGNED until its
    // appointment, so a booking days ahead stays scheduled (and can be moved or cancelled) until then. The wait re-checks
    // at most every few hours, and a moved appointment re-arms it (rescheduleOrder).
    if (PROGRESSION[step] === 'SAMPLE_COLLECTED') {
      const wait = Date.parse(order.appointment) - Date.now();
      if (Number.isFinite(wait) && wait > delay) {
        order.holding = step;
        order.stepTimer = setTimeout(() => { this.schedule(order, step); }, Math.min(wait, HOLD_RECHECK_MS));
        order.stepTimer.unref?.();
        return;
      }
    }
    order.stepTimer = setTimeout(() => { void this.advance(order, step); }, delay);
    order.stepTimer.unref?.();
  }

  /** Orders this process did not place (the seed's, or those placed before a restart), taken from the database at
   *  start so a seeded booking can be moved, cancelled and stepped like a new one. They stay where they are (no timer):
   *  only a member's or the team's own action changes them. New order numbers continue after the highest one known. */
  adopt(orders: AdoptedOrder[]): number {
    let n = 0;
    for (const a of orders) {
      if (!a.orderId || this.orders.has(a.orderId)) continue;
      this.orders.set(a.orderId, { orderId: a.orderId, referenceId: a.referenceId, orderStatus: a.orderStatus, appointment: a.appointment, updatedAt: '', req: a.req, cancelled: a.cancelled });
      this.byReference.set(a.referenceId, a.orderId);
      const num = /^LS-(\d+)$/.exec(a.orderId);
      if (num) this.seq = Math.max(this.seq, Number(num[1]));
      n++;
    }
    return n;
  }

  private async advance(order: StandinOrder, step: number): Promise<void> {
    if (order.cancelled || step >= PROGRESSION.length) return;
    order.holding = undefined;
    const status = PROGRESSION[step]!;
    order.orderStatus = status;
    order.updatedAt = new Date().toISOString();
    const events: WebhookPayload['events'] = [{ event: 'ORDER_STATUS_CHANGED', at: order.updatedAt }];
    if (status === 'REPORT_DELIVERED') events.push({ event: 'REPORTS_CHANGED', link: `standin://report/${order.orderId}.pdf`, partial: false }, { event: 'HARMONIZED_VALUES_CHANGED' });
    try { await this.opts.deliver({ orderId: order.orderId, referenceId: order.referenceId, orderStatus: status, events }, { name: this.opts.webhookHeader, value: this.opts.webhookValue }); } catch { /* the safety net picks it up */ }
    this.schedule(order, step + 1);
  }

  async getOrderDetails(referenceId: string): Promise<VendorOrder | null> {
    const id = this.byReference.get(referenceId);
    if (!id) return null;
    const o = this.orders.get(id)!;
    return { orderId: o.orderId, referenceId: o.referenceId, orderStatus: o.orderStatus, appointment: o.appointment, updatedAt: o.updatedAt };
  }

  async cancelOrder(orderId: string): Promise<ChangeResult> {
    const o = this.orders.get(orderId);
    if (!o) return { accepted: false, pending: false, message: 'unknown order' };
    if (new Date(o.appointment).getTime() - Date.now() < 30 * 60_000) return { accepted: false, pending: false, message: 'Refused within 30 minutes of the slot' };
    o.cancelled = true; o.orderStatus = 'CANCELED'; o.updatedAt = new Date().toISOString();
    if (o.stepTimer) clearTimeout(o.stepTimer);
    return { accepted: true, pending: false };
  }

  async rescheduleOrder(orderId: string, appointment: string): Promise<ChangeResult> {
    const o = this.orders.get(orderId);
    if (!o) return { accepted: false, pending: false, message: 'unknown order' };
    if (new Date(o.appointment).getTime() - Date.now() < 30 * 60_000) return { accepted: false, pending: false, message: 'Refused within 30 minutes of the slot' };
    o.appointment = appointment; o.updatedAt = new Date().toISOString();
    // an order waiting for its visit waits for the new one
    if (o.holding !== undefined) { if (o.stepTimer) clearTimeout(o.stepTimer); this.schedule(o, o.holding); }
    return { accepted: true, pending: false };
  }

  async getOrders(updatedSince: string): Promise<VendorOrder[]> {
    return [...this.orders.values()].filter((o) => o.updatedAt > updatedSince).map((o) => ({ orderId: o.orderId, referenceId: o.referenceId, orderStatus: o.orderStatus, appointment: o.appointment, updatedAt: o.updatedAt }));
  }

  async getReportRawValues(orderId: string): Promise<{ ready: boolean; values: RawValue[]; failed?: boolean }> {
    const o = this.orders.get(orderId);
    if (!o || o.orderStatus !== 'REPORT_DELIVERED') return { ready: false, values: [] };
    const vendorIds = [...(o.req.testIds ?? []), ...(o.req.packageIds ?? [])];
    const values = vendorIds.flatMap((id) => SAMPLE_VALUES[id] ?? [{ testId: `${id}-UNMAPPED`, name: `${id} result`, value: 'see PDF' }]);
    return { ready: true, values };
  }

  async fetchReport(link: string): Promise<{ bytes: Buffer; mime: string } | null> {
    if (!link.startsWith('standin://')) return null;
    return { bytes: Buffer.from(`Practice laboratory placeholder for ${link}. Not a real report.`), mime: 'text/plain' };
  }

  async testWebhook(orderId: string, orderStatus: string): Promise<void> {
    const o = this.orders.get(orderId);
    if (!o) return;
    const events: WebhookPayload['events'] = [{ event: 'ORDER_STATUS_CHANGED', at: new Date().toISOString() }];
    if (orderStatus === 'REPORT_DELIVERED') events.push({ event: 'REPORTS_CHANGED', link: `standin://report/${orderId}.pdf` }, { event: 'HARMONIZED_VALUES_CHANGED' });
    await this.opts.deliver({ orderId, referenceId: o.referenceId, orderStatus, events }, { name: this.opts.webhookHeader, value: this.opts.webhookValue });
  }

  /** Manual speed only: move an order one step, for tests that drive the flow. */
  async step(orderId: string): Promise<string | null> {
    const o = this.orders.get(orderId);
    if (!o) return null;
    const idx = PROGRESSION.indexOf(o.orderStatus);
    const next = PROGRESSION[idx + 1];
    if (!next) return null;
    if (o.stepTimer) clearTimeout(o.stepTimer); // an explicit step replaces a timer that was waiting
    await this.advance(o, idx + 1);
    return next;
  }

  keyExpiry(): string | null { return null; }
  get size(): number { return this.orders.size; }
  newReference(): string { return randomToken(6); }
  static minutesBefore(iso: string, m: number): string { return addMinutes(iso, -m); }
}
