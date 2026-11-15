/* Coach › Meal plan editor (the web's /coach/meal-plans/:id, 'new' with ?member=; apps/dashboard/src/modules/nutrition/MealPlanEditor.tsx).
   A draft until it is published; publishing freezes the version and tells the client; editing a published plan opens
   the next version. Targets are optional and typed by the coach; totals show only the values entered in the library.
   GET /coach/meal-plans/:id, GET /coach/nutrition-library, GET /coach/clients?limit=100 (new only); POST /coach/meal-plans,
   PATCH /coach/meal-plans/:id, POST …/publish, POST …/archive { reason }. Flag: nutrition. */
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { errorText, get, patch, post } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { decimal, fieldErrorsOf, libraryPill, num, plural, useFlash } from '@/lib/coach/libraries/shared';
import { DAY_LABEL, DAYS, NUTRIENTS, SLOT_LABEL, SLOTS, slotBody, slotRef, TARGETS, type Library, type MealPlan, type SlotDraft } from '@/lib/coach/libraries/nutrition';
import { Button, Card, ErrorBox, Eyebrow, Field, H2, Input, Loading, Notice, P, Pill, Row, Screen, StaleBanner, Title } from '@/components/ui';
import { type FilterOption } from '@/components/workspace';
import { NotificationBell, notifyBadges, RoleGate } from '@/components/workspaceShell';
import { ReasonSheet } from '@/components/adminA/ReasonSheet';
import { ModuleGate } from '@/components/coachLibraries/ModuleGate';
import { SelectField, type SelectOption } from '@/components/coachLibraries/SelectField';
import { Enter, MotionCard } from '@/motion';
import { colors, font, radius, space } from '@/theme';

type Client = { id: string; name: string; memberCode?: string | null };

export default function MealPlanScreen() {
  const { id = 'new', member } = useLocalSearchParams<{ id: string; member?: string }>();
  // a new plan opened again for another client (?member=) starts afresh, as a fresh page does on the web
  return <>
    <Stack.Screen options={{ title: id === 'new' ? 'New meal plan' : 'Meal plan', headerRight: () => <NotificationBell /> }} />
    <RoleGate workspace="coach"><ModuleGate flag="nutrition" title={id === 'new' ? 'New meal plan' : 'Meal plan'}><Editor key={id === 'new' ? `new:${member ?? ''}` : id} id={id} /></ModuleGate></RoleGate>
  </>;
}

/** The schema's rules before anything is sent (packages/domain nutrition.ts mealPlanCreateSchema). */
function checkPlan(isNew: boolean, member: string, title: string, summary: string, targets: Record<string, string>, slots: SlotDraft[]): Record<string, string> {
  const e: Record<string, string> = {};
  if (isNew && !member) e.memberId = 'Choose the client first';
  const t = title.trim();
  if (t.length < 2) e.title = 'At least 2 characters.'; else if (t.length > 160) e.title = 'At most 160 characters.';
  if (summary.trim().length > 2000) e.summary = 'At most 2000 characters.';
  for (const [k, v] of Object.entries(targets)) { const n = num(v); if (n !== null && !(n >= 0 && n <= 100000)) { e.targets = `${TARGETS.find((x) => x.key === k)?.label ?? k}: a number from 0 to 100000.`; break; } }
  if (slots.length > 84) e.slots = 'At most 84 meals in a plan.';
  for (const s of slots) {
    if (!s.ref && !s.title.trim()) { e.slots = `${DAY_LABEL[s.day]}, ${SLOT_LABEL[s.slot]}: name the meal, or pick a food or recipe.`; break; }
    if (s.title.trim().length > 160) { e.slots = `${DAY_LABEL[s.day]}, ${SLOT_LABEL[s.slot]}: a name of at most 160 characters.`; break; }
    if (s.timeHint.trim().length > 40) { e.slots = `${DAY_LABEL[s.day]}, ${SLOT_LABEL[s.slot]}: a time of at most 40 characters.`; break; }
    if (s.portionNote.trim().length > 300) { e.slots = `${DAY_LABEL[s.day]}, ${SLOT_LABEL[s.slot]}: a portion note of at most 300 characters.`; break; }
  }
  return e;
}

