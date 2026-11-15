/* Help and support (M4): the help articles for members, the member's questions to the Bioptime team, and the copy of
   their data they asked for. Each part shows only while its switch is on (help_centre, support_requests); the server
   refuses them otherwise. Reached from Profile › Settings (the support module's entry), and from the Coach tab while a
   coach is being matched (?section=requests&ask=coaching opens a new request on the coaching topic). */
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ApiError, errorText, get, post } from '@/lib/api';
import { apiBaseSync } from '@/lib/config';
import { fmtDate, label, relative } from '@/lib/format';
import { useFeatures } from '@/lib/features';
import { useLoad } from '@/lib/useLoad';
import {
  Button, EmptyState, ErrorState, Eyebrow, Field, FilterChip, fx, GlassCard, Input, Notice, Overlay, Pill, PillTabs, Reveal,
  RingSpinner, RowDivider, SearchInput, SettingsRow, StaleBanner, statusTone, SwitchView, T,
} from '@/fx';

type Section = 'articles' | 'requests' | 'export';
const CATEGORIES = [
  { id: 'account', label: 'Account and sign-in' }, { id: 'billing', label: 'Payments and orders' }, { id: 'bloodwork', label: 'Blood tests and reports' },
  { id: 'app', label: 'The app' }, { id: 'coaching', label: 'Coaching' }, { id: 'privacy', label: 'Privacy and your data' }, { id: 'other', label: 'Something else' },
];
const statusText = (s: string) => (s === 'waiting_on_requester' ? 'Waiting on you' : s === 'open' ? 'With the team' : label(s));
const statusToneFor = (s: string) => (s === 'waiting_on_requester' ? 'warning' : s === 'open' ? 'info' : s === 'resolved' ? 'success' : 'info') as 'warning' | 'info' | 'success';

export default function Help() {
  const features = useFeatures(true);
  const params = useLocalSearchParams<{ section?: string; ask?: string }>();
  const ask = CATEGORIES.some((c) => c.id === params.ask) ? String(params.ask) : null;
  const sections: Array<{ id: Section; title: string }> = [
    ...(features?.has('help_centre') ? [{ id: 'articles' as Section, title: 'Articles' }] : []),
    ...(features?.has('support_requests') ? [{ id: 'requests' as Section, title: 'My requests' }] : []),
    { id: 'export', title: 'Your data' },
  ];
  const [picked, setPicked] = useState<Section | null>(params.section === 'requests' || params.section === 'articles' || params.section === 'export' ? params.section : null);
  const [prev, setPrev] = useState(0);
  const section = sections.find((s) => s.id === picked)?.id ?? sections[0]!.id;
  const index = sections.findIndex((s) => s.id === section);
  return <Overlay kind="back" title="Help and support" subtitle="Answers, your questions to the Bioptime team, and your data" fallback="/(tabs)/profile?tab=settings">
    {!features ? <View style={styles.loading}><RingSpinner label="Loading" /></View> : <>
      <PillTabs items={sections.map((s) => ({ value: s.id, label: s.title }))} value={section} onChange={(v) => { setPrev(index); setPicked(v); }} />
      <SwitchView id={section} direction={index >= prev ? 1 : -1}>
        <View style={styles.gap}>
          {section === 'articles' && <Articles />}
          {section === 'requests' && <Requests ask={ask} />}
          {section === 'export' && <DataExport />}
        </View>
      </SwitchView>
    </>}
  </Overlay>;
}

function Articles() {
  const list = useLoad<any>('help-articles', () => get('/help/articles'), []);
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const article = useLoad<any>(open ? `help-article-${open}` : null, () => (open ? get(`/help/articles/${encodeURIComponent(open)}`) : Promise.resolve(null)), [open]);
  const items: any[] = list.data?.items ?? [];
  const shown = useMemo(() => { const s = q.trim().toLowerCase(); return s ? items.filter((a) => `${a.title} ${a.summary}`.toLowerCase().includes(s)) : items; }, [items, q]);
  if (open) return <>
    <Button title="All articles" variant="back" onPress={() => setOpen(null)} style={styles.start} />
    <ErrorState error={article.error} onRetry={article.reload} />
    {article.loading && !article.data ? <View style={styles.loading}><RingSpinner label="Loading the article" /></View> : article.data ? <GlassCard>
      <Eyebrow kind="brand">{article.data.category}</Eyebrow>
      <T v="heading" accessibilityRole="header" style={styles.title}>{article.data.title}</T>
      <T v="body" color={fx.ink.a80}>{article.data.bodyText}</T>
      <T v="caption" color={fx.ink.a50} style={styles.title}>{`Updated ${fmtDate(article.data.updatedAt)}`}</T>
    </GlassCard> : null}
  </>;
  return <>
    <StaleBanner at={list.stale} /><ErrorState error={list.error} onRetry={list.reload} />
    <SearchInput placeholder="Search the articles" value={q} onChangeText={setQ} label="Search the help articles" />
    {list.loading && !list.data ? <View style={styles.loading}><RingSpinner label="Loading the articles" /></View>
      : shown.length ? shown.map((a, i) => <Reveal key={a.id} index={Math.min(i, 8)} mount><SettingsRow icon="book-open" title={a.title} sub={a.summary} onPress={() => setOpen(a.slug)} /></Reveal>)
        : <EmptyState icon="search" title={items.length ? 'No article matches' : 'No articles yet'} body="Ask the team under My requests." />}
  </>;
}

