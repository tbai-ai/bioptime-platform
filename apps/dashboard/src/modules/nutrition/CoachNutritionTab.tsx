/* M5 Nutrition, coach workspace: the Nutrition tab of the client record (/coach/clients/:id?tab=nutrition). The coach's
   meal plans for the client always; the client's preferences, restrictions, meal logs, photos and adherence only while
   the client shares health records with the coach (the server withholds them otherwise and says so). */
import React, { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { fmtDate, label } from '../../lib/format';
import { Link } from '../../lib/nav';
import type { ClientRecordTabContext } from '../types';
import { Alert, Button, Card, CardHead, Dialog, Empty, Field, Input, Pill, Readout, Select, Skeleton, Textarea, errorText, useApi, useToast } from '../../ui';
import { DAY_LABEL, OUTCOME_LABEL, OUTCOME_PILL, RESTRICTION_KINDS, ROW_ACTIONS, SLOT_LABEL, fmtLocalDate, openPrivateFile, planDayOf, restrictionText, targetsLine } from './shared';

export function CoachNutritionTab({ memberId }: ClientRecordTabContext) {
  const view = useApi(() => api.get(`/coach/clients/${memberId}/nutrition`), [memberId]);
  const toast = useToast();
  const [feedbackFor, setFeedbackFor] = useState<any>(null);
  const [editProfile, setEditProfile] = useState(false);
  const d = view.data as any;
  if (view.error) return <Alert kind="error">{view.error}</Alert>;
  if (!d) return <Skeleton rows={5} />;
  const plans: any[] = d.plans ?? [];
  const logs: any[] = d.logs ?? [];
  const dates = Array.from(new Set(logs.map((l) => l.date)));
  const photo = async (l: any) => { try { await openPrivateFile(l.photoFileId); } catch (e) { toast(errorText(e), 'error'); } };
  return <div className="grid">
    <div className="span12"><Card><CardHead eyebrow="Meal plans" title={plans.length ? `${plans.length} plan${plans.length === 1 ? '' : 's'}` : 'No meal plan yet'} right={<Link className="bp-btn bp-btn-primary bp-btn-sm" to={`/meal-plans/new?member=${memberId}`}>New meal plan</Link>} />
      {plans.length ? <ul className="taskList">{plans.map((p) => <li key={p.id}><div><span>{p.title}</span><span className="muted">Version {p.currentVersion || 1}{p.hasDraft && p.status !== 'draft' ? ' · a revision is in draft' : ''} · {(p.version?.slots ?? []).length} meals · updated {fmtDate(p.updatedAt)}{targetsLine(p.version?.targets) ? ` · targets: ${targetsLine(p.version?.targets)}` : ''}</span></div><div className="row" style={ROW_ACTIONS}><Pill status={p.status} />{p.status !== 'archived' && <Link className="bp-btn bp-btn-secondary bp-btn-sm" to={`/meal-plans/${p.id}`}>{p.status === 'draft' ? 'Edit and publish' : 'Revise'}</Link>}</div></li>)}</ul>
        : <Empty title="No meal plan yet" body="Write a draft from the client's goals and preferences; publishing it tells the client." />}
    </Card></div>
    {d.withheld ? <div className="span12"><Card><Empty title="Meal log and preferences are private" body="Until this client shares their health records with you, their food preferences, restrictions, meal log, meal photos and adherence stay with them. You still see the plans you wrote. They can turn sharing on under Profile › Privacy and sharing." /></Card></div> : <>
      <div className="span4 stack">
        <Card dense><Readout eyebrow="Last 14 days" value={d.adherence?.pct ?? '—'} unit={d.adherence?.pct !== null && d.adherence?.pct !== undefined ? '%' : undefined} sub={d.adherence?.due ? `${d.adherence.done} of ${d.adherence.due} planned meals logged as planned or swapped` : 'No planned meals were due'} /><p className="muted small" style={{ marginTop: 6 }}>{d.adherence?.note}</p></Card>
        <Card><CardHead eyebrow="As the client told us" title="Preferences" right={<Button size="sm" onClick={() => setEditProfile(true)}>Edit</Button>} />
          <dl className="kv"><dt>Diet pattern</dt><dd>{d.profile?.dietPattern || '—'}</dd><dt>Restrictions</dt><dd>{(d.profile?.restrictions ?? []).map(restrictionText).join(', ') || '—'}</dd><dt>Dislikes</dt><dd>{(d.profile?.dislikes ?? []).join(', ') || '—'}</dd><dt>Cuisines</dt><dd>{(d.profile?.cuisines ?? []).join(', ') || '—'}</dd><dt>Meals a day</dt><dd>{d.profile?.mealsPerDay ?? '—'}</dd>{d.profile?.notes ? <><dt>Notes</dt><dd>{d.profile.notes}</dd></> : null}</dl>
          <p className="muted small" style={{ marginTop: 8 }}>Labels are the client's own words. Advice for a medical condition belongs with their doctor.</p>
        </Card>
      </div>
      <div className="span8"><Card><CardHead eyebrow={`${fmtLocalDate(d.range.from)} to ${fmtLocalDate(d.range.to)}`} title="Meal log" />
        {!logs.length ? <Empty title="Nothing logged in the last 14 days" /> : <div className="stack">{dates.map((date) => <div key={date}><h4>{DAY_LABEL[planDayOf(date)]} · {fmtLocalDate(date)}</h4><ul className="taskList">{logs.filter((l) => l.date === date).map((l) => <li key={l.id}>
          <div><span>{l.description}</span><span className="muted">{SLOT_LABEL[l.slot]}{l.note ? ` · ${l.note}` : ''}{l.source === 'coach' ? ' · entered by coach' : ''}</span>{(l.feedback ?? []).map((f: any) => <span key={f.id} className="small" style={{ color: 'var(--bp-color-text-primary)' }}>{f.coachName}: {f.body}</span>)}</div>
          <div className="row" style={ROW_ACTIONS}><Pill status={OUTCOME_PILL[l.outcome]}>{OUTCOME_LABEL[l.outcome]}</Pill>{l.hasPhoto && <Button size="sm" variant="tertiary" onClick={() => photo(l)}>Photo</Button>}<Button size="sm" variant="secondary" onClick={() => setFeedbackFor(l)}>Feedback</Button></div>
        </li>)}</ul></div>)}</div>}
      </Card></div>
    </>}
    <FeedbackDialog log={feedbackFor} onClose={() => setFeedbackFor(null)} onSaved={() => { setFeedbackFor(null); view.reload(); }} />
    {!d.withheld && <ProfileDialog open={editProfile} memberId={memberId} profile={d.profile} onClose={() => setEditProfile(false)} onSaved={() => { setEditProfile(false); view.reload(); }} />}
  </div>;
}

function FeedbackDialog({ log, onClose, onSaved }: { log: any; onClose: () => void; onSaved: () => void }) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const toast = useToast();
  useEffect(() => { if (log) { setBody(''); setErr(''); } }, [log]);
  const send = async () => { setBusy(true); setErr(''); try { await api.post(`/coach/meal-logs/${log.id}/feedback`, { body }); toast('Feedback sent to the client'); onSaved(); } catch (e) { setErr(errorText(e)); } finally { setBusy(false); } };
  return <Dialog open={!!log} onClose={onClose} title="Feedback on this meal" footer={<><Button variant="tertiary" onClick={onClose}>Not now</Button><Button variant="primary" busy={busy} disabled={body.trim().length < 2} onClick={send}>Send to the client</Button></>}>
    {log && <div className="form"><p className="small">{log.description} · {SLOT_LABEL[log.slot]} · {fmtLocalDate(log.date)} · {OUTCOME_LABEL[log.outcome]}</p>
      <Field label="Your feedback (the client reads it under Nutrition)"><Textarea value={body} onChange={(e) => setBody(e.target.value)} /></Field>
      <p className="muted small">The client is told there is feedback, without its text in the notification. Keep to your coaching scope: no medical or supplement advice.</p>
      {err && <Alert kind="error">{err}</Alert>}</div>}
  </Dialog>;
}

