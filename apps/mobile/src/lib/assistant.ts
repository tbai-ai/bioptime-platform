/* The member assistant (owner decision D2; API: api/domain/assistant.ts, routes api/http/routes/assistant.ts). The Coach
   tab is the human coach chat. The server keeps an assistant behind a switch that is off (no provider, no key, no cost),
   and the app shows nothing about it unless GET /me/assistant offers it:
   - `offer` (the switch on, a provider configured, the 'ai' flag on for the member): the Coach tab shows the
     "Coach | Assistant" segment; the Assistant side asks for the consent first (CRITIQUE §25: otherwise a member could
     never reach it once the switch is turned on);
   - `on` (offered and the member's assistant_processing consent under the current wording): the conversation.
   Any failure (offline, an older server without the route, signed out) reads as off: nothing is shown. GET /me/assistant
   and POST /me/assistant/consent answer while the 'ai' module is off; the messages routes need it. Withdrawing always
   works and deletes the conversation with the assistant (the server says so in the wording). */
import { useCallback, useEffect, useRef, useState } from 'react';
import { get, post } from './api';

export type AssistantRequirement = { key: string; label: string };
export type AssistantStatus = {
  on: boolean;
  offer: boolean;
  reason: string | null;
  missing: AssistantRequirement[];
  consent: {
    granted: boolean;
    earlierWording: boolean;
    version: string | null;
    at: string | null;
    canGrant: boolean;
    wording: { version: string; status: string; label: string; text: string };
  };
};
export type AssistantMessage = { id: string; role: 'member' | 'assistant'; body: string; createdAt: string; model: string | null; label: string | null };

const OFF: AssistantStatus = {
  on: false, offer: false, reason: null, missing: [],
  consent: { granted: false, earlierWording: false, version: null, at: null, canGrant: false, wording: { version: '', status: '', label: '', text: '' } },
};

function normalise(s: Partial<AssistantStatus> | null | undefined): AssistantStatus {
  if (!s || typeof s !== 'object') return OFF;
  return { ...OFF, ...s, on: s.on === true, offer: s.offer === true || s.on === true, consent: { ...OFF.consent, ...(s.consent ?? {}) } };
}

/** GET /me/assistant, read as off on any failure. */
export function loadAssistantStatus(): Promise<AssistantStatus> {
  return get<AssistantStatus>('/me/assistant').then(normalise, () => OFF);
}

/** Whether the assistant is offered and on for the signed-in member (both false until the server says otherwise).
 *  `active` false (no member, a screen that is not shown): nothing is asked. */
export function useAssistantStatus(active = true): { status: AssistantStatus; offer: boolean; on: boolean; loaded: boolean; reload: () => Promise<void>; setStatus: (s: AssistantStatus) => void } {
  const [status, setStatus] = useState<AssistantStatus>(OFF);
  const [loaded, setLoaded] = useState(false);
  const alive = useRef(true);
  const reload = useCallback(async () => {
    const s = await loadAssistantStatus();
    if (alive.current) { setStatus(s); setLoaded(true); }
  }, []);
  useEffect(() => {
    alive.current = true;
    if (active) void reload();
    return () => { alive.current = false; };
  }, [active, reload]);
  return { status, offer: status.offer, on: status.on, loaded, reload, setStatus: (s) => setStatus(normalise(s)) };
}

/** POST /me/assistant/consent: grant (the current wording's version) or withdraw (deletes the conversation). */
export function setAssistantConsent(granted: boolean, version?: string): Promise<AssistantStatus> {
  return post<AssistantStatus>('/me/assistant/consent', granted ? { granted, version } : { granted }).then(normalise);
}

/** GET /me/assistant/messages: the conversation while the assistant is on for the member (empty otherwise). */
export function loadAssistantMessages(): Promise<{ on: boolean; reason: string | null; items: AssistantMessage[] }> {
  return get<{ on: boolean; reason: string | null; items: AssistantMessage[] }>('/me/assistant/messages');
}

/** POST /me/assistant/messages: the member's message and the assistant's answer, or the server's refusal (ASSISTANT_OFF,
 *  AI_NOT_CONFIGURED, ASSISTANT_CONSENT_REQUIRED) as an ApiError. Nothing is made up on this side. */
export function sendAssistantMessage(body: string): Promise<{ items: AssistantMessage[] }> {
  return post<{ items?: AssistantMessage[] }>('/me/assistant/messages', { body }).then((r) => ({ items: Array.isArray(r?.items) ? r.items : [] }));
}
