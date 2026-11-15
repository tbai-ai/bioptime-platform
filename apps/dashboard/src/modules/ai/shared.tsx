/* Coach AI in the portal: the shapes the API returns, the "not configured" state, AiDraftPanel, the draft-and-review
   panel the Coach AI page and the client-record tab use, and AiDraftInline, the same panel placed in the coach's
   Messages thread (a reply draft) and plan editor (a plan outline) for the client on screen. Those two pages load it
   lazily, only for a coach while the 'ai' module is on, so members and administrators never download it.

   Drafts are never sent: the coach edits a draft and accepts it with their own final text. On the Coach AI page and the
   client tab it is then copied for them to paste; in Messages and the plan editor it is put into the page's own field
   (the reply box, the plan summary), where the coach still presses Send or saves the plan. With no AI provider
   configured, every request comes back as "Coach AI is not configured" with what is missing; nothing is made up in its
   place. */
import React, { useEffect, useState } from 'react';
import { api, ApiRequestError, qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Link } from '../../lib/nav';
import { fmtDateTime, fmtDate } from '../../lib/format';
import { Alert, Button, Card, CardHead, ConfirmDialog, Empty, Field, Select, Skeleton, Textarea, useApi, useToast, errorText } from '../../ui';

export type AiPurpose = 'message_reply' | 'plan_outline' | 'checkin_response' | 'meal_plan_outline' | 'workout_outline';
export type Requirement = { key: string; label: string };
export type PurposeInfo = { purpose: AiPurpose; label: string; hint: string; needsMember: boolean; available: boolean; unavailableReason: string | null };
export type CoachStatus = {
  configured: boolean; provider: string; model: string | null; missing: Requirement[]; retentionDays: number | null; promptVersion: string; purposes: PurposeInfo[]; rules: string[]; perHour: number;
  member: null | {
    id: string; name: string; inAudience?: boolean; aiConsent: { granted: boolean; earlierWording?: boolean; version: string | null; at: string | null }; healthShared: boolean;
    sources: { conversation: { id: string; messages: number } | null; plans: Array<{ id: string; title: string; status: string; updatedAt: string }>; checkins: Array<{ id: string; title: string; dueDate: string; status: string }> };
  };
};
export type DraftStatus = 'requested' | 'ready' | 'failed' | 'accepted' | 'discarded';
export type Draft = {
  id: string; purpose: AiPurpose; purposeLabel: string; memberId: string | null; memberName: string | null; status: DraftStatus; output: string | null; finalText: string | null;
  inputRefs: Array<{ type: string; id: string }>; contextScope: { client?: boolean; messages?: number; plan?: boolean; checkin?: boolean; checkinAnswers?: boolean; health?: boolean; progressValues?: number };
  promptVersion: string; provider: string; model: string | null; error: string | null; createdAt: string; updatedAt: string; acceptedAt: string | null; discardedAt: string | null; label: string;
};

const STATUS: Record<DraftStatus, [string, string]> = {
  requested: ['Waiting', 'bp-pill-warning'], ready: ['Ready to review', 'bp-pill-info'], failed: ['Failed', 'bp-pill-error'], accepted: ['Accepted', 'bp-pill-success'], discarded: ['Discarded', 'bp-pill-neutral'],
};
export function DraftPill({ status }: { status: DraftStatus }) { const [text, cls] = STATUS[status]; return <span className={`bp-pill ${cls}`}>{text}</span>; }

/** The exact list of what is missing, as the server names it. */
export function MissingList({ items }: { items: Requirement[] }) {
  if (!items.length) return null;
  return <ul className="taskList" style={{ marginTop: 8 }}>{items.map((m) => <li key={m.key}><span className="small">{m.label}</span></li>)}</ul>;
}

/** "Coach AI is not configured": the server's own wording and its list of missing requirements. */
export function NotConfigured({ missing, title = 'Coach AI is not configured', children }: { missing: Requirement[]; title?: string; children?: React.ReactNode }) {
  return <Alert kind="warning" title={title}>
    {children ?? 'No draft can be made until each of these is in place. Nothing is generated in the meantime.'}
    <MissingList items={missing} />
  </Alert>;
}

