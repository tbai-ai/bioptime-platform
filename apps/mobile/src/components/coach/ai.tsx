/* Coach AI in place (the portal's modules/ai/shared.tsx AiDraftInline and AiDraftPanel with a fixed purpose): a closed
   card under the coach's Messages thread ("Draft a reply") and in the plan editor ("Draft a plan outline"), only for a
   coach while the 'ai' flag is on. It asks GET /coach/ai/status?memberId for this client and stays hidden when that is
   refused with 403 or 404. Open, it asks for a draft (POST /coach/ai/drafts), lists this purpose's drafts, and an
   accepted draft (POST /coach/ai/drafts/:id/accept with the coach's own final text) is put into the host screen's own
   field through `use.set`: nothing is sent or saved from here, the coach still presses Send or saves the plan. An outline
   can start from one of the client's plans ("Start from a plan", planId), as on the portal. Toasts go to the host
   screen's floating toast when it passes `show`; otherwise they show right under the button the coach pressed (the
   draft's own buttons or "Ask for a draft"), never at the top of a long panel. */
import * as Clipboard from 'expo-clipboard';
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { ApiError, errorText, get, post, qs } from '@/lib/api';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { Button, Card, Empty, Field, Loading, Notice, Pill, Row } from '@/components/ui';
import { KeyValue } from '@/components/workspace';
import { CardHead, ConfirmSheet, Muted, PickerField, Small, TextArea, ToastView, useToast, type Toast } from './shared';
import { space } from '@/theme';

export type AiPurpose = 'message_reply' | 'plan_outline' | 'checkin_response' | 'meal_plan_outline' | 'workout_outline';
export type Requirement = { key: string; label: string };
export type PurposeInfo = { purpose: AiPurpose; label: string; hint: string; needsMember: boolean; available: boolean; unavailableReason: string | null };
export type CoachStatus = {
  configured: boolean; provider: string; model: string | null; missing: Requirement[]; retentionDays: number | null; promptVersion: string; purposes: PurposeInfo[]; rules: string[]; perHour: number;
  member: null | { id: string; name: string; inAudience?: boolean; aiConsent: { granted: boolean; earlierWording?: boolean; version: string | null; at: string | null }; healthShared: boolean; sources: { conversation: { id: string; messages: number } | null; plans: Array<{ id: string; title: string; status: string; updatedAt: string }>; checkins: Array<{ id: string; title: string; dueDate: string; status: string }> } };
};
export type DraftStatus = 'requested' | 'ready' | 'failed' | 'accepted' | 'discarded';
export type Draft = { id: string; purpose: AiPurpose; purposeLabel: string; memberId: string | null; memberName: string | null; status: DraftStatus; output: string | null; finalText: string | null; contextScope: { client?: boolean; messages?: number; plan?: boolean; checkin?: boolean; checkinAnswers?: boolean; health?: boolean; progressValues?: number }; promptVersion: string; error: string | null; createdAt: string; acceptedAt: string | null; discardedAt: string | null; label: string };

/** Where an accepted draft goes on the host screen: its own field, after what the coach already wrote. */
export type DraftUse = { accept: string; again: string; done: string; set: (update: (current: string) => string) => void };

/** A toast sender: the host screen's own (a floating toast) or the panel's. */
export type Say = (text: string, kind?: 'ok' | 'error') => void;

export function withDraft(current: string, text: string): string { const add = text.trim(); if (!add) return current; return current.trim() ? `${current.trimEnd()}\n\n${add}` : add; }

const STATUS: Record<DraftStatus, [string, React.ComponentProps<typeof Pill>['tone']]> = { requested: ['Waiting', 'warning'], ready: ['Ready to review', 'info'], failed: ['Failed', 'error'], accepted: ['Accepted', 'success'], discarded: ['Discarded', 'info'] };

export function scopeText(d: Draft): string {
  const s = d.contextScope ?? {};
  const parts = [s.client ? 'client profile (no contact details)' : 'no client details', s.messages ? `${s.messages} recent message${s.messages === 1 ? '' : 's'}` : '', s.plan ? 'current plan' : '', s.checkin ? (s.checkinAnswers ? 'check-in with answers' : 'check-in questions only') : '', s.progressValues ? `${s.progressValues} logged value${s.progressValues === 1 ? '' : 's'}` : ''].filter(Boolean);
  return `Built from: ${parts.join(', ')}.`;
}

