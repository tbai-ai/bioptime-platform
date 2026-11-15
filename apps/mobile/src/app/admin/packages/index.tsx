/* Admin › Packages (the web's /admin/packages, pages/Packages.tsx, packages.manage): GET /admin/packages (with version
   history), one card per package with Revise (PATCH /admin/packages/:id: a new version), Publish / Unpublish
   (POST …/publish|unpublish), Preview as a member and Archive (POST …/archive), the package form (POST /admin/packages
   for a new one), and the coupon codes card (GET/POST /admin/coupons, PATCH /admin/coupons/:id). Every change that the
   web records with a reason keeps the reason. Prices are the server's; nothing is computed here. */
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ApiError, errorText, get, patch, post } from '@/lib/api';
import { fmtDate, fmtDateTime, inr, label } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { AccentPill, AdminHeader, Choice, Collapsible, DateField, FormField, NotedRow, TwoUp } from '@/components/adminA/parts';
import { ReasonSheet } from '@/components/adminA/ReasonSheet';
import { useToast, type ToastKind } from '@/components/adminA/toast';
import { Button, Card, Check, ErrorBox, Eyebrow, Field, H2, Input, Loading, Notice, P, Pill, Row, Screen, StaleBanner, Title } from '@/components/ui';
import { KeyValue, RecordList, RecordRow, Sheet } from '@/components/workspace';
import { RequirePermission, RoleGate } from '@/components/workspaceShell';
import { Enter } from '@/motion';
import { colors, font, space } from '@/theme';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rec = any;

export default function AdminPackages() {
  const list = useLoad<{ items: Rec[] }>('admin-packages', () => get('/admin/packages'), []);
  const toast = useToast();
  const [edit, setEdit] = useState<Rec | null>(null);
  const [create, setCreate] = useState(false);
  const [archive, setArchive] = useState<Rec | null>(null);
  const [preview, setPreview] = useState<Rec | null>(null);
  const [publishState, setPublishState] = useState<{ p: Rec; forSale: boolean } | null>(null);
  const items = list.data?.items ?? [];
  return <RoleGate workspace="admin"><View style={{ flex: 1 }}><Screen refreshing={list.loading} onRefresh={list.reload} depth>
    <AdminHeader title="Packages" />
    <Title sub="Editing creates a new version; members who already paid keep the version they bought. Published means for sale; hidden keeps a package off the website and the app while it stays sellable by link. Prices are provisional until the founder sets them.">Packages</Title>
    <RequirePermission permission="packages.manage">
      <StaleBanner at={list.stale} /><ErrorBox error={list.error} onRetry={list.reload} />
      <Enter index={1}><Button title="New package" small onPress={() => setCreate(true)} style={{ alignSelf: 'flex-start' }} /></Enter>
      <Enter index={2}>{list.loading && !list.data ? <Loading /> : <View style={{ gap: space.md }}>{items.map((p) => { const v = p.version; return <Card key={p.id} accent={p.slug === 'core'}>
        <Eyebrow>{`${label(p.kind)} · version ${v?.version ?? '—'}`}</Eyebrow>
        <H2>{p.name}</H2>
        <Row>{p.promoLabel ? <AccentPill>{p.promoLabel}</AccentPill> : null}{p.archived ? <Pill tone="info">Archived</Pill> : <><Pill tone={v?.forSale ? 'success' : 'warning'}>{v?.forSale ? 'Published' : 'Unpublished'}</Pill>{p.visible === false ? <Pill tone="warning">Hidden</Pill> : null}</>}</Row>
        {p.description ? <P small muted>{p.description}</P> : null}
        {v ? <KeyValue rows={[
          ['Duration', v.durationLabel ?? '—'],
          ['Enrolment', `${label(v.eligibility ?? 'public')} · starts ${v.startPolicy === 'on_first_consultation' ? 'at the first consultation' : 'when paid'}${v.graceDays ? ` · ${v.graceDays} grace days` : ''}`],
          ['Consultations', String(v.consultations ?? '—')], ['Blood tests', `${v.bloodworkEntitlements ?? '—'} (${v.entitlementUnit ?? 'collection'})`], ['Price', inr(v.priceInr)], ['Coaching', label(v.coaching)], ['Effective', fmtDate(v.effectiveFrom)],
        ]} /> : null}
        {!p.archived ? <Row>
          <Button title="Revise" small variant="secondary" onPress={() => setEdit(p)} />
          {v?.forSale ? <Button title="Unpublish" small variant="ghost" onPress={() => setPublishState({ p, forSale: false })} /> : <Button title="Publish" small onPress={() => setPublishState({ p, forSale: true })} />}
          <Button title="Preview as a member" small variant="ghost" onPress={() => setPreview(p)} />
          <Button title="Archive" small variant="danger" onPress={() => setArchive(p)} />
        </Row> : null}
        {p.versions?.length > 1 ? <Collapsible title={`Version history (${p.versions.length})`}><RecordList>{p.versions.map((x: Rec) => <RecordRow key={x.id} title={`Version ${x.version} · ${x.price_paise === null ? 'On request' : inr(x.price_paise / 100)}`} meta={`${x.consultations} consults · ${x.bloodwork_entitlements} tests · ${fmtDate(x.effective_from)}${x.effective_to ? ` → ${fmtDate(x.effective_to)}` : ' → now'}`} />)}</RecordList></Collapsible> : null}
      </Card>; })}</View>}</Enter>
      <Enter index={3}><Coupons toast={toast.show} /></Enter>

      <PreviewSheet p={preview} onClose={() => setPreview(null)} />
      <ReasonSheet open={!!publishState} onClose={() => setPublishState(null)} title={publishState ? `${publishState.forSale ? 'Publish' : 'Unpublish'} ${publishState.p.name}?` : ''} confirmLabel={publishState?.forSale ? 'Publish' : 'Unpublish'} destructive={publishState ? !publishState.forSale : false} body={publishState?.forSale ? 'The current version goes on sale on the website and in the app at once. No new version is created.' : 'The package leaves the website and the app; members already enrolled continue on their version.'}
        onConfirm={async (reason) => { if (!publishState) return; await post(`/admin/packages/${publishState.p.id}/${publishState.forSale ? 'publish' : 'unpublish'}`, { reason }); toast.show(publishState.forSale ? 'Published' : 'Unpublished'); void list.reload(); }} />
      <PackageSheet p={edit} open={!!edit || create} onClose={() => { setEdit(null); setCreate(false); }} onDone={(revised) => { toast.show(revised ? 'New version created' : 'Package created'); void list.reload(); }} />
      <ReasonSheet open={!!archive} onClose={() => setArchive(null)} title={`Archive ${archive?.name ?? ''}?`} destructive confirmLabel="Archive" body="It disappears from the website and the app; existing programmes continue."
        onConfirm={async (reason) => { if (!archive) return; await post(`/admin/packages/${archive.id}/archive`, { reason }); toast.show('Archived'); void list.reload(); }} />
    </RequirePermission>
  </Screen>{toast.float}</View></RoleGate>;
}

