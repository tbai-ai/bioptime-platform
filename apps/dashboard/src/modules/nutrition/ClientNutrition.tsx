/* M5 Nutrition, member portal: /client/nutrition. Today's planned meals with one-tap logging, the week view of the
   published plan with the totals of the entered values, the meal history with photos and the coach's feedback, and the
   member's own preferences and restrictions (in their own words). */
import React, { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { fmtDate, fmtDateTime, label } from '../../lib/format';
import { Alert, Button, Card, CardHead, ConfirmDialog, Dialog, Empty, Field, Input, Pill, Readout, Select, Skeleton, Tabs, Textarea, errorText, useApi, useToast } from '../../ui';
import { DAY_LABEL, OUTCOMES, OUTCOME_LABEL, OUTCOME_PILL, RESTRICTION_KINDS, ROW_ACTIONS, SLOTS, SLOT_LABEL, TotalsTable, WeekView, fileToBase64, fmtLocalDate, openPrivateFile, planDayOf, restrictionText, shiftDate, slotSource, targetsLine } from './shared';

type Tab = 'today' | 'plan' | 'history' | 'preferences';

export function ClientNutrition() {
  const [tab, setTab] = useState<Tab>('today');
  const home = useApi(() => api.get('/me/nutrition'), []);
  const [logFor, setLogFor] = useState<{ slot?: any; outcome?: string } | null>(null);
  const d = home.data as any;
  return <div className="stack">
    <div className="pageHead"><div><h1>Nutrition</h1><p className="sub">The meal plan your coach wrote, what you ate, and your coach’s feedback. Nothing here is calculated from a photo.</p></div><div className="actions"><Button variant="primary" onClick={() => setLogFor({})} disabled={!d}>Log a meal</Button></div></div>
    {home.error && <Alert kind="error">{home.error}</Alert>}
    {!d && !home.error && <Skeleton rows={6} />}
    {d && <Tabs items={[{ id: 'today', label: 'Today' }, { id: 'plan', label: 'Meal plan' }, { id: 'history', label: 'History' }, { id: 'preferences', label: 'Preferences' }]} value={tab} onChange={setTab} label="Nutrition">
      {tab === 'today' && <Today d={d} onLog={(slot, outcome) => setLogFor({ slot, outcome })} reload={home.reload} />}
      {tab === 'plan' && <PlanTab d={d} />}
      {tab === 'history' && <History today={d.today} photos={d.photos} />}
      {tab === 'preferences' && <Preferences profile={d.profile} onSaved={home.reload} />}
    </Tabs>}
    {d && <LogDialog open={!!logFor} onClose={() => setLogFor(null)} today={d.today} plan={d.plan} preset={logFor} onSaved={() => { setLogFor(null); home.reload(); }} />}
  </div>;
}

function Today({ d, onLog, reload }: { d: any; onLog: (slot: any, outcome?: string) => void; reload: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const logs: any[] = d.todayLogs ?? [];
  const logged = (slotId: string) => logs.find((l) => l.slotId === slotId);
  const quick = async (slot: any, outcome: 'as_planned' | 'skipped') => {
    setBusy(slot.id);
    try { await api.post('/me/meal-logs', { date: d.today, slotId: slot.id, outcome }); toast(outcome === 'as_planned' ? 'Logged as planned' : 'Logged as skipped'); reload(); }
    catch (e) { toast(errorText(e), 'error'); } finally { setBusy(''); }
  };
  const extras = logs.filter((l) => !l.slotId);
  const a = d.adherence;
  return <div className="grid">
    <div className="span8"><Card><CardHead eyebrow={`${DAY_LABEL[d.day]} · ${fmtDate(`${d.today}T06:00:00Z`)}`} title="Today’s meals" />
      {!d.plan ? <Empty title="No meal plan yet" body="Your coach writes it after talking with you; you are told here when it is ready. You can still log what you eat." /> : d.todaySlots.length === 0 ? <p className="muted">Your plan has no meals for today.</p> : <ul className="taskList">{d.todaySlots.map((s: any) => { const l = logged(s.id); return <li key={s.id}>
        <div><span className={l ? 'done' : ''}>{s.title}</span><span className="muted">{SLOT_LABEL[s.slot]}{s.timeHint ? ` · ${s.timeHint}` : ''}{s.portionNote ? ` · ${s.portionNote}` : ''}</span>{slotSource(s) && <span className="muted">{slotSource(s)}</span>}</div>
        <div className="row" style={ROW_ACTIONS}>{l ? <Pill status={OUTCOME_PILL[l.outcome]}>{OUTCOME_LABEL[l.outcome]}</Pill> : <>
          <Button size="sm" variant="secondary" busy={busy === s.id} onClick={() => quick(s, 'as_planned')}>As planned</Button>
          <Button size="sm" variant="tertiary" disabled={!!busy} onClick={() => onLog(s, 'swapped')}>Swapped</Button>
          <Button size="sm" variant="tertiary" disabled={!!busy} onClick={() => quick(s, 'skipped')}>Skipped</Button></>}</div>
      </li>; })}</ul>}
      {extras.length > 0 && <><h4 style={{ marginTop: 14 }}>Also today</h4><ul className="taskList">{extras.map((l) => <li key={l.id}><div><span>{l.description}</span><span className="muted">{SLOT_LABEL[l.slot]}</span></div><Pill status={OUTCOME_PILL[l.outcome]}>{OUTCOME_LABEL[l.outcome]}</Pill></li>)}</ul></>}
    </Card></div>
    <div className="span4 stack">
      <Card dense><Readout eyebrow="Last 7 days" value={a?.pct ?? '—'} unit={a?.pct !== null && a?.pct !== undefined ? '%' : undefined} sub={a?.due ? `${a.done} of ${a.due} planned meals logged as planned or swapped` : 'No planned meals were due'} /><p className="muted small" style={{ marginTop: 6 }}>{a?.note}</p></Card>
      {logs.some((l) => l.feedback?.length) && <Card accent><CardHead eyebrow="From your coach" title="Feedback today" /><ul className="timeline">{logs.flatMap((l) => (l.feedback ?? []).map((f: any) => <li key={f.id} className="done"><div>{f.body}</div><time>{f.coachName} · {l.description}</time></li>))}</ul></Card>}
    </div>
  </div>;
}

function PlanTab({ d }: { d: any }) {
  const p = d.plan;
  if (!p) return <Card><Empty title="No meal plan yet" body="Your coach writes it after talking with you; you are told here when it is ready." /></Card>;
  const v = p.version;
  const t = targetsLine(v?.targets);
  return <div className="stack">
    <Card><CardHead eyebrow={`Version ${v?.version ?? p.currentVersion} · by ${p.coachName}`} title={p.title} right={<Pill status={p.status} />} />{v?.summary && <p className="small">{v.summary}</p>}{t ? <p className="small" style={{ marginTop: 8 }}><b>Targets your coach set:</b> {t}</p> : <p className="muted small" style={{ marginTop: 8 }}>No energy or macro targets are set in this plan.</p>}</Card>
    <Card><CardHead eyebrow="Week" title="Your meals by day" /><WeekView slots={v?.slots ?? []} today={d.day} /></Card>
    <Card><CardHead eyebrow="Entered values" title="Totals per day" /><TotalsTable totals={v?.totals} targets={v?.targets} /></Card>
  </div>;
}

function History({ today, photos }: { today: string; photos: { available: boolean; missing?: string } }) {
  const [from, setFrom] = useState(shiftDate(today, -13));
  const logs = useApi(() => api.get(`/me/meal-logs?from=${from}&to=${today}`), [from, today]);
  const toast = useToast();
  const [del, setDel] = useState<any>(null);
  const [busy, setBusy] = useState('');
  const items: any[] = (logs.data as any)?.items ?? [];
  const dates = Array.from(new Set(items.map((l) => l.date)));
  const upload = async (log: any, file: File | undefined) => {
    if (!file) return;
    setBusy(log.id);
    try { await api.post(`/me/meal-logs/${log.id}/photo`, { filename: file.name, dataBase64: await fileToBase64(file) }); toast('Photo added'); logs.reload(); }
    catch (e) { toast(errorText(e), 'error'); } finally { setBusy(''); }
  };
  const removePhoto = async (log: any) => { setBusy(log.id); try { await api.del(`/me/meal-logs/${log.id}/photo`); toast('Photo removed'); logs.reload(); } catch (e) { toast(errorText(e), 'error'); } finally { setBusy(''); } };
  const view = async (log: any) => { try { await openPrivateFile(log.photoFileId); } catch (e) { toast(errorText(e), 'error'); } };
  return <div className="stack">
    <div className="row between"><Field label="Show from"><Select value={from} onChange={(e) => setFrom(e.target.value)}>{[6, 13, 29, 59].map((n) => <option key={n} value={shiftDate(today, -n)}>The last {n + 1} days</option>)}</Select></Field></div>
    {!photos.available && <Alert kind="info" title="Meal photos are not available yet">{photos.missing}</Alert>}
    {logs.error && <Alert kind="error">{logs.error}</Alert>}
    {!logs.data && !logs.error && <Skeleton rows={4} />}
    {logs.data && !items.length && <Card><Empty title="Nothing logged in this period" body="Use Log a meal, or the buttons on Today." /></Card>}
    {dates.map((date) => <Card key={date}><CardHead eyebrow={DAY_LABEL[planDayOf(date)]} title={fmtLocalDate(date)} />
      <ul className="taskList">{items.filter((l) => l.date === date).map((l) => <li key={l.id}>
        <div><span>{l.description}</span><span className="muted">{SLOT_LABEL[l.slot]}{l.note ? ` · ${l.note}` : ''}</span>
          {(l.feedback ?? []).map((f: any) => <span key={f.id} className="small" style={{ color: 'var(--bp-color-text-primary)' }}>{f.coachName}: {f.body}</span>)}</div>
        <div className="row" style={ROW_ACTIONS}><Pill status={OUTCOME_PILL[l.outcome]}>{OUTCOME_LABEL[l.outcome]}</Pill>
          {l.hasPhoto ? <><Button size="sm" variant="tertiary" onClick={() => view(l)}>View photo</Button><Button size="sm" variant="tertiary" busy={busy === l.id} onClick={() => removePhoto(l)}>Remove photo</Button></>
            : photos.available && <label className="bp-btn bp-btn-tertiary bp-btn-sm" aria-busy={busy === l.id || undefined}>Add photo<input className="sr" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => { void upload(l, e.target.files?.[0]); e.target.value = ''; }} /></label>}
          <Button size="sm" variant="tertiary" onClick={() => setDel(l)} aria-label={`Delete ${l.description}`}>Delete</Button></div>
      </li>)}</ul>
    </Card>)}
    <p className="muted small">Photos are private: only you, and your coach while you share health records with them, can open them, through a link that lasts five minutes.</p>
    <ConfirmDialog open={!!del} onClose={() => setDel(null)} title="Delete this entry?" body={del ? `${del.description} (${fmtLocalDate(del.date)}). Its photo is deleted too.` : ''} confirmLabel="Delete" danger onConfirm={async () => { await api.del(`/me/meal-logs/${del.id}`); toast('Entry deleted'); logs.reload(); }} />
  </div>;
}

function Preferences({ profile, onSaved }: { profile: any; onSaved: () => void }) {
  const toast = useToast();
  const [diet, setDiet] = useState(profile?.dietPattern ?? '');
  const [restrictions, setRestrictions] = useState<Array<{ label: string; kind: string }>>(profile?.restrictions ?? []);
  const [dislikes, setDislikes] = useState((profile?.dislikes ?? []).join(', '));
  const [cuisines, setCuisines] = useState((profile?.cuisines ?? []).join(', '));
  const [meals, setMeals] = useState(profile?.mealsPerDay ? String(profile.mealsPerDay) : '');
  const [notes, setNotes] = useState(profile?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
  const save = async () => {
    setBusy(true); setErr('');
    try { await api.put('/me/nutrition/profile', { dietPattern: diet.trim() || null, restrictions: restrictions.filter((r) => r.label.trim()), dislikes: list(dislikes), cuisines: list(cuisines), mealsPerDay: meals ? Number(meals) : null, notes }); toast('Preferences saved'); onSaved(); }
    catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  return <div className="grid">
    <div className="span8"><Card><CardHead eyebrow="In your own words" title="Food preferences and restrictions" /><div className="form">
      <Field label="Diet pattern" optional hint="For example vegetarian, eggetarian, Jain, no restrictions."><Input value={diet} onChange={(e) => setDiet(e.target.value)} /></Field>
      <div><span className="bp-label">Restrictions</span><div className="stack" style={{ marginTop: 6 }}>{restrictions.map((r, i) => <div key={i} className="row"><Input aria-label="Restriction" style={{ flex: '1 1 220px' }} value={r.label} onChange={(e) => setRestrictions((rs) => rs.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)))} placeholder="What to avoid" /><Select aria-label="Kind of restriction" style={{ maxWidth: 160 }} value={r.kind} onChange={(e) => setRestrictions((rs) => rs.map((x, k) => (k === i ? { ...x, kind: e.target.value } : x)))}>{RESTRICTION_KINDS.map((k) => <option key={k} value={k}>{label(k)}</option>)}</Select><Button size="sm" variant="tertiary" aria-label="Remove restriction" onClick={() => setRestrictions((rs) => rs.filter((_, k) => k !== i))}>✕</Button></div>)}<div><Button size="sm" onClick={() => setRestrictions((rs) => [...rs, { label: '', kind: 'avoid' }])}>Add a restriction</Button></div></div></div>
      <Field label="Dislikes (comma separated)" optional><Input value={dislikes} onChange={(e) => setDislikes(e.target.value)} /></Field>
      <Field label="Cuisines you enjoy (comma separated)" optional><Input value={cuisines} onChange={(e) => setCuisines(e.target.value)} /></Field>
      <Field label="Meals a day" optional><Select value={meals} onChange={(e) => setMeals(e.target.value)}><option value="">Not set</option>{[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}</Select></Field>
      <Field label="Anything else for your coach" optional><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      {err && <Alert kind="error">{err}</Alert>}
      <div className="row"><Button variant="primary" busy={busy} onClick={save}>Save preferences</Button></div>
    </div></Card></div>
    <div className="span4"><Card><CardHead eyebrow="Who sees this" title="Your coach, with your consent" /><p className="small">Your coach sees these preferences and your meal log only while you share health records with them (Profile › Privacy and sharing). Labels are your own words: Bioptime keeps no medical list of foods.</p>{profile?.updatedAt && <p className="muted small" style={{ marginTop: 8 }}>Last changed {fmtDateTime(profile.updatedAt)}{profile.updatedByRole === 'coach' ? ' by your coach' : ''}.</p>}{restrictions.length > 0 && <p className="small" style={{ marginTop: 8 }}>{restrictions.filter((r) => r.label.trim()).map(restrictionText).join(', ')}</p>}</Card></div>
  </div>;
}

/** Log a meal: a planned meal of the chosen day (as planned, swapped or skipped) or an extra one. */
function LogDialog({ open, onClose, today, plan, preset, onSaved }: { open: boolean; onClose: () => void; today: string; plan: any; preset: { slot?: any; outcome?: string } | null; onSaved: () => void }) {
  const [date, setDate] = useState(today);
  const [slotId, setSlotId] = useState('');
  const [slot, setSlot] = useState('lunch');
  const [outcome, setOutcome] = useState('as_planned');
  const [description, setDescription] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const toast = useToast();
  useEffect(() => { if (open) { setDate(today); setSlotId(preset?.slot?.id ?? ''); setSlot(preset?.slot?.slot ?? 'lunch'); setOutcome(preset?.outcome ?? (preset?.slot ? 'as_planned' : 'extra')); setDescription(''); setNote(''); setErr(''); } }, [open, preset, today]);
  const planned: any[] = (plan?.version?.slots ?? []).filter((s: any) => s.day === planDayOf(date));
  const outcomes = slotId ? OUTCOMES.filter((o) => o !== 'extra') : OUTCOMES;
  const save = async () => {
    setBusy(true); setErr('');
    try { await api.post('/me/meal-logs', { date, outcome, ...(slotId ? { slotId } : { slot }), ...(description.trim() ? { description: description.trim() } : {}), ...(note.trim() ? { note: note.trim() } : {}) }); toast('Meal logged'); onSaved(); }
    catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  return <Dialog open={open} onClose={onClose} title="Log a meal" footer={<><Button variant="tertiary" onClick={onClose}>Not now</Button><Button variant="primary" busy={busy} onClick={save}>Save</Button></>}>
    <div className="form">
      <Field label="Day"><Input type="date" value={date} max={today} min={shiftDate(today, -60)} onChange={(e) => { setDate(e.target.value); setSlotId(''); }} /></Field>
      {planned.length > 0 && <Field label="Planned meal" optional hint="Pick one to log against your plan, or leave it for an extra meal."><Select value={slotId} onChange={(e) => { setSlotId(e.target.value); if (e.target.value && outcome === 'extra') setOutcome('as_planned'); }}><option value="">Not a planned meal</option>{planned.map((s) => <option key={s.id} value={s.id}>{SLOT_LABEL[s.slot]} · {s.title}</option>)}</Select></Field>}
      {!slotId && <Field label="Meal"><Select value={slot} onChange={(e) => setSlot(e.target.value)}>{SLOTS.map((s) => <option key={s} value={s}>{SLOT_LABEL[s]}</option>)}</Select></Field>}
      <div><span className="bp-label">What happened</span><div className="bp-seg" role="group" aria-label="What happened" style={{ marginTop: 6 }}>{outcomes.map((o) => <button key={o} type="button" aria-pressed={outcome === o} onClick={() => setOutcome(o)}>{OUTCOME_LABEL[o]}</button>)}</div></div>
      <Field label={outcome === 'swapped' ? 'What you ate instead' : outcome === 'skipped' ? 'Why you skipped' : 'What you ate'} optional={!!slotId && outcome !== 'swapped'} hint={slotId && outcome !== 'swapped' ? 'Leave empty to use the planned meal’s name.' : undefined}><Input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      <Field label="Note" optional><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <p className="muted small">Add a photo from History after saving. Nothing is estimated from what you write or photograph.</p>
      {err && <Alert kind="error">{err}</Alert>}
    </div>
  </Dialog>;
}
