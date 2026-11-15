/* The member's announcements: /client/announcements (every announcement that reaches them, newest first) and the
   "Announcements" card on Home (unread ones first). From the Bioptime team, or from their own coach to their clients.
   Opening the page marks nothing; "Mark read" does. Plain text only. */
import React, { useState } from 'react';
import { api } from '../../lib/api';
import { Link } from '../../lib/nav';
import { fmtDateTime } from '../../lib/format';
import { Alert, Button, Card, CardHead, Empty, Pill, Skeleton, useApi, useToast, errorText } from '../../ui';
import { AnnouncementBody, type MemberAnnouncement } from './shared';

type List = { items: MemberAnnouncement[]; unread: number };

function useAnnouncements() {
  const list = useApi(() => api.get<List>('/me/announcements'), []);
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const markRead = async (a: MemberAnnouncement) => {
    setBusy(a.id);
    try { await api.post(`/me/announcements/${a.id}/read`); list.reload(); } catch (e) { toast(errorText(e), 'error'); } finally { setBusy(null); }
  };
  return { list, busy, markRead };
}

function Item({ a, busy, onRead }: { a: MemberAnnouncement; busy: boolean; onRead: () => void }) {
  return <li>
    <div className="annMeta"><span>{a.from}</span><span>{fmtDateTime(a.publishedAt)}</span>{!a.read && <Pill status="new">New</Pill>}</div>
    <h4 className="annTitle">{a.title}</h4>
    <AnnouncementBody text={a.body} />
    {!a.read && <div><Button size="sm" variant="tertiary" busy={busy} onClick={onRead}>Mark read</Button></div>}
  </li>;
}

export function ClientAnnouncements() {
  const { list, busy, markRead } = useAnnouncements();
  const items = list.data?.items ?? [];
  return <div className="stack">
    <div className="pageHead"><div><h1>Announcements</h1><p className="sub">News from the Bioptime team and from your coach. Announcements are service news, never medical advice.</p></div></div>
    {list.error ? <Alert kind="error">{list.error}</Alert> : <Card>{!list.data ? <Skeleton rows={5} />
      : items.length ? <ul className="annList">{items.map((a) => <Item key={a.id} a={a} busy={busy === a.id} onRead={() => markRead(a)} />)}</ul>
      : <Empty title="No announcements" body="When the Bioptime team or your coach announces something, it appears here and you get a notification." />}</Card>}
  </div>;
}

export function AnnouncementsHomeCard() {
  const { list, busy, markRead } = useAnnouncements();
  const items = list.data?.items ?? [];
  const shown = [...items.filter((a) => !a.read), ...items.filter((a) => a.read)].slice(0, 2);
  const unread = list.data?.unread ?? 0;
  return <Card>
    <CardHead eyebrow="Announcements" title={!list.data ? 'Announcements' : unread ? `${unread} new` : items.length ? 'All read' : 'Nothing new'} right={<Link className="bp-btn bp-btn-tertiary bp-btn-sm" to="/announcements">All announcements</Link>} />
    {list.error ? <Alert kind="error">{list.error}</Alert> : !list.data ? <Skeleton rows={3} />
      : shown.length ? <ul className="annList">{shown.map((a) => <Item key={a.id} a={a} busy={busy === a.id} onRead={() => markRead(a)} />)}</ul>
      : <p className="small">News from the Bioptime team and from your coach appears here.</p>}
  </Card>;
}