type Form = Record<string, string | boolean>;
const str = (f: Form, k: string) => (typeof f[k] === 'string' ? (f[k] as string) : '');
const digits = (v: string) => v.replace(/\D/g, '');

function PackageSheet({ p, open, onClose, onDone }: { p: Rec | null; open: boolean; onClose: () => void; onDone: (revised: boolean) => void }) {
  const v = p?.version;
  const [f, setF] = useState<Form>({});
  const [err, setErr] = useState('');
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setF(p ? { name: p.name ?? '', description: p.description ?? '', durationMonths: v?.durationMonths != null ? String(v.durationMonths) : '', durationLabel: v?.durationLabel ?? '', consultations: String(v?.consultations ?? 0), bloodworkEntitlements: String(v?.bloodworkEntitlements ?? 0), priceInr: v?.priceInr != null ? String(v.priceInr) : '', coaching: v?.coaching ?? 'standard', forSale: !!v?.forSale, visible: p.visible !== false, promoLabel: p.promoLabel ?? '', includes: (v?.includes ?? []).join('\n'), eligibility: v?.eligibility ?? 'public', startPolicy: v?.startPolicy ?? 'on_payment', graceDays: String(v?.graceDays ?? 0), services: (v?.services ?? []).map((x: Rec) => (x.detail ? `${x.name} — ${x.detail}` : x.name)).join('\n'), reason: '' }
      : { slug: '', name: '', kind: 'package', description: '', durationMonths: '1', durationLabel: '1 month', consultations: '1', bloodworkEntitlements: '1', priceInr: '', coaching: 'standard', forSale: false, visible: true, promoLabel: '', includes: '', eligibility: 'public', startPolicy: 'on_payment', graceDays: '0', services: '', reason: '' });
    setErr(''); setErrs({});
  }, [p, open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: string) => (val: string | boolean) => setF((s) => ({ ...s, [k]: val }));
  const go = async () => {
    setBusy(true); setErr(''); setErrs({});
    const body: Record<string, unknown> = {
      ...(p ? {} : { slug: str(f, 'slug').trim(), kind: str(f, 'kind') }),
      name: str(f, 'name').trim(), description: str(f, 'description'),
      durationMonths: str(f, 'durationMonths') === '' ? null : Number(str(f, 'durationMonths')), durationLabel: str(f, 'durationLabel'),
      consultations: Number(str(f, 'consultations')), bloodworkEntitlements: Number(str(f, 'bloodworkEntitlements')), priceInr: str(f, 'priceInr') === '' ? null : Number(str(f, 'priceInr')),
      coaching: str(f, 'coaching'), forSale: !!f.forSale, visible: f.visible !== false, promoLabel: str(f, 'promoLabel').trim() || null,
      includes: str(f, 'includes').split('\n').map((s) => s.trim()).filter(Boolean), eligibility: str(f, 'eligibility'), startPolicy: str(f, 'startPolicy'), graceDays: Number(str(f, 'graceDays')) || 0,
      services: str(f, 'services').split('\n').map((s) => s.trim()).filter(Boolean).map((line) => { const [name, ...rest] = line.split(' — '); return { name: (name ?? '').trim(), ...(rest.length ? { detail: rest.join(' — ').trim() } : {}) }; }),
      reason: str(f, 'reason').trim() || undefined,
    };
    try { if (p) await patch(`/admin/packages/${p.id}`, body); else await post('/admin/packages', body); onDone(!!p); onClose(); }
    catch (e) { const fe = e instanceof ApiError ? e.fieldErrors() : {}; if (Object.keys(fe).length) setErrs(fe); setErr(errorText(e)); }
    finally { setBusy(false); }
  };
  return <Sheet open={open} onClose={onClose} title={p ? `Revise ${p.name}` : 'New package'} footer={<View style={{ flexDirection: 'row', gap: space.sm }}><Button title="Cancel" variant="secondary" onPress={onClose} disabled={busy} style={{ flex: 1 }} /><Button title={p ? 'Create new version' : 'Create package'} busy={busy} onPress={go} style={{ flex: 1 }} /></View>}>
    {!p ? <>
      <Field label="Slug" error={errs.slug}><Input value={str(f, 'slug')} onChangeText={set('slug')} placeholder="e.g. core-plus" autoCapitalize="none" accessibilityLabel="Slug" /></Field>
      <Choice label="Kind" options={[{ value: 'package', label: 'Package' }, { value: 'programme', label: 'Programme' }, { value: 'bespoke', label: 'Bespoke' }]} value={str(f, 'kind') || 'package'} onChange={set('kind')} />
    </> : null}
    <Field label="Name" error={errs.name}><Input value={str(f, 'name')} onChangeText={set('name')} accessibilityLabel="Name" /></Field>
    <Field label="Description" error={errs.description}><Input value={str(f, 'description')} onChangeText={set('description')} multiline numberOfLines={3} style={{ minHeight: 72, textAlignVertical: 'top' }} accessibilityLabel="Description" /></Field>
    <TwoUp>
      <Field label="Duration (months)" error={errs.durationMonths}><Input value={str(f, 'durationMonths')} onChangeText={(x) => set('durationMonths')(digits(x))} keyboardType="number-pad" accessibilityLabel="Duration (months)" /></Field>
      <Field label="Duration label" error={errs.durationLabel}><Input value={str(f, 'durationLabel')} onChangeText={set('durationLabel')} accessibilityLabel="Duration label" /></Field>
    </TwoUp>
    <TwoUp>
      <Field label="Consultations" error={errs.consultations}><Input value={str(f, 'consultations')} onChangeText={(x) => set('consultations')(digits(x))} keyboardType="number-pad" accessibilityLabel="Consultations" /></Field>
      <Field label="Blood tests" error={errs.bloodworkEntitlements}><Input value={str(f, 'bloodworkEntitlements')} onChangeText={(x) => set('bloodworkEntitlements')(digits(x))} keyboardType="number-pad" accessibilityLabel="Blood tests" /></Field>
    </TwoUp>
    <Field label="Price ₹ (incl. GST)" hint="Empty = on request" error={errs.priceInr}><Input value={str(f, 'priceInr')} onChangeText={(x) => set('priceInr')(digits(x))} keyboardType="number-pad" accessibilityLabel="Price ₹ (incl. GST)" /></Field>
    <Choice label="Coaching" options={[{ value: 'standard', label: 'Standard (coach assigned)' }, { value: 'none', label: 'None (programme only)' }, { value: 'as_agreed', label: 'As agreed (bespoke)' }]} value={str(f, 'coaching') || 'standard'} onChange={set('coaching')} />
    <Check checked={!!f.forSale} onChange={set('forSale')} label="Published (for sale)" />
    <Check checked={f.visible !== false} onChange={set('visible')} label="Visible on the website and in the app" />
    <FormField label="Promotional label" optional hint="Short, shown on the card: Most popular, Launch offer." error={errs.promoLabel}><Input value={str(f, 'promoLabel')} onChangeText={(x) => set('promoLabel')(x.slice(0, 40))} maxLength={40} accessibilityLabel="Promotional label" /></FormField>
    <Field label="What is included (one per line)" error={errs.includes}><Input value={str(f, 'includes')} onChangeText={set('includes')} multiline numberOfLines={3} style={{ minHeight: 72, textAlignVertical: 'top' }} accessibilityLabel="What is included (one per line)" /></Field>
    <FormField label="Services (one per line, “name — detail”)" optional hint="Typed services shown on the package card and in the app." error={errs.services}><Input value={str(f, 'services')} onChangeText={set('services')} multiline numberOfLines={3} style={{ minHeight: 72, textAlignVertical: 'top' }} accessibilityLabel="Services (one per line, “name — detail”)" /></FormField>
    <Choice label="Who may enrol" options={[{ value: 'public', label: 'Anyone' }, { value: 'invite_only', label: 'Invited members only' }, { value: 'existing_members', label: 'Existing members only' }]} value={str(f, 'eligibility') || 'public'} onChange={set('eligibility')} />
    <Choice label="Programme starts" options={[{ value: 'on_payment', label: 'When the payment is verified' }, { value: 'on_first_consultation', label: 'At the first consultation' }]} value={str(f, 'startPolicy') || 'on_payment'} onChange={set('startPolicy')} />
    <Field label="Grace days after expiry" error={errs.graceDays}><Input value={str(f, 'graceDays')} onChangeText={(x) => set('graceDays')(digits(x).slice(0, 2))} keyboardType="number-pad" accessibilityLabel="Grace days after expiry" /></Field>
    <Field label="Reason (recorded)" error={errs.reason}><Input value={str(f, 'reason')} onChangeText={set('reason')} placeholder="Why this change" accessibilityLabel="Reason (recorded)" /></Field>
    {err ? <Notice kind="error">{err}</Notice> : null}
    <P muted small>Changing a package never alters entitlements already paid for. A new version takes effect for new orders at once; orders already in checkout complete on the version they started with.</P>
  </Sheet>;
}