function Editor({ id }: { id: string }) {
  const { member: memberParam, saved } = useLocalSearchParams<{ member?: string; saved?: string }>();
  const router = useRouter();
  const isNew = id === 'new';
  const existing = useLoad<MealPlan | null>(isNew ? null : `coach.meal-plan.${id}`, () => (isNew ? Promise.resolve(null) : get(`/coach/meal-plans/${id}`)), [id]);
  const clients = useLoad<{ items: Client[] } | null>(isNew ? 'coach.clients.pick' : null, () => (isNew ? get('/coach/clients?limit=100') : Promise.resolve(null)), [isNew]);
  const library = useLoad<Library>('coach.nutrition-library.plan', () => get('/coach/nutrition-library'), []);
  const [member, setMember] = useState(memberParam ?? '');
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [slots, setSlots] = useState<SlotDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [archiving, setArchiving] = useState(false);
  const { flash, ok, clear } = useFlash();
  const p = existing.data;
  // a plan just created: its editor opened here with the toast the create screen could not show
  useEffect(() => { if (saved === 'published') ok('Meal plan published: the client has been told'); else if (saved === 'draft') ok('Draft saved'); }, [saved, ok]);
  useEffect(() => {
    if (!p) return;
    setMember(p.memberId); setTitle(p.title);
    const v = p.version;
    setSummary(v?.summary ?? '');
    setTargets(Object.fromEntries(Object.entries(v?.targets ?? {}).map(([k, val]) => [k, String(val)])));
    setSlots((v?.slots ?? []).map((s) => ({ day: s.day, slot: s.slot, timeHint: s.timeHint ?? '', ref: slotRef(s), title: s.title, portionNote: s.portionNote ?? '' })));
  }, [p]);

  const foods = library.data?.foods ?? [];
  const recipes = library.data?.recipes ?? [];
  // items the plan already uses that are not in my library (a previous coach's draft after a handover, or one the team
  // archived since): the API keeps accepting them on this plan, so they stay selectable instead of showing as empty
  const itemOptions = useMemo<SelectOption[]>(() => {
    const out: SelectOption[] = [{ value: '', label: 'No library item' }];
    for (const f of foods) out.push({ value: `food:${f.id}`, label: `${f.name}${f.status === 'draft' ? ' (my draft)' : ''}`, detail: f.servingLabel || undefined, group: 'Foods' });
    for (const r of recipes) out.push({ value: `recipe:${r.id}`, label: `${r.title}${r.status === 'draft' ? ' (my draft)' : ''}`, group: 'Recipes' });
    if (library.data) for (const s of p?.version?.slots ?? []) {
      const ref = slotRef(s);
      const known = s.food ? foods.some((f) => f.id === s.food!.id) : s.recipe ? recipes.some((r) => r.id === s.recipe!.id) : true;
      if (ref && !known && !out.some((o) => o.value === ref)) out.push({ value: ref, label: s.food ? s.food.name : s.recipe!.title, group: 'Already on this plan' });
    }
    return out;
  }, [foods, recipes, library.data, p]);

  const body = () => ({
    title: title.trim(), summary: summary.trim(),
    targets: Object.fromEntries(Object.entries(targets).filter(([, v]) => v.trim() !== '').map(([k, v]) => [k, Number(v)])),
    slots: slots.map(slotBody),
  });
  const save = async (publish: boolean) => {
    clear(); setErr(null);
    const own = checkPlan(isNew, member, title, summary, targets, slots);
    setErrs(own);
    if (Object.keys(own).length) { setErr(own.memberId ?? 'Check the fields marked below.'); return; }
    setBusy(true);
    try {
      let planId = id;
      if (isNew) { const r = await post<{ id: string }>('/coach/meal-plans', { memberId: member, ...body() }); planId = r.id; }
      else await patch(`/coach/meal-plans/${id}`, body());
      if (publish) { await post(`/coach/meal-plans/${planId}/publish`); ok('Meal plan published: the client has been told'); }
      else ok('Draft saved');
      notifyBadges();
      if (isNew) router.replace(`/coach/meal-plans/${planId}?saved=${publish ? 'published' : 'draft'}`); else void existing.reload();
    } catch (e) { setErrs(fieldErrorsOf(e)); setErr(errorText(e)); }
    finally { setBusy(false); }
  };
  const setSlot = (i: number, change: Partial<SlotDraft>) => setSlots((ss) => ss.map((s, k) => (k === i ? { ...s, ...change } : s)));
  const addSlot = (day: number) => setSlots((ss) => [...ss, { day, slot: 'lunch', timeHint: '', ref: '', title: '', portionNote: '' }]);
  const copyMonday = () => setSlots((ss) => { const mon = ss.filter((s) => s.day === 1); return [...mon, ...[2, 3, 4, 5, 6, 7].flatMap((d) => mon.map((s) => ({ ...s, day: d })))]; });

  if (!isNew && existing.loading && !p) return <Screen><Loading /></Screen>;
  const archived = p?.status === 'archived';
  const hasDraft = isNew || !!p?.hasDraft;
  const back = member ? `/coach/clients/${member}?tab=nutrition` : '/(coach)/clients';
  const statusPill = p ? libraryPill(p.status) : null;
  const slotOptions: FilterOption[] = SLOTS.map((s) => ({ value: s, label: SLOT_LABEL[s]! }));
  return <Screen refreshing={existing.loading || library.loading} onRefresh={() => { void existing.reload(); void library.reload(); }}>
    <StaleBanner at={existing.stale} />
    <ErrorBox error={existing.error} onRetry={existing.reload} />
    {!isNew && existing.error ? null : <>
      <Enter><View>
        <Button title="← Client" variant="ghost" small onPress={() => router.push(back)} style={{ alignSelf: 'flex-start', paddingHorizontal: 0 }} />
        <Title sub={isNew ? 'A draft until you publish it. Publishing shows it to the client and tells them.' : `${p?.memberName} · version ${p?.version?.version ?? p?.currentVersion} · ${p?.version?.status ?? p?.status}${p?.hasDraft && p.status === 'published' ? ' (the client still sees the last published version)' : ''}`}>{isNew ? 'New meal plan' : p?.title ?? 'Meal plan'}</Title>
      </View></Enter>
      <Enter index={1}><Row>
        {statusPill ? <Pill tone={statusPill.tone}>{statusPill.label}</Pill> : null}
        {!archived ? <Button title="Save draft" variant="secondary" small busy={busy} onPress={() => save(false)} /> : null}
        {!archived ? <Button title={hasDraft || isNew ? 'Publish' : 'Publish revision'} small busy={busy} onPress={() => save(true)} /> : null}
        {!isNew && !archived ? <Button title="Archive" variant="ghost" small onPress={() => setArchiving(true)} /> : null}
      </Row></Enter>
      {err ? <Notice kind="error">{err}</Notice> : null}
      {flash ? <Notice kind={flash.kind}>{flash.text}</Notice> : null}
      {archived ? <Notice kind="info" title="Archived">This plan is archived and no longer shown to the client. Start a new plan from the client record.</Notice> : null}
      <MotionCard index={2} pressable={false}><Card>
        <Eyebrow>Meal plan</Eyebrow><H2>Basics</H2>
        {isNew ? <SelectField label="Client" value={member} placeholder="Choose a client" searchable error={errs.memberId} options={(clients.data?.items ?? []).map((c) => ({ value: c.id, label: c.name, detail: c.memberCode ?? undefined }))} onChange={setMember} /> : null}
        <Field label="Title" error={errs.title}><Input value={title} onChangeText={setTitle} placeholder="e.g. Regular meals, weeks 1 to 4" editable={!archived} maxLength={160} accessibilityLabel="Title" /></Field>
        <Field label="Summary for the client" hint="Optional" error={errs.summary}><Input value={summary} onChangeText={setSummary} editable={!archived} multiline numberOfLines={3} style={{ minHeight: 72, textAlignVertical: 'top' }} maxLength={2000} accessibilityLabel="Summary for the client" /></Field>
        <Field label="Targets per day" hint="Optional. Only targets you agreed with the client; leave empty otherwise." error={errs.targets}>
          <View style={{ gap: space.sm }}>{TARGETS.map((t) => <Row key={t.key}><Text style={styles.targetLabel}>{`${t.label} (${t.unit})`}</Text><View style={{ flex: 1 }}><Input value={targets[t.key] ?? ''} onChangeText={(v) => setTargets((x) => ({ ...x, [t.key]: decimal(v) }))} keyboardType="decimal-pad" editable={!archived} accessibilityLabel={`${t.label} target`} /></View></Row>)}</View>
        </Field>
        <P muted small>Within your coaching scope: no diet-for-condition claims, no supplement or medical advice in a plan.</P>
      </Card></MotionCard>
      <MotionCard index={3} pressable={false}><Card>
        <Row between><View><Eyebrow>Week</Eyebrow><H2>{plural(slots.length, 'meal')}</H2></View>{!archived ? <Button title="Copy Monday to every day" variant="secondary" small disabled={!slots.some((s) => s.day === 1)} onPress={copyMonday} /> : null}</Row>
        {library.error ? <Notice kind="warning">{errorText(library.error)}</Notice> : null}
        {errs.slots ? <Notice kind="error">{errs.slots}</Notice> : null}
        {DAYS.map((day) => <View key={day} style={styles.dayTile}>
          <Row between><Text style={styles.dayName}>{DAY_LABEL[day]}</Text>{!archived ? <Button title="Add meal" variant="ghost" small onPress={() => addSlot(day)} /> : null}</Row>
          {slots.map((s, i) => s.day !== day ? null : <View key={i} style={styles.mealTile}>
            <Row>
              <View style={{ flex: 1 }}><SelectField compact label={`Meal ${i + 1} slot`} title="Meal" value={s.slot} options={slotOptions} onChange={(v) => setSlot(i, { slot: v })} disabled={archived} /></View>
              {!archived ? <Button title="✕" variant="ghost" small onPress={() => setSlots((ss) => ss.filter((_, k) => k !== i))} /> : null}
            </Row>
            <SelectField compact label={`Meal ${i + 1} food or recipe`} title="Food or recipe" value={s.ref} options={itemOptions} searchable onChange={(v) => setSlot(i, { ref: v })} disabled={archived} />
            <Input value={s.title} onChangeText={(v) => setSlot(i, { title: v })} placeholder={s.ref ? 'Name (optional)' : 'Name, e.g. Home-cooked dinner'} editable={!archived} maxLength={160} accessibilityLabel={`Meal ${i + 1} name`} />
            <Row>
              <View style={{ flex: 1 }}><Input value={s.timeHint} onChangeText={(v) => setSlot(i, { timeHint: v })} placeholder="Time" editable={!archived} maxLength={40} accessibilityLabel={`Meal ${i + 1} time`} /></View>
              <View style={{ flex: 2 }}><Input value={s.portionNote} onChangeText={(v) => setSlot(i, { portionNote: v })} placeholder="Portion note (optional)" editable={!archived} maxLength={300} accessibilityLabel={`Meal ${i + 1} portion note`} /></View>
            </Row>
          </View>)}
          {!slots.some((s) => s.day === day) ? <P muted small>No meals planned.</P> : null}
        </View>)}
        <P muted small>Foods and recipes come from the <Text accessibilityRole="link" onPress={() => router.push('/coach/nutrition-library')} style={styles.link}>nutrition library</Text>: published items and your own drafts.</P>
      </Card></MotionCard>
      {p?.version ? <MotionCard index={4} pressable={false}><Card>
        <Eyebrow>{`Version ${p.version.version} · entered values only`}</Eyebrow><H2>Totals per day</H2>
        <Totals version={p.version} />
        <P muted small>Totals follow the last saved draft; save to refresh them.</P>
      </Card></MotionCard> : null}
      {p ? <MotionCard index={5} pressable={false}><Card>
        <Eyebrow>Versions</Eyebrow><H2>History</H2>
        {p.versions.map((v) => <View key={v.id} style={styles.versionRow}><Text style={styles.versionTitle}>{`Version ${v.version} · ${v.status}${v.summary ? ` · ${v.summary}` : ''}`}</Text><Text style={styles.versionTime}>{fmtDateTime(v.publishedAt ?? v.createdAt)}</Text></View>)}
      </Card></MotionCard> : null}
    </>}
    {!isNew ? <ReasonSheet open={archiving} title="Archive this meal plan?" body="The client no longer sees it. The history stays." confirmLabel="Archive" destructive onClose={() => setArchiving(false)} onConfirm={async (reason) => { await post(`/coach/meal-plans/${id}/archive`, { reason }); clear(); ok('Meal plan archived'); notifyBadges(); void existing.reload(); }} /> : null}
  </Screen>;
}

