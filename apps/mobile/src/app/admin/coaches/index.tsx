/* Admin › Coaches (the web's /admin/coaches, pages/Coaches.tsx, coaches.manage): GET /admin/coaches, one row per coach
   opening the coach record (src/app/admin/coaches/[id].tsx), the pending invitations, and the "Invite a coach" sheet
   (POST /admin/coaches/invite). The success note and the activation link come from the server, never invented here. */
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';
import { errorText, get, post } from '@/lib/api';
import { fmtDate, fmtDateTime, relative } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { labelOr, tone } from '@/lib/admin/a/format';
import { AdminHeader, FormField, NotedRow, TwoUp } from '@/components/adminA/parts';
import { useToast } from '@/components/adminA/toast';
import { Button, Card, ErrorBox, Eyebrow, Field, H2, Input, Loading, Notice, P, Screen, StaleBanner, Title } from '@/components/ui';
import { RecordList, RecordRow, Sheet } from '@/components/workspace';
import { RequirePermission, RoleGate } from '@/components/workspaceShell';
import { Enter } from '@/motion';
import { space } from '@/theme';

type Coach = { id: string; displayName: string; email?: string; expertise?: string[]; city?: string | null; caseload: number; caseloadLimit: number; available: boolean; unavailableUntil?: string | null; state?: string };
type Invitation = { id: string; email: string; status: string; expires_at: string; created_at: string };

export default function AdminCoaches() {
  const router = useRouter();
  const list = useLoad<{ items: Coach[]; invitations?: Invitation[] }>('admin-coaches', () => get('/admin/coaches'), []);
  const [invite, setInvite] = useState(false);
  const toast = useToast();
  const d = list.data;
  return <RoleGate workspace="admin"><View style={{ flex: 1 }}><Screen refreshing={list.loading} onRefresh={list.reload} depth>
    <AdminHeader title="Coaches" />
    <Title sub="Invite, scope and capacity. A coach account exists only through an invitation; the link works once and expires in 7 days.">Coaches</Title>
    <RequirePermission permission="coaches.manage">
      <StaleBanner at={list.stale} /><ErrorBox error={list.error} onRetry={list.reload} />
      <Enter index={1}><Button title="Invite a coach" small onPress={() => setInvite(true)} style={{ alignSelf: 'flex-start' }} /></Enter>
      <Enter index={2}>{list.loading && !d ? <Loading /> : d ? <View style={{ gap: space.md }}>
        {d.items.length ? <RecordList title="Coaches">{d.items.map((c) => <NotedRow key={c.id} title={c.displayName} onPress={() => router.push(`/admin/coaches/${c.id}` as never)}
          meta={`${c.email ?? ''}\n${c.city ?? '—'} · caseload ${c.caseload}/${c.caseloadLimit}`}
          notes={[(c.expertise ?? []).join(', ')]}
          pills={[{ label: c.available ? 'Available' : `Away${c.unavailableUntil ? ' until ' + fmtDate(c.unavailableUntil) : ''}`, tone: c.available ? 'success' : 'info' }, { label: labelOr(c.state), tone: tone(c.state) }]} />)}</RecordList> : null}
        {d.invitations?.length ? <Card><Eyebrow>Pending</Eyebrow><H2>Invitations</H2><RecordList>{d.invitations.map((i) => <RecordRow key={i.id} title={i.email} meta={`expires ${fmtDateTime(i.expires_at)} · sent ${relative(i.created_at)}`} pills={[{ label: labelOr(i.status), tone: tone(i.status) }]} />)}</RecordList></Card> : null}
      </View> : null}</Enter>
      <InviteCoachSheet open={invite} onClose={() => setInvite(false)} onDone={(r) => { toast.show(r.token ? 'Invitation created; the activation link is shown' : 'Invitation queued'); void list.reload(); }} />
    </RequirePermission>
  </Screen>{toast.float}</View></RoleGate>;
}

type InviteResult = { note?: string; token?: string };

function InviteCoachSheet({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (r: InviteResult) => void }) {
  const [email, setEmail] = useState(''); const [name, setName] = useState(''); const [expertise, setExpertise] = useState(''); const [city, setCity] = useState(''); const [limit, setLimit] = useState('20');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [result, setResult] = useState<InviteResult | null>(null);
  const go = async () => { setBusy(true); setErr(''); try { const r = await post<InviteResult>('/admin/coaches/invite', { email: email.trim(), displayName: name.trim(), expertise: expertise.split(',').map((s) => s.trim()).filter(Boolean), city: city.trim() || undefined, caseloadLimit: Number(limit) }); setResult(r); onDone(r); } catch (e) { setErr(errorText(e)); } finally { setBusy(false); } };
  const close = () => { setResult(null); setErr(''); onClose(); };
  return <Sheet open={open} onClose={close} title="Invite a coach" footer={result ? <Button title="Done" onPress={close} /> : <View style={{ flexDirection: 'row', gap: space.sm }}><Button title="Cancel" variant="secondary" onPress={close} disabled={busy} style={{ flex: 1 }} /><Button title="Send invitation" onPress={go} busy={busy} style={{ flex: 1 }} /></View>}>
    {result ? <Notice kind="success" title="Invitation created"><View style={{ gap: space.xs }}><P small muted>{result.note ?? ''}</P>{result.token ? <P small muted>{`Activation link: /login/coach/activate?token=${result.token}`}</P> : null}</View></Notice> : <>
      <Field label="Email"><Input value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" accessibilityLabel="Email" /></Field>
      <Field label="Display name"><Input value={name} onChangeText={setName} accessibilityLabel="Display name" /></Field>
      <Field label="Expertise (comma separated)"><Input value={expertise} onChangeText={setExpertise} accessibilityLabel="Expertise (comma separated)" /></Field>
      <TwoUp>
        <FormField label="City" optional><Input value={city} onChangeText={setCity} accessibilityLabel="City" /></FormField>
        <Field label="Caseload limit"><Input value={limit} onChangeText={(v) => setLimit(v.replace(/\D/g, '').slice(0, 3))} keyboardType="number-pad" accessibilityLabel="Caseload limit" /></Field>
      </TwoUp>
      {err ? <Notice kind="error">{err}</Notice> : null}
      <P muted small>The coach sets their own password from the link; nobody is told it.</P>
    </>}
  </Sheet>;
}