/** How the card reads on the website and in the app, from the same fields members see. */
function PreviewSheet({ p, onClose }: { p: Rec | null; onClose: () => void }) {
  const v = p?.version ?? {};
  return <Sheet open={!!p} onClose={onClose} title="Preview as a member" footer={<Button title="Close" onPress={onClose} />}>
    {p ? <Card>
      <Row between><Eyebrow>{`${label(p.kind)}${v.durationLabel ? ` · ${v.durationLabel}` : ''}`}</Eyebrow>{p.promoLabel ? <AccentPill>{p.promoLabel}</AccentPill> : null}</Row>
      <H2>{p.name}</H2>
      {p.description ? <P small>{p.description}</P> : null}
      <KeyValue rows={[['Consultations', String(v.consultations ?? '—')], ['Blood tests', `${v.bloodworkEntitlements ?? '—'} (${v.entitlementUnit ?? 'collection'})`], ['Price', v.forSale ? `${inr(v.priceInr)} incl. GST` : 'On request']]} />
      {(v.includes ?? []).length ? <View>{(v.includes as string[]).map((i) => <Text key={i} style={styles.li}>{`• ${i}`}</Text>)}</View> : null}
      <P muted small>{`${p.visible === false ? 'Hidden: not listed on the website or in the app.' : 'Listed on the website and in the app.'} ${v.forSale ? 'Buy button shown.' : 'Not for sale: no buy button.'}`}</P>
    </Card> : null}
  </Sheet>;
}