function MissingList({ items }: { items: Requirement[] }) { if (!items.length) return null; return <View style={{ gap: 2, marginTop: space.xs }}>{items.map((m) => <Small key={m.key}>{`• ${m.label}`}</Small>)}</View>; }

export function NotConfigured({ missing, children }: { missing: Requirement[]; children?: string }) {
  return <Notice kind="warning" title="Coach AI is not configured"><View><Small>{children ?? 'No draft can be made until each of these is in place. Nothing is generated in the meantime.'}</Small><MissingList items={missing} /></View></Notice>;
}

/** The line the closed in-place panel shows (the portal's inlineNote). */
export function inlineNote(s: Pick<CoachStatus, 'configured' | 'missing'>, intro: string): string {
  if (s.missing.some((x) => !x.key.startsWith('member_'))) return 'Coach AI is not configured, so no draft can be made here yet. Open it to see what is missing.';
  if (!s.configured || s.missing.length) return 'No draft can use this client’s details yet. Open it to see why.';
  return intro;
}

const OUTLINES: AiPurpose[] = ['plan_outline', 'meal_plan_outline', 'workout_outline'];

/** `toast`: the panel's toast when it belongs to this draft (shown under the draft's buttons). */
function DraftCard({ d, onChange, use, show, toast }: { d: Draft; onChange: () => void; use?: DraftUse; show: Say; toast: Toast | null }) {
  const [text, setText] = useState(d.output ?? '');
  const [busy, setBusy] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [discardErr, setDiscardErr] = useState<string | null>(null);
  const [status, tone] = STATUS[d.status] ?? ['—', 'info'];
  const accept = async () => {
    setBusy(true);
    try {
      const r = await post<Draft>(`/coach/ai/drafts/${d.id}/accept`, { finalText: text });
      const final = r.finalText ?? text;
      if (use) { use.set((current) => withDraft(current, final)); show(`Accepted. ${use.done}`); }
      else { const copied = await Clipboard.setStringAsync(final).then(() => true, () => false); show(copied ? 'Accepted and copied. Paste it where you send it; nothing was sent.' : 'Accepted. Copy the text below; nothing was sent.'); }
      onChange();
    } catch (e) { show(errorText(e), 'error'); } finally { setBusy(false); }
  };
  return <Card>
    <CardHead eyebrow={`${d.purposeLabel}${d.memberName ? ` · ${d.memberName}` : ' · general'}`} title={fmtDateTime(d.createdAt)} right={<Pill tone={tone}>{status}</Pill>} />
    <Muted>{`${d.label} ${scopeText(d)}`}</Muted>
    {d.status === 'ready' ? <>
      <Field label="Draft (edit it before you use it)"><TextArea rows={8} value={text} onChangeText={setText} /></Field>
      <Row><Button title={use ? use.accept : 'Accept and copy'} small busy={busy} disabled={!text.trim()} onPress={accept} /><Button title="Discard" small variant="ghost" onPress={() => setDiscard(true)} /></Row>
    </> : null}
    {d.status === 'accepted' ? <>
      <Field label={`Your final text, accepted ${fmtDate(d.acceptedAt)}`}><TextArea rows={6} editable={false} value={d.finalText ?? ''} /></Field>
      <Row>
        {use && d.finalText ? <Button title={use.again} small onPress={() => { const final = d.finalText ?? ''; use.set((current) => withDraft(current, final)); show(use.done); }} /> : null}
        <Button title="Copy" small variant="secondary" onPress={async () => show((await Clipboard.setStringAsync(d.finalText ?? '').then(() => true, () => false)) ? 'Copied' : 'Copy did not work here; select the text instead')} />
        {!use ? <Small>{`Send it yourself from ${d.purpose === 'message_reply' ? 'Messages' : 'the client’s plan'}.`}</Small> : null}
      </Row>
    </> : null}
    {d.status === 'failed' ? <><Notice kind="error" title="No draft">{d.error ?? 'The provider did not return a draft.'}</Notice><Row><Button title="Discard" small variant="ghost" onPress={() => setDiscard(true)} /></Row></> : null}
    {d.status === 'discarded' ? <Small>{`Discarded ${fmtDateTime(d.discardedAt)}${d.error ? `: ${d.error}` : ''}. Its text was cleared.`}</Small> : null}
    <ToastView toast={toast} />
    <ConfirmSheet open={discard} onClose={() => { setDiscard(false); setDiscardErr(null); }} title="Discard this draft?" body="Its text is cleared at once. Nothing was sent to the client." confirmLabel="Discard" destructive note="Why (optional, recorded in the audit log)" error={discardErr}
      onConfirm={async (note) => { try { await post(`/coach/ai/drafts/${d.id}/discard`, note ? { reason: note } : {}); setDiscard(false); show('Discarded'); onChange(); } catch (e) { setDiscardErr(errorText(e)); } }} />
  </Card>;
}