function ProfileDialog({ open, memberId, profile, onClose, onSaved }: { open: boolean; memberId: string; profile: any; onClose: () => void; onSaved: () => void }) {
  const [diet, setDiet] = useState('');
  const [restrictions, setRestrictions] = useState<Array<{ label: string; kind: string }>>([]);
  const [meals, setMeals] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const toast = useToast();
  useEffect(() => { if (open) { setDiet(profile?.dietPattern ?? ''); setRestrictions(profile?.restrictions ?? []); setMeals(profile?.mealsPerDay ? String(profile.mealsPerDay) : ''); setErr(''); } }, [open, profile]);
  const save = async () => { setBusy(true); setErr(''); try { await api.put(`/coach/clients/${memberId}/nutrition/profile`, { dietPattern: diet.trim() || null, restrictions: restrictions.filter((r) => r.label.trim()), mealsPerDay: meals ? Number(meals) : null }); toast('Preferences saved'); onSaved(); } catch (e) { setErr(errorText(e)); } finally { setBusy(false); } };
  return <Dialog open={open} onClose={onClose} title="Record the client's preferences" footer={<><Button variant="tertiary" onClick={onClose}>Not now</Button><Button variant="primary" busy={busy} onClick={save}>Save</Button></>}>
    <div className="form">
      <p className="small">Record what the client told you, in their words. They see and can change it.</p>
      <Field label="Diet pattern" optional><Input value={diet} onChange={(e) => setDiet(e.target.value)} /></Field>
      <div><span className="bp-label">Restrictions</span><div className="stack" style={{ marginTop: 6 }}>{restrictions.map((r, i) => <div key={i} className="row"><Input aria-label="Restriction" style={{ flex: '1 1 200px' }} value={r.label} onChange={(e) => setRestrictions((rs) => rs.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)))} /><Select aria-label="Kind of restriction" style={{ maxWidth: 150 }} value={r.kind} onChange={(e) => setRestrictions((rs) => rs.map((x, k) => (k === i ? { ...x, kind: e.target.value } : x)))}>{RESTRICTION_KINDS.map((k) => <option key={k} value={k}>{label(k)}</option>)}</Select><Button size="sm" variant="tertiary" aria-label="Remove restriction" onClick={() => setRestrictions((rs) => rs.filter((_, k) => k !== i))}>✕</Button></div>)}<div><Button size="sm" onClick={() => setRestrictions((rs) => [...rs, { label: '', kind: 'avoid' }])}>Add a restriction</Button></div></div></div>
      <Field label="Meals a day" optional><Select value={meals} onChange={(e) => setMeals(e.target.value)}><option value="">Not set</option>{[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}</Select></Field>
      {err && <Alert kind="error">{err}</Alert>}
    </div>
  </Dialog>;
}
