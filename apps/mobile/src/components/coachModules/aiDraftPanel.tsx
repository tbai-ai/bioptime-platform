/* Coach AI in the coach workspace (the web's modules/ai/shared.tsx): the shapes the API returns, the "not configured"
   state, and AiDraftPanel, the draft-and-review panel the Coach AI screen and the client-record tab use. Drafts are
   never sent: the coach edits a draft and accepts it with their own final text, which is then copied for them to paste
   where they send it. With no AI provider configured, every request comes back as "Coach AI is not configured" with
   what is missing; nothing is made up in its place. */
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { ApiError, errorText, get, post, qs } from '@/lib/api';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { Button, Card, Empty, Eyebrow, Field, H2, Input, Loading, Notice, P, Pill, Row } from '@/components/ui';
import { ConfirmSheet, KvList, PickerField, copyText, day, fieldErrorsOf, useFlash } from './shared';
import { colors, font, space } from '@/theme';

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
  contextScope: { client?: boolean; messages?: number; plan?: boolean; checkin?: boolean; checkinAnswers?: boolean; health?: boolean; progressValues?: number };
  promptVersion: string; provider: string; model: string | null; error: string | null; createdAt: string; updatedAt: string; acceptedAt: string | null; discardedAt: string | null; label: string;
};

const STATUS: Record<DraftStatus, [string, 'warning' | 'info' | 'error' | 'success']> = { requested: ['Waiting', 'warning'], ready: ['Ready to review', 'info'], failed: ['Failed', 'error'], accepted: ['Accepted', 'success'], discarded: ['Discarded', 'info'] };
export function DraftPill({ status }: { status: DraftStatus }) { const [text, tone] = STATUS[status]; return <Pill tone={tone}>{text}</Pill>; }

/** The exact list of what is missing, as the server names it. */
export function MissingList({ items }: { items: Requirement[] }) {
  if (!items.length) return null;
  return <View style={{ gap: space.xs, marginTop: space.xs }}>{items.map((m) => <Text key={m.key} style={{ color: colors.muted, fontSize: font.small, lineHeight: 19 }}>{`• ${m.label}`}</Text>)}</View>;
}

/** "Coach AI is not configured": the server's own wording and its list of missing requirements. */
export function NotConfigured({ missing, body }: { missing: Requirement[]; body?: string }) {
  return <Notice kind="warning" title="Coach AI is not configured"><Text style={{ color: colors.muted, fontSize: font.small, lineHeight: 19 }}>{body ?? 'No draft can be made until each of these is in place. Nothing is generated in the meantime.'}</Text><MissingList items={missing} /></Notice>;
}

/** What went into a draft, in words (sections and counts only; the content itself is never stored). */
export function scopeText(d: Draft): string {
  const s = d.contextScope;
  const parts = [s.client ? 'client profile (no contact details)' : 'no client details', s.messages ? `${s.messages} recent message${s.messages === 1 ? '' : 's'}` : '', s.plan ? 'current plan' : '', s.checkin ? (s.checkinAnswers ? 'check-in with answers' : 'check-in questions only') : '', s.progressValues ? `${s.progressValues} logged value${s.progressValues === 1 ? '' : 's'}` : ''].filter(Boolean);
  return `Built from: ${parts.join(', ')}.`;
}

