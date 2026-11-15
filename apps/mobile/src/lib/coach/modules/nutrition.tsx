/* The Nutrition tab on the coach's client record (the web's modules/nutrition/CoachNutritionTab.tsx): the coach's meal
   plans for the client always; the client's preferences, restrictions, meal logs, photos and adherence only while the
   client shares health records with the coach (the server withholds them otherwise and says so). */
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { api, errorText, get, post } from '@/lib/api';
import { fmtDate, label } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import type { RecordTabContext } from '@/lib/coach/moduleTabs';
import { Button, Card, Empty, Eyebrow, Field, H2, Input, Notice, P, Pill, Row } from '@/components/ui';
import { Sheet } from '@/components/workspace';
import { KvList, PickerField, StatusPill, TabState, fmtLocalDate, openPrivateFile, useFlash, useRecordTick } from '@/components/coachModules/shared';
import { colors, font, space } from '@/theme';

const SLOT_LABEL: Record<string, string> = { breakfast: 'Breakfast', mid_morning: 'Mid-morning', lunch: 'Lunch', evening: 'Evening', dinner: 'Dinner', other: 'Other' };
const OUTCOME_LABEL: Record<string, string> = { as_planned: 'As planned', swapped: 'Swapped', skipped: 'Skipped', extra: 'Extra' };
const OUTCOME_TONE: Record<string, 'success' | 'warning' | 'info'> = { as_planned: 'success', swapped: 'warning', skipped: 'info', extra: 'info' };
const DAY_LABEL = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const RESTRICTION_KINDS = ['allergy', 'intolerance', 'avoid', 'religious', 'other'];
const TARGETS: Array<{ key: string; label: string; unit: string }> = [{ key: 'kcal', label: 'Energy', unit: 'kcal' }, { key: 'protein_g', label: 'Protein', unit: 'g' }, { key: 'carbs_g', label: 'Carbohydrate', unit: 'g' }, { key: 'fat_g', label: 'Fat', unit: 'g' }];
const planDayOf = (date: string) => { const d = new Date(`${date}T00:00:00Z`).getUTCDay(); return d === 0 ? 7 : d; };
const targetsLine = (t: Record<string, number> | undefined) => TARGETS.filter((x) => typeof (t ?? {})[x.key] === 'number').map((x) => `${x.label} ${t![x.key]} ${x.unit}`).join(' · ');
const restrictionText = (r: { label: string; kind: string }) => `${r.label} (${label(r.kind).toLowerCase()})`;

type Plan = { id: string; title: string; status: string; currentVersion: number; hasDraft: boolean; updatedAt: string; version?: { slots?: unknown[]; targets?: Record<string, number> } | null };
type Log = { id: string; date: string; slot: string; description: string; note: string | null; source: string; outcome: string; hasPhoto: boolean; photoFileId: string | null; feedback: Array<{ id: string; coachName: string; body: string }> };
type Profile = { dietPattern: string | null; restrictions: Array<{ label: string; kind: string }>; dislikes: string[]; cuisines: string[]; mealsPerDay: number | null; notes: string | null } | null;
type Payload = { today: string; healthShared: boolean; withheld: boolean; plans: Plan[]; profile: Profile; logs: Log[]; adherence: { pct: number | null; due: number; done: number; note: string } | null; range: { from: string; to: string } };

