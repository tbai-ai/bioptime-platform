/* The Habits tab on the administrator's member record (the web's modules/habits/HabitsTab.tsx in admin mode,
   members.manage): the member's habits with completion, weekly adherence and open follow-ups, read only.
   GET /admin/members/:id/habits (audited as member.record_viewed; restricted keys stripped without
   members.view_restricted). Coaches set and change the habits they set; members change their own. */
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { get } from '@/lib/api';
import { label } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import type { RecordTabContext } from '@/lib/admin/moduleTabs';
import { Button, Card, Empty, Eyebrow, H2, P, Pill, Row, StaleBanner } from '@/components/ui';
import { Bar, KvList, StatusPill, TabState, day, useRecordTick } from '@/components/coachModules/shared';
import { colors, font, radius, space } from '@/theme';

type DayCell = { date: string; weekday: number; due: boolean; status: 'done' | 'skipped' | 'missed' | 'open' | 'off' };
type Checkin = { id: string; date: string; status: 'done' | 'skipped'; note?: string | null };
type TeamHabit = {
  id: string; title: string; detail: string; kind: string; scheduleLabel: string; targetLabel: string | null; reminderTimes: string[]; remindersOn: boolean;
  status: 'active' | 'paused' | 'archived'; startDate: string; endDate: string | null; setBy: 'member' | 'coach';
  week: { done: number; target: number }; streak: { count: number; unit: 'days' | 'weeks' }; recent: DayCell[];
  missedDueDays: number; followUp: { id: string; status: string; createdAt: string } | null; checkins: Checkin[];
};
type Payload = { today: string; timezone: string; habits: TeamHabit[]; weekly: Array<{ weekStart: string; due: number; done: number; pct: number | null; current: boolean }>; notesShared: boolean; memberHabitsShared: boolean; followUpThreshold: number | null; note: string };

const LETTER: Record<number, string> = { 1: 'M', 2: 'T', 3: 'W', 4: 'T', 5: 'F', 6: 'S', 7: 'S' };
const CELL_TEXT: Record<DayCell['status'], string> = { done: 'done', skipped: 'skipped', missed: 'no check-in', open: 'open today', off: 'not due' };