/** One draft: review and edit a ready one, accept it with your own text (then copy it), or discard it. */
export function DraftCard({ d, onChange, show }: { d: Draft; onChange: () => void; show: (t: string, k?: 'success' | 'error') => void }) {
  const router = useRouter();
  const [text, setText] = useState(d.output ?? '');
  const [busy, setBusy] = useState(false);
  const [discard, setDiscard] = useState(false);
  const accept = async () => {
    setBusy(true);
    try {
      const r = await post<Draft>(`/coach/ai/drafts/${d.id}/accept`, { finalText: text.trim() });
      const copied = await copyText(r.finalText ?? text.trim());
      show(copied ? 'Accepted and copied. Paste it where you send it; nothing was sent.' : 'Accepted. Copy the text below; nothing was sent.');
      onChange();
    } catch (e) { show(errorText(e), 'error'); } finally { setBusy(false); }
  };
  const where = d.purpose === 'message_reply' ? { label: 'Messages', route: '/(coach)/messages' } : d.memberId ? { label: 'the client’s plan', route: `/coach/clients/${d.memberId}?tab=plan` } : null;
  return <Card>
    <Eyebrow>{`${d.purposeLabel}${d.memberName ? ` · ${d.memberName}` : ' · general'}`}</Eyebrow>
    <Row between><H2>{fmtDateTime(d.createdAt)}</H2><DraftPill status={d.status} /></Row>
    <P muted small>{`${d.label} ${scopeText(d)}`}</P>
    {d.status === 'ready' ? <View>
      <Field label="Draft (edit it before you use it)"><Input value={text} onChangeText={setText} multiline style={{ minHeight: 140, textAlignVertical: 'top' }} /></Field>
      <Row><Button title="Accept and copy" small busy={busy} disabled={!text.trim()} onPress={accept} /><Button title="Discard" variant="ghost" small onPress={() => setDiscard(true)} /></Row>
    </View> : null}
    {d.status === 'accepted' ? <View>
      <Field label={`Your final text, accepted ${fmtDate(d.acceptedAt)}`}><Input value={d.finalText ?? ''} editable={false} multiline style={{ minHeight: 100, textAlignVertical: 'top' }} /></Field>
      <Row><Button title="Copy" variant="secondary" small onPress={async () => show((await copyText(d.finalText ?? '')) ? 'Copied' : 'Copy did not work here; select the text instead')} />{where ? <Text style={{ color: colors.text, fontSize: font.small }}>Send it yourself from <Text style={{ color: colors.accentText }} onPress={() => router.push(where.route)}>{where.label}</Text>.</Text> : null}</Row>
    </View> : null}
    {d.status === 'failed' ? <View style={{ gap: space.sm }}><Notice kind="error" title="No draft">{d.error ?? 'The provider did not return a draft.'}</Notice><Button title="Discard" variant="ghost" small onPress={() => setDiscard(true)} style={{ alignSelf: 'flex-start' }} /></View> : null}
    {d.status === 'discarded' ? <P small>{`Discarded ${fmtDateTime(d.discardedAt)}${d.error ? `: ${d.error}` : ''}. Its text was cleared.`}</P> : null}
    <ConfirmSheet open={discard} onClose={() => setDiscard(false)} title="Discard this draft?" body="Its text is cleared at once. Nothing was sent to the client." confirmLabel="Discard" destructive note="Why (optional, recorded in the audit log)" busy={busy}
      onConfirm={async (note) => { setBusy(true); try { await post(`/coach/ai/drafts/${d.id}/discard`, note ? { reason: note } : {}); setDiscard(false); show('Discarded'); onChange(); } catch (e) { setDiscard(false); show(errorText(e), 'error'); } finally { setBusy(false); } }} />
  </Card>;
}

type Refusal = { code: string; message: string; missing: Requirement[] };

/** Ask for a draft for one client (or a general outline), then review the drafts. `refreshKey`: a change reloads the
 *  consent card and the drafts (the client record's pull to refresh) without losing a request being written. */
