/* Admin › Newsletter (the web's /admin/growth/newsletter, modules/growth/AdminNewsletter.tsx; growth module,
   growth.manage): people who signed up in the website footer. A sign-up counts once the person opened the link emailed
   to them (double opt-in); nothing is sent from here. Counts per status, a status filter and an email search, the CSV
   of the chosen status (to the share sheet; each export is recorded in the audit log with its row count) and
   "Unsubscribe" with a reason. GET /admin/growth/newsletter?status&q → { items, counts };
   GET /admin/growth/newsletter/export.csv?status; POST /admin/growth/newsletter/:id/unsubscribe { reason }. Not kept on
   the device: the list is people's email addresses. */
import React, { useState } from 'react';
import { View } from 'react-native';
import { errorText, get, post, qs } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { SOURCE_LABELS, growthPill, type Subscriber } from '@/lib/admin/modules2/growth';
import { Readout } from '@/components/adminA/parts';
import { ReasonSheet } from '@/components/adminA/ReasonSheet';
import { useToast } from '@/components/adminA/toast';
import { Button, Card, ErrorBox, Loading, Screen, Title } from '@/components/ui';
import { EmptyState, FilterChips, RecordList, SearchBar } from '@/components/workspace';
import { AdminModuleGate, Hint, ItemRow, useDebounced } from '@/components/adminModules2/frame';
import { shareText } from '@/components/adminModules2/growth';
import { Enter } from '@/motion';
import { space } from '@/theme';

const TITLE = 'Newsletter';
const STATUSES = [{ value: 'confirmed', label: 'Confirmed' }, { value: 'pending', label: 'Waiting to confirm' }, { value: 'unsubscribed', label: 'Unsubscribed' }, { value: 'all', label: 'All' }];

export default function AdminNewsletterScreen() {
  return <AdminModuleGate title={TITLE} module="growth" permission="growth.manage"><Body /></AdminModuleGate>;
}

function Body() {
  const toast = useToast();
  const [status, setStatus] = useState('confirmed');
  const [q, setQ] = useState('');
  const search = useDebounced(q.trim());
  const list = useLoad<{ items: Subscriber[]; counts: Record<string, number> }>(null, () => get(`/admin/growth/newsletter${qs({ status, q: search })}`), [status, search]);
  const [off, setOff] = useState<Subscriber | null>(null);
  const [downloading, setDownloading] = useState(false);
  const items = list.data?.items ?? [];
  const c = list.data?.counts ?? {};
  const csv = async () => {
    setDownloading(true);
    try { await shareText(`/admin/growth/newsletter/export.csv${qs({ status })}`, `newsletter-${status}.csv`, 'text/csv'); }
    catch (e) { toast.show(errorText(e), 'error'); } finally { setDownloading(false); }
  };
  return <View style={{ flex: 1 }}><Screen refreshing={list.loading} onRefresh={list.reload}>
    <Enter><Title sub="People who signed up in the website footer. Each one confirmed by opening a link sent to their address, and every email carries a link to leave. Nothing is sent from here.">{TITLE}</Title></Enter>
    <Enter index={1}><Button title="Download CSV" variant="secondary" small busy={downloading} onPress={csv} style={{ alignSelf: 'flex-start' }} /></Enter>
    {list.data ? <Enter index={2}><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
      <Readout eyebrow="Confirmed" value={c.confirmed ?? 0} sub="Agreed twice" />
      <Readout eyebrow="Waiting to confirm" value={c.pending ?? 0} sub="Deleted 30 days after the link expires" />
      <Readout eyebrow="Unsubscribed" value={c.unsubscribed ?? 0} sub="Deleted 30 days after leaving" />
    </View></Enter> : null}
    <FilterChips options={STATUSES} value={status} onChange={(v) => setStatus(String(v))} />
    <SearchBar value={q} onChangeText={setQ} placeholder="Email address" />
    <Hint>The CSV holds the rows of the status chosen above. Downloads are recorded in the audit log with how many rows they held.</Hint>
    <ErrorBox error={list.error} onRetry={list.reload} />
    {!list.data ? (list.error ? null : <Loading />) : items.length ? <RecordList title="Newsletter subscribers">
      {items.map((s) => <ItemRow key={s.id} title={s.email}
        lines={[s.status === 'pending' && s.confirmExpiresAt ? `Link works until ${fmtDateTime(s.confirmExpiresAt)}` : null, `Signed up ${fmtDateTime(s.requestedAt)}`, `Confirmed ${s.confirmedAt ? fmtDateTime(s.confirmedAt) : '—'}`, s.unsubscribedAt ? `Left ${fmtDateTime(s.unsubscribedAt)}` : null, `From: ${SOURCE_LABELS[s.source] ?? s.source}`]}
        pills={[growthPill(s.status)]}
        actions={s.status !== 'unsubscribed' ? <Button title="Unsubscribe" variant="ghost" small onPress={() => setOff(s)} /> : undefined} />)}
    </RecordList> : <Card><EmptyState title="Nobody in this view" body="Sign-ups from the website footer appear here." /></Card>}
    <ReasonSheet open={!!off} onClose={() => setOff(null)} title={`Take ${off?.email ?? ''} off the newsletter?`} confirmLabel="Unsubscribe" body="For example when they ask by email. They can sign up again themselves."
      onConfirm={async (reason) => { const s = off; if (!s) return; await post(`/admin/growth/newsletter/${s.id}/unsubscribe`, { reason }); toast.show('Unsubscribed'); void list.reload(); }} />
  </Screen>{toast.float}</View>;
}
