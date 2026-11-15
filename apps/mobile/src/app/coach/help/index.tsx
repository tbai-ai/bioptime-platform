/* Coach › Help (the web's /coach/help, modules/support/HelpCentre.tsx for a coach): the help articles for coaches, the
   coach's own support requests with the team's replies, and the onboarding checklist. Each part shows only while its
   switch is on (help_centre, support_requests); with both off a coach sees just the checklist. Shown while the
   'support' flag is on. Pull to refresh reloads the checklist and the list of the open tab. */
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { errorText, get, post } from '@/lib/api';
import { useFeatures } from '@/lib/features';
import { relative } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { Button, Card, Empty, ErrorBox, Field, H2, Input, Loading, Notice, P, Row, StaleBanner } from '@/components/ui';
import { RecordList, RecordRow, SearchBar, SegmentTabs, Sheet } from '@/components/workspace';
import { NotificationBell, RoleGate, WorkspaceScreen } from '@/components/workspaceShell';
import { CoachOnboarding } from '@/components/coachModules/onboarding';
import { ModuleGate, PickerField, RequestStatus, fieldErrorsOf } from '@/components/coachModules/shared';
import { Enter } from '@/motion';
import { colors, font, space } from '@/theme';

type Tab = 'articles' | 'requests';
type Article = { id: string; slug: string; title: string; category: string; audience: string; summary: string; updatedAt: string };
type Req = { id: string; reference: string; category: string; categoryLabel: string; subject: string; status: string; createdAt: string; updatedAt: string; lastMessageAt: string | null };
/** The topics as the API names them; "Payments and orders" is not offered to coaches (the web hides it for them). */
const CATEGORIES: Array<{ id: string; label: string }> = [
  { id: 'account', label: 'Account and sign-in' }, { id: 'bloodwork', label: 'Blood tests and reports' }, { id: 'app', label: 'The app or portal' },
  { id: 'coaching', label: 'Coaching' }, { id: 'privacy', label: 'Privacy and your data' }, { id: 'other', label: 'Something else' },
];

/** Pull to refresh on Help: the checklist and the open tab's list register their reload while they are mounted (the
 *  tab not shown is not mounted, so it is not requested), and a pull runs them together. */
type Register = (key: string, reload: () => Promise<unknown>) => () => void;
function useRefreshers(): { register: Register; refreshing: boolean; onRefresh: () => void } {
  const fns = useRef(new Map<string, () => Promise<unknown>>());
  const [refreshing, setRefreshing] = useState(false);
  const register = useCallback<Register>((key, reload) => { fns.current.set(key, reload); return () => { fns.current.delete(key); }; }, []);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void Promise.all([...fns.current.values()].map((f) => f().catch(() => undefined))).finally(() => setRefreshing(false));
  }, []);
  return { register, refreshing, onRefresh };
}

export default function CoachHelp() {
  const features = useFeatures(true);
  const refresh = useRefreshers();
  const { tab: asked } = useLocalSearchParams<{ tab?: string }>();
  const tabs: Array<{ id: Tab; label: string }> = [
    ...(features?.has('help_centre') ? [{ id: 'articles' as Tab, label: 'Help articles' }] : []),
    ...(features?.has('support_requests') ? [{ id: 'requests' as Tab, label: 'My requests' }] : []),
  ];
  const [picked, setPicked] = useState<Tab | null>(null);
  const tab = tabs.find((t) => t.id === (picked ?? asked))?.id ?? tabs[0]?.id;
  return <RoleGate workspace="coach">
    <Stack.Screen options={{ title: 'Help', headerRight: () => <NotificationBell /> }} />
    <WorkspaceScreen workspace="coach" title="Help" sub="Articles for coaches, your questions to the Bioptime team, and your onboarding checklist." refreshing={refresh.refreshing} onRefresh={refresh.onRefresh}>
      <ModuleGate features={features} module="support">
        <Enter><CoachOnboarding register={refresh.register} /></Enter>
        {tabs.length ? <SegmentTabs items={tabs} value={tab ?? ''} onChange={(id) => setPicked(id as Tab)} /> : null}
        {tab === 'articles' ? <Articles register={refresh.register} /> : null}
        {tab === 'requests' ? <Requests register={refresh.register} /> : null}
      </ModuleGate>
    </WorkspaceScreen>
  </RoleGate>;
}

