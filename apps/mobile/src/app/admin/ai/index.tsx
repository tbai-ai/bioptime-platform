/* Admin › Coach AI usage (the web's /admin/ai, modules/ai/AdminAiUsage.tsx; ai module, ai.manage): whether Coach AI is
   configured and exactly what is missing (provider and model, the API key in the server environment, the
   data-processing agreement, the retention decision), then counts from the audit log by purpose, coach and day:
   requests, refusals, drafts made, accepted and discarded (GET /admin/ai/usage?from&to, the last 30 days by default,
   a year at most). Never draft text, coaches' instructions or client details. Read only; the retention period is a
   module setting on Modules. */
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { get, qs } from '@/lib/api';
import { fmtDate, istDate } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { Readout } from '@/components/adminA/parts';
import { LoadError } from '@/components/adminB1/parts';
import { Button, Card, Empty, Eyebrow, H2, Loading, Notice, P, Row } from '@/components/ui';
import { DatePickerField, isIsoDate } from '@/components/workspace';
import { NotConfigured, type Requirement } from '@/components/coach/ai';
import { AdminModuleScreen, useScreenRefresh } from '@/components/adminModules/shared';
import { Enter } from '@/motion';
import { colors, font, space } from '@/theme';

type Counts = { requests: number; refused: number; drafted: number; accepted: number; discarded: number };
type Usage = {
  from: string; to: string;
  readiness: { configured: boolean; provider: string; model: string | null; missing: Requirement[]; retentionDays: number | null; promptVersion: string };
  totals: Counts; stored: Record<string, number>;
  byPurpose: Array<Counts & { purpose: string; label: string }>;
  byCoach: Array<Counts & { coachId: string; coachName: string }>;
  byDay: Array<{ date: string; requests: number; refused: number; accepted: number }>;
  note: string;
};

const day = (d: string) => fmtDate(`${d}T12:00:00Z`);

export default function AdminAiUsageScreen() {
  return <AdminModuleScreen title="Coach AI usage" module="ai" permission="ai.manage"
    sub="Requests, refusals and reviews by purpose, coach and day. Counts only: draft text, coaches’ instructions and client details are never shown here.">
    <UsageBody />
  </AdminModuleScreen>;
}

/** A table row of counts: the label, then "n requests · n refused · …". */
function CountRow({ title, cells, last }: { title: string; cells: Array<[string, number]>; last?: boolean }) {
  return <View style={{ paddingVertical: space.sm, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.border, gap: 2 }}>
    <Text style={{ color: colors.text, fontSize: font.body, fontWeight: '600' }}>{title}</Text>
    <Text style={{ color: colors.muted, fontSize: font.small }}>{cells.map(([k, v]) => `${k} ${v}`).join(' · ')}</Text>
  </View>;
}

function UsageBody() {
  const router = useRouter();
  const [from, setFrom] = useState(istDate(-29));
  const [to, setTo] = useState(istDate(0));
  const [range, setRange] = useState({ from: istDate(-29), to: istDate(0) });
  const [tick, setTick] = useState(0);
  const usage = useLoad<Usage>(`admin-ai-usage-${range.from}-${range.to}`, () => get(`/admin/ai/usage${qs(range)}`), [range.from, range.to, tick]);
  const pull = useScreenRefresh(usage.loading, usage.stale);
  useEffect(() => { if (pull) setTick((n) => n + 1); }, [pull]);
  // the web reads a date as soon as it is a whole date; From never after To
  useEffect(() => { if (isIsoDate(from) && isIsoDate(to) && from <= to && (from !== range.from || to !== range.to)) setRange({ from, to }); }, [from, to, range.from, range.to]);
  const d = usage.data;
  return <View style={{ gap: space.md }}>
    <Card>
      <Row style={{ alignItems: 'flex-start' }}>
        <View style={{ flex: 1, minWidth: 140 }}><DatePickerField label="From" value={from} onChange={setFrom} max={to} /></View>
        <View style={{ flex: 1, minWidth: 140 }}><DatePickerField label="To" value={to} onChange={setTo} min={from} /></View>
      </Row>
    </Card>
    <LoadError title="Coach AI usage could not be loaded" error={usage.error} onRetry={usage.reload} />
    {!d && !usage.error ? <Loading /> : null}
    {d ? <>
      {d.readiness.configured
        ? <Notice kind="success" title="Coach AI is configured">{`Provider ${d.readiness.provider}${d.readiness.model ? `, model ${d.readiness.model}` : ''}. Drafts are kept ${d.readiness.retentionDays} days.`}</Notice>
        : <View style={{ gap: space.xs }}>
          <NotConfigured missing={d.readiness.missing}>Coaches can open Coach AI, but every request is refused until each of these is in place. Nothing is generated in the meantime. Integrations lists the provider settings; the retention period is on Modules.</NotConfigured>
          <Button title="Open Modules" variant="ghost" small onPress={() => router.push('/admin/modules' as never)} style={{ alignSelf: 'flex-start', paddingHorizontal: 0 }} />
        </View>}
      <Enter index={1}><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
        <Readout eyebrow="Requests" value={d.totals.requests} sub={`${day(d.from)} to ${day(d.to)}`} />
        <Readout eyebrow="Refused" value={d.totals.refused} sub="Not configured, or no client consent" />
        <Readout eyebrow="Accepted" value={d.totals.accepted} sub="Edited and kept by the coach" />
        <Readout eyebrow="Discarded" value={d.totals.discarded} sub="Text cleared at once" />
      </View></Enter>
      <Enter index={2}><Card>
        <Eyebrow>By purpose</Eyebrow><H2>What coaches asked for</H2>
        {d.byPurpose.map((p, i) => <CountRow key={p.purpose} title={p.label} last={i === d.byPurpose.length - 1} cells={[['Requests', p.requests], ['Refused', p.refused], ['Accepted', p.accepted]]} />)}
      </Card></Enter>
      <Enter index={3}><Card>
        <Eyebrow>By coach</Eyebrow><H2>Who asked</H2>
        {d.byCoach.length ? d.byCoach.map((c, i) => <CountRow key={c.coachId} title={c.coachName} last={i === d.byCoach.length - 1} cells={[['Requests', c.requests], ['Refused', c.refused], ['Accepted', c.accepted], ['Discarded', c.discarded]]} />) : <Empty title="No requests in this range" />}
      </Card></Enter>
      <Enter index={4}><Card>
        <Eyebrow>By day (UTC)</Eyebrow><H2>Requests over the range</H2>
        {d.byDay.length ? d.byDay.map((x, i) => <CountRow key={x.date} title={day(x.date)} last={i === d.byDay.length - 1} cells={[['Requests', x.requests], ['Refused', x.refused], ['Accepted', x.accepted]]} />) : <Empty title="No requests in this range" />}
        <P muted>{`${d.note} Drafts stored now: ${Object.entries(d.stored).map(([k, v]) => `${k} ${v}`).join(', ')}. Prompt version ${d.readiness.promptVersion}.`}</P>
      </Card></Enter>
    </> : null}
  </View>;
}
