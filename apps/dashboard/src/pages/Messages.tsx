import React, { Suspense, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Link, useNavigate } from '../lib/nav';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDateTime, relative } from '../lib/format';
import { Alert, Button, Card, Empty, Skeleton, Textarea, useApi, useToast, errorText } from '../ui';
import { useFeatures } from '../modules/runtime';
import { BADGES_EVENT } from '../shell/Shell';
import { ATTACH_ACCEPT, ATTACH_MAX_BYTES, ATTACH_MAX_PER_MESSAGE, AttachmentChips, fileToBase64, fmtBytes, openAttachment, type Attachment } from '../modules/messaging/shared';

/* Files on messages (M9, flag 'messaging'): while the flag is on, the member and their coach add PNG, JPEG, WebP or PDF
   files (5 MB each, checked by content on the server) to the next message, and anyone who may read the thread opens a
   file through a 5-minute token. Administrators read and open, never add. A file follows the conversation's own rule,
   not health sharing (api/domain/attachments.ts), so the member's composer says plainly that files go to their coach.
   When the list itself is refused (an administrator whose members.manage was taken away while the page was open gets
   403 PERMISSION_DENIED), the list card shows the error instead of an empty list; a thread that cannot be loaded shows
   its error in the thread card the same way.

   Coach AI (M11, flag 'ai'): in a coach's open thread, while the flag is on, a closed "Draft a reply" panel sits under
   the thread (modules/ai/shared.tsx AiDraftInline, loaded only then). It asks for a reply draft about this client, the
   coach edits it, and accepting puts the text into the reply box below the thread's messages: nothing is sent until the
   coach presses Send. Members and administrators never see it. The reply box empties when another conversation opens,
   so a reply or draft written for one client never goes to another. */

const AiDraftInline = React.lazy(() => import('../modules/ai/shared').then((m) => ({ default: m.AiDraftInline })));

