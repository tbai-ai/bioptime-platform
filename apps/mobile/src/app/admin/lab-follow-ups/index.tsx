/* Admin › Lab follow-ups (the web's /admin/lab-follow-ups, modules/labFollowups/AdminLabFollowups.tsx; labFollowups
   module, reports.view): every next step set after a report review, with counts and filters
   (GET /admin/lab-follow-ups?status&kind or ?overdue=1&kind). Changes (done, cancel, reopen) need integrations.manage
   and a reason; new team next steps are added on a report the team released (the report screen). LabStack
   administration is not here: it stays under /admin/integrations/labstack. */
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { get, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useLoad } from '@/lib/useLoad';
import { Readout } from '@/components/adminA/parts';
import { useToast } from '@/components/adminA/toast';
import { LoadError } from '@/components/adminB1/parts';
import { Card, Empty, Loading, P } from '@/components/ui';
import { FilterChips, RecordList } from '@/components/workspace';
import { notifyBadges } from '@/components/workspaceShell';
import { AdminModuleScreen, useScreenRefresh } from '@/components/adminModules/shared';
import { FollowUpLine, KINDS, TeamActions, type FollowUp, type Summary } from '@/components/adminModules/labFollowups';
import { Enter } from '@/motion';
import { colors, font, space } from '@/theme';

type StatusFilter = 'open' | 'done' | 'cancelled' | 'all' | 'overdue';
const STATUS_OPTIONS = [{ value: 'open', label: 'Open' }, { value: 'overdue', label: 'Past due' }, { value: 'done', label: 'Done' }, { value: 'cancelled', label: 'Cancelled' }, { value: 'all', label: 'Any status' }];
const KIND_OPTIONS = [{ value: '', label: 'Any kind' }, ...KINDS.map((k) => ({ value: k.id, label: k.label }))];

export default function AdminLabFollowupsScreen() {
  return <AdminModuleScreen title="Lab follow-ups" module="labFollowups" permission="reports.view"
    sub="Next steps set after a report review: consultations, retests, plan changes and notes. The assigned coach sets them once a report is released, while the client shares health information; the team sets them on reports it released itself. On a coach’s step the team can mark it done, cancel or reopen it, or change its link, but not its words. Due dates are the writer’s own; nothing here suggests one.">
    <Body />
  </AdminModuleScreen>;
}

function Body() {
  const { can } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [status, setStatus] = useState<StatusFilter>('open');
  const [kind, setKind] = useState('');
  const [tick, setTick] = useState(0);
  const list = useLoad<{ items: FollowUp[]; summary: Summary }>(`admin-lab-follow-ups-${status}-${kind}`, () => get(`/admin/lab-follow-ups${qs(status === 'overdue' ? { overdue: 1, kind } : { status, kind })}`), [status, kind, tick]);
  const pull = useScreenRefresh(list.loading, list.stale);
  React.useEffect(() => { if (pull) setTick((n) => n + 1); }, [pull]);
  const canWrite = can('integrations.manage');
  const s = list.data?.summary;
  const items = list.data?.items ?? [];
  const changed = () => { void list.reload(); notifyBadges(); };
  return <View style={{ gap: space.md }}>
    {toast.node}
    {s ? <Enter index={1}><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
      <Readout eyebrow="Open" value={s.open} />
      <Readout eyebrow="Past due" value={s.overdue} hot={s.overdue > 0} />
      <Readout eyebrow="Done" value={s.done} />
      <Readout eyebrow="Cancelled" value={s.cancelled} />
    </View></Enter> : null}
    <FilterChips options={STATUS_OPTIONS} value={status} onChange={(v) => setStatus(String(v) as StatusFilter)} />
    <FilterChips options={KIND_OPTIONS} value={kind} onChange={(v) => setKind(String(v))} />
    {list.error ? <LoadError title="Next steps could not be loaded" error={list.error} onRetry={list.reload} /> : !list.data ? <Loading />
      : items.length ? <RecordList title="Lab follow-ups">
        {items.map((f) => <View key={f.id} style={{ paddingHorizontal: space.md }}>
          <Pressable accessibilityRole="link" onPress={() => router.push(`/admin/clients/${f.memberId}?tab=lab-follow-ups` as never)} style={{ paddingTop: space.sm }}>
            <Text style={{ color: colors.accentText, fontSize: font.body, fontWeight: '700' }}>{f.memberName ?? f.memberId}</Text>
          </Pressable>
          <FollowUpLine f={f} showReport listPage>{canWrite ? <TeamActions f={f} onChanged={changed} show={toast.show} /> : null}</FollowUpLine>
        </View>)}
      </RecordList> : <Card><Empty title="No next steps here" body={status === 'open' ? 'Nothing is open. Next steps appear once a coach or the team adds them to a released report.' : 'Nothing matches these filters.'} /></Card>}
    {!canWrite ? <P muted small>Changing a next step needs the “integrations.manage” permission.</P> : null}
  </View>;
}