export function NutritionTab({ ctx }: { ctx: RecordTabContext }) {
  const { memberId } = ctx;
  const router = useRouter();
  const tick = useRecordTick(ctx.record); // the record screen's pull to refresh reloads this tab's data too
  const view = useLoad<Payload>(`coach-nutrition-${memberId}`, () => get(`/coach/clients/${memberId}/nutrition`), [memberId, tick]);
  const { show, node: flash } = useFlash();
  const [feedbackFor, setFeedbackFor] = useState<Log | null>(null);
  const [editProfile, setEditProfile] = useState(false);
  const [busyPhoto, setBusyPhoto] = useState<string | null>(null);
  const d = view.data;
  const plans = d?.plans ?? [];
  const logs = d?.logs ?? [];
  const dates = Array.from(new Set(logs.map((l) => l.date)));
  const photo = async (l: Log) => { if (!l.photoFileId) return; setBusyPhoto(l.id); try { await openPrivateFile(l.photoFileId); } catch (e) { show(errorText(e), 'error'); } finally { setBusyPhoto(null); } };
  return <TabState loading={view.loading && !d} error={view.error} onRetry={view.reload}>
    {d ? <View style={{ gap: space.md }}>
      {flash}
      <Card>
        <Row between><View style={{ flex: 1 }}><Eyebrow>Meal plans</Eyebrow><H2>{plans.length ? `${plans.length} plan${plans.length === 1 ? '' : 's'}` : 'No meal plan yet'}</H2></View><Button title="New meal plan" small onPress={() => router.push(`/coach/meal-plans/new?member=${memberId}`)} /></Row>
        {plans.length ? plans.map((p) => <View key={p.id} style={st.item}>
          <Text style={st.itemTitle}>{p.title}</Text>
          <Text style={st.itemMeta}>{`Version ${p.currentVersion || 1}${p.hasDraft && p.status !== 'draft' ? ' · a revision is in draft' : ''} · ${(p.version?.slots ?? []).length} meals · updated ${fmtDate(p.updatedAt)}${targetsLine(p.version?.targets) ? ` · targets: ${targetsLine(p.version?.targets)}` : ''}`}</Text>
          <Row><StatusPill status={p.status} />{p.status !== 'archived' ? <Button title={p.status === 'draft' ? 'Edit and publish' : 'Revise'} variant="secondary" small onPress={() => router.push(`/coach/meal-plans/${p.id}`)} /> : null}</Row>
        </View>) : <Empty title="No meal plan yet" body="Write a draft from the client's goals and preferences; publishing it tells the client." />}
      </Card>
      {d.withheld ? <Card><Empty title="Meal log and preferences are private" body="Until this client shares their health records with you, their food preferences, restrictions, meal log, meal photos and adherence stay with them. You still see the plans you wrote. They can turn sharing on under Profile › Privacy and sharing." /></Card> : <>
        <Card>
          <Eyebrow>Last 14 days</Eyebrow>
          <Text style={st.readout}>{d.adherence?.pct ?? '—'}<Text style={{ color: colors.muted, fontSize: font.body }}>{d.adherence?.pct !== null && d.adherence?.pct !== undefined ? ' %' : ''}</Text></Text>
          <P small>{d.adherence?.due ? `${d.adherence.done} of ${d.adherence.due} planned meals logged as planned or swapped` : 'No planned meals were due'}</P>
          {d.adherence?.note ? <P muted small>{d.adherence.note}</P> : null}
        </Card>
        <Card>
          <Row between><View style={{ flex: 1 }}><Eyebrow>As the client told us</Eyebrow><H2>Preferences</H2></View><Button title="Edit" variant="secondary" small onPress={() => setEditProfile(true)} /></Row>
          <KvList rows={[
            ['Diet pattern', d.profile?.dietPattern || '—'],
            ['Restrictions', (d.profile?.restrictions ?? []).map(restrictionText).join(', ') || '—'],
            ['Dislikes', (d.profile?.dislikes ?? []).join(', ') || '—'],
            ['Cuisines', (d.profile?.cuisines ?? []).join(', ') || '—'],
            ['Meals a day', d.profile?.mealsPerDay ?? '—'],
            d.profile?.notes ? ['Notes', d.profile.notes] : null,
          ]} />
          <P muted small>Labels are the client's own words. Advice for a medical condition belongs with their doctor.</P>
        </Card>
        <Card>
          <Eyebrow>{`${fmtLocalDate(d.range.from)} to ${fmtLocalDate(d.range.to)}`}</Eyebrow><H2>Meal log</H2>
          {!logs.length ? <Empty title="Nothing logged in the last 14 days" /> : dates.map((date) => <View key={date} style={{ gap: space.xs }}>
            <Text style={st.dayHead}>{`${DAY_LABEL[planDayOf(date)]} · ${fmtLocalDate(date)}`}</Text>
            {logs.filter((l) => l.date === date).map((l) => <View key={l.id} style={st.item}>
              <Text style={st.itemTitle}>{l.description}</Text>
              <Text style={st.itemMeta}>{`${SLOT_LABEL[l.slot] ?? label(l.slot)}${l.note ? ` · ${l.note}` : ''}${l.source === 'coach' ? ' · entered by coach' : ''}`}</Text>
              {(l.feedback ?? []).map((f) => <Text key={f.id} style={{ color: colors.text, fontSize: font.small }}>{`${f.coachName}: ${f.body}`}</Text>)}
              <Row><Pill tone={OUTCOME_TONE[l.outcome] ?? 'info'}>{OUTCOME_LABEL[l.outcome] ?? label(l.outcome)}</Pill>{l.hasPhoto ? <Button title="Photo" variant="ghost" small busy={busyPhoto === l.id} onPress={() => void photo(l)} /> : null}<Button title="Feedback" variant="secondary" small onPress={() => setFeedbackFor(l)} /></Row>
            </View>)}
          </View>)}
        </Card>
      </>}
      <FeedbackSheet log={feedbackFor} onClose={() => setFeedbackFor(null)} onSaved={() => { setFeedbackFor(null); show('Feedback sent to the client'); view.reload(); }} />
      {!d.withheld ? <ProfileSheet open={editProfile} memberId={memberId} profile={d.profile} onClose={() => setEditProfile(false)} onSaved={() => { setEditProfile(false); show('Preferences saved'); view.reload(); }} /> : null}
    </View> : null}
  </TabState>;
}

