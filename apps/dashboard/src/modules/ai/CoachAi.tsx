/* /coach/ai: Coach AI for a coach. Choose one of your clients (or none, for a general outline) and what to draft, add
   instructions if you like, then review the drafts: edit, accept and copy, or discard. Nothing is ever sent to a client
   from here. While no AI provider is configured, the page shows exactly what is missing and every request is refused. */
import React, { useState } from 'react';
import { api } from '../../lib/api';
import { Card, CardHead, Field, Select, useApi } from '../../ui';
import { AiDraftPanel } from './shared';

type Clients = { items: Array<{ id: string; name: string; memberCode: string | null }> };

export default function CoachAi() {
  const clients = useApi(() => api.get<Clients>('/coach/clients?limit=100&sort=name'), []);
  const [memberId, setMemberId] = useState('');
  return <div className="stack">
    <div className="pageHead"><div><h1>Coach AI</h1><p className="sub">Drafts for you to read and edit. Nothing is sent to a client: you accept a draft and send it yourself.</p></div></div>
    <div className="grid">
      <div className="span8">
        <Card dense>
          <Field label="Client" hint="Only your assigned clients. A draft about a client needs their Coach AI consent.">
            <Select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
              <option value="">No client (a general outline from your instructions)</option>
              {(clients.data?.items ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}{c.memberCode ? ` · ${c.memberCode}` : ''}</option>)}
            </Select>
          </Field>
          {clients.error && <p className="muted">{clients.error}</p>}
        </Card>
      </div>
      <div className="span4">
        <Card dense>
          <CardHead eyebrow="How it works" title="You stay in charge" />
          <ul className="taskList">
            <li><span className="small">Drafts are never sent. You edit, accept and send them yourself.</span></li>
            <li><span className="small">A draft about a client needs their Coach AI consent; health detail only while they also share health records with you.</span></li>
            <li><span className="small">Phone, email, address, PIN code and date of birth are never taken from a client’s profile. Messages and your instructions are sent as written.</span></li>
            <li><span className="small">The AI provider is asked not to give medical advice or state nutrient values. That is a request, not a guarantee: review every draft before anything reaches your client.</span></li>
          </ul>
        </Card>
      </div>
    </div>
    <AiDraftPanel key={memberId || 'general'} memberId={memberId || null} />
  </div>;
}