function Articles({ register }: { register: Register }) {
  const router = useRouter();
  const list = useLoad<{ items: Article[] }>('help-articles-coach', () => get('/help/articles'), []);
  useEffect(() => register('articles', list.reload), [register, list.reload]);
  const [q, setQ] = useState('');
  const items = list.data?.items ?? [];
  const shown = useMemo(() => { const s = q.trim().toLowerCase(); return s ? items.filter((a) => `${a.title} ${a.summary} ${a.category}`.toLowerCase().includes(s)) : items; }, [items, q]);
  const groups = useMemo(() => { const m = new Map<string, Article[]>(); for (const a of shown) m.set(a.category, [...(m.get(a.category) ?? []), a]); return [...m]; }, [shown]);
  return <View style={{ gap: space.md }}>
    <StaleBanner at={list.stale} />
    <ErrorBox error={list.error} onRetry={list.reload} />
    {list.loading && !list.data ? <Loading /> : !items.length ? <Card><Empty title="No articles yet" body="The Bioptime team publishes help articles here. Ask a question under My requests in the meantime." /></Card> : <>
      <SearchBar value={q} onChangeText={setQ} placeholder="Search the articles" />
      {groups.length ? groups.map(([category, arts], i) => <Enter key={category} index={i}><RecordList title="Help">
        <H2>{category}</H2>
        {arts.map((a) => <RecordRow key={a.id} title={a.title} meta={a.summary} onPress={() => router.push(`/coach/help/articles/${encodeURIComponent(a.slug)}`)} />)}
      </RecordList></Enter>) : <Card><Empty title="No article matches" body="Try another word, or ask the team under My requests." /></Card>}
    </>}
  </View>;
}

function Requests({ register }: { register: Register }) {
  const router = useRouter();
  const list = useLoad<{ items: Req[] }>('support-requests-coach', () => get('/support-requests'), []);
  useEffect(() => register('requests', list.reload), [register, list.reload]);
  const [creating, setCreating] = useState(false);
  const items = list.data?.items ?? [];
  return <View style={{ gap: space.md }}>
    <Row between><Text style={{ color: colors.text, fontSize: font.small, flex: 1, lineHeight: 19 }}>Questions about your account, payments, tests, the app or your coaching. The team answers here, and a notification tells you when they have.</Text></Row>
    <Button title="New request" small onPress={() => setCreating(true)} style={{ alignSelf: 'flex-start' }} />
    <StaleBanner at={list.stale} />
    <ErrorBox error={list.error} onRetry={list.reload} />
    {list.loading && !list.data ? <Loading /> : items.length ? <Enter><RecordList title="My support requests">
      {items.map((r) => <RecordRow key={r.id} title={r.subject} meta={`${r.reference} · ${r.categoryLabel} · ${relative(r.updatedAt)}`} right={<View style={{ marginEnd: space.xs }}><RequestStatus status={r.status} /></View>} onPress={() => router.push(`/coach/help/requests/${r.id}`)} />)}
    </RecordList></Enter> : list.data ? <Card><Empty title="No requests yet" body="Ask the team anything about your account or the service." /><Button title="New request" variant="secondary" small onPress={() => setCreating(true)} style={{ alignSelf: 'center' }} /></Card> : null}
    <NewRequest open={creating} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); list.reload(); router.push(`/coach/help/requests/${id}`); }} />
  </View>;
}

function NewRequest({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const [f, setF] = useState({ category: 'app', subject: '', body: '' });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async () => {
    setBusy(true); setErr(''); setErrs({});
    try { const r = await post<{ id: string }>('/support-requests', { category: f.category, subject: f.subject.trim(), body: f.body.trim() }); setF({ category: 'app', subject: '', body: '' }); onCreated(r.id); }
    catch (e) { setErrs(fieldErrorsOf(e)); setErr(errorText(e)); } finally { setBusy(false); }
  };
  return <Sheet open={open} onClose={onClose} title="Ask the Bioptime team" footer={<Row><Button title="Not now" variant="ghost" onPress={onClose} disabled={busy} /><Button title="Send" busy={busy} disabled={f.subject.trim().length < 3 || f.body.trim().length < 5} onPress={submit} style={{ flex: 1 }} /></Row>}>
    <PickerField label="Topic" value={f.category} options={CATEGORIES.map((c) => ({ value: c.id, label: c.label }))} onChange={(category) => setF({ ...f, category })} error={errs.category} />
    <Field label="Subject" error={errs.subject}><Input value={f.subject} maxLength={160} onChangeText={(subject) => setF({ ...f, subject })} placeholder="In a few words" /></Field>
    <Field label="What happened" hint="What you did, what you expected and what you saw. The team reads it in the portal." error={errs.body}><Input value={f.body} maxLength={5000} onChangeText={(body) => setF({ ...f, body })} multiline style={{ minHeight: 120, textAlignVertical: 'top' }} /></Field>
    <P muted small>For a medical emergency call 112. This is not the place for urgent health concerns.</P>
    {err ? <Notice kind="error">{err}</Notice> : null}
  </Sheet>;
}

