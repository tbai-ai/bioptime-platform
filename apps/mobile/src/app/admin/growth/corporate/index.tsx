/* Admin › Corporate enquiries (the web's /admin/growth/corporate, modules/growth/AdminCorporate.tsx; growth module,
   growth.manage): companies asking what Bioptime could offer their team, filtered by status; an enquiry opens its own
   screen (/admin/growth/corporate/[id]). GET /admin/growth/corporate?status → { items, counts }. Not kept on the device:
   the list carries contact details. */
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
import { get, qs } from '@/lib/api';
import { relative } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { CORPORATE_INTEREST_LABELS, CORPORATE_STATUSES, growthPill, type CorporateEnquiry } from '@/lib/admin/modules2/growth';
import { Card, ErrorBox, Loading, Screen, Title } from '@/components/ui';
import { EmptyState, FilterChips, RecordList } from '@/components/workspace';
import { AdminModuleGate, ItemRow } from '@/components/adminModules2/frame';
import { Enter } from '@/motion';

const TITLE = 'Corporate enquiries';

export default function AdminCorporateScreen() {
  return <AdminModuleGate title={TITLE} module="growth" permission="growth.manage"><Body /></AdminModuleGate>;
}

function Body() {
  const router = useRouter();
  const [status, setStatus] = useState('open');
  const list = useLoad<{ items: CorporateEnquiry[]; counts: Record<string, number> }>(null, () => get(`/admin/growth/corporate${qs({ status })}`), [status]);
  const first = useRef(true);
  useFocusEffect(useCallback(() => { if (first.current) { first.current = false; return; } void list.reload(); }, [list.reload])); // eslint-disable-line react-hooks/exhaustive-deps
  const items = list.data?.items ?? [];
  const c = list.data?.counts ?? {};
  return <Screen refreshing={list.loading} onRefresh={list.reload}>
    <Enter><Title sub="Companies asking what Bioptime could offer their team. They were told someone will reply by email and that nothing is agreed or priced until you have talked. A closed enquiry is deleted with its notes 180 days after it was closed, and one nobody has changed for a year is deleted too.">{TITLE}</Title></Enter>
    <FilterChips options={[{ value: 'open', label: `Open (${(c.new ?? 0) + (c.contacted ?? 0) + (c.in_discussion ?? 0)})` }, ...CORPORATE_STATUSES.map((s) => ({ value: s.id, label: `${s.label} (${c[s.id] ?? 0})` })), { value: 'all', label: 'All' }]} value={status} onChange={(v) => setStatus(String(v))} />
    <ErrorBox error={list.error} onRetry={list.reload} />
    {!list.data ? (list.error ? null : <Loading />) : items.length ? <Enter index={1}><RecordList title="Corporate enquiries">
      {items.map((r) => <ItemRow key={r.id} title={r.company} onPress={() => router.push(`/admin/growth/corporate/${r.id}`)}
        lines={[r.reference, `${r.contactName} · ${r.email}`, `Team size: ${r.teamSize}`, `Interested in: ${r.interests.map((i) => CORPORATE_INTEREST_LABELS[i] ?? i).join(', ')}`, `Handled by: ${r.assignedTo?.name ?? 'Not assigned'}`, `Received ${relative(r.createdAt)}`]}
        pills={[growthPill(r.status)]} />)}
    </RecordList></Enter> : <Card><EmptyState title="Nothing in this view" body="Enquiries from the corporate page appear here." /></Card>}
  </Screen>;
}
