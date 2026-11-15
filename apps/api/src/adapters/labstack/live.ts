/* The live LabStack client, built on the Labs API v1.3 engineering reference (~/Desktop/drive/labstack-doc): the
   `ls-api-key` header on every call, the documented paths and query parameters, 409 on a duplicate placeOrder treated
   as placed, 202 as "pending at the lab", retries with a growing wait on network errors. Response field names follow
   the reference where it names them; anything else is read defensively and must be confirmed against the test store.
   This client has not been run against LabStack: no key has been issued yet. */
import type { ChangeResult, LabVendor, PlaceOrderRequest, PlaceOrderResult, RawValue, VendorOrder, VendorSlot, VendorTest } from './types.js';
import { VendorError } from './types.js';

type Json = Record<string, unknown>;

export class LiveLabStack implements LabVendor {
  readonly name = 'LabStack Labs API v1.3';
  readonly mode = 'live' as const;
  constructor(private readonly opts: { baseUrl: string; apiKey: string; apiKeyNext?: string; timeoutMs?: number; keyExpiresAt?: string | null; log?: (line: string) => void }) {}

  private async call(method: 'GET' | 'POST', path: string, query?: Record<string, string>, body?: unknown, attempt = 0): Promise<{ status: number; json: Json | Json[] | null; raw: string }> {
    const url = new URL(this.opts.baseUrl.replace(/\/$/, '') + path);
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 15_000);
    try {
      const res = await fetch(url, { method, headers: { 'ls-api-key': this.opts.apiKey, 'content-type': 'application/json', accept: 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: controller.signal });
      const raw = await res.text();
      let json: Json | Json[] | null = null;
      try { json = raw ? (JSON.parse(raw) as Json) : null; } catch { json = null; }
      this.opts.log?.(`labstack ${method} ${path} → ${res.status} in ${Date.now() - started} ms`);
      if (res.status === 401 || res.status === 403) throw new VendorError('LabStack rejected the API key', 'auth', res.status);
      if (res.status >= 500 && attempt < 3) { await wait(500 * 2 ** attempt); return this.call(method, path, query, body, attempt + 1); }
      return { status: res.status, json, raw };
    } catch (e) {
      if (e instanceof VendorError) throw e;
      const aborted = (e as Error).name === 'AbortError';
      if (!aborted && attempt < 3) { await wait(500 * 2 ** attempt); return this.call(method, path, query, body, attempt + 1); }
      throw new VendorError(aborted ? 'LabStack did not answer in time' : `LabStack unreachable: ${(e as Error).message}`, aborted ? 'timeout' : 'network');
    } finally {
      clearTimeout(timer);
    }
  }

  async getCatalogue(): Promise<VendorTest[]> {
    const out: VendorTest[] = [];
    for (const [kind, listPath, itemPath, idKey] of [['test', '/network/getTests', '/network/getTest', 'testId'], ['package', '/network/getPackages', '/network/getPackage', 'packageId']] as const) {
      const list = await this.call('GET', listPath);
      const items = asArray(list.json);
      for (const item of items) {
        const id = str(item[idKey] ?? item.id);
        if (!id) continue;
        const detail = await this.call('GET', itemPath, { [idKey]: id });
        const d = (detail.json && !Array.isArray(detail.json) ? detail.json : item) as Json;
        out.push({ vendorTestId: id, kind, name: str(d.name ?? d.testName ?? d.packageName) || id, description: str(d.description), pricePaise: num(d.price ?? d.mrp ?? d.labPrice) === null ? null : Math.round(num(d.price ?? d.mrp ?? d.labPrice)! * 100), fastingHours: num(d.fastingHours ?? d.fasting) ?? 0, turnaround: str(d.tat ?? d.turnaroundHours ? `${d.tat ?? d.turnaroundHours} hours` : d.turnaround) || '', preparation: str(d.preparation ?? d.instructions), markers: num(d.parameterCount ?? d.markers) ?? undefined });
      }
    }
    return out;
  }

