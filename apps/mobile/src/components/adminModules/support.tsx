/* M4 Support in the admin workspace: what the Support page, a request's page and the member record's Support tab share
   (the web's modules/support/shared.tsx and AdminSupport.tsx): the topics and statuses as the API names them, the
   team's status pill, file sizes, and the request thread (the requester's messages on the left, the team's on the
   right, internal notes marked). Tokens from theme.ts only. */
import React from 'react';
import { Text, View } from 'react-native';
import { fmtDateTime, label } from '@/lib/format';
import { Pill } from '@/components/ui';
import { StatusPill } from '@/components/coachModules/shared';
import { colors, font, radius, space } from '@/theme';

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
export const STATUSES = [{ id: 'open', label: 'Open' }, { id: 'waiting_on_requester', label: 'Waiting on requester' }, { id: 'resolved', label: 'Resolved' }, { id: 'closed', label: 'Closed' }];

export type RequestRow = { id: string; reference: string; category: string; subject: string; status: string; requester: { id: string; name: string; email?: string; role: string } | null; assignedTo: { id: string; name: string } | null; createdAt: string; updatedAt: string; messageCount: number; internalCount: number };
export type RequestDetail = RequestRow & { requesterRole: string; resolvedAt: string | null; messages: Array<{ id: string; body: string; internal: boolean; createdAt: string; fromRequester: boolean; author: { id: string; name: string; role: string } }> };
export type ExportRow = { id: string; status: string; requestedAt: string; completedAt: string | null; memberId: string; memberName: string; memberCode: string | null; note: string | null; file: { name: string; size: number; createdAt: string } | null };

/** The request status as the team reads it ("Waiting on requester", "Open", then the status itself). */
export function TeamStatusPill({ status }: { status: string }) {
  if (status === 'waiting_on_requester') return <Pill tone="warning">Waiting on requester</Pill>;
  if (status === 'open') return <Pill tone="info">Open</Pill>;
  return <StatusPill status={status} />;
}

export function fmtBytes(n?: number | null): string {
  if (!n) return '—';
  return n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

/** The whole thread as the team sees it: the requester on the left, the team on the right, internal notes marked. */
export function TeamThread({ d }: { d: RequestDetail }) {
  if (!d.messages.length) return <Text style={{ color: colors.muted, fontSize: font.body }}>No messages yet.</Text>;
  return <View style={{ gap: space.md }}>
    {d.messages.map((m) => {
      const mine = !m.fromRequester;
      return <View key={m.id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '88%', gap: 4, alignItems: mine ? 'flex-end' : 'flex-start' }}>
        {m.internal ? <Pill tone="warning">Internal note · the requester never sees it</Pill> : null}
        <View style={{ backgroundColor: mine ? colors.raised : colors.base, borderWidth: 1, borderColor: m.internal ? colors.warning : colors.border, padding: space.md, borderRadius: radius.lg, borderBottomRightRadius: mine ? 4 : radius.lg, borderBottomLeftRadius: mine ? radius.lg : 4 }}>
          <Text style={{ color: colors.text, fontSize: font.body, lineHeight: 21 }} selectable>{m.body}</Text>
        </View>
        <Text style={{ color: colors.muted, fontSize: font.tiny }}>{`${m.fromRequester ? `${m.author.name} (${label(m.author.role)})` : m.author.name} · ${fmtDateTime(m.createdAt)}`}</Text>
      </View>;
    })}
  </View>;
}