function Requests({ ask }: { ask?: string | null }) {
  const router = useRouter();
  const list = useLoad<any>('support-requests', () => get('/support-requests'), []);
  // a link that asks for a new request opens the form on its topic
  const [writing, setWriting] = useState(!!ask);
  const [f, setF] = useState({ category: ask ?? 'app', subject: '', body: '' });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const items: any[] = list.data?.items ?? [];
  const send = async () => {
    setBusy(true); setErrs({}); setMsg(null);
    try { const r = await post<any>('/support-requests', { category: f.category, subject: f.subject.trim(), body: f.body.trim() }); setF({ category: 'app', subject: '', body: '' }); setWriting(false); await list.reload(); router.push(`/support/${r.id}`); }
    catch (e) { if (e instanceof ApiError) setErrs(e.fieldErrors()); setMsg(errorText(e)); } finally { setBusy(false); }
  };
  return <>
    <StaleBanner at={list.stale} /><ErrorState error={list.error} onRetry={list.reload} />
    {writing ? <GlassCard>
      <Eyebrow kind="brand">New request</Eyebrow>
      <T v="heading" accessibilityRole="header" style={styles.title}>Ask the Bioptime team</T>
      <View style={styles.gap}>
        <Field label="Topic"><View style={styles.chips}>{CATEGORIES.map((c) => <FilterChip key={c.id} label={c.label} selected={f.category === c.id} onPress={() => setF({ ...f, category: c.id })} />)}</View></Field>
        <Field label="Subject" error={errs.subject}><Input value={f.subject} maxLength={160} onChangeText={(subject) => setF({ ...f, subject })} placeholder="In a few words" /></Field>
        <Field label="What happened" hint="What you did, what you expected and what you saw." error={errs.body}><Input value={f.body} maxLength={5000} onChangeText={(body) => setF({ ...f, body })} multiline style={styles.multi} /></Field>
        {msg ? <Notice kind="error">{msg}</Notice> : null}
        <View style={styles.buttons}>
          <Button title="Send" full={false} onPress={send} busy={busy} disabled={f.subject.trim().length < 3 || f.body.trim().length < 5} commit />
          <Button title="Not now" variant="ghost" full={false} onPress={() => setWriting(false)} />
        </View>
        <T v="caption" color={fx.ink.a55}>For a medical emergency call 112. This is not the place for urgent health concerns.</T>
      </View>
    </GlassCard> : <Button title="New request" icon="plus" onPress={() => setWriting(true)} />}
    {list.loading && !list.data ? <View style={styles.loading}><RingSpinner label="Loading your requests" /></View>
      : items.length ? items.map((r, i) => <Reveal key={r.id} index={Math.min(i, 8)} mount>
        <SettingsRow icon="message-square" title={r.subject} sub={`${r.reference} · ${r.categoryLabel} · ${relative(r.updatedAt)}`} right={<Pill tone={statusToneFor(r.status)}>{statusText(r.status)}</Pill>} onPress={() => router.push(`/support/${r.id}`)} />
      </Reveal>)
        : <EmptyState icon="inbox" title="No requests yet" body="The team answers here, and a notification tells you when they have." />}
  </>;
}

function DataExport() {
  const router = useRouter();
  const list = useLoad<any>('data-exports', () => get('/me/data-exports'), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const items: any[] = list.data?.items ?? [];
  const open = async (id: string) => {
    setBusy(id); setMsg(null);
    // a link that works for five minutes, opened at once; the file has no lasting address
    try { const t = await post<{ url: string }>(`/me/data-requests/${id}/file-token`); await WebBrowser.openBrowserAsync(`${apiBaseSync()}${t.url}`); }
    catch (e) { setMsg(errorText(e)); } finally { setBusy(null); }
  };
  const off = list.error instanceof ApiError && list.error.code === 'FEATURE_DISABLED';
  return <>
    <StaleBanner at={list.stale} />{off ? null : <ErrorState error={list.error} onRetry={list.reload} />}
    {msg ? <Notice kind="error">{msg}</Notice> : null}
    <GlassCard>
      <Eyebrow kind="brand">Your data</Eyebrow>
      <T v="heading" accessibilityRole="header" style={styles.title}>Copies of your data</T>
      <T v="bodySm" color={fx.ink.a70}>A file with a copy of your records; anything it does not include yet is named inside it. Only you can open it; each time you do, the link works for five minutes.</T>
      <View style={styles.exports}>
        {off ? <T v="caption" color={fx.ink.a55}>Copies are not downloaded in the app at the moment: ask for one and the Bioptime team prepares it.</T> : list.loading && !list.data ? <RingSpinner label="Loading your copies" /> : items.length ? items.map((e, i) => <View key={e.id}>
          {i ? <RowDivider /> : null}
          <View style={styles.row}>
            <View style={styles.flex}>
              <T v="section">{`Requested ${fmtDate(e.requestedAt)}`}</T>
              {!e.file ? <T v="caption" color={fx.ink.a55}>{e.status === 'cancelled' ? 'Cancelled.' : 'Being prepared. You are notified when it is ready.'}</T> : null}
            </View>
            {e.file ? <Button title="Download" variant="soft" small full={false} busy={busy === e.id} onPress={() => open(e.id)} /> : <Pill tone={statusTone(e.status)}>{label(e.status)}</Pill>}
          </View>
        </View>) : <T v="caption" color={fx.ink.a55}>No copy requested yet.</T>}
      </View>
      <Button title="Ask for a copy" variant="link" iconRight={null} onPress={() => router.push('/settings/data')} style={styles.start} />
    </GlassCard>
  </>;
}

const styles = StyleSheet.create({
  loading: { paddingVertical: 32, alignItems: 'center' },
  gap: { gap: 12 },
  start: { alignSelf: 'flex-start' },
  title: { marginTop: 6, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  multi: { minHeight: 120, textAlignVertical: 'top' },
  buttons: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  exports: { marginTop: 12, gap: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  flex: { flex: 1, minWidth: 0, gap: 2 },
});
