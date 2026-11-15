/* Admin › Members (the web's /admin/clients, pages/Clients.tsx, members.manage): every member account, searchable by
   name or email and filtered by account state (GET /admin/members?q=&state=), one row per member opening the record
   (src/app/admin/clients/[id].tsx), and the "Invite a member" sheet (POST /admin/members/invite). Phone search is the
   server's decision (members.view_restricted); the list shows email because administrators hold it, as on the web. */
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { errorText, get, post, qs } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { labelOr, tone } from '@/lib/admin/a/format';
import { FormField, NotedRow } from '@/components/adminA/parts';
import { useToast } from '@/components/adminA/toast';
import { Button, Card, ErrorBox, Field, Input, Loading, Notice, P, StaleBanner } from '@/components/ui';
import { EmptyState, FilterChips, RecordList, SearchBar, Sheet } from '@/components/workspace';
import { RequirePermission, WorkspaceScreen } from '@/components/workspaceShell';
import { Enter } from '@/motion';
import { space } from '@/theme';

type Member = { id: string; name: string; email: string; state?: string | null; created_at?: string | null; effective_at?: string | null; goals?: string[] | null; package_name?: string | null; programme_end_at?: string | null; coach_name?: string | null; assignment_status?: string | null };

const STATES = ['pending_verification', 'onboarding', 'active', 'suspended', 'deactivated', 'deletion_requested'];

export default function AdminMembers() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [state, setState] = useState('');
  const [invite, setInvite] = useState(false);
  const toast = useToast();
  useEffect(() => { const t = setTimeout(() => setQuery(q.trim()), 350); return () => clearTimeout(t); }, [q]);
  const list = useLoad<{ items: Member[] }>(!query && !state ? 'admin-members' : null, () => get(`/admin/members${qs({ q: query, state })}`), [query, state]);
  const items = list.data?.items ?? [];
  const filtered = !!(query || state);
  return <View style={{ flex: 1 }}><WorkspaceScreen workspace="admin" title="Members" sub="Everyone with a member account; open one for orders, entitlements, assignments and history." refreshing={list.loading} onRefresh={list.reload} depth>
    <RequirePermission permission="members.manage">
      <StaleBanner at={list.stale} /><ErrorBox error={list.error} onRetry={list.reload} />
      <Enter index={1}><View style={{ gap: space.sm }}>
        <SearchBar value={q} onChangeText={setQ} placeholder="Search name or email" onSubmit={() => setQuery(q.trim())} />
        <FilterChips options={[{ value: '', label: 'Any state' }, ...STATES.map((s) => ({ value: s, label: s.replace(/_/g, ' ') }))]} value={state} onChange={(v) => setState(String(v))} />
        <Button title="Invite a member" small onPress={() => setInvite(true)} style={{ alignSelf: 'flex-start' }} />
      </View></Enter>
      <Enter index={2}>{list.loading && !list.data ? <Loading /> : items.length ? <RecordList title="Members">
        {items.map((m) => <NotedRow key={m.id} title={m.name} onPress={() => router.push(`/admin/clients/${m.id}` as never)}
          meta={`${m.email}\n${m.package_name ?? '—'}${m.programme_end_at ? ` · ends ${fmtDate(m.programme_end_at)}` : ''}`}
          notes={[`${m.coach_name ?? 'Unassigned'}${m.assignment_status === 'paused' ? ' (paused)' : ''} · joined ${fmtDate(m.created_at ?? m.effective_at)}`, (m.goals ?? []).join(', ')]}
          pills={[{ label: labelOr(m.state ?? m.assignment_status), tone: tone(m.state ?? m.assignment_status) }]} />)}
      </RecordList> : list.data ? <Card><EmptyState title="No members match" body={filtered ? 'Try another name, email or state.' : 'Members appear here once they register or accept an invitation.'} /></Card> : <View />}</Enter>
      <InviteMemberSheet open={invite} onClose={() => setInvite(false)} onDone={() => { toast.show('Invitation created'); void list.reload(); }} />
    </RequirePermission>
  </WorkspaceScreen>{toast.float}</View>;
}

type InviteResult = { note?: string; token?: string };

/** The web's "Invite a member" dialog: email, name, an optional reason; the success alert keeps the server's note and,
 *  when the server returns one, the activation link (never invented here). */
function InviteMemberSheet({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [email, setEmail] = useState(''); const [name, setName] = useState(''); const [reason, setReason] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [result, setResult] = useState<InviteResult | null>(null);
  const go = async () => { setBusy(true); setErr(''); try { const r = await post<InviteResult>('/admin/members/invite', { email: email.trim(), name: name.trim(), reason: reason.trim() || undefined }); setResult(r); onDone(); } catch (e) { setErr(errorText(e)); } finally { setBusy(false); } };
  const close = () => { setResult(null); setEmail(''); setName(''); setReason(''); setErr(''); onClose(); };
  return <Sheet open={open} onClose={close} title="Invite a member" footer={result ? <Button title="Done" onPress={close} /> : <View style={{ flexDirection: 'row', gap: space.sm }}><Button title="Cancel" variant="secondary" onPress={close} disabled={busy} style={{ flex: 1 }} /><Button title="Send the invitation" onPress={go} busy={busy} disabled={!email.trim() || name.trim().length < 2} style={{ flex: 1 }} /></View>}>
    {result ? <Notice kind="success" title="Invitation created"><View style={{ gap: space.xs }}><P small muted>{result.note ?? ''}</P>{result.token ? <P small muted>{`Activation link: /login/client/activate?token=${result.token}`}</P> : null}</View></Notice> : <>
      <Field label="Email"><Input value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" accessibilityLabel="Email" /></Field>
      <Field label="Name"><Input value={name} onChangeText={setName} accessibilityLabel="Name" /></Field>
      <FormField label="Reason" optional hint="Recorded in the audit log."><Input value={reason} onChangeText={setReason} accessibilityLabel="Reason" /></FormField>
      {err ? <Notice kind="error">{err}</Notice> : null}
      <P muted small>The member sets their own password from the link (72 hours, one use) and accepts the policies; nobody is told it. Public registration on the website still works for everyone else.</P>
    </>}
  </Sheet>;
}