type Refusal = { code: string; message: string; missing: Requirement[] };

/** Ask for a draft of one fixed purpose for this client, then review this purpose's drafts. */
export function AiDraftPanel({ memberId, purpose, use, show: hostShow }: { memberId: string; purpose: AiPurpose; use?: DraftUse; show?: Say }) {
  const local = useToast();
  const [toastAt, setToastAt] = useState('ask');
  /** Where a toast is seen: the host's floating toast, or under the control at `at` ('ask' or a draft id). */
  const sayAt = (at: string): Say => (text, kind = 'ok') => { if (hostShow) hostShow(text, kind); else { setToastAt(at); local.show(text, kind); } };
  const show = sayAt('ask');
  const [planId, setPlanId] = useState('');
  const status = useLoad<CoachStatus>(null, () => get(`/coach/ai/status${qs({ memberId })}`), [memberId]);
  const drafts = useLoad<{ items: Draft[]; retentionDays: number | null }>(null, () => get(`/coach/ai/drafts${qs({ memberId })}`), [memberId]);
  const [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const s = status.data;
  if (status.error) return <Notice kind="error">{status.error.message}</Notice>;
  if (!s) return <Loading />;
  const chosen = s.purposes.find((p) => p.purpose === purpose) ?? null;
  const m = s.member;
  const isOutline = OUTLINES.includes(purpose);
  const plans = m?.sources.plans ?? [];
  const listed = drafts.data ? drafts.data.items.filter((d) => d.purpose === purpose) : null;
  const ask = async () => {
    setBusy(true); setRefusal(null); setFieldErr({});
    try {
      const d = await post<Draft>('/coach/ai/drafts', { purpose, memberId, ...(isOutline && planId ? { planId } : {}), ...(instructions.trim() ? { instructions: instructions.trim() } : {}) });
      show(d.status === 'ready' ? 'Draft ready to review' : 'The request finished without a draft', d.status === 'ready' ? 'ok' : 'error');
      setInstructions('');
      void drafts.reload();
    } catch (e) {
      const missing = (e instanceof ApiError && e.details && typeof e.details === 'object' && Array.isArray((e.details as { missing?: Requirement[] }).missing) ? (e.details as { missing: Requirement[] }).missing : []);
      if (e instanceof ApiError && e.code === 'VALIDATION_FAILED') setFieldErr(e.fieldErrors());
      else if (e instanceof ApiError && (['AI_NOT_CONFIGURED', 'AI_CONSENT_REQUIRED'].includes(e.code) || (e.code === 'FEATURE_DISABLED' && missing.some((x) => x.key === 'member_audience')))) setRefusal({ code: e.code, message: e.message, missing });
      else show(errorText(e), 'error');
      void status.reload();
    } finally { setBusy(false); }
  };
  return <View style={{ gap: space.md }}>
    {!s.configured ? <NotConfigured missing={s.missing}>Drafting is set up and audited, but no draft can be made until each of these is in place. Nothing is generated in the meantime.</NotConfigured> : null}
    {m ? <KeyValue rows={[
      ...(m.inAudience === false ? [{ label: 'Coach AI for this client', value: 'Switched off: the module’s audience leaves them out, so no draft can use their details' }] : []),
      { label: 'Coach AI consent', value: m.aiConsent.granted ? `Given ${fmtDate(m.aiConsent.at)}${m.aiConsent.version?.includes('draft') ? ' under the draft wording, pending review by counsel' : ''}` : m.aiConsent.earlierWording ? `Given ${fmtDate(m.aiConsent.at)} under an earlier wording: not used until they agree to the current one` : 'Not given: no draft can use this client’s details' },
      { label: 'Health records', value: m.healthShared ? (m.aiConsent.granted ? 'Shared: logged values and check-in answers can be included' : 'Shared with you, but not for Coach AI') : 'Not shared: no values or check-in answers are included' },
      { label: 'Never taken from the profile', value: 'Phone, email, address, PIN code, date of birth. Messages and your instructions are sent as written.' },
    ]} /> : null}
    <Card>
      <CardHead eyebrow="Ask for a draft" title={chosen ? chosen.label : 'What should Coach AI draft?'} />
      <Small>{chosen ? (chosen.available ? chosen.hint : chosen.unavailableReason ?? '') : 'This kind of draft needs a client.'}</Small>
      {fieldErr.purpose ? <Notice kind="error">{fieldErr.purpose}</Notice> : null}
      {isOutline && m && plans.length > 0 ? <PickerField label="Start from a plan (optional)" accessibilityLabel="Start from a plan" value={planId} onChange={setPlanId} error={fieldErr.planId}
        options={[{ value: '', label: 'The most recent plan' }, ...plans.map((p) => ({ value: p.id, label: `${p.title} (${p.status})` }))]} /> : null}
      {purpose === 'message_reply' && m ? <Small>{m.sources.conversation ? `Uses the last messages of your conversation (${m.sources.conversation.messages} so far).` : 'You have no conversation with this client yet.'}</Small> : null}
      <Field label="Your instructions (optional)" error={fieldErr.instructions} hint="Used for this request only and not stored. Leave out contact details."><TextArea rows={3} maxLength={2000} value={instructions} onChangeText={setInstructions} /></Field>
      {refusal ? (refusal.code === 'AI_NOT_CONFIGURED'
        ? <Notice kind="warning" title="Request refused">Coach AI is not configured, so nothing was generated. What is missing is listed at the top of this panel.</Notice>
        : <Notice kind="warning" title={refusal.code === 'FEATURE_DISABLED' ? 'Coach AI is off for this client' : 'Consent needed'}><View><Small>{refusal.message}</Small><MissingList items={refusal.missing} /></View></Notice>) : null}
      <Muted>{`Up to ${s.perHour} requests an hour. Drafts are never sent to the client.`}</Muted>
      <Button title="Ask for a draft" small busy={busy} disabled={!chosen || !chosen.available || m?.inAudience === false} onPress={ask} />
      {!hostShow && toastAt === 'ask' ? <ToastView toast={local.toast} /> : null}
    </Card>
    {drafts.error ? <Notice kind="error">{drafts.error.message}</Notice> : null}
    {listed ? (listed.length ? listed.map((d) => <DraftCard key={`${d.id}:${d.status}`} d={d} onChange={() => { void drafts.reload(); }} use={use} show={sayAt(d.id)} toast={!hostShow && toastAt === d.id ? local.toast : null} />) : <Card><Empty title="No drafts yet" body={s.configured ? 'Drafts you ask for appear here for review.' : 'Drafts appear here once Coach AI is configured.'} /></Card>) : <Loading />}
    {drafts.data ? <Muted>{`${drafts.data.retentionDays ? `Drafts are deleted ${drafts.data.retentionDays} days after they are made.` : 'How long drafts are kept is still an owner decision.'} Prompt version ${s.promptVersion}.`}</Muted> : null}
  </View>;
}

type InlineState = { memberId: string; status: CoachStatus | null; hidden: boolean; error: string };

/** The closed card the host screen shows; the panel mounts once the coach opens it. `show`: the host screen's floating
 *  toast (ToastFloat), so a toast is seen wherever the coach pressed the button. */
export function AiDraftInline({ memberId, purpose, title, intro, use, show }: { memberId: string; purpose: AiPurpose; title: string; intro: string; use?: DraftUse; show?: Say }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<InlineState | null>(null);
  useEffect(() => {
    setOpen(false);
    if (!memberId) { setState(null); return; }
    let alive = true;
    get<CoachStatus>(`/coach/ai/status${qs({ memberId })}`).then(
      (s) => { if (alive) setState({ memberId, status: s, hidden: !s.member, error: '' }); },
      (e) => { if (alive) setState({ memberId, status: null, hidden: e instanceof ApiError && (e.status === 403 || e.status === 404), error: errorText(e) }); },
    );
    return () => { alive = false; };
  }, [memberId]);
  if (!state || state.memberId !== memberId || state.hidden) return null;
  return <Card>
    <CardHead eyebrow="Coach AI" title={title} right={<Button title={open ? 'Close' : 'Open'} small variant="ghost" onPress={() => setOpen((o) => !o)} />} />
    {state.error ? <Notice kind="error">{state.error}</Notice> : state.status && !open ? <Muted>{inlineNote(state.status, intro)}</Muted> : null}
    {open ? <AiDraftPanel key={memberId} memberId={memberId} purpose={purpose} use={use} show={show} /> : null}
  </Card>;
}
