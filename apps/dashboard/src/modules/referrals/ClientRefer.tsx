/* /client/refer: the member's personal referral link (GET /me/referrals; the code is made the first time), a share
   button (the device's share sheet where the browser has one, otherwise copy), and who joined with it, by first name and
   the date they joined. Nothing about a reward is shown or promised: rewards are an owner decision. */
import React, { useRef } from 'react';
import { api } from '../../lib/api';
import { fmtDate } from '../../lib/format';
import { Alert, Button, Card, CardHead, Empty, Field, Skeleton, useApi, useToast } from '../../ui';

type Mine = { code: string; link: string; joined: Array<{ id: string; firstName: string; joinedAt: string }> };

export function ClientRefer() {
  const mine = useApi(() => api.get<Mine>('/me/referrals'), []);
  const toast = useToast();
  const field = useRef<HTMLInputElement>(null);
  const d = mine.data;
  if (mine.error) return <Alert kind="error">{mine.error}</Alert>;
  if (!d) return <Skeleton rows={5} />;
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const copy = async () => {
    try { await navigator.clipboard.writeText(d.link); toast('Link copied'); }
    catch { field.current?.focus(); field.current?.select(); toast('Select the link and copy it', 'error'); }
  };
  const share = async () => {
    try { await navigator.share({ title: 'Bioptime', text: 'Here is my link to create a Bioptime account:', url: d.link }); }
    catch (e) { if ((e as { name?: string })?.name !== 'AbortError') void copy(); }
  };

  return <div className="stack">
    <div className="pageHead"><div><h1>Refer a friend</h1><p className="sub">Share your personal link. When a friend creates a Bioptime account with it, they appear here by first name.</p></div></div>
    <div className="grid">
      <div className="span8 stack">
        <Card><CardHead eyebrow="Your link" title={<span>Code <b>{d.code}</b></span>} />
          <div className="form">
            <Field label="Personal link" hint="Anyone who opens it can create an account with your code."><input ref={field} className="bp-input bp-input-dense" readOnly value={d.link} onFocus={(e) => e.currentTarget.select()} /></Field>
            <div className="row">
              {canShare && <Button variant="primary" size="sm" onClick={() => void share()}>Share</Button>}
              <Button variant={canShare ? 'secondary' : 'primary'} size="sm" onClick={() => void copy()}>Copy link</Button>
            </div>
          </div>
          <p className="muted small" style={{ marginTop: 12 }}>Rewards are set by the Bioptime team.</p>
        </Card>
      </div>
      <div className="span4 stack">
        <Card><CardHead eyebrow="With your link" title={d.joined.length ? `${d.joined.length} joined` : 'Who joined'} />
          {d.joined.length
            ? <ul className="taskList">{d.joined.map((j) => <li key={j.id}><div><span>{j.firstName}</span><span className="muted small">Joined {fmtDate(j.joinedAt)}</span></div></li>)}</ul>
            : <Empty title="No one yet" body="Friends who create an account with your link appear here." />}
          <p className="muted small" style={{ marginTop: 12 }}>You see only their first name and the date they joined.</p>
        </Card>
      </div>
    </div>
  </div>;
}
