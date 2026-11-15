import React, { useState } from 'react';
import { api } from '../lib/api';
import { fmtDate, fmtDateTime, fmtInr, label } from '../lib/format';
import { Alert, Button, Card, CardHead, Dialog, Field, Input, Pill, ReasonDialog, Select, Skeleton, Table, Textarea, useApi, useToast, errorText } from '../ui';

export function Packages() {
  const list = useApi(() => api.get('/admin/packages'), []);
  const toast = useToast();
  const [edit, setEdit] = useState<any>(null);
  const [create, setCreate] = useState(false);
  const [archive, setArchive] = useState<any>(null);
  const [preview, setPreview] = useState<any>(null);
  const [publishState, setPublishState] = useState<{ p: any; forSale: boolean } | null>(null);
  const items = ((list.data as any)?.items ?? []) as any[];
  return <div className="stack">
    <div className="pageHead"><div><h1>Packages</h1><p className="sub">Editing creates a new version; members who already paid keep the version they bought. Published means for sale; hidden keeps a package off the website and the app while it stays sellable by link. Prices are provisional until the founder sets them.</p></div><div className="actions"><Button variant="primary" onClick={() => setCreate(true)}>New package</Button></div></div>
    {list.error && <Alert kind="error">{list.error}</Alert>}
    {!list.data ? <Skeleton rows={4} /> : <div className="grid">{items.map((p) => <div key={p.id} className="span6"><Card accent={p.slug === 'core'}><CardHead eyebrow={`${label(p.kind)} · version ${p.version?.version ?? '—'}`} title={p.name} right={<div className="row">{p.promoLabel && <span className="bp-pill bp-pill-accent">{p.promoLabel}</span>}{p.archived ? <Pill status="ended">Archived</Pill> : <><Pill status={p.version?.forSale ? 'active' : 'draft'}>{p.version?.forSale ? 'Published' : 'Unpublished'}</Pill>{p.visible === false && <Pill status="pending">Hidden</Pill>}</>}</div>} />
      <p className="small">{p.description}</p>
      {p.version && <dl className="kv" style={{ marginTop: 10 }}><dt>Duration</dt><dd>{p.version.durationLabel}</dd><dt>Enrolment</dt><dd>{label(p.version.eligibility ?? 'public')} · starts {p.version.startPolicy === 'on_first_consultation' ? 'at the first consultation' : 'when paid'}{p.version.graceDays ? ` · ${p.version.graceDays} grace days` : ''}</dd><dt>Consultations</dt><dd className="num">{p.version.consultations}</dd><dt>Blood tests</dt><dd className="num">{p.version.bloodworkEntitlements} ({p.version.entitlementUnit})</dd><dt>Price</dt><dd>{fmtInr(p.version.priceInr)}</dd><dt>Coaching</dt><dd>{label(p.version.coaching)}</dd><dt>Effective</dt><dd>{fmtDate(p.version.effectiveFrom)}</dd></dl>}
      <div className="bp-card-foot">{!p.archived && <Button size="sm" onClick={() => setEdit(p)}>Revise</Button>}{!p.archived && (p.version?.forSale ? <Button size="sm" variant="tertiary" onClick={() => setPublishState({ p, forSale: false })}>Unpublish</Button> : <Button size="sm" variant="primary" onClick={() => setPublishState({ p, forSale: true })}>Publish</Button>)}{!p.archived && <Button size="sm" variant="tertiary" onClick={() => setPreview(p)}>Preview as a member</Button>}{!p.archived && <Button size="sm" variant="destructive" onClick={() => setArchive(p)}>Archive</Button>}</div>
      {p.versions?.length > 1 && <details className="bp-acc" style={{ marginTop: 10 }}><summary>Version history ({p.versions.length})</summary><div><Table head={<><th>Version</th><th className="num">Price</th><th className="num">Consults</th><th className="num">Tests</th><th>Effective</th></>}>{p.versions.map((v: any) => <tr key={v.id}><td>{v.version}</td><td className="num">{v.price_paise === null ? 'On request' : fmtInr(v.price_paise / 100)}</td><td className="num">{v.consultations}</td><td className="num">{v.bloodwork_entitlements}</td><td>{fmtDate(v.effective_from)}{v.effective_to ? ` → ${fmtDate(v.effective_to)}` : ' → now'}</td></tr>)}</Table></div></details>}
    </Card></div>)}</div>}
    <PreviewDialog p={preview} onClose={() => setPreview(null)} />
    <ReasonDialog open={!!publishState} onClose={() => setPublishState(null)} title={publishState ? `${publishState.forSale ? 'Publish' : 'Unpublish'} ${publishState.p.name}?` : ''} confirmLabel={publishState?.forSale ? 'Publish' : 'Unpublish'} danger={publishState ? !publishState.forSale : false} body={publishState?.forSale ? 'The current version goes on sale on the website and in the app at once. No new version is created.' : 'The package leaves the website and the app; members already enrolled continue on their version.'} onConfirm={async (reason) => { await api.post(`/admin/packages/${publishState!.p.id}/${publishState!.forSale ? 'publish' : 'unpublish'}`, { reason }); toast(publishState!.forSale ? 'Published' : 'Unpublished'); list.reload(); }} />
    <Coupons />
    <PackageDialog p={edit} open={!!edit || create} onClose={() => { setEdit(null); setCreate(false); }} onDone={() => { toast(edit ? 'New version created' : 'Package created'); list.reload(); }} />
    <ReasonDialog open={!!archive} onClose={() => setArchive(null)} title={`Archive ${archive?.name}?`} danger confirmLabel="Archive" body="It disappears from the website and the app; existing programmes continue." onConfirm={async (reason) => { await api.post(`/admin/packages/${archive.id}/archive`, { reason }); toast('Archived'); list.reload(); }} />
  </div>;
}