  async getSlots(date: string, pincode: string): Promise<VendorSlot[]> {
    const r = await this.call('GET', '/availability/getSlots', { date, pincode, service: 'HOME_SAMPLE' });
    const out: VendorSlot[] = [];
    for (const lab of asArray(r.json)) {
      const labId = str(lab.labId ?? lab.id), labName = str(lab.labName ?? lab.name) || labId;
      for (const t of asArray(lab.slots ?? lab.times)) {
        const time = typeof t === 'string' ? t : str((t as Json).time ?? (t as Json).slot);
        if (!/^\d{2}:\d{2}$/.test(time)) continue; // bare HH:MM, read as India time until LabStack confirms
        const [hh, mm] = time.split(':').map(Number) as [number, number];
        const startAt = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), hh - 5, mm - 30)).toISOString();
        out.push({ labId, labName, time, startAt });
      }
    }
    return out;
  }

  async placeOrder(req: PlaceOrderRequest): Promise<PlaceOrderResult> {
    const r = await this.call('POST', '/order/placeOrder', undefined, req);
    const j = (r.json && !Array.isArray(r.json) ? r.json : {}) as Json;
    if (r.status === 409) return { orderId: str(j.orderId), orderStatus: str(j.orderStatus) || 'PENDING', duplicate: true };
    if (r.status >= 400) throw new VendorError(`LabStack refused the order (${r.status}): ${str(j.message ?? j.error) || r.raw.slice(0, 200)}`, 'rejected', r.status);
    return { orderId: str(j.orderId), orderStatus: str(j.orderStatus) || 'PENDING', duplicate: false, labError: str(j.labError ?? j.error) || undefined };
  }

  async getOrderDetails(referenceId: string): Promise<VendorOrder | null> {
    const r = await this.call('GET', '/order/getOrderDetails', { referenceId });
    if (r.status === 404 || !r.json) return null;
    return toOrder(Array.isArray(r.json) ? (r.json[0] as Json) : r.json);
  }

  async cancelOrder(orderId: string): Promise<ChangeResult> {
    const r = await this.call('GET', '/order/cancelOrder', { orderId });
    if (r.status === 202) return { accepted: true, pending: true };
    if (r.status >= 400) return { accepted: false, pending: false, message: str((r.json as Json | null)?.message) || `refused (${r.status})` };
    return { accepted: true, pending: false };
  }

  async rescheduleOrder(orderId: string, appointment: string): Promise<ChangeResult> {
    const r = await this.call('GET', '/order/rescheduleOrder', { orderId, appointment });
    if (r.status === 202) return { accepted: true, pending: true };
    if (r.status >= 400) return { accepted: false, pending: false, message: str((r.json as Json | null)?.message) || `refused (${r.status})` };
    return { accepted: true, pending: false };
  }

  async getOrders(updatedSince: string): Promise<VendorOrder[]> {
    const r = await this.call('GET', '/order/getOrders', { updatedSince });
    return asArray(r.json).map(toOrder);
  }

  async getReportRawValues(orderId: string): Promise<{ ready: boolean; values: RawValue[]; failed?: boolean }> {
    const r = await this.call('GET', '/order/getReportRawValues', { orderId });
    if (r.status === 202) return { ready: false, values: [] };
    if (r.status === 400) return { ready: false, values: [], failed: true };
    const values = asArray(Array.isArray(r.json) ? r.json : ((r.json as Json | null)?.values ?? (r.json as Json | null)?.results)).map((v) => ({ testId: str(v.testId ?? v.id), name: str(v.name ?? v.testName), value: str(v.value), units: str(v.units ?? v.unit) || undefined, ranges: v.ranges && typeof v.ranges === 'object' ? { low: num((v.ranges as Json).low ?? (v.ranges as Json).min) ?? undefined, high: num((v.ranges as Json).high ?? (v.ranges as Json).max) ?? undefined } : undefined, matchedRange: str(v.matchedRange) || undefined, flag: str(v.flag) || undefined }));
    return { ready: true, values };
  }

  async fetchReport(link: string): Promise<{ bytes: Buffer; mime: string } | null> {
    const url = new URL(link);
    if (!url.hostname.endsWith('labstack.in')) return null; // the key goes only to labstack.in hosts
    const res = await fetch(url, { headers: { 'ls-api-key': this.opts.apiKey } });
    if (!res.ok) return null;
    return { bytes: Buffer.from(await res.arrayBuffer()), mime: res.headers.get('content-type') ?? 'application/pdf' };
  }

  async testWebhook(orderId: string, orderStatus: string): Promise<void> { await this.call('GET', '/order/testWebhook', { orderId, orderStatus }); }
  keyExpiry(): string | null { return this.opts.keyExpiresAt ?? null; }
}

function wait(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
function asArray(v: unknown): Json[] { if (Array.isArray(v)) return v as Json[]; if (v && typeof v === 'object') { const o = v as Json; for (const k of ['data', 'items', 'results', 'tests', 'packages', 'orders', 'slots']) if (Array.isArray(o[k])) return o[k] as Json[]; } return []; }
function str(v: unknown): string { return v === undefined || v === null ? '' : String(v); }
function num(v: unknown): number | null { if (v === undefined || v === null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
function toOrder(j: Json): VendorOrder { return { orderId: str(j.orderId ?? j.id), referenceId: str(j.referenceId), orderStatus: str(j.orderStatus ?? j.status), appointment: str(j.appointment) || undefined, updatedAt: str(j.updatedAt ?? j.updated_at ?? j.modifiedAt) || new Date().toISOString(), reportLinks: asArray(j.reports).map((r) => str(r.link ?? r.url)).filter(Boolean) }; }