export function AdminHabitsTab({ ctx }: { ctx: RecordTabContext }) {
  const { memberId } = ctx;
  const tick = useRecordTick(ctx.record); // the record screen's pull to refresh reloads this tab's data too
  const view = useLoad<Payload>(`admin-habits-${memberId}`, () => get(`/admin/members/${memberId}/habits`), [memberId, tick]);
  const [showArchived, setShowArchived] = useState(false);
  const d = view.data;
  const habits = (d?.habits ?? []).filter((h) => showArchived || h.status !== 'archived');
  const archived = (d?.habits ?? []).filter((h) => h.status === 'archived').length;
  // weeks before any habit ran say nothing: the table starts at the first week with something due (or this week), as on the web
  const firstDue = d?.weekly.findIndex((w) => w.due > 0 || w.current) ?? -1;
  const weeks = firstDue >= 0 ? d!.weekly.slice(firstDue) : [];
  return <TabState loading={view.loading && !d} error={view.error} onRetry={view.reload}>
    {d ? <View style={{ gap: space.md }}>
      <StaleBanner at={view.stale} />
      <Card>
        <Eyebrow>Weekly adherence</Eyebrow><H2>Due days checked in as done</H2>
        {d.habits.length ? weeks.map((w) => <View key={w.weekStart} style={st.row}>
          <Text style={st.rowTitle}>{`Week of ${day(w.weekStart)}${w.current ? ' · this week, so far' : ''}`}</Text>
          <Text style={st.meta}>{`Due ${w.due} · Done ${w.done} · ${w.pct === null ? '—' : `${w.pct}%`}`}</Text>
        </View>) : <Empty title="No habits yet" body="Neither the client nor their coach has added a habit." />}
        <P muted small>{`${d.note} Paused days are not counted; this week counts what is settled.`}</P>
      </Card>
      <Card>
        <Eyebrow>Follow-ups</Eyebrow><H2>{d.followUpThreshold === null ? 'Off' : `After ${d.followUpThreshold} missed ${d.followUpThreshold === 1 ? 'day' : 'days'}`}</H2>
        <P muted small>{d.followUpThreshold === null ? 'No follow-up opens for a slipping habit until the owner chooses a threshold.' : `A habit that goes ${d.followUpThreshold} due days without any check-in opens one follow-up for the assigned coach, listed on Today.`}</P>
        <KvList rows={[['Client’s timezone', d.timezone], ['Today there', day(d.today)]]} />
      </Card>
      {habits.map((h) => <Card key={h.id}>
        <Eyebrow>{`${h.scheduleLabel}${h.targetLabel ? ` · ${h.targetLabel}` : ''} · ${label(h.kind)}`}</Eyebrow>
        <H2>{h.title}</H2>
        <Row>{h.setBy === 'coach' ? <Pill tone="info">Set by a coach</Pill> : <Pill>Client’s own</Pill>}<StatusPill status={h.status} />{h.followUp ? <Pill tone="warning">Follow-up open</Pill> : null}</Row>
        {h.detail ? <P small>{h.detail}</P> : null}
        <Text style={st.meta}>{h.week.target ? `${h.week.done} of ${h.week.target} this week` : 'Nothing due this week'}{h.streak.count ? ` · ${h.streak.count} ${h.streak.unit === 'days' ? (h.streak.count === 1 ? 'day' : 'days') : (h.streak.count === 1 ? 'week' : 'weeks')} in a row` : ''}</Text>
        {h.week.target ? <Bar pct={(h.week.done / h.week.target) * 100} tone="success" /> : null}
        <View style={st.strip} accessibilityLabel="Recent days">{h.recent.map((c) => <View key={c.date} style={[st.cell, c.status === 'done' && { backgroundColor: colors.success }, c.status === 'skipped' && { backgroundColor: colors.borderStrong }, c.status === 'missed' && { borderColor: colors.warning }, c.status === 'open' && { borderColor: colors.brand }]} accessibilityLabel={`${day(c.date)}: ${CELL_TEXT[c.status]}`}><Text style={[st.cellText, c.status === 'off' && { color: colors.disabled }]}>{LETTER[c.weekday] ?? ''}</Text></View>)}</View>
        <KvList rows={[
          ['Started', `${day(h.startDate)}${h.endDate ? ` · ends ${day(h.endDate)}` : ''}`],
          h.status === 'active' ? ['Without a check-in', h.missedDueDays ? `${h.missedDueDays} due ${h.missedDueDays === 1 ? 'day' : 'days'}` : 'None'] : null,
          ['Reminders', `${h.remindersOn && h.reminderTimes.length ? h.reminderTimes.join(', ') : 'Off'} (the client’s choice)`],
        ]} />
        {h.checkins.length ? <View>{h.checkins.slice(0, 10).map((c) => <View key={c.id} style={st.row}><Row between><Text style={st.rowTitle}>{day(c.date)}</Text><Pill tone={c.status === 'done' ? 'success' : 'info'}>{c.status === 'done' ? 'Done' : 'Skipped'}</Pill></Row>{d.notesShared && c.note ? <Text style={st.meta}>{c.note}</Text> : null}</View>)}</View> : <P muted small>No check-ins in the last four weeks.</P>}
      </Card>)}
      {archived ? <Button title={showArchived ? 'Hide archived habits' : 'Show archived habits'} variant="ghost" small onPress={() => setShowArchived((v) => !v)} style={{ alignSelf: 'flex-start' }} /> : null}
      <P muted small>Read only. Coaches set and change the habits they set; members change their own and their reminders. Opening this tab is recorded in the audit log.</P>
    </View> : null}
  </TabState>;
}

const st = StyleSheet.create({
  row: { paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 2 },
  rowTitle: { color: colors.text, fontSize: font.small, fontWeight: '600' },
  meta: { color: colors.muted, fontSize: font.small },
  strip: { flexDirection: 'row', gap: space.xs, flexWrap: 'wrap' },
  cell: { width: 26, height: 26, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.base, alignItems: 'center', justifyContent: 'center' },
  cellText: { color: colors.text, fontSize: font.tiny, fontWeight: '700' },
});
