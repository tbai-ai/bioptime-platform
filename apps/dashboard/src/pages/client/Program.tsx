import React, { useRef, useState } from 'react';
import { uuid } from '../../lib/ids';
import { Link } from '../../lib/nav';
import { api } from '../../lib/api';
import { fmtDate, fmtDateTime, fmtInr, label } from '../../lib/format';
import { Alert, Button, Card, CardHead, Dialog, Empty, Field, Input, Pill, Skeleton, Tabs, useApi, useToast, errorText } from '../../ui';

/** My program: the active package and entitlements, the published plan week by week, packages to buy and past orders. */
export function Program() {
  const [tab, setTab] = useState<'plan' | 'packages'>('plan');
  return <div className="stack">
    <div className="pageHead"><div><h1>My program</h1><p className="sub">Your package, the plan your coach published, and what is included.</p></div></div>
    <Tabs items={[{ id: 'plan', label: 'Plan' }, { id: 'packages', label: 'Packages and orders' }]} value={tab} onChange={setTab}>
    {tab === 'plan' ? <Plan /> : <Packages />}
    </Tabs>
  </div>;
}

function Plan() {
  const prog = useApi(() => api.get('/me/programme'), []);
  const notes = useApi(() => api.get('/me/notes'), []);
  const toast = useToast();
  const d = prog.data as any;
  if (prog.error) return <Alert kind="error">{prog.error}</Alert>;
  if (!d) return <Skeleton rows={6} />;
  const setStatus = async (t: any, status: 'done' | 'skipped' | 'pending') => { try { await api.patch(`/me/tasks/${t.id}`, { status }); prog.reload(); } catch (e) { toast(errorText(e), 'error'); } };
  const weeks: number[] = Array.from(new Set((d.tasks ?? []).map((t: any) => Number(t.week)))).sort((a: any, b: any) => a - b) as number[];
  const structure = d.plan?.currentVersion?.structure?.weeks ?? [];
  return <div className="grid">
    <div className="span4"><Card>{d.programme ? <><CardHead eyebrow="Package" title={d.programme.packageName} right={<Pill status={d.programme.status} />} />
      <dl className="kv"><dt>Runs</dt><dd>{fmtDate(d.programme.startAt)} to {fmtDate(d.programme.endAt)}</dd>{(d.entitlements ?? []).map((e: any) => <React.Fragment key={e.id ?? e.serviceType}><dt>{label(e.serviceType)}</dt><dd>{e.remaining ?? Math.max(0, e.quantity - e.used - e.reserved)} of {e.quantity} left{e.reserved ? ` (${e.reserved} booked)` : ''}</dd></React.Fragment>)}</dl></>
      : <><CardHead eyebrow="No package" title="A plan comes with a package" /><p className="small">A coach, blood tests and consultations are part of every package. Pick one under Packages and orders.</p></>}</Card></div>
    <div className="span8">{((notes.data as any)?.items ?? []).length > 0 && <Card accent><CardHead eyebrow="From your coach" title="Recommendations" /><ul className="timeline">{((notes.data as any).items as any[]).map((n) => <li key={n.id} className="done"><div>{n.body}</div><time>{n.coach_name} · {fmtDate(n.created_at)}</time></li>)}</ul></Card>}{d.plan ? <div className="stack">
      <Card><CardHead eyebrow={`Version ${d.plan.current_version} · by ${d.plan.coach_name}`} title={d.plan.title} />{d.plan.currentVersion?.summary && <p className="small">{d.plan.currentVersion.summary}</p>}{d.plan.goals?.length ? <div className="pillRow" style={{ marginTop: 8 }}>{d.plan.goals.map((g: string) => <span key={g} className="bp-pill">{g}</span>)}</div> : null}</Card>
      {weeks.map((w) => { const focus = structure.find((s: any) => s.week === w)?.focus; const tasks = d.tasks.filter((t: any) => Number(t.week) === w); return <Card key={w}><CardHead eyebrow={`Week ${w}`} title={focus ?? `Week ${w}`} />
        <ul className="taskList">{tasks.map((t: any) => <li key={t.id}><div><span className={t.status === 'done' ? 'done' : ''}>{t.title}</span><span className="muted">{label(t.kind)} · day {t.day} · {fmtDate(t.due_at)}</span></div><div className="row" style={{ gap: 6 }}><Pill status={t.status} />{t.status !== 'done' && <Button size="sm" variant="secondary" onClick={() => setStatus(t, 'done')}>Done</Button>}{t.status === 'pending' && <Button size="sm" variant="tertiary" onClick={() => setStatus(t, 'skipped')}>Skip</Button>}{t.status !== 'pending' && <Button size="sm" variant="tertiary" onClick={() => setStatus(t, 'pending')}>Undo</Button>}</div></li>)}</ul>
      </Card>; })}
    </div> : d.programme ? <Card><Empty title="No plan published yet" body="Your coach writes it after reading your goals; you are told here when it is ready." /></Card> : null}</div>
  </div>;
}