/** What went into a draft, in words (sections and counts only; the content itself is never stored). */
export function scopeText(d: Draft): string {
  const s = d.contextScope;
  const parts = [s.client ? 'client profile (no contact details)' : 'no client details', s.messages ? `${s.messages} recent message${s.messages === 1 ? '' : 's'}` : '', s.plan ? 'current plan' : '', s.checkin ? (s.checkinAnswers ? 'check-in with answers' : 'check-in questions only') : '', s.progressValues ? `${s.progressValues} logged value${s.progressValues === 1 ? '' : 's'}` : ''].filter(Boolean);
  return `Built from: ${parts.join(', ')}.`;
}

async function copy(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

/** Where an accepted draft goes on the page that shows the panel: `set` is that page's own field setter (the reply box,
 *  the plan summary), and the coach's final text is added to the field with withDraft and nothing else happens; the
 *  coach still sends or saves it themselves. */
export type DraftUse = {
  /** the button on a ready draft, e.g. "Accept and put in your reply" */
  accept: string;
  /** the button on an accepted draft, e.g. "Put in your reply" */
  again: string;
  /** what the toast says once the text is in place, e.g. "It is in your reply box above. Nothing is sent until you press Send." */
  done: string;
  set: (update: (current: string) => string) => void;
};

/** The page field's text with an accepted draft added: the draft alone in an empty field, otherwise after what the
 *  coach already wrote, separated by a blank line (nothing they wrote is replaced). */
export function withDraft(current: string, text: string): string {
  const add = text.trim();
  if (!add) return current;
  return current.trim() ? `${current.trimEnd()}\n\n${add}` : add;
}

/** One draft: review and edit a ready one, accept it with your own text (then copy it, or put it in the page's field
 *  when `use` is given), or discard it. */
export function DraftCard({ d, onChange, use }: { d: Draft; onChange: () => void; use?: DraftUse }) {
  const toast = useToast();
  const [text, setText] = useState(d.output ?? '');
  const [busy, setBusy] = useState(false);
  const [discard, setDiscard] = useState(false);
  const accept = async () => {
    setBusy(true);
    try {
      const r = await api.post<Draft>(`/coach/ai/drafts/${d.id}/accept`, { finalText: text });
      const final = r.finalText ?? text;
      if (use) { use.set((current) => withDraft(current, final)); toast(`Accepted. ${use.done}`); }
      else {
        const copied = await copy(final);
        toast(copied ? 'Accepted and copied. Paste it where you send it; nothing was sent.' : 'Accepted. Copy the text below; nothing was sent.');
      }
      onChange();
    } catch (e) { toast(errorText(e), 'error'); } finally { setBusy(false); }
  };
  const where = d.purpose === 'message_reply' ? <Link to="/messages">Messages</Link> : d.memberId ? <Link to={`/clients/${d.memberId}?tab=plan`}>the client’s plan</Link> : null;
  return <Card>
    <CardHead eyebrow={`${d.purposeLabel}${d.memberName ? ` · ${d.memberName}` : ' · general'}`} title={fmtDateTime(d.createdAt)} right={<DraftPill status={d.status} />} />
    <p className="muted">{d.label} {scopeText(d)}</p>
    {d.status === 'ready' && <div className="stack" style={{ marginTop: 10 }}>
      <Field label="Draft (edit it before you use it)"><Textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} /></Field>
      <div className="row">
        <Button variant="primary" size="sm" busy={busy} disabled={!text.trim()} onClick={accept}>{use ? use.accept : 'Accept and copy'}</Button>
        <Button variant="tertiary" size="sm" onClick={() => setDiscard(true)}>Discard</Button>
      </div>
    </div>}
    {d.status === 'accepted' && <div className="stack" style={{ marginTop: 10 }}>
      <Field label={`Your final text, accepted ${fmtDate(d.acceptedAt)}`}><Textarea rows={6} readOnly value={d.finalText ?? ''} /></Field>
      <div className="row">
        {use && d.finalText && <Button variant="primary" size="sm" onClick={() => { const final = d.finalText ?? ''; use.set((current) => withDraft(current, final)); toast(use.done); }}>{use.again}</Button>}
        <Button size="sm" onClick={async () => toast((await copy(d.finalText ?? '')) ? 'Copied' : 'Copy did not work here; select the text instead', 'ok')}>Copy</Button>
        {where && !use && <span className="small">Send it yourself from {where}.</span>}
      </div>
    </div>}
    {d.status === 'failed' && <div className="stack" style={{ marginTop: 10 }}>
      <Alert kind="error" title="No draft">{d.error ?? 'The provider did not return a draft.'}</Alert>
      <div className="row"><Button variant="tertiary" size="sm" onClick={() => setDiscard(true)}>Discard</Button></div>
    </div>}
    {d.status === 'discarded' && <p className="small" style={{ marginTop: 8 }}>Discarded {fmtDateTime(d.discardedAt)}{d.error ? `: ${d.error}` : ''}. Its text was cleared.</p>}
    <ConfirmDialog open={discard} onClose={() => setDiscard(false)} title="Discard this draft?" confirmLabel="Discard" danger note="Why (optional, recorded in the audit log)"
      body="Its text is cleared at once. Nothing was sent to the client."
      onConfirm={async (note) => { await api.post(`/coach/ai/drafts/${d.id}/discard`, note ? { reason: note } : {}); toast('Discarded'); onChange(); }} />
  </Card>;
}

