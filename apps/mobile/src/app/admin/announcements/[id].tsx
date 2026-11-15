/* Admin › one announcement (the editor card of the web's /admin/announcements, modules/messaging/AdminAnnouncements.tsx,
   as its own screen: the phone notes ask for list → detail → edit). 'new' opens an empty draft.
   - Editable (new, or the team's own draft or scheduled announcement): Title, Message, Packages (none ticked: every
     member), Coach (only that coach's clients); "Save draft" / "Save" → POST /admin/announcements or PATCH …/:id;
     "Publish now" and "Schedule" save first, then POST …/:id/publish { publishAt? } ("Or schedule for", entered in IST
     like every time in the app); "Discard" (a draft) / "Withdraw" (scheduled) ask for a reason → POST …/:id/withdraw.
   - Read only (published, withdrawn, or a coach's): who wrote it, who published it, how many it reaches and read it,
     and "Withdraw" with a reason unless it already is.
   GET /admin/announcements (the list holds every field; there is no single read) and GET /admin/announcements/options. */
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { ApiError, errorText, get, patch, post } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { STATUS_PILL, STATUS_WORD, audienceText, isEditable, whenText, type AnnouncementOptions, type ManagedAnnouncement } from '@/lib/admin/modules2/announcements';
import { ReasonSheet } from '@/components/adminA/ReasonSheet';
import { useToast } from '@/components/adminA/toast';
import { PickerField, istToIso } from '@/components/coachModules/shared';
import { Button, Card, ErrorBox, Eyebrow, Field, H2, Input, Loading, Notice, P, Pill, Row, Screen, StaleBanner, Title } from '@/components/ui';
import { DatePickerField, KeyValue, TimePickerField, isClockTime, isIsoDate } from '@/components/workspace';
import { notifyBadges } from '@/components/workspaceShell';
import { AdminModuleGate, BackLink, CheckList, Hint } from '@/components/adminModules2/frame';
import { Enter } from '@/motion';
import { colors, font, radius, space } from '@/theme';

type Draft = { title: string; body: string; packageIds: string[]; coachId: string };
const EMPTY: Draft = { title: '', body: '', packageIds: [], coachId: '' };
/** The list with one announcement replaced in place, or added at the top when it is new. */
const upsert = (items: ManagedAnnouncement[], a: ManagedAnnouncement) => (items.some((x) => x.id === a.id) ? items.map((x) => (x.id === a.id ? a : x)) : [a, ...items]);
const toDraft = (a: ManagedAnnouncement): Draft => ({ title: a.title, body: a.body, packageIds: a.audience.packageIds, coachId: a.audience.coachId ?? '' });

export default function AdminAnnouncementScreen() {
  return <AdminModuleGate title="Announcement" module="messaging" permission="announcements.manage"><Body /></AdminModuleGate>;
}

