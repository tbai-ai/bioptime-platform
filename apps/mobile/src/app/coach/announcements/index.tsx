/* Coach › Announcements (the web's /coach/announcements, modules/messaging/CoachAnnouncements.tsx): a coach announces
   to their own assigned clients (nobody else can be chosen), now or at a set time, and withdraws their own with a
   reason. The list shows how many clients each reaches and how many read it; never a client's contact details. Shown
   while the 'messaging' flag is on. */
import { Stack } from 'expo-router';
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { errorText, get, post } from '@/lib/api';
import { useFeatures } from '@/lib/features';
import { fmtDateTime } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { Button, Card, Empty, ErrorBox, Eyebrow, Field, H2, Input, Loading, Notice, P, Pill, Row, StaleBanner } from '@/components/ui';
import { DatePickerField, TimePickerField, isClockTime, isIsoDate } from '@/components/workspace';
import { ReasonSheet } from '@/components/adminA/ReasonSheet';
import { NotificationBell, RoleGate, WorkspaceScreen } from '@/components/workspaceShell';
import { ModuleGate, fieldErrorsOf, istToIso, useFlash } from '@/components/coachModules/shared';
import { Enter } from '@/motion';
import { colors, font, space } from '@/theme';

type Announcement = { id: string; title: string; body: string; status: 'draft' | 'scheduled' | 'published' | 'withdrawn'; reach: { members: number | null; reads: number }; publishAt: string | null; publishedAt: string | null; withdrawnAt: string | null; withdrawReason: string | null; updatedAt: string };
const STATUS: Record<Announcement['status'], [string, 'warning' | 'info' | 'success']> = { draft: ['Draft', 'warning'], scheduled: ['Scheduled', 'info'], published: ['Published', 'success'], withdrawn: ['Withdrawn', 'info'] };
function whenText(a: Announcement): string {
  if (a.status === 'published') return `Published ${fmtDateTime(a.publishedAt)}`;
  if (a.status === 'scheduled') return `Goes out ${fmtDateTime(a.publishAt)}`;
  if (a.status === 'withdrawn') return `Withdrawn ${fmtDateTime(a.withdrawnAt)}`;
  return `Draft, last changed ${fmtDateTime(a.updatedAt)}`;
}

export default function CoachAnnouncements() {
  const features = useFeatures(true);
  const on = !!features?.has('messaging');
  const list = useLoad<{ items: Announcement[]; clients: number }>(on ? 'coach-announcements' : null, () => (on ? get('/coach/announcements') : Promise.resolve({ items: [], clients: 0 })), [on]);
  const { show, node: flash } = useFlash();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [laterDate, setLaterDate] = useState('');
  const [laterTime, setLaterTime] = useState('');
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [withdrawing, setWithdrawing] = useState<Announcement | null>(null);
  const clients = list.data?.clients ?? 0;
  const items = list.data?.items ?? [];
  const later = !!laterDate || !!laterTime;
  const laterOk = !later || (isIsoDate(laterDate) && isClockTime(laterTime));
  const send = async () => {
    setBusy(true); setErrs({});
    try {
      const out = await post<Announcement>('/coach/announcements', { title: title.trim(), body: body.trim(), ...(later ? { publishAt: istToIso(laterDate, laterTime) } : {}) });
      show(out.status === 'scheduled' ? 'Scheduled' : 'Sent to your clients');
      setTitle(''); setBody(''); setLaterDate(''); setLaterTime(''); list.reload();
    } catch (e) { setErrs(fieldErrorsOf(e)); show(errorText(e), 'error'); } finally { setBusy(false); }
  };
  return <RoleGate workspace="coach">
    <Stack.Screen options={{ title: 'Announcements', headerRight: () => <NotificationBell /> }} />
    <WorkspaceScreen workspace="coach" title="Announcements" sub="A note to all of your assigned clients at once, such as a change to your working hours. For one client, use Messages." refreshing={on && list.loading} onRefresh={list.reload}>
      <ModuleGate features={features} module="messaging">
        {flash}
        <StaleBanner at={list.stale} />
        <ErrorBox error={list.error} onRetry={list.reload} />
        <Enter><Card><Eyebrow>New</Eyebrow><H2>Announce to your clients</H2>
          {!list.data ? <Loading /> : <View>
            <Notice kind="info">{`${clients ? `Goes to your ${clients} assigned client${clients === 1 ? '' : 's'} only. ` : 'You have no assigned clients yet, so there is nobody to send to. '}Service news only: never a diagnosis, results or medical advice.`}</Notice>
            <View style={{ height: space.md }} />
            <Field label="Title" error={errs.title}><Input value={title} maxLength={120} onChangeText={setTitle} /></Field>
            <Field label="Message" hint="Plain text; line breaks are kept." error={errs.body}><Input value={body} maxLength={4000} onChangeText={setBody} multiline style={{ minHeight: 140, textAlignVertical: 'top' }} /></Field>
            <DatePickerField label="Send later (optional, IST)" value={laterDate} onChange={setLaterDate} hint="Leave empty to send now." error={errs.publishAt} />
            {laterDate ? <TimePickerField label="Time (IST)" value={laterTime} onChange={setLaterTime} /> : null}
            <Button title={later ? 'Schedule' : 'Send now'} busy={busy} disabled={!clients || title.trim().length < 3 || !body.trim() || !laterOk} onPress={send} />
          </View>}
        </Card></Enter>
        <Enter index={1}><Card><Eyebrow>Sent</Eyebrow><H2>Your announcements</H2>
          {!list.data ? <Loading /> : items.length ? items.map((a) => <View key={a.id} style={st.item}>
            <Row><Pill tone={STATUS[a.status][1]}>{STATUS[a.status][0]}</Pill><Text style={st.meta}>{whenText(a)}</Text>{a.status !== 'withdrawn' ? <Text style={st.meta}>{`${a.reach.members ?? 0} client${a.reach.members === 1 ? '' : 's'} · ${a.reach.reads} read`}</Text> : null}</Row>
            <Text style={st.title}>{a.title}</Text>
            <P small>{a.body}</P>
            {a.status === 'withdrawn' ? <Text style={st.meta}>{`Reason: ${a.withdrawReason ?? ''}`}</Text> : <Button title="Withdraw" variant="ghost" small onPress={() => setWithdrawing(a)} style={{ alignSelf: 'flex-start' }} />}
          </View>) : <Empty title="No announcements yet" body="What you send appears here with how many of your clients read it." />}
        </Card></Enter>
        <ReasonSheet open={!!withdrawing} onClose={() => setWithdrawing(null)} destructive title={`Withdraw “${withdrawing?.title ?? ''}”?`} confirmLabel="Withdraw" body="It disappears for your clients at once, and the notification it sent loses its text."
          onConfirm={async (reason) => { if (!withdrawing) return; await post(`/coach/announcements/${withdrawing.id}/withdraw`, { reason }); show('Withdrawn'); list.reload(); }} />
      </ModuleGate>
    </WorkspaceScreen>
  </RoleGate>;
}

const st = {
  item: { paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.border, gap: space.xs },
  title: { color: colors.text, fontSize: font.body, fontWeight: '700' as const },
  meta: { color: colors.muted, fontSize: font.small },
};