type Refusal = { code: string; message: string; missing: Requirement[] };

/** Ask for a draft for one client (or a general outline), then review the drafts. With a fixed purpose there is no
 *  choice of draft and only that purpose's drafts are listed; `use` puts an accepted draft into the host page's field. */
export function AiDraftPanel({ memberId, purpose: fixedPurpose, showDrafts = true, use }: { memberId?: string | null; purpose?: AiPurpose; showDrafts?: boolean; use?: DraftUse }) {
  const toast = useToast();
  const status = useApi(() => api.get<CoachStatus>(`/coach/ai/status${qs({ memberId: memberId ?? undefined })}`), [memberId]);
  const drafts = useApi(() => api.get<{ items: Draft[]; retentionDays: number | null }>(`/coach/ai/drafts${qs({ memberId: memberId ?? undefined })}`), [memberId]);
  const [purpose, setPurpose] = useState<AiPurpose | ''>(fixedPurpose ?? '');
  const [checkinId, setCheckinId] = useState('');
  const [planId, setPlanId] = useState('');
  const [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const s = status.data;
  if (status.error) return <Alert kind="error">{status.error}</Alert>;
  if (!s) return <Skeleton rows={5} />;
  const purposes = s.purposes.filter((p) => memberId || !p.needsMember);
  const chosen = purposes.find((p) => p.purpose === purpose) ?? null;
  const isOutline = purpose === 'plan_outline' || purpose === 'meal_plan_outline' || purpose === 'workout_outline';
  const m = s.member;
  const listed = drafts.data ? drafts.data.items.filter((d) => !fixedPurpose || d.purpose === fixedPurpose) : null;

  const ask = async () => {
    if (!purpose) { setFieldErr({ purpose: 'Choose what to draft' }); return; }
    setBusy(true); setRefusal(null); setFieldErr({});
    try {
      const d = await api.post<Draft>('/coach/ai/drafts', { purpose, ...(memberId ? { memberId } : {}), ...(purpose === 'checkin_response' && checkinId ? { checkinId } : {}), ...(isOutline && planId ? { planId } : {}), ...(instructions.trim() ? { instructions: instructions.trim() } : {}) });
      toast(d.status === 'ready' ? 'Draft ready to review' : 'The request finished without a draft', d.status === 'ready' ? 'ok' : 'error');
      setInstructions('');
      drafts.reload();
    } catch (e) {
      if (e instanceof ApiRequestError && e.code === 'VALIDATION_FAILED' && Array.isArray(e.details)) {
        const out: Record<string, string> = {};
        for (const i of e.details as Array<{ path: string; message: string }>) { const k = String(i.path ?? '').split('.')[0] || 'form'; if (!out[k]) out[k] = i.message; }
        setFieldErr(out);
      } else if (e instanceof ApiRequestError && (['AI_NOT_CONFIGURED', 'AI_CONSENT_REQUIRED'].includes(e.code) || (e.code === 'FEATURE_DISABLED' && (((e.details as { missing?: Requirement[] } | undefined)?.missing) ?? []).some((x) => x.key === 'member_audience')))) {
        setRefusal({ code: e.code, message: e.message, missing: ((e.details as { missing?: Requirement[] } | undefined)?.missing) ?? [] });
      } else toast(errorText(e), 'error');
      status.reload();
    } finally { setBusy(false); }
  };

  return <div className="stack">
    {!s.configured && <NotConfigured missing={s.missing}>Drafting is set up and audited, but no draft can be made until each of these is in place. Nothing is generated in the meantime.</NotConfigured>}
    {m && <Card dense>
      <dl className="kv">
        {m.inAudience === false && <><dt>Coach AI for this client</dt><dd>Switched off: the module’s audience leaves them out, so no draft can use their details</dd></>}
        <dt>Coach AI consent</dt><dd>{m.aiConsent.granted ? `Given ${fmtDate(m.aiConsent.at)}${m.aiConsent.version?.includes('draft') ? ' under the draft wording, pending review by counsel' : ''}` :m.aiConsent.earlierWording ? `Given ${fmtDate(m.aiConsent.at)} under an earlier wording: not used until they agree to the current one` : 'Not given: no draft can use this client’s details'}</dd>
        <dt>Health records</dt><dd>{m.healthShared ? (m.aiConsent.granted ? 'Shared: logged values and check-in answers can be included' : 'Shared with you, but not for Coach AI') : 'Not shared: no values or check-in answers are included'}</dd>
        <dt>Never taken from the profile</dt><dd>Phone, email, address, PIN code, date of birth. Messages and your instructions are sent as written.</dd>
      </dl>
    </Card>}
    <Card>
      <CardHead eyebrow={memberId ? 'Ask for a draft' : 'Ask for a draft (no client)'} title={chosen ? chosen.label : 'What should Coach AI draft?'} />
      <div className="form">
        {!fixedPurpose && <Field label="Draft" error={fieldErr.purpose} hint={chosen?.hint}>
          <Select value={purpose} onChange={(e) => { setPurpose(e.target.value as AiPurpose | ''); setFieldErr({}); setRefusal(null); }}>
            <option value="">Choose…</option>
            {purposes.map((p) => <option key={p.purpose} value={p.purpose} disabled={!p.available}>{p.label}{p.available ? '' : ` (${p.unavailableReason})`}</option>)}
          </Select>
        </Field>}
        {fixedPurpose && <p className="small">{chosen ? (chosen.available ? chosen.hint : chosen.unavailableReason) : 'This kind of draft needs a client.'}</p>}
        {fixedPurpose && fieldErr.purpose && <Alert kind="error">{fieldErr.purpose}</Alert>}
        {purpose === 'checkin_response' && <Field label="Check-in" error={fieldErr.checkinId}>
          <Select value={checkinId} onChange={(e) => setCheckinId(e.target.value)}>
            <option value="">Choose…</option>
            {(m?.sources.checkins ?? []).map((c) => <option key={c.id} value={c.id}>{c.title} · due {fmtDate(`${c.dueDate}T12:00:00Z`)} · {c.status}</option>)}
          </Select>
        </Field>}
        {isOutline && m && m.sources.plans.length > 0 && <Field label="Start from a plan" optional error={fieldErr.planId}>
          <Select value={planId} onChange={(e) => setPlanId(e.target.value)}>
            <option value="">The most recent plan</option>
            {m.sources.plans.map((p) => <option key={p.id} value={p.id}>{p.title} ({p.status})</option>)}
          </Select>
        </Field>}
        {purpose === 'message_reply' && m && <p className="small">{m.sources.conversation ? `Uses the last messages of your conversation (${m.sources.conversation.messages} so far).` : 'You have no conversation with this client yet.'}</p>}
        <Field label="Your instructions" optional error={fieldErr.instructions} hint="Used for this request only and not stored. Leave out contact details.">
          <Textarea rows={3} maxLength={2000} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
        </Field>
        {refusal && (refusal.code === 'AI_NOT_CONFIGURED'
          ? <Alert kind="warning" title="Request refused">Coach AI is not configured, so nothing was generated. What is missing is listed at the top of this panel.</Alert>
          : <Alert kind="warning" title={refusal.code === 'FEATURE_DISABLED' ? 'Coach AI is off for this client' : 'Consent needed'}>{refusal.message}<MissingList items={refusal.missing} /></Alert>)}
        <div className="row between">
          <span className="muted">Up to {s.perHour} requests an hour. Drafts are never sent to the client.</span>
          <Button variant="primary" size="sm" busy={busy} disabled={!purpose || (chosen ? !chosen.available : !!fixedPurpose) || m?.inAudience === false} onClick={ask}>Ask for a draft</Button>
        </div>
      </div>
    </Card>
    {showDrafts && <>
      {drafts.error && <Alert kind="error">{drafts.error}</Alert>}
      {listed && (listed.length
        ? listed.map((d) => <DraftCard key={`${d.id}:${d.status}`} d={d} onChange={drafts.reload} use={use} />)
        : <Card><Empty title="No drafts yet" body={s.configured ? 'Drafts you ask for appear here for review.' : 'Drafts appear here once Coach AI is configured.'} /></Card>)}
      {drafts.data && <p className="muted">{drafts.data.retentionDays ? `Drafts are deleted ${drafts.data.retentionDays} days after they are made.` : 'How long drafts are kept is still an owner decision.'} Prompt version {s.promptVersion}.</p>}
    </>}
  </div>;
}

/* ---------- in place: the coach's Messages thread and plan editor ---------- */

/** The line the closed in-place panel shows: plainly that Coach AI is not configured while anything outside this client
 *  is missing (the provider, the retention decision, the consent wording), why not for this client while only they lack
 *  something (Coach AI's audience, their consent: the server's 'member_' requirements), otherwise the page's own
 *  one-line introduction. */
export function inlineNote(s: Pick<CoachStatus, 'configured' | 'missing'>, intro: string): string {
  if (s.missing.some((x) => !x.key.startsWith('member_'))) return 'Coach AI is not configured, so no draft can be made here yet. Open it to see what is missing.';
  if (!s.configured || s.missing.length) return 'No draft can use this client’s details yet. Open it to see why.';
  return intro;
}

type InlineState = { memberId: string; status: CoachStatus | null; hidden: boolean; error: string };

/** Coach AI in place for the client on screen: a reply draft in the coach's Messages thread, a plan outline in the plan
 *  editor. The host page renders it only for a coach while the 'ai' module is on; it then asks GET /coach/ai/status for
 *  this client and stays hidden when that is refused with 403 or 404 (not a client assigned to this coach, or Coach AI
 *  off for this coach), so it shows only for an assigned client. It stays closed until the coach opens it, so the page
 *  reads as before until then. Nothing is sent or saved from here: an accepted draft goes into the page's own field
 *  through `use`, and the coach still presses Send or saves the plan. */
export function AiDraftInline({ memberId, purpose, title, intro, use }: { memberId: string; purpose: AiPurpose; title: string; intro: string; use?: DraftUse }) {
  const { isCoach } = useAuth();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<InlineState | null>(null);
  useEffect(() => {
    setOpen(false);
    if (!isCoach || !memberId) { setState(null); return; }
    let alive = true;
    api.get<CoachStatus>(`/coach/ai/status${qs({ memberId })}`).then(
      (s) => { if (alive) setState({ memberId, status: s, hidden: !s.member, error: '' }); },
      (e) => { if (alive) setState({ memberId, status: null, hidden: e instanceof ApiRequestError && (e.status === 403 || e.status === 404), error: errorText(e) }); },
    );
    return () => { alive = false; };
  }, [isCoach, memberId]);
  if (!isCoach || !state || state.memberId !== memberId || state.hidden) return null;
  const bodyId = `coachAiInline-${purpose}`;
  return <Card dense>
    <CardHead eyebrow="Coach AI" title={title} right={<Button size="sm" variant="tertiary" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((o) => !o)}>{open ? 'Close' : 'Open'}</Button>} />
    {state.error ? <Alert kind="error">{state.error}</Alert> : state.status && !open && <p className="muted">{inlineNote(state.status, intro)}</p>}
    <div id={bodyId} hidden={!open} style={{ marginTop: 12 }}>{open && <AiDraftPanel key={memberId} memberId={memberId} purpose={purpose} use={use} />}</div>
  </Card>;
}