/** The web's TotalsTable on a phone: one block per day with the entered totals, the target line and the server's note. */
function Totals({ version }: { version: NonNullable<MealPlan['version']> }) {
  const days = version.totals?.days ?? [];
  const targets = version.targets ?? {};
  const hasTargets = Object.keys(targets).length > 0;
  if (!days.length) return <P muted small>No totals: the plan has no meals yet.</P>;
  const fmt = (v: number | null | undefined) => (typeof v === 'number' ? String(v) : '—');
  return <View style={{ gap: space.sm }}>
    {days.map((d) => <View key={d.day} style={styles.totalsRow}>
      <Text style={styles.dayName}>{DAY_LABEL[d.day]}</Text>
      <Text style={styles.totalsLine}>{NUTRIENTS.map((n) => `${n.label} ${fmt(d[n.key])} ${n.unit}`).join(' · ')}</Text>
      <Text style={styles.totalsNote}>{d.complete ? 'All entered' : `${d.slotsMissingValues} of ${d.slots} meals without values`}</Text>
    </View>)}
    {hasTargets ? <View style={styles.totalsRow}><Text style={styles.dayName}>Target</Text><Text style={styles.totalsLine}>{NUTRIENTS.map((n) => `${n.label} ${fmt(targets[n.key])} ${n.unit}`).join(' · ')}</Text><Text style={styles.totalsNote}>Set by your coach</Text></View> : null}
    {version.totals?.note ? <P muted small>{version.totals.note}</P> : null}
  </View>;
}

const styles = StyleSheet.create({
  targetLabel: { color: colors.text, fontSize: font.small, width: 140 },
  dayTile: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: space.md, gap: space.sm, backgroundColor: colors.base },
  dayName: { color: colors.text, fontSize: font.body, fontWeight: '700' },
  mealTile: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: space.sm, gap: space.sm, backgroundColor: colors.surface },
  versionRow: { paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  versionTitle: { color: colors.text, fontSize: font.small },
  versionTime: { color: colors.muted, fontSize: font.tiny, marginTop: 2 },
  totalsRow: { paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 2 },
  totalsLine: { color: colors.text, fontSize: font.small },
  totalsNote: { color: colors.muted, fontSize: font.tiny },
  link: { color: colors.accentText, textDecorationLine: 'underline' },
});

