/* Growth: the team's notes on a request (never shown to the person or to a coach) and the box to add one. */
import React, { useState } from 'react';
import { api } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { Button, Card, CardHead, Empty, Textarea, useToast, errorText } from '../../ui';
import type { Note } from './shared';

export function Notes({ notes, path, onSaved }: { notes: Note[]; path: string; onSaved: () => void }) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const add = async () => {
    if (body.trim().length < 2) return;
    setBusy(true);
    try { await api.post(path, { body: body.trim() }); setBody(''); toast('Note added'); onSaved(); }
    catch (e) { toast(errorText(e), 'error'); } finally { setBusy(false); }
  };
  return <Card><CardHead eyebrow="Team notes" title={`${notes.length} note${notes.length === 1 ? '' : 's'}`} />
    {notes.length ? <ul className="timeline">{notes.map((n) => <li key={n.id}><span className="small muted">{n.author?.name ?? 'The team'} · {fmtDateTime(n.createdAt)}</span><div style={{ whiteSpace: 'pre-wrap' }}>{n.body}</div></li>)}</ul> : <Empty title="No notes yet" body="Notes stay with the team: the person and any coach never see them." />}
    <div className="form" style={{ marginTop: 12 }}>
      <Textarea value={body} maxLength={2000} onChange={(e) => setBody(e.target.value)} placeholder="What happened, what was agreed, what comes next." aria-label="New note" />
      <div className="row between"><span className="muted small">Saved with your name and the time; the audit log records that a note was added, not its words.</span><Button size="sm" busy={busy} disabled={body.trim().length < 2} onClick={add}>Add note</Button></div>
    </div>
  </Card>;
}