export function AiDraftPanel({ memberId, refreshKey = 0 }: { memberId?: string | null; refreshKey?: number }) {
  const { show, node: flash } = useFlash();
  const status = useLoad<CoachStatus>(`coach-ai-status-${memberId ?? 'general'}`, () => get(`/coach/ai/status${qs({ memberId: memberId ?? undefined })}`), [memberId, refreshKey]);
  const drafts = useLoad<{ items: Draft[]; retentionDays: number | null }>(`coach-ai-drafts-${memberId ?? 'general'}`, () => get(`/coach/ai/drafts${qs({ memberId: memberId ?? undefined })}`), [memberId, refreshKey]);
  const [purpose, setPurpose] = useState<AiPurpose | ''>('');
  const [checkinId, setCheckinId] = useState('');
  const [planId, setPlanId] = useState('');
  const [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const s = status.data;
  if (status.error) return <Notice kind="error">{status.error.message}</Notice>;
  if (!s) return <Loading />;
  const purposes = s.purposes.filter((p) => memberId || !p.needsMember);
  const chosen = purposes.find((p) => p.purpose === purpose) ?? null;
  const isOutline = purpose === 'plan_outline' || purpose === 'meal_plan_outline' || purpose === 'workout_outline';
  const m = s.member;
  const listed = drafts.data?.items ?? null;

  const ask = async () => {
    if (!purpose) { setFieldErr({ purpose: 'Choose what to draft' }); return; }
    setBusy(true); setRefusal(null); setFieldErr({});
    try {
      const d = await post<Draft>('/coach/ai/drafts', { purpose, ...(memberId ? { memberId } : {}), ...(purpose === 'checkin_response' && checkinId ? { checkinId } : {}), ...(isOutline && planId ? { planId } : {}), ...(instructions.trim() ? { instructions: instructions.trim() } : {}) });
      show(d.status === 'ready' ? 'Draft ready to review' : 'The request finished without a draft', d.status === 'ready' ? 'success' : 'error');
      setInstructions('');
      drafts.reload();
    } catch (e) {
      const missing = e instanceof ApiError ? (((e.details as { missing?: Requirement[] } | undefined)?.missing) ?? []) : [];
      if (e instanceof ApiError && e.code === 'VALIDATION_FAILED') setFieldErr(fieldErrorsOf(e));
      else if (e instanceof ApiError && (['AI_NOT_CONFIGURED', 'AI_CONSENT_REQUIRED'].includes(e.code) || (e.code === 'FEATURE_DISABLED' && missing.some((x) => x.key === 'member_audience')))) setRefusal({ code: e.code, message: e.message, missing });
      else show(errorText(e), 'error');
      status.reload();
    } finally { setBusy(false); }
  };

  return <View style={{ gap: space.md }}>
    {flash}
    {!s.configured ? <NotConfigured missing={s.missing} body="Drafting is set up and audited, but no draft can be made until each of these is in place. Nothing is generated in the meantime." /> : null}
    {m ? <Card><KvList rows={[
      m.inAudience === false ? ['Coach AI for this client', 'Switched off: the module’s audience leaves them out, so no draft can use their details'] : null,
      ['Coach AI consent', m.aiConsent.granted ? `Given ${fmtDate(m.aiConsent.at)}${m.aiConsent.version?.includes('draft') ? ' under the draft wording, pending review by counsel' : ''}` : m.aiConsent.earlierWording ? `Given ${fmtDate(m.aiConsent.at)} under an earlier wording: not used until they agree to the current one` : 'Not given: no draft can use this client’s details'],
      ['Health records', m.healthShared ? (m.aiConsent.granted ? 'Shared: logged values and check-in answers can be included' : 'Shared with you, but not for Coach AI') : 'Not shared: no values or check-in answers are included'],
      ['Never taken from the profile', 'Phone, email, address, PIN code, date of birth. Messages and your instructions are sent as written.'],
    ]} /></Card> : null}
    <Card>
      <Eyebrow>{memberId ? 'Ask for a draft' : 'Ask for a draft (no client)'}</Eyebrow>
      <H2>{chosen ? chosen.label : 'What should Coach AI draft?'}</H2>
      <PickerField label="Draft" value={purpose} placeholder="Choose…" hint={chosen?.hint} error={fieldErr.purpose} options={purposes.map((p) => ({ value: p.purpose, label: `${p.label}${p.available ? '' : ` (${p.unavailableReason})`}`, disabled: !p.available }))} onChange={(v) => { setPurpose(v as AiPurpose | ''); setFieldErr({}); setRefusal(null); }} />
      {purpose === 'checkin_response' ? <PickerField label="Check-in" value={checkinId} placeholder="Choose…" error={fieldErr.checkinId} options={(m?.sources.checkins ?? []).map((c) => ({ value: c.id, label: `${c.title} · due ${day(c.dueDate)} · ${c.status}` }))} onChange={setCheckinId} /> : null}
      {isOutline && m && m.sources.plans.length > 0 ? <PickerField label="Start from a plan (optional)" value={planId} placeholder="The most recent plan" error={fieldErr.planId} options={m.sources.plans.map((p) => ({ value: p.id, label: `${p.title} (${p.status})` }))} onChange={setPlanId} /> : null}
      {purpose === 'message_reply' && m ? <P small>{m.sources.conversation ? `Uses the last messages of your conversation (${m.sources.conversation.messages} so far).` : 'You have no conversation with this client yet.'}</P> : null}
      <Field label="Your instructions (optional)" error={fieldErr.instructions} hint="Used for this request only and not stored. Leave out contact details."><Input value={instructions} onChangeText={setInstructions} maxLength={2000} multiline style={{ minHeight: 72, textAlignVertical: 'top' }} /></Field>
      {refusal ? (refusal.code === 'AI_NOT_CONFIGURED'
        ? <Notice kind="warning" title="Request refused">Coach AI is not configured, so nothing was generated. What is missing is listed at the top of this panel.</Notice>
        : <Notice kind="warning" title={refusal.code === 'FEATURE_DISABLED' ? 'Coach AI is off for this client' : 'Consent needed'}><Text style={{ color: colors.muted, fontSize: font.small, lineHeight: 19 }}>{refusal.message}</Text><MissingList items={refusal.missing} /></Notice>) : null}
      <P muted small>{`Up to ${s.perHour} requests an hour. Drafts are never sent to the client.`}</P>
      <Button title="Ask for a draft" busy={busy} disabled={!purpose || (chosen ? !chosen.available : false) || m?.inAudience === false} onPress={ask} />
    </Card>
    {drafts.error ? <Notice kind="error">{drafts.error.message}</Notice> : null}
    {listed ? (listed.length ? listed.map((d) => <DraftCard key={`${d.id}:${d.status}`} d={d} onChange={drafts.reload} show={show} />) : <Card><Empty title="No drafts yet" body={s.configured ? 'Drafts you ask for appear here for review.' : 'Drafts appear here once Coach AI is configured.'} /></Card>) : <Loading />}
    {drafts.data ? <P muted small>{`${drafts.data.retentionDays ? `Drafts are deleted ${drafts.data.retentionDays} days after they are made.` : 'How long drafts are kept is still an owner decision.'} Prompt version ${s.promptVersion}.`}</P> : null}
  </View>;
}
