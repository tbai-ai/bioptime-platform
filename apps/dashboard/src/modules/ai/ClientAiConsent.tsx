/* /client/coach-ai: Coach AI and the member's data. Whether Coach AI is in use at all, the ai_processing consent (its
   wording is a draft pending counsel and says so; outside the demo it cannot be given yet and the page names what is
   missing), giving and withdrawing it, and how drafts work. Members never see drafts: a coach sends only what they
   wrote and chose to send.

   The wording lists, line by line, exactly what a draft request can send (the API's AI_CONSENT_DATA). A consent given
   under an earlier wording is shown as such and is not used until the member agrees again. Withdrawing works whenever
   a consent is on record, even while the module is off for the member (the API leaves /me/ai/consent ungated); the
   module registry keeps this page and its link while the flag is off as long as a consent is on record (whileOff:
   aiConsentOnRecord in ./module). */
import React, { useState } from 'react';
import { api } from '../../lib/api';
import { Link } from '../../lib/nav';
import { refreshFeatures } from '../runtime';
import { fmtDate } from '../../lib/format';
import { Alert, Button, Card, CardHead, ConfirmDialog, Pill, Skeleton, useApi, useToast, errorText } from '../../ui';

export type ConsentState = {
  granted: boolean; current: boolean; earlierWording: boolean; version: string | null; at: string | null;
  wording: { version: string; status: string; label: string; text: string; intro?: string; items?: string[]; outro?: string };
  moduleOn: boolean; canGrant: boolean; missing: string | null; healthShared: boolean; inUse: boolean; note: string; demo: boolean;
};

/** The wording as the member reads it: the opening, the list of what can be sent, the closing. */
function Wording({ w }: { w: ConsentState['wording'] }) {
  if (!w.items?.length) return <p className="small">{w.text}</p>;
  return <>
    <p className="small">{w.intro}</p>
    <ul className="taskList" style={{ marginTop: 8 }}>{w.items.map((t) => <li key={t}><span className="small">{t}</span></li>)}</ul>
    <p className="small" style={{ marginTop: 8 }}>{w.outro}</p>
  </>;
}

export default function ClientAiConsent() {
  const state = useApi(() => api.get<ConsentState>('/me/ai/consent'), []);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [withdraw, setWithdraw] = useState(false);
  const d = state.data;
  if (state.error) return <Alert kind="error">{state.error}</Alert>;
  if (!d) return <Skeleton rows={6} />;
  const agree = async () => {
    setBusy(true);
    try { await api.post('/me/ai/consent', { granted: true, version: d.wording.version }); toast('Consent recorded'); state.reload(); }
    catch (e) { toast(errorText(e), 'error'); } finally { setBusy(false); }
  };
  return <div className="stack">
    <div className="pageHead"><div><h1>Coach AI and your data</h1><p className="sub">Your coach may use Coach AI to help write drafts for you, only if you agree here. Your coach reads and edits every draft; nothing is sent to you automatically.</p></div></div>
    <Alert kind="info" title={d.inUse ? 'Coach AI is in use' : d.moduleOn ? 'Coach AI is not in use yet' : 'Coach AI is switched off'}>{d.note}</Alert>
    <div className="grid">
      <div className="span8"><Card accent={!d.current && d.canGrant}>
        <CardHead eyebrow="Your consent" title={d.granted ? `Given ${fmtDate(d.at)}` : 'Not given'} />
        <span className="bp-pill bp-pill-warning pillWrap">{d.wording.label}</span>
        {d.earlierWording && <Alert kind="warning" title="The wording has changed">You agreed to an earlier wording. Your coach cannot use Coach AI for drafts about you until you agree to the wording below. You can also withdraw your earlier consent.</Alert>}
        <Wording w={d.wording} />
        <div className="row" style={{ marginTop: 12 }}>
          {!d.current && d.canGrant && <Button variant="primary" size="sm" busy={busy} onClick={agree}>{d.earlierWording ? 'I agree to this wording' : 'I agree'}</Button>}
          {d.granted && <Button variant="secondary" size="sm" onClick={() => setWithdraw(true)}>Withdraw consent</Button>}
          {d.current && <Pill status="active">Agreed</Pill>}
        </div>
        {!d.current && !d.canGrant && (d.moduleOn
          ? <Alert kind="warning" title="Not available yet">Pending configuration. Missing: {d.missing}</Alert>
          : <Alert kind="info" title="Coach AI is switched off for your account">{d.granted ? 'You cannot agree to it now. You can withdraw the consent you gave.' : 'There is nothing to agree to now.'}</Alert>)}
      </Card></div>
      <div className="span4"><Card>
        <CardHead eyebrow="What is included" title="Only what your coach can see" />
        <dl className="kv">
          <dt>Health records</dt><dd>{d.healthShared ? 'Included only while you share them with your coach (you do now)' : 'Not included: you do not share them with your coach'}</dd>
          <dt>Never taken from your profile</dt><dd>Your phone, email, address, PIN code and date of birth. Messages are sent as you wrote them.</dd>
          <dt>Drafts</dt><dd>Seen only by your coach, who reviews every draft; you receive only what your coach writes and sends</dd>
        </dl>
        <p className="muted" style={{ marginTop: 10 }}>Health sharing with your coach is under <Link to="/profile">Profile</Link>.</p>
      </Card></div>
    </div>
    <ConfirmDialog open={withdraw} onClose={() => setWithdraw(false)} title="Withdraw your Coach AI consent?" confirmLabel="Withdraw" danger
      body="Your coach can no longer ask Coach AI for drafts about you, and any open drafts about you are discarded. You can agree again later."
      onConfirm={async () => { await api.post('/me/ai/consent', { granted: false }); toast('Consent withdrawn'); refreshFeatures(); state.reload(); }} />
  </div>;
}
