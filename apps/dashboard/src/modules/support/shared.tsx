/* Shared pieces of the support module's pages: categories and statuses as the API names them, the status pill, the
   request thread (the portal's existing .thread / .msg / .bubble styles) and a second, client-side pass over article
   HTML, which the server has already sanitised to the CMS allowlist. */
import React from 'react';
import { fmtDateTime } from '../../lib/format';
import { Pill } from '../../ui';
import { useFeatures } from '../runtime';
import './support.css';

export const CATEGORIES: Array<{ id: string; label: string }> = [
  { id: 'account', label: 'Account and sign-in' },
  { id: 'billing', label: 'Payments and orders' },
  { id: 'bloodwork', label: 'Blood tests and reports' },
  { id: 'app', label: 'The app or portal' },
  { id: 'coaching', label: 'Coaching' },
  { id: 'privacy', label: 'Privacy and your data' },
  { id: 'other', label: 'Something else' },
];
export const categoryLabel = (id?: string | null) => CATEGORIES.find((c) => c.id === id)?.label ?? id ?? '—';

/** The request status as a pill: the requester reads "Waiting on you", the team "Waiting on requester". */
export function RequestStatus({ status, forTeam }: { status: string; forTeam?: boolean }) {
  if (status === 'waiting_on_requester') return <Pill status="pending">{forTeam ? 'Waiting on requester' : 'Waiting on you'}</Pill>;
  if (status === 'open') return <Pill status="open">{forTeam ? 'Open' : 'With the team'}</Pill>;
  return <Pill status={status} />;
}

export type ThreadMessage = { id: string; body: string; createdAt: string; mine?: boolean; internal?: boolean; authorName: string; fromRequester?: boolean };

/** A support thread. For the team, the requester's messages sit on the left and the team's on the right; internal notes
 *  are marked. For the requester, their own messages sit on the right. */
export function Thread({ items, empty }: { items: ThreadMessage[]; empty?: string }) {
  if (!items.length) return <p className="muted">{empty ?? 'No messages yet.'}</p>;
  return <div className="thread">{items.map((m) => <div key={m.id} className={`msg ${m.mine ? 'mine' : ''}`}>
    {m.internal && <Pill status="draft">Internal note · the requester never sees it</Pill>}
    <div className="bubble supBubble">{m.body}</div>
    <time>{m.authorName} · {fmtDateTime(m.createdAt)}</time>
  </div>)}</div>;
}

/** The parts of the module that are switched on for this person (support_requests, help_centre, imports), or null
 *  while the flags load. */
export function useSupportParts(): { requests: boolean; help: boolean; imports: boolean } | null {
  const f = useFeatures(true);
  if (!f) return null;
  return { requests: f.has('support_requests'), help: f.has('help_centre'), imports: f.has('imports') };
}

const ALLOWED = new Set(['P', 'BR', 'STRONG', 'B', 'EM', 'I', 'UL', 'OL', 'LI', 'H3', 'A']);
/** Keep only the formatting tags the server allows and https or same-site links; everything else becomes its text. */
export function safeHtml(html: string): string {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as HTMLElement;
        walk(el);
        if (!ALLOWED.has(el.tagName)) { el.replaceWith(...Array.from(el.childNodes)); continue; }
        for (const attr of Array.from(el.attributes)) if (!(el.tagName === 'A' && attr.name === 'href')) el.removeAttribute(attr.name);
        if (el.tagName === 'A') {
          const href = el.getAttribute('href') ?? '';
          if (!/^(https:\/\/|\/(?!\/)|#)/i.test(href)) { el.replaceWith(...Array.from(el.childNodes)); continue; }
          if (/^https:/i.test(href)) { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener'); }
        }
      } else if (child.nodeType !== Node.TEXT_NODE) child.remove();
    }
  };
  walk(tpl.content);
  return tpl.innerHTML;
}

/** An article body, sanitised again in the browser. */
export function ArticleBody({ html }: { html: string }) {
  return <div className="supArticle" dangerouslySetInnerHTML={{ __html: safeHtml(html) }} />;
}

export function fmtBytes(n?: number | null): string {
  if (!n) return '—';
  return n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}
