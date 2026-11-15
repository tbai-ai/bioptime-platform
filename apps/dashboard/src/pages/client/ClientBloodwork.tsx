import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Link } from '../../lib/nav';
import { uuid } from '../../lib/ids';
import { api } from '../../lib/api';
import { addDaysIst, fmtDate, fmtDateTime, fmtTime, label, plural } from '../../lib/format';
import { Alert, Button, Card, CardHead, ConfirmDialog, Empty, Field, Input, Pill, Skeleton, Textarea, useApi, useToast, errorText } from '../../ui';

/* The booking timeline in a member's words: who each step came from, and no system labels. */
const TIMELINE_SOURCE: Record<string, string> = { member: 'You', vendor: 'Laboratory', coach: 'Your coach', admin: 'Bioptime team', system: 'Bioptime' };
/** LabStack statuses that keep the booking at Scheduled but need a new visit (packages/domain LABSTACK_REBOOK_FLAGS). */
const REBOOK_STATUSES = new Set(['SAMPLE_REJECTED', 'PHLEBO_NO_SHOW', 'PATIENT_MISSED']);
/** The notes apps/api applyVendorStatus (domain/bloodwork.ts) gives a laboratory status change: they only name the
    channel the update came by (the order call, the laboratory's webhook, the reconciliation job), so a member never sees them. */
const CHANNEL_NOTES = new Set(['order placed', 'webhook', 'safety net']);
function timelineStep(e: { from_status: string | null; to_status: string; vendor_status: string | null; note: string | null; source: string }): { title: string; note: string | null; source: string } {
  const rebook = e.from_status === e.to_status && !!e.vendor_status && REBOOK_STATUSES.has(e.vendor_status);
  const moved = e.note ? /^Moved from (\S+) to (\S+)$/.exec(e.note) : null;
  const note = !e.note || CHANNEL_NOTES.has(e.note) ? null : moved ? `Moved from ${fmtDateTime(moved[1])} to ${fmtDateTime(moved[2])}` : e.note;
  return { title: rebook ? 'A new visit is needed' : label(e.to_status), note, source: TIMELINE_SOURCE[e.source] ?? label(e.source) };
}