function PackageDialog({ p, open, onClose, onDone }: { p: any; open: boolean; onClose: () => void; onDone: () => void }) {
  const v = p?.version;
  const [f, setF] = useState<any>({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  React.useEffect(() => { setF(p ? { name: p.name, description: p.description, durationMonths: v?.durationMonths ?? '', durationLabel: v?.durationLabel ?? '', consultations: v?.consultations ?? 0, bloodworkEntitlements: v?.bloodworkEntitlements ?? 0, priceInr: v?.priceInr ?? '', coaching: v?.coaching ?? 'standard', forSale: !!v?.forSale, visible: p.visible !== false, promoLabel: p.promoLabel ?? '', includes: (v?.includes ?? []).join('\n'), eligibility: v?.eligibility ?? 'public', startPolicy: v?.startPolicy ?? 'on_payment', graceDays: v?.graceDays ?? 0, services: (v?.services ?? []).map((x: any) => x.detail ? `${x.name} — ${x.detail}` : x.name).join('\n'), reason: '' } : { slug: '', name: '', kind: 'package', description: '', durationMonths: 1, durationLabel: '1 month', consultations: 1, bloodworkEntitlements: 1, priceInr: '', coaching: 'standard', forSale: false, visible: true, promoLabel: '', includes: '', eligibility: 'public', startPolicy: 'on_payment', graceDays: 0, services: '', reason: '' }); setErr(''); }, [p, open]);
  const set = (k: string, val: unknown) => setF((s: any) => ({ ...s, [k]: val }));
  const go = async () => {
    setBusy(true); setErr('');
    const body = { ...f, durationMonths: f.durationMonths === '' ? null : Number(f.durationMonths), consultations: Number(f.consultations), bloodworkEntitlements: Number(f.bloodworkEntitlements), priceInr: f.priceInr === '' ? null : Number(f.priceInr), includes: String(f.includes).split('\n').map((s: string) => s.trim()).filter(Boolean), promoLabel: f.promoLabel?.trim() || null, visible: f.visible !== false, eligibility: f.eligibility, startPolicy: f.startPolicy, graceDays: Number(f.graceDays) || 0, services: String(f.services).split('\n').map((s: string) => s.trim()).filter(Boolean).map((line: string) => { const [name, ...rest] = line.split(' — '); return { name: name!.trim(), ...(rest.length ? { detail: rest.join(' — ').trim() } : {}) }; }) };
    try { if (p) await api.patch(`/admin/packages/${p.id}`, body); else await api.post('/admin/packages', body); onDone(); onClose(); } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  return <Dialog open={open} onClose={onClose} title={p ? `Revise ${p.name}` : 'New package'} footer={<><Button variant="tertiary" onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={go}>{p ? 'Create new version' : 'Create package'}</Button></>}>
    <div className="form">
      {!p && <div className="row"><Field label="Slug"><Input value={f.slug ?? ''} onChange={(e) => set('slug', e.target.value)} placeholder="e.g. core-plus" /></Field><Field label="Kind"><Select value={f.kind ?? 'package'} onChange={(e) => set('kind', e.target.value)}><option value="package">Package</option><option value="programme">Programme</option><option value="bespoke">Bespoke</option></Select></Field></div>}
      <Field label="Name"><Input value={f.name ?? ''} onChange={(e) => set('name', e.target.value)} /></Field>
      <Field label="Description"><Textarea value={f.description ?? ''} onChange={(e) => set('description', e.target.value)} /></Field>
      <div className="row"><Field label="Duration (months)"><Input type="number" min={1} value={f.durationMonths ?? ''} onChange={(e) => set('durationMonths', e.target.value)} /></Field><Field label="Duration label"><Input value={f.durationLabel ?? ''} onChange={(e) => set('durationLabel', e.target.value)} /></Field></div>
      <div className="row"><Field label="Consultations"><Input type="number" min={0} value={f.consultations ?? 0} onChange={(e) => set('consultations', e.target.value)} /></Field><Field label="Blood tests"><Input type="number" min={0} value={f.bloodworkEntitlements ?? 0} onChange={(e) => set('bloodworkEntitlements', e.target.value)} /></Field><Field label="Price ₹ (incl. GST)" hint="Empty = on request"><Input type="number" min={0} value={f.priceInr ?? ''} onChange={(e) => set('priceInr', e.target.value)} /></Field></div>
      <div className="row"><Field label="Coaching"><Select value={f.coaching ?? 'standard'} onChange={(e) => set('coaching', e.target.value)}><option value="standard">Standard (coach assigned)</option><option value="none">None (programme only)</option><option value="as_agreed">As agreed (bespoke)</option></Select></Field><label className="bp-check" style={{ alignSelf: 'end', paddingBottom: 10 }}><input type="checkbox" checked={!!f.forSale} onChange={(e) => set('forSale', e.target.checked)} /> Published (for sale)</label><label className="bp-check" style={{ alignSelf: 'end', paddingBottom: 10 }}><input type="checkbox" checked={f.visible !== false} onChange={(e) => set('visible', e.target.checked)} /> Visible on the website and in the app</label></div>
      <Field label="Promotional label" optional hint="Short, shown on the card: Most popular, Launch offer."><Input value={f.promoLabel ?? ''} maxLength={40} onChange={(e) => set('promoLabel', e.target.value)} /></Field>
      <Field label="What is included (one per line)"><Textarea value={f.includes ?? ''} onChange={(e) => set('includes', e.target.value)} /></Field>
      <Field label="Services (one per line, “name — detail”)" optional hint="Typed services shown on the package card and in the app."><Textarea value={f.services ?? ''} onChange={(e) => set('services', e.target.value)} /></Field>
      <div className="row"><Field label="Who may enrol"><Select value={f.eligibility ?? 'public'} onChange={(e) => set('eligibility', e.target.value)}><option value="public">Anyone</option><option value="invite_only">Invited members only</option><option value="existing_members">Existing members only</option></Select></Field><Field label="Programme starts"><Select value={f.startPolicy ?? 'on_payment'} onChange={(e) => set('startPolicy', e.target.value)}><option value="on_payment">When the payment is verified</option><option value="on_first_consultation">At the first consultation</option></Select></Field><Field label="Grace days after expiry"><Input type="number" min={0} max={90} value={f.graceDays ?? 0} onChange={(e) => set('graceDays', e.target.value)} /></Field></div>
      <Field label="Reason (recorded)"><Input value={f.reason ?? ''} onChange={(e) => set('reason', e.target.value)} placeholder="Why this change" /></Field>
      {err && <Alert kind="error">{err}</Alert>}<p className="muted">Changing a package never alters entitlements already paid for. A new version takes effect for new orders at once; orders already in checkout complete on the version they started with.</p>
    </div>
  </Dialog>;
}

/** How the card reads on the website and in the app, from the same fields members see. */
function PreviewDialog({ p, onClose }: { p: any; onClose: () => void }) {
  const v = p?.version ?? {};
  return <Dialog open={!!p} onClose={onClose} title="Preview as a member" footer={<Button variant="primary" onClick={onClose}>Close</Button>}>
    {p && <div className="bp-card" style={{ padding: 16 }}><div className="row between"><span className="bp-eyebrow">{label(p.kind)}{v.durationLabel ? ` · ${v.durationLabel}` : ''}</span>{p.promoLabel && <span className="bp-pill bp-pill-accent">{p.promoLabel}</span>}</div><h3 style={{ margin: '6px 0' }}>{p.name}</h3><p className="small">{p.description}</p>
      <dl className="kv" style={{ marginTop: 10 }}><dt>Consultations</dt><dd>{v.consultations ?? '—'}</dd><dt>Blood tests</dt><dd>{v.bloodworkEntitlements ?? '—'} ({v.entitlementUnit ?? 'collection'})</dd><dt>Price</dt><dd>{v.forSale ? `${fmtInr(v.priceInr)} incl. GST` : 'On request'}</dd></dl>
      {(v.includes ?? []).length ? <ul className="small" style={{ marginTop: 10, paddingLeft: 18 }}>{v.includes.map((i: string) => <li key={i}>{i}</li>)}</ul> : null}
      <p className="muted small" style={{ marginTop: 10 }}>{p.visible === false ? 'Hidden: not listed on the website or in the app.' : 'Listed on the website and in the app.'} {v.forSale ? 'Buy button shown.' : 'Not for sale: no buy button.'}</p></div>}
  </Dialog>;
}

/** Promotional codes: percent or amount off, optional cap and validity; applied server-side at checkout and counted on verified capture. */
function Coupons() {
  const list = useApi(() => api.get('/admin/coupons'), []);
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<any>({ code: '', kind: 'percent', value: 10, maxUses: '', validTo: '', note: '', reason: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const items = ((list.data as any)?.items ?? []) as any[];
  const set = (k: string, v: unknown) => setF((s: any) => ({ ...s, [k]: v }));
  const create = async () => { setBusy(true); setErr(''); try { await api.post('/admin/coupons', { code: String(f.code).trim().toUpperCase(), kind: f.kind, value: Number(f.value), maxUses: f.maxUses === '' ? null : Number(f.maxUses), validTo: f.validTo ? `${f.validTo}T23:59:59+05:30` : null, note: f.note || undefined, reason: f.reason }); toast('Coupon created'); setOpen(false); list.reload(); } catch (e) { setErr(errorText(e)); } finally { setBusy(false); } };
  const [toggling, setToggling] = useState<any>(null);
  return <Card><CardHead eyebrow="Promotions" title="Coupon codes" right={<Button size="sm" onClick={() => setOpen(true)}>New code</Button>} />
    {list.error && <Alert kind="error">{list.error}</Alert>}
    {!list.data ? <Skeleton /> : items.length ? <Table head={<><th>Code</th><th>Discount</th><th className="num">Used</th><th>Valid</th><th>Note</th><th>State</th><th /></>}>{items.map((c) => <tr key={c.id}><td><code>{c.code}</code></td><td>{c.kind === 'percent' ? `${c.value}%` : fmtInr(c.value)}</td><td className="num">{c.uses}{c.maxUses ? ` / ${c.maxUses}` : ''}</td><td className="small">{c.validFrom ? `from ${fmtDateTime(c.validFrom)} ` : ''}{c.validTo ? `until ${fmtDateTime(c.validTo)}` : 'no end'}</td><td className="small">{c.note}</td><td><Pill status={c.active ? 'active' : 'ended'}>{c.active ? 'active' : 'inactive'}</Pill></td><td className="num"><Button size="sm" variant="tertiary" onClick={() => setToggling(c)}>{c.active ? 'Deactivate' : 'Reactivate'}</Button></td></tr>)}</Table> : <p className="small">No codes yet.</p>}
    <p className="muted small" style={{ marginTop: 8 }}>Members enter a code at checkout; the server applies it, never the client. A use counts only on a verified capture, so failed payments do not spend the cap.</p>
    <ReasonDialog open={!!toggling} onClose={() => setToggling(null)} title={toggling ? `${toggling.active ? 'Deactivate' : 'Reactivate'} ${toggling.code}?` : ''} danger={!!toggling?.active} confirmLabel={toggling?.active ? 'Deactivate' : 'Reactivate'} body={toggling?.active ? 'Members can no longer apply it; orders already paid with it are unchanged.' : 'Members can apply it again, within its cap and validity.'} onConfirm={async (reason) => { await api.patch(`/admin/coupons/${toggling.id}`, { active: !toggling.active, reason }); toast(toggling.active ? 'Coupon deactivated' : 'Coupon active'); list.reload(); }} />
    <Dialog open={open} onClose={() => setOpen(false)} title="New coupon code" footer={<><Button variant="tertiary" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" busy={busy} disabled={!f.code || !f.reason || f.reason.length < 3} onClick={create}>Create</Button></>}>
      <div className="form"><div className="row"><Field label="Code"><Input value={f.code} maxLength={24} onChange={(e) => set('code', e.target.value.toUpperCase())} placeholder="LAUNCH20" /></Field><Field label="Kind"><Select value={f.kind} onChange={(e) => set('kind', e.target.value)}><option value="percent">Percent off</option><option value="amount">Amount off (₹)</option></Select></Field><Field label={f.kind === 'percent' ? 'Percent' : 'Amount ₹'}><Input type="number" min={1} max={f.kind === 'percent' ? 100 : undefined} value={f.value} onChange={(e) => set('value', e.target.value)} /></Field></div>
        <div className="row"><Field label="Maximum uses" optional><Input type="number" min={1} value={f.maxUses} onChange={(e) => set('maxUses', e.target.value)} /></Field><Field label="Valid until" optional><Input type="date" value={f.validTo} onChange={(e) => set('validTo', e.target.value)} /></Field></div>
        <Field label="Note" optional><Input value={f.note} maxLength={200} onChange={(e) => set('note', e.target.value)} /></Field>
        <Field label="Reason (recorded)"><Input value={f.reason} onChange={(e) => set('reason', e.target.value)} /></Field>
        {err && <Alert kind="error">{err}</Alert>}</div>
    </Dialog>
  </Card>;
}