type Coupon = { id: string; code: string; kind: 'percent' | 'amount'; value: number; maxUses?: number | null; used?: number; uses?: number; validFrom?: string | null; validTo?: string | null; active: boolean; note?: string | null };

/** Promotional codes: percent or amount off, optional cap and validity; applied server-side at checkout and counted on verified capture. */
function Coupons({ toast }: { toast: (text: string, kind?: ToastKind) => void }) {
  const list = useLoad<{ items: Coupon[] }>('admin-coupons', () => get('/admin/coupons'), []);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ code: '', kind: 'percent', value: '10', maxUses: '', validTo: '', note: '', reason: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [toggling, setToggling] = useState<Coupon | null>(null);
  const items = list.data?.items ?? [];
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));
  const create = async () => { setBusy(true); setErr(''); try { await post('/admin/coupons', { code: f.code.trim().toUpperCase(), kind: f.kind, value: Number(f.value), maxUses: f.maxUses === '' ? null : Number(f.maxUses), validTo: f.validTo ? `${f.validTo}T23:59:59+05:30` : null, note: f.note || undefined, reason: f.reason.trim() }); toast('Coupon created'); setOpen(false); setF({ code: '', kind: 'percent', value: '10', maxUses: '', validTo: '', note: '', reason: '' }); void list.reload(); } catch (e) { setErr(errorText(e)); } finally { setBusy(false); } };
  return <Card>
    <Row between><View><Eyebrow>Promotions</Eyebrow><H2>Coupon codes</H2></View><Button title="New code" small variant="secondary" onPress={() => setOpen(true)} /></Row>
    <ErrorBox error={list.error} onRetry={list.reload} />
    {list.loading && !list.data ? <Loading /> : items.length ? <RecordList>{items.map((c) => <View key={c.id}>
      <NotedRow title={`${c.code} · ${c.kind === 'percent' ? `${c.value}%` : inr(c.value)}`} meta={`used ${c.used ?? c.uses ?? 0}${c.maxUses ? ` / ${c.maxUses}` : ''} · ${c.validFrom ? `from ${fmtDateTime(c.validFrom)} ` : ''}${c.validTo ? `until ${fmtDateTime(c.validTo)}` : 'no end'}`} notes={[c.note]} pills={[{ label: c.active ? 'active' : 'inactive', tone: c.active ? 'success' : 'info' }]} right={<Button title={c.active ? 'Deactivate' : 'Reactivate'} small variant="ghost" onPress={() => setToggling(c)} />} />
    </View>)}</RecordList> : list.data ? <P muted small>No codes yet.</P> : null}
    <P muted small>Members enter a code at checkout; the server applies it, never the client. A use counts only on a verified capture, so failed payments do not spend the cap.</P>
    <ReasonSheet open={!!toggling} onClose={() => setToggling(null)} title={toggling ? `${toggling.active ? 'Deactivate' : 'Reactivate'} ${toggling.code}?` : ''} destructive={!!toggling?.active} confirmLabel={toggling?.active ? 'Deactivate' : 'Reactivate'} body={toggling?.active ? 'Members can no longer apply it; orders already paid with it are unchanged.' : 'Members can apply it again, within its cap and validity.'}
      onConfirm={async (reason) => { if (!toggling) return; await patch(`/admin/coupons/${toggling.id}`, { active: !toggling.active, reason }); toast(toggling.active ? 'Coupon deactivated' : 'Coupon active'); void list.reload(); }} />
    <Sheet open={open} onClose={() => setOpen(false)} title="New coupon code" footer={<View style={{ flexDirection: 'row', gap: space.sm }}><Button title="Cancel" variant="secondary" onPress={() => setOpen(false)} disabled={busy} style={{ flex: 1 }} /><Button title="Create" busy={busy} disabled={!f.code.trim() || f.reason.trim().length < 3} onPress={create} style={{ flex: 1 }} /></View>}>
      <Field label="Code"><Input value={f.code} onChangeText={(v) => set('code')(v.toUpperCase().slice(0, 24))} maxLength={24} placeholder="LAUNCH20" autoCapitalize="characters" accessibilityLabel="Code" /></Field>
      <Choice label="Kind" options={[{ value: 'percent', label: 'Percent off' }, { value: 'amount', label: 'Amount off (₹)' }]} value={f.kind} onChange={set('kind')} />
      <Field label={f.kind === 'percent' ? 'Percent' : 'Amount ₹'}><Input value={f.value} onChangeText={(v) => set('value')(digits(v))} keyboardType="number-pad" accessibilityLabel={f.kind === 'percent' ? 'Percent' : 'Amount ₹'} /></Field>
      <FormField label="Maximum uses" optional><Input value={f.maxUses} onChangeText={(v) => set('maxUses')(digits(v))} keyboardType="number-pad" accessibilityLabel="Maximum uses" /></FormField>
      <DateField label="Valid until" optional value={f.validTo} onChange={set('validTo')} />
      <FormField label="Note" optional><Input value={f.note} onChangeText={(v) => set('note')(v.slice(0, 200))} maxLength={200} accessibilityLabel="Note" /></FormField>
      <Field label="Reason (recorded)"><Input value={f.reason} onChangeText={set('reason')} accessibilityLabel="Reason (recorded)" /></Field>
      {err ? <Notice kind="error">{err}</Notice> : null}
    </Sheet>
  </Card>;
}

const styles = StyleSheet.create({
  li: { color: colors.text, fontSize: font.small, lineHeight: 19 },
});