/** Bloodwork: the entitlement, bookings, released reports, the catalogue, and the booking flow. */
export function ClientBloodwork() {
  const tests = useApi(() => api.get('/me/bloodwork/tests'), []);
  const bookings = useApi(() => api.get('/me/bloodwork/bookings'), []);
  const reports = useApi(() => api.get('/me/reports'), []);
  const [booking, setBooking] = useState(false);
  const t = tests.data as any;
  if (tests.error) return <Alert kind="error">{tests.error}</Alert>;
  if (!t) return <Skeleton rows={6} />;
  const ent = t.entitlement;
  // the same rules as the API (lab_consent must be granted to book) plus the portal's own: no new bookings while health_data is withdrawn
  const labOk = !!t.consents?.lab_consent?.granted, healthOk = !!t.consents?.health_data?.granted;
  const consentOk = labOk && healthOk;
  const all = ((bookings.data as any)?.items ?? []) as any[];
  const open = all.filter((b) => !['completed', 'cancelled'].includes(b.status));
  const done = all.filter((b) => ['completed', 'cancelled'].includes(b.status));
  const reload = () => { tests.reload(); bookings.reload(); reports.reload(); };
  return <div className="stack">
    <div className="pageHead"><div><h1>Bloodwork</h1><p className="sub">{!ent ? 'No blood tests included yet. One included test is one home collection by the partner laboratory.' : ent.total === 0 ? 'Your package does not include blood tests.' : `${ent.remaining} of ${ent.total} blood test${ent.total === 1 ? '' : 's'} left${ent.reserved ? `, ${ent.reserved} booked and held` : ''}. One included test is one home collection by the partner laboratory.`}</p></div>
      <div className="actions"><Button variant="primary" disabled={!ent || ent.remaining < 1 || !consentOk} onClick={() => setBooking(true)}>Book a test</Button></div></div>
    {t.vendor === 'standin' && <p className="muted small">Practice laboratory: bookings are simulated and no sample is collected.</p>}
    {!consentOk && <Alert kind="warning" title="Consent needed">{!labOk && <>Booking shares your name, phone, email, gender, date of birth and collection address with the laboratory. Turn on "Share my details with the partner laboratory" under <Link to="/profile?tab=privacy">Profile, privacy and sharing</Link>.</>}{!labOk && !healthOk ? ' ' : null}{!healthOk && <>Turn on "Process my health information" under <Link to="/profile?tab=privacy">Privacy and sharing</Link>.</>}</Alert>}
    {ent && ent.total > 0 && ent.remaining < 1 && <p className="muted small">Your package's tests are used up. Pay-per-test is not available yet; a new package includes more.</p>}
    {booking && <BookTest tests={t} onClose={() => setBooking(false)} onDone={() => { setBooking(false); reload(); }} />}
    <div className="grid">
      <div className="span6"><Card><CardHead eyebrow="Bookings" title="Upcoming" />{open.length ? <div className="stack">{open.map((b) => <div key={b.id} className="row between"><div><Link to={`/bloodwork/${b.id}`}><b>{b.test?.name ?? 'Test'}</b></Link><div className="small">{b.reference} · {fmtDateTime(b.slotAt)}{b.flag ? ' · ' + b.flag : ''}</div></div><Pill status={b.status} /></div>)}</div> : <Empty title="No upcoming bookings" />}</Card></div>
      <div className="span6"><Card><CardHead eyebrow="Reports" title="Released" />{((reports.data as any)?.items ?? []).length ? <div className="stack">{((reports.data as any).items as any[]).map((r) => <div key={r.id} className="row between"><div><Link to={`/reports/${r.id}`}><b>{r.test?.name ?? 'Report'}</b></Link><div className="small">{r.reference} · collected {fmtDate(r.collectedAt)}{r.reviewed ? ` · reviewed by ${r.reviewerName}` : ''}</div></div>{r.flagged?.length ? <span className="bp-pill bp-pill-warning">{r.flagged.length} flagged</span> : r.valuesStatus === 'ready' && r.values?.length ? <span className="bp-pill bp-pill-success">In range</span> : <span className="bp-pill">{r.valuesStatus === 'pending' ? 'Values pending' : r.hasFile ? 'See the laboratory PDF' : 'No values'}</span>}</div>)}</div> : <Empty title="No released reports" body="A report reaches you after it has been reviewed: by your coach while health sharing is on, otherwise by the Bioptime team." />}</Card></div>
      {done.length ? <div className="span6"><Card><CardHead eyebrow="History" title="Past bookings" /><div className="stack">{done.map((b) => <div key={b.id} className="row between"><span><Link to={`/bloodwork/${b.id}`}>{b.test?.name ?? 'Test'}</Link> <span className="muted">{b.reference} · {fmtDate(b.slotAt)}</span></span><Pill status={b.status} /></div>)}</div></Card></div> : null}
      <div className="span6"><Card><CardHead eyebrow="Catalogue" title="Tests you can book" /><div className="stack">{(t.items ?? []).map((x: any) => <div key={x.id}><b style={{ color: 'var(--bp-color-text-primary)' }}>{x.name}</b><div className="small">{x.markers ? `${plural(x.markers, 'marker')} · ` : ''}{x.fastingHours ? `fasting ${x.fastingHours} h · ` : 'no fasting · '}results in {x.turnaround}</div></div>)}</div><p className="muted small" style={{ marginTop: 10 }}>Tests are booked against your package's included collections.</p></Card></div>
    </div>
  </div>;
}

function BookTest({ tests, onClose, onDone }: { tests: any; onClose: () => void; onDone: () => void }) {
  const profile = useApi(() => api.get('/me/profile'), []);
  const [testId, setTestId] = useState<string | null>(null);
  const [date, setDate] = useState(addDaysIst(2));
  const [addr, setAddr] = useState({ pincode: '', address: '', city: '', state: '' });
  const [slots, setSlots] = useState<any[] | null>(null);
  const [slot, setSlot] = useState<any>(null);
  const [slotsErr, setSlotsErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const key = useRef(uuid());
  useEffect(() => { const p = (profile.data as any)?.profile; if (p && !addr.pincode) setAddr({ pincode: p.pincode ?? '', address: p.address ?? '', city: p.city ?? '', state: p.state ?? '' }); }, [profile.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const find = async () => {
    setLoading(true); setSlotsErr(''); setSlot(null);
    try { const r = await api.get<any>(`/me/bloodwork/slots?date=${date}&pincode=${encodeURIComponent(addr.pincode)}`); setSlots(r.slots ?? []); }
    catch (e) { setSlots(null); setSlotsErr(errorText(e)); } finally { setLoading(false); }
  };
  const book = async () => {
    if (!testId || !slot) return;
    setBusy(true); setMsg(null);
    try {
      const r = await api.post<any>('/me/bloodwork/bookings', { testId, slotAt: slot.slotAt ?? slot.startAt ?? slot.at, labId: slot.labId ?? slot.lab?.id, pincode: addr.pincode, address: addr.address, city: addr.city, state: addr.state, idempotencyKey: key.current });
      if (r.status === 'cancelled') { setMsg({ kind: 'error', text: `The laboratory could not take this order${r.cancelledReason ? `: ${r.cancelledReason}` : ''}. Nothing is booked and your test is still available; try another slot or PIN code.` }); return; }
      setMsg({ kind: 'success', text: `Booked: ${r.reference}. ${r.vendorPending || !r.vendorOrderId ? 'The laboratory is confirming the slot; you are told when it does.' : `Collection ${fmtDate(r.slotAt)} at ${fmtTime(r.slotAt)}.`}${r.test?.fastingHours ? ` Fast for ${r.test.fastingHours} hours before.` : ''}` });
      key.current = uuid(); onDone();
    } catch (e) { setMsg({ kind: 'error', text: errorText(e) }); } finally { setBusy(false); }
  };
  const chosen = (tests.items ?? []).find((x: any) => x.id === testId);
  const ready = !!testId && !!slot && addr.address.length >= 5 && addr.city.length >= 2 && addr.state.length >= 2;
  return <Card accent><CardHead eyebrow="Book" title="A blood test at home" right={<Button size="sm" variant="tertiary" onClick={onClose}>Close</Button>} />
    <div className="form">
      <div><span className="bp-label">1. Test</span><div className="pillRow" style={{ marginTop: 6 }}>{(tests.items ?? []).map((x: any) => <button key={x.id} type="button" className="bp-chip" aria-pressed={x.id === testId} onClick={() => setTestId(x.id)}>{x.name}</button>)}</div>{chosen && <p className="muted small" style={{ marginTop: 6 }}>{chosen.markers ? `${plural(chosen.markers, 'marker')} · ` : ''}{chosen.fastingHours ? `fasting ${chosen.fastingHours} h` : 'no fasting'} · results in {chosen.turnaround}{chosen.preparation ? ` · ${chosen.preparation}` : ''}</p>}</div>
      <span className="bp-label">2. Address</span>
      <div className="row"><Field label="PIN code"><Input inputMode="numeric" maxLength={6} value={addr.pincode} onChange={(e) => setAddr({ ...addr, pincode: e.target.value })} /></Field><Field label="City"><Input value={addr.city} onChange={(e) => setAddr({ ...addr, city: e.target.value })} /></Field><Field label="State"><Input value={addr.state} onChange={(e) => setAddr({ ...addr, state: e.target.value })} /></Field></div>
      <Field label="Address"><Textarea value={addr.address} onChange={(e) => setAddr({ ...addr, address: e.target.value })} /></Field>
      <div><span className="bp-label">3. Slot</span><div className="pillRow" style={{ marginTop: 6 }}>{[1, 2, 3, 4, 5, 6, 7].map((n) => addDaysIst(n)).map((d) => <button key={d} type="button" className="bp-chip" aria-pressed={d === date} onClick={() => { setDate(d); setSlots(null); setSlot(null); }}>{fmtDate(d).replace(/ \d{4}$/, '')}</button>)}</div></div>
      <div><Button busy={loading} disabled={!/^\d{6}$/.test(addr.pincode)} onClick={find}>Find collection slots</Button></div>
      {slotsErr && <Alert kind="error">{slotsErr}</Alert>}
      {slots ? (slots.length ? <div className="pillRow">{slots.map((s, i) => { const at = s.slotAt ?? s.startAt ?? s.at; return <button key={i} type="button" className="bp-chip" aria-pressed={slot === s} onClick={() => setSlot(s)}>{fmtTime(at)}{s.labName ? ` · ${s.labName}` : ''}</button>; })}</div> : <p className="small">No slots for that PIN code and day. Try another day.</p>) : null}
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <div><Button variant="primary" busy={busy} disabled={!ready} onClick={book}>Book this slot</Button></div>
      <p className="muted small">Booking shares your name, phone, email, gender, date of birth and collection address with the laboratory for this collection only. You can cancel from the booking page while its Cancel button shows: until shortly before the slot, and only before the sample is collected. To change the time, cancel and book again.</p>
    </div>
  </Card>;
}

/** One booking with its timeline, and cancellation. */
export function ClientBooking() {
  const { id = '' } = useParams();
  const b = useApi(() => api.get(`/me/bloodwork/bookings/${id}`), [id]);
  const toast = useToast();
  const [cancel, setCancel] = useState(false);
  const d = b.data as any;
  if (b.error) return <Alert kind="error">{b.error}</Alert>;
  if (!d) return <Skeleton rows={6} />;
  return <div className="stack">
    <div className="pageHead"><div><Link className="muted" to="/bloodwork">← Bloodwork</Link><h1 style={{ marginTop: 4 }}>{d.test?.name}</h1><p className="sub">{d.reference} · collection {fmtDateTime(d.slotAt)}</p></div><div className="actions"><Pill status={d.status} />{d.simulated && <span className="bp-pill">Simulated</span>}{d.canCancel && <Button size="sm" variant="destructive" onClick={() => setCancel(true)}>Cancel booking</Button>}{d.report?.released && <Link className="bp-btn bp-btn-primary bp-btn-sm" to={`/reports/${d.report.id}`}>Open report</Link>}</div></div>
    {d.flag && <Alert kind="warning">{d.flag}</Alert>}
    <div className="grid">
      <div className="span6"><Card><CardHead eyebrow="Details" title="Collection" /><dl className="kv"><dt>Collection</dt><dd>{fmtDateTime(d.slotAt)}</dd><dt>Address</dt><dd>{d.address?.line ?? ''}, {d.address?.city ?? ''} {d.address?.pincode ?? ''}</dd><dt>Fasting</dt><dd>{d.test?.fastingHours ? `${d.test.fastingHours} hours before` : 'Not needed'}</dd><dt>Results</dt><dd>{d.expectedReportBy ? `expected by ${fmtDate(d.expectedReportBy)}` : d.test?.turnaround ?? '—'}</dd><dt>Counts</dt><dd>{d.consumesEntitlement ? 'against your package' : 'not against your package'}</dd></dl>{d.report && !d.report.released && <p className="muted small" style={{ marginTop: 10 }}>{d.report.reviewerKind === 'team' ? 'Report with the Bioptime team for review.' : 'Report with your coach for review.'}</p>}</Card></div>
      <div className="span6"><Card><CardHead eyebrow="Timeline" title="What happened" /><ul className="timeline">{(d.timeline ?? []).map((e: any, i: number) => { const st = timelineStep(e); return <li key={i} className="done"><b>{st.title}</b>{st.note ? ` · ${st.note}` : ''}<time>{fmtDateTime(e.at)} · {st.source}</time></li>; })}</ul></Card></div>
    </div>
    <p className="muted small">Status changes come from the laboratory or the review of your report. A result outside a range is not a diagnosis.</p>
    <ConfirmDialog open={cancel} onClose={() => setCancel(false)} title="Cancel this booking?" danger confirmLabel="Cancel booking" body="The laboratory is told and the test goes back to your package." note="Anything the laboratory should know" onConfirm={async (note) => { await api.post(`/me/bloodwork/bookings/${id}/cancel`, { reason: note || 'cancelled in the portal' }); toast('Booking cancelled'); b.reload(); }} />
  </div>;
}