export function Messages() {
  const { id } = useParams();
  const { isPrivileged, isMember, isCoach } = useAuth();
  const nav = useNavigate();
  const convs = useApi(() => api.get('/conversations'), [id]);
  const thread = useApi(() => (id ? api.get(`/conversations/${id}/messages?limit=100`) : Promise.resolve(null)), [id]);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const endRef = useRef<HTMLDivElement>(null);
  const features = useFeatures(true);
  const filesOn = !!features?.has('messaging');
  const aiOn = isCoach && !!features?.has('ai');
  useEffect(() => { setBody(''); }, [id]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  // the files this person added to this conversation and has not sent yet (kept by the server for a day)
  useEffect(() => { setPending([]); if (!id || !filesOn || isPrivileged) return; let alive = true; void api.get<{ pending: Attachment[] }>(`/conversations/${id}/attachments`).then((r) => { if (alive) setPending(r.pending ?? []); }, () => {}); return () => { alive = false; }; }, [id, filesOn, isPrivileged]);
  const openFile = (a: Attachment) => openAttachment(a.id, (e) => toast(errorText(e), 'error'));
  const addFiles = async (picked: FileList | null) => {
    const list = Array.from(picked ?? []);
    if (fileRef.current) fileRef.current.value = '';
    if (!list.length || !id) return;
    const room = ATTACH_MAX_PER_MESSAGE - pending.length;
    if (list.length > room) toast(`At most ${ATTACH_MAX_PER_MESSAGE} files on one message`, 'error');
    setUploading(true);
    try {
      for (const f of list.slice(0, Math.max(0, room))) {
        if (f.size > ATTACH_MAX_BYTES) { toast(`${f.name} is larger than ${fmtBytes(ATTACH_MAX_BYTES)}`, 'error'); continue; }
        try { const a = await api.post<Attachment>(`/conversations/${id}/attachments`, { dataBase64: await fileToBase64(f), filename: f.name }); setPending((p) => [...p, a]); }
        catch (e) { toast(`${f.name}: ${errorText(e)}`, 'error'); }
      }
    } finally { setUploading(false); }
  };
  const removeFile = async (a: Attachment) => { setRemoving(a.id); try { await api.del(`/conversations/${id}/attachments/${a.id}`); setPending((p) => p.filter((x) => x.id !== a.id)); } catch (e) { toast(errorText(e), 'error'); } finally { setRemoving(null); } };
  // the open thread is read once its messages have loaded (and again after a send): then the unread badges on the
  // list and in the navigation are refreshed. Administrators only read threads for support and never mark them read
  // (the server refuses it), so no call is made for them.
  const loadedId = (thread.data as any)?.conversation?.id as string | undefined;
  useEffect(() => {
    if (!id || isPrivileged || loadedId !== id) return;
    let alive = true;
    api.post(`/conversations/${id}/read`).then(() => { if (!alive) return; convs.reload(); window.dispatchEvent(new Event(BADGES_EVENT)); }, () => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, thread.data, isPrivileged, loadedId]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [thread.data]);
  const list = ((convs.data as any)?.items ?? []) as any[];
  const t = thread.data as any;
  const open = list.find((c) => c.id === id);
  // administrators read both sides of a thread, so each message names who wrote it
  const who = (m: any) => (m.senderId === t?.conversation?.memberId ? open?.memberName ?? 'Member' : m.senderId === t?.conversation?.coachId ? open?.coachName ?? 'Coach' : 'Bioptime');
  // the client of the open thread, once that thread (not the previous one) has loaded: the server lists and opens a
  // coach's threads only with clients assigned to them (api/domain/messaging.ts)
  const aiMember: string | null = aiOn && id && !thread.error && t?.conversation?.id === id ? t.conversation.memberId : null;
  const send = async () => { if (!body.trim() && !pending.length) return; setBusy(true); try { await api.post(`/conversations/${id}/messages`, { body: body.trim(), ...(pending.length ? { attachmentIds: pending.map((a) => a.id) } : {}) }); setBody(''); setPending([]); thread.reload(); convs.reload(); } catch (e) { toast(errorText(e), 'error'); } finally { setBusy(false); } };
  return <div className="stack">
    <div className="pageHead"><div><h1>Messages</h1><p className="sub">{isPrivileged ? 'Administrators can read threads for support; writing is between a member and their coach.' : isMember ? 'With your coach. Messages stay here; a notification only says one arrived. Nothing here is medical advice.' : 'Your conversations with assigned clients. Keep health detail in the app, not in notifications.'}</p></div></div>
    <div className="grid">
      <div className="span4"><Card dense>{convs.error ? <Alert kind="error">{convs.error}</Alert> : convs.loading && !convs.data ? <Skeleton /> : list.length ? <div className="stack">{list.map((c) => <button key={c.id} className="bp-sideitem" style={{ width: '100%', textAlign: 'left', border: 0, background: id === c.id ? 'var(--bp-color-action-secondaryHover)' : 'transparent', cursor: 'pointer' }} onClick={() => nav(`/messages/${c.id}`)}><span><b style={{ color: 'var(--bp-color-text-primary)' }}>{isPrivileged ? `${c.memberName} ↔ ${c.coachName}` : isMember ? c.coachName ?? 'Your coach' : c.memberName}</b><div className="muted">{c.lastBody ?? 'No messages yet'} · {relative(c.lastMessageAt)}</div></span>{c.unread ? <span className="bp-badge">{c.unread}</span> : null}</button>)}</div> : <Empty title="No conversations" body="A conversation opens when a coach is assigned." />}</Card></div>
      <div className="span8"><div className="stack"><Card>{!id ? <Empty title={isMember ? (list.length ? 'Pick a conversation' : 'No conversation yet') : 'Pick a conversation'} body={isMember && !list.length ? 'It opens when a coach is assigned to you.' : undefined} /> : thread.error ? <Alert kind="error">{thread.error}</Alert> : !t ? <Skeleton /> : <>
        <div className="row between" style={{ marginBottom: 10 }}><b style={{ color: 'var(--bp-color-text-primary)' }}>{isMember ? open?.coachName ?? 'Your coach' : isPrivileged && open ? `${open.memberName} ↔ ${open.coachName}` : open?.memberName}</b>{!isMember && <Link className="bp-btn bp-btn-tertiary bp-btn-sm" to={`/clients/${t.conversation.memberId}`}>Open client</Link>}</div>
        <div className="thread">{t.items.map((m: any) => <div key={m.id} className={`msg ${m.mine ? 'mine' : ''}`}>{m.body ? <div className="bubble">{m.body}</div> : null}{m.attachments?.length ? <AttachmentChips items={m.attachments} onOpen={filesOn ? openFile : undefined} /> : null}<time>{isPrivileged ? `${who(m)} · ` : ''}{fmtDateTime(m.createdAt)}{m.mine && m.readAt ? ' · read' : ''}</time></div>)}{!t.items.length && <p className="muted">No messages yet. Say hello.</p>}<div ref={endRef} /></div>
        {!isPrivileged && <div className="form" style={{ marginTop: 12 }}><Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder={isMember ? 'Write to your coach' : 'Write to the member. Plain, warm, candid about limits.'} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void send(); }} />{filesOn && <div className="msgAttachBar"><AttachmentChips items={pending} onOpen={openFile} onRemove={removeFile} busy={removing} /><input ref={fileRef} className="msgAttachInput" type="file" accept={ATTACH_ACCEPT} multiple tabIndex={-1} aria-hidden="true" onChange={(e) => void addFiles(e.target.files)} /><Button size="sm" variant="tertiary" busy={uploading} disabled={pending.length >= ATTACH_MAX_PER_MESSAGE} onClick={() => fileRef.current?.click()}>Add a file</Button><span className="muted small">PNG, JPEG, WebP or PDF, up to {fmtBytes(ATTACH_MAX_BYTES)} each.{isMember ? ' Files you send go to your coach, who can open them even while health sharing is off.' : ''}</span></div>}<div className="row between"><span className="muted">{isMember ? '⌘/Ctrl+Enter to send. Your coach reads messages during working hours; in an emergency call 112.' : '⌘/Ctrl+Enter to send. Never diagnose; point to a doctor when a result needs one.'}</span><Button variant="primary" busy={busy} disabled={(!body.trim() && !pending.length) || uploading} onClick={send}>Send</Button></div></div>}
      </>}</Card>
        {aiMember && <Suspense fallback={null}><AiDraftInline key={aiMember} memberId={aiMember} purpose="message_reply" title="Draft a reply"
          intro="Ask Coach AI for a reply to this client’s latest messages and edit it here. Accepting puts it in your reply box; nothing is sent until you press Send."
          use={{ accept: 'Accept and put in your reply', again: 'Put in your reply', done: 'It is in your reply box above. Nothing is sent until you press Send.', set: setBody }} /></Suspense>}
      </div></div>
    </div>
  </div>;
}