function Body() {
  const { id: param = 'new' } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const [id, setId] = useState<string | null>(param === 'new' ? null : param);
  // the announcement this screen shows, kept in step with `id` at once (the route param arrives a render later)
  const shown = useRef<string | null>(id);
  const adopt = (next: string | null) => { shown.current = next; setId(next); };
  const list = useLoad<{ items: ManagedAnnouncement[] }>('admin-announcements', () => get('/admin/announcements'), []);
  const options = useLoad<AnnouncementOptions>('admin-announcement-options', () => get('/admin/announcements/options'), []);
  const current = useMemo(() => (id ? list.data?.items.find((a) => a.id === id) ?? null : null), [id, list.data]);
  const [edit, setEdit] = useState<Draft | null>(id ? null : { ...EMPTY });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [laterDate, setLaterDate] = useState('');
  const [laterTime, setLaterTime] = useState('');
  const [withdrawing, setWithdrawing] = useState(false);
  // the draft follows the stored announcement whenever a fresh copy arrives (after a save, a publish, a reload)
  useEffect(() => { if (current) setEdit(toDraft(current)); }, [current]);
  // the screen follows its route: history back/forward or a link can hand this same screen another announcement (or
  // 'new'); the param a first save sets is the announcement already shown, so that one changes nothing
  useEffect(() => {
    const next = param === 'new' ? null : param;
    if (next === shown.current) return;
    adopt(next);
    setEdit(next ? null : { ...EMPTY });
    setErrs({}); setLaterDate(''); setLaterTime(''); setWithdrawing(false);
  }, [param]); // eslint-disable-line react-hooks/exhaustive-deps
  const editable = isEditable(current);
  const missing = !!id && !!list.data && !current;

  const payload = (d: Draft) => ({ title: d.title.trim(), body: d.body.trim(), audience: { packageIds: d.packageIds, coachId: d.coachId || null } });
  const fail = (e: unknown) => { if (e instanceof ApiError) setErrs(e.fieldErrors()); toast.show(errorText(e), 'error'); };
  const save = async (): Promise<ManagedAnnouncement | null> => {
    if (!edit) return null;
    setBusy(true); setErrs({});
    try {
      const out = id ? await patch<ManagedAnnouncement>(`/admin/announcements/${id}`, payload(edit)) : await post<ManagedAnnouncement>('/admin/announcements', payload(edit));
      if (!id) { adopt(out.id); router.setParams({ id: out.id }); }
      list.setData({ items: upsert(list.data?.items ?? [], out) });
      return out;
    } catch (e) { fail(e); return null; } finally { setBusy(false); }
  };
  const laterSet = !!laterDate || !!laterTime;
  const laterOk = isIsoDate(laterDate) && isClockTime(laterTime);
  const publish = async (when: 'now' | 'later') => {
    const saved = await save();
    if (!saved) return;
    setBusy(true);
    try {
      const out = await post<ManagedAnnouncement>(`/admin/announcements/${saved.id}/publish`, when === 'later' ? { publishAt: istToIso(laterDate, laterTime) } : {});
      toast.show(out.status === 'scheduled' ? 'Scheduled' : 'Published: members in its audience are notified');
      setLaterDate(''); setLaterTime('');
      list.setData({ items: upsert(list.data?.items ?? [], out) });
      notifyBadges();
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const ready = !!edit && edit.title.trim().length >= 3 && !!edit.body.trim();
  const opts = options.data;

  return <View style={{ flex: 1 }}><Screen refreshing={list.loading} onRefresh={() => { void list.reload(); void options.reload(); }}>
    <BackLink title="← Announcements" href="/admin/announcements" />
    <Enter><Title sub={current ? STATUS_WORD[current.status] : 'New'}>{current ? (editable ? 'Edit announcement' : 'Announcement') : 'New announcement'}</Title></Enter>
    <StaleBanner at={list.stale} />
    <ErrorBox error={list.error} onRetry={list.reload} />
    {missing ? <Notice kind="warning" title="Not found">This announcement is not in the list any more. Go back to the announcements.</Notice> : null}
    {id && !list.data ? <Loading /> : editable && edit ? <Enter index={1}><Card>
      <Field label="Title" error={errs.title}><Input value={edit.title} maxLength={120} onChangeText={(title) => setEdit({ ...edit, title })} accessibilityLabel="Title" /></Field>
      <Field label="Message" hint="Plain text; line breaks are kept." error={errs.body}><Input value={edit.body} maxLength={4000} onChangeText={(body) => setEdit({ ...edit, body })} multiline style={{ minHeight: 140, textAlignVertical: 'top' }} accessibilityLabel="Message" /></Field>
      {options.error ? <ErrorBox error={options.error} onRetry={options.reload} /> : !opts ? <Loading /> : <>
        <CheckList label="Packages (optional)" hint={`Leave all unticked for every member (${opts.allMembers} now). Ticked: members with an active programme of one of them.`} error={errs.audience}
          options={opts.packages.map((p) => ({ value: p.id, label: `${p.name}${p.active ? '' : ' (inactive)'}` }))} value={edit.packageIds} onChange={(packageIds) => setEdit({ ...edit, packageIds })} />
        <PickerField label="Coach (optional)" hint="Only this coach’s assigned clients." placeholder="Any coach" value={edit.coachId} options={opts.coaches.map((c) => ({ value: c.id, label: c.name }))} onChange={(coachId) => setEdit({ ...edit, coachId })} />
      </>}
      <Row>
        <Button title={id ? 'Save' : 'Save draft'} small busy={busy} disabled={!ready} onPress={() => void save().then((out) => { if (out) toast.show('Draft saved'); })} />
        <Button title="Publish now" variant="secondary" small busy={busy} disabled={!ready} onPress={() => void publish('now')} />
        {current ? <Button title={current.status === 'draft' ? 'Discard' : 'Withdraw'} variant="ghost" small onPress={() => setWithdrawing(true)} /> : null}
      </Row>
      <View style={{ height: space.sm }} />
      <DatePickerField label="Or schedule for (optional, IST)" value={laterDate} onChange={setLaterDate} error={errs.publishAt} />
      {laterDate ? <TimePickerField label="Time (IST)" value={laterTime} onChange={setLaterTime} /> : null}
      <Button title="Schedule" variant="secondary" small busy={busy} disabled={!laterSet || !laterOk || !ready} onPress={() => void publish('later')} style={{ alignSelf: 'flex-start' }} />
      {current?.status === 'scheduled' ? <Hint>{`${whenText(current)}. Publishing now sends it at once instead.`}</Hint> : null}
      {edit.body.trim() ? <View style={{ marginTop: space.sm, gap: space.xs }}><Eyebrow>Preview</Eyebrow><View style={{ backgroundColor: colors.base, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: space.md }}><Text style={{ color: colors.text, fontSize: font.small, lineHeight: 20 }}>{edit.body.trim()}</Text></View></View> : null}
    </Card></Enter> : current ? <Enter index={1}><Card>
      <Row><Pill tone={STATUS_PILL[current.status].tone}>{STATUS_PILL[current.status].label}</Pill><Text style={{ color: colors.muted, fontSize: font.small }}>{whenText(current)}</Text></Row>
      <Text style={{ color: colors.muted, fontSize: font.small }}>{audienceText(current)}</Text>
      <H2>{current.title}</H2>
      <P>{current.body}</P>
      <KeyValue rows={[
        ['Written by', `${current.createdBy.name ?? '—'}${current.origin === 'coach' ? ' (coach)' : ''}`],
        ...(current.publishedBy ? [['Published by', current.publishedBy.name ?? '—'] as [string, string]] : []),
        ...(current.status !== 'withdrawn' ? [['Reaches now', `${current.reach.members ?? 0} members`] as [string, string]] : []),
        ['Read by', String(current.reach.reads)],
        ...(current.status === 'withdrawn' ? [['Withdrawn by', current.withdrawnBy?.name ?? '—'], ['Reason', current.withdrawReason ?? '—']] as Array<[string, string]> : []),
      ]} />
      {current.status !== 'withdrawn' ? <Button title="Withdraw" variant="danger" small onPress={() => setWithdrawing(true)} style={{ alignSelf: 'flex-start' }} /> : null}
    </Card></Enter> : null}
    <ReasonSheet open={withdrawing && !!current} onClose={() => setWithdrawing(false)} destructive title={`Withdraw “${current?.title ?? ''}”?`} confirmLabel="Withdraw"
      body={current?.status === 'published' ? 'It disappears for members at once, and the notifications it sent lose their text.' : 'It will not be published.'}
      onConfirm={async (reason) => { const a = current; if (!a) return; const out = await post<ManagedAnnouncement>(`/admin/announcements/${a.id}/withdraw`, { reason }); toast.show('Withdrawn'); list.setData({ items: upsert(list.data?.items ?? [], out) }); notifyBadges(); }} />
  </Screen>{toast.float}</View>;
}