function FeedbackSheet({ log, onClose, onSaved }: { log: Log | null; onClose: () => void; onSaved: () => void }) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { if (log) { setBody(''); setErr(''); } }, [log]);
  const send = async () => { if (!log) return; setBusy(true); setErr(''); try { await post(`/coach/meal-logs/${log.id}/feedback`, { body: body.trim() }); onSaved(); } catch (e) { setErr(errorText(e)); } finally { setBusy(false); } };
  return <Sheet open={!!log} onClose={onClose} title="Feedback on this meal" footer={<Row><Button title="Not now" variant="ghost" onPress={onClose} disabled={busy} /><Button title="Send to the client" busy={busy} disabled={body.trim().length < 2} onPress={send} style={{ flex: 1 }} /></Row>}>
    {log ? <>
      <P small>{`${log.description} · ${SLOT_LABEL[log.slot] ?? label(log.slot)} · ${fmtLocalDate(log.date)} · ${OUTCOME_LABEL[log.outcome] ?? label(log.outcome)}`}</P>
      <Field label="Your feedback (the client reads it under Nutrition)"><Input value={body} onChangeText={setBody} maxLength={2000} multiline style={{ minHeight: 90, textAlignVertical: 'top' }} /></Field>
      <P muted small>The client is told there is feedback, without its text in the notification. Keep to your coaching scope: no medical or supplement advice.</P>
      {err ? <Notice kind="error">{err}</Notice> : null}
    </> : null}
  </Sheet>;
}

function ProfileSheet({ open, memberId, profile, onClose, onSaved }: { open: boolean; memberId: string; profile: Profile; onClose: () => void; onSaved: () => void }) {
  const [diet, setDiet] = useState('');
  const [restrictions, setRestrictions] = useState<Array<{ label: string; kind: string }>>([]);
  const [meals, setMeals] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { if (open) { setDiet(profile?.dietPattern ?? ''); setRestrictions(profile?.restrictions ?? []); setMeals(profile?.mealsPerDay ? String(profile.mealsPerDay) : ''); setErr(''); } }, [open, profile]);
  const save = async () => { setBusy(true); setErr(''); try { await api('PUT', `/coach/clients/${memberId}/nutrition/profile`, { dietPattern: diet.trim() || null, restrictions: restrictions.filter((r) => r.label.trim()).map((r) => ({ label: r.label.trim(), kind: r.kind })), mealsPerDay: meals ? Number(meals) : null }); onSaved(); } catch (e) { setErr(errorText(e)); } finally { setBusy(false); } };
  return <Sheet open={open} onClose={onClose} title="Record the client's preferences" footer={<Row><Button title="Not now" variant="ghost" onPress={onClose} disabled={busy} /><Button title="Save" busy={busy} onPress={save} style={{ flex: 1 }} /></Row>}>
    <P small>Record what the client told you, in their words. They see and can change it.</P>
    <Field label="Diet pattern (optional)"><Input value={diet} onChangeText={setDiet} maxLength={80} /></Field>
    <Field label="Restrictions">
      <View style={{ gap: space.sm }}>
        {restrictions.map((r, i) => <View key={i} style={{ gap: space.xs }}>
          <Row><Input accessibilityLabel="Restriction" value={r.label} maxLength={80} onChangeText={(t) => setRestrictions((rs) => rs.map((x, k) => (k === i ? { ...x, label: t } : x)))} style={{ flex: 1 }} /><Button title="✕" variant="ghost" small onPress={() => setRestrictions((rs) => rs.filter((_, k) => k !== i))} /></Row>
          <Row>{RESTRICTION_KINDS.map((k) => <Button key={k} title={label(k)} variant={r.kind === k ? 'primary' : 'secondary'} small onPress={() => setRestrictions((rs) => rs.map((x, j) => (j === i ? { ...x, kind: k } : x)))} />)}</Row>
        </View>)}
        <Button title="Add a restriction" variant="secondary" small onPress={() => setRestrictions((rs) => [...rs, { label: '', kind: 'avoid' }])} style={{ alignSelf: 'flex-start' }} />
      </View>
    </Field>
    <PickerField label="Meals a day (optional)" value={meals} placeholder="Not set" options={[1, 2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: String(n) }))} onChange={setMeals} />
    {err ? <Notice kind="error">{err}</Notice> : null}
  </Sheet>;
}

const st = {
  item: { paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.border, gap: space.xs },
  itemTitle: { color: colors.text, fontSize: font.body, fontWeight: '600' as const },
  itemMeta: { color: colors.muted, fontSize: font.small },
  dayHead: { color: colors.text, fontSize: font.small, fontWeight: '700' as const, marginTop: space.sm },
  readout: { color: colors.text, fontSize: font.title, fontWeight: '700' as const },
};
