/* Admin › Messages (the web's /admin/messages, members.manage): every conversation between a member and their coach,
   read for support; a thread opens at /admin/messages/[id]. Administrators never write, never mark a thread read and
   never add files (apps/dashboard/src/pages/Messages.tsx:47,66-75,93), so the list carries no composer and the unread
   counts are the participants' own. */
import { useRouter } from 'expo-router';
import React from 'react';
import { get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { relative } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import type { Conversation } from '@/lib/admin/b1/types';
import { ErrorBox, Loading, StaleBanner } from '@/components/ui';
import { Badge, EmptyState, RecordList, RecordRow } from '@/components/workspace';
import { RequirePermission, WorkspaceScreen } from '@/components/workspaceShell';
import { Enter } from '@/motion';

export default function AdminMessages() {
  const { can } = useAuth();
  const router = useRouter();
  const allowed = can('members.manage');
  const convs = useLoad<{ items: Conversation[] } | null>(allowed ? 'admin-conversations' : null, () => (allowed ? get('/conversations') : Promise.resolve(null)), [allowed]);
  const items = convs.data?.items ?? [];
  return <WorkspaceScreen workspace="admin" title="Messages" sub="Administrators can read threads for support; writing is between a member and their coach." refreshing={convs.loading} onRefresh={convs.reload} depth>
    <RequirePermission permission="members.manage">
      <StaleBanner at={convs.stale} /><ErrorBox error={convs.error} onRetry={convs.reload} />
      {convs.loading && !convs.data ? <Loading /> : convs.data ? <Enter index={1}>
        {items.length ? <RecordList title="Conversations">
          {items.map((c) => <RecordRow key={c.id} title={`${c.memberName} ↔ ${c.coachName}`} meta={`${c.lastBody ?? 'No messages yet'} · ${c.lastMessageAt ? relative(c.lastMessageAt) : '—'}`} right={c.unread ? <Badge count={c.unread} /> : undefined} onPress={() => router.push(`/admin/messages/${c.id}`)} />)}
        </RecordList> : <EmptyState title="No conversations" body="A conversation opens when a coach is assigned." icon="chatbubbles-outline" />}
      </Enter> : null}
    </RequirePermission>
  </WorkspaceScreen>;
}