function Packages() {
  const pk = useApi(() => api.get('/packages'), []);
  const orders = useApi(() => api.get('/me/orders'), []);
  const config = useApi(() => api.get('/public/config'), []);
  const toast = useToast();
  const [confirm, setConfirm] = useState<any>(null);
  const [coupon, setCoupon] = useState('');
  const [pending, setPending] = useState<{ order: any; checkout: any } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null);
  const key = useRef(uuid()); // one key per checkout attempt: a double click or a retry cannot create two orders
  const items = ((pk.data as any)?.items ?? []).filter((p: any) => p.kind !== 'programme') as any[];
  const buy = async (p: any) => {
    setBusy(p.id); setMsg(null);
    try {
      const r = await api.post<any>('/me/checkout', { packageId: p.id, idempotencyKey: key.current, ...(coupon.trim() ? { couponCode: coupon.trim() } : {}) });
      setConfirm(null); key.current = uuid();
      if (r.checkout?.simulated) { setPending(r); setMsg({ kind: 'info', text: `Order ${r.order.reference} created for ${fmtInr(r.order.totalInr)}${r.order.discountInr ? ` (coupon ${r.order.couponCode}: ${fmtInr(r.order.discountInr)} off)` : ''}. It is not paid yet.` }); }
      else if (r.checkout?.url) { setMsg({ kind: 'info', text: `Order ${r.order.reference} created. Taking you to the payment provider…` }); window.location.assign(r.checkout.url); }
      else setMsg({ kind: 'error', text: 'No payment page came back for this provider.' });
    } catch (e) { setMsg({ kind: 'error', text: errorText(e) }); } finally { setBusy(null); }
  };
  const simulate = async (outcome: 'captured' | 'failed') => {
    if (!pending) return;
    setBusy('sim'); setMsg(null);
    try { const r = await api.post<any>('/payments/simulator/complete', { checkoutId: pending.checkout.checkoutId, outcome }); const o = r.order; setPending(null); setMsg(o.status === 'activated' || o.status === 'paid' ? { kind: 'success', text: `Payment confirmed. Order ${o.reference} is ${label(o.status)}; your package is active and a coach is being matched.` } : { kind: 'error', text: `The provider reported the payment as ${label(o.status)}. Nothing was charged.` }); orders.reload(); }
    catch (e) { toast(errorText(e), 'error'); } finally { setBusy(null); }
  };
  if (pk.error) return <Alert kind="error">{pk.error}</Alert>;
  if (!pk.data) return <Skeleton rows={6} />;
  return <div className="stack">
    {msg && <Alert kind={msg.kind === 'info' ? 'info' : msg.kind}>{msg.text}</Alert>}
    {pending && <Card accent><CardHead eyebrow="Payment" title={`Order ${pending.order.reference}`} /><p className="small">Choose how the payment provider should answer.</p><div className="bp-card-foot"><Button variant="primary" size="sm" busy={busy === 'sim'} onClick={() => simulate('captured')}>Simulate success</Button><Button size="sm" disabled={busy === 'sim'} onClick={() => simulate('failed')}>Simulate failure</Button></div></Card>}
    <div className="grid">{items.map((p: any) => { const v = p.version ?? {}; return <div key={p.id} className="span4"><Card><CardHead eyebrow={`${label(p.kind)}${v.durationLabel ? ` · ${v.durationLabel}` : ''}`} title={p.name} right={p.promoLabel ? <span className="bp-pill bp-pill-accent">{p.promoLabel}</span> : undefined} /><p className="small">{p.description}</p>
      {p.kind === 'bespoke' ? <p className="small">Scoped with you and priced per proposal. Ask for one under <Link to="/bespoke">Bespoke</Link>; your proposals and their terms appear there, and nothing is charged until you accept one and pay.</p> : <dl className="kv" style={{ marginTop: 10 }}><dt>Consultations</dt><dd>{v.consultations ?? '—'}</dd><dt>Blood tests</dt><dd>{v.bloodworkEntitlements ?? '—'} ({v.entitlementUnit ?? 'collection'})</dd><dt>Price</dt><dd>{v.forSale ? `${fmtInr(v.priceInr)} incl. GST` : 'On request'}</dd></dl>}
      {p.kind === 'bespoke' ? <div className="bp-card-foot"><Link className="bp-btn bp-btn-secondary bp-btn-sm" to="/bespoke">Ask for a proposal</Link></div> : v.forSale ? <div className="bp-card-foot"><Button variant="primary" size="sm" disabled={!!busy || !!pending} onClick={() => setConfirm(p)}>Buy {p.name}</Button></div> : null}
    </Card></div>; })}</div>
    <Card><CardHead eyebrow="Orders" title="What you paid" />{((orders.data as any)?.items ?? []).length ? <div className="stack">{((orders.data as any).items as any[]).map((o) => <div key={o.id} className="row between"><div><b style={{ color: 'var(--bp-color-text-primary)' }}>{o.reference} · {o.packageName}</b><div className="small">{fmtInr(o.totalInr)}{o.discountInr ? ` (${o.couponCode}: ${fmtInr(o.discountInr)} off)` : ''} · {fmtDateTime(o.activatedAt ?? o.paidAt ?? o.createdAt)}{o.payment?.simulated ? ' · simulated' : ''}</div></div><Pill status={o.status} /></div>)}</div> : <Empty title="No orders yet" />}</Card>
    <p className="muted small">{(config.data as any)?.payments === 'simulator' ? 'Payments here are simulated; no money moves.' : 'Payments are handled by the provider; Bioptime never sees your card or UPI details.'} Cancellations and refunds follow the terms.</p>
    <Dialog open={!!confirm} onClose={() => setConfirm(null)} title={confirm ? `Buy ${confirm.name}?` : ''} footer={<><Button variant="tertiary" onClick={() => setConfirm(null)}>Not now</Button><Button variant="primary" busy={!!busy} onClick={() => confirm && buy(confirm)}>Continue to payment</Button></>}>
      {confirm && <div className="form"><p className="small">{fmtInr(confirm.version?.priceInr)} including GST. Bioptime matches you with a coach after the payment is confirmed and tells you here.</p><Field label="Coupon code" optional><Input value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} /></Field></div>}
    </Dialog>
  </div>;
}
