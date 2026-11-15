/* /admin/ai (ai.manage): Coach AI usage. Whether Coach AI is configured and exactly what is missing (provider and model,
   the API key in the server environment, the data-processing agreement, the retention decision), then counts from the
   audit log by purpose, coach and day: requests, refusals, drafts made, accepted and discarded. Never draft text,
   coaches' instructions or client details. */
import React, { useState } from 'react';
import { api, qs } from '../../lib/api';
import { Link } from '../../lib/nav';
import { addDaysIst, fmtDate, todayIst } from '../../lib/format';
import { Alert, Card, CardHead, Empty, Field, Input, Readout, Skeleton, Table, useApi } from '../../ui';
import { NotConfigured, type Requirement } from './shared';

type Counts = { requests: number; refused: number; drafted: number; accepted: number; discarded: number };
type Usage = {
  from: string; to: string;
  readiness: { configured: boolean; provider: string; model: string | null; missing: Requirement[]; retentionDays: number | null; promptVersion: string };
  totals: Counts; stored: Record<string, number>;
  byPurpose: Array<Counts & { purpose: string; label: string }>;
  byCoach: Array<Counts & { coachId: string; coachName: string }>;
  byDay: Array<{ date: string; requests: number; refused: number; accepted: number }>;
  note: string; demo: boolean;
};

export default function AdminAiUsage() {
  const [from, setFrom] = useState(addDaysIst(-29));
  const [to, setTo] = useState(todayIst());
  const usage = useApi(() => api.get<Usage>(`/admin/ai/usage${qs({ from, to })}`), [from, to]);
  const d = usage.data;
  return <div className="stack">
    <div className="pageHead"><div><h1>Coach AI usage</h1><p className="sub">Requests, refusals and reviews by purpose, coach and day. Counts only: draft text, coaches’ instructions and client details are never shown here.</p></div></div>
    <Card dense>
      <div className="row">
        <Field label="From"><Input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} /></Field>
        <Field label="To"><Input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} /></Field>
      </div>
    </Card>
    {usage.error && <Alert kind="error">{usage.error}</Alert>}
    {!d && !usage.error && <Skeleton rows={6} />}
    {d && <>
      {d.readiness.configured
        ? <Alert kind="success" title="Coach AI is configured">Provider {d.readiness.provider}{d.readiness.model ? `, model ${d.readiness.model}` : ''}. Drafts are kept {d.readiness.retentionDays} days.</Alert>
        : <NotConfigured missing={d.readiness.missing}>Coaches can open Coach AI, but every request is refused until each of these is in place. Nothing is generated in the meantime. Integrations lists the provider settings; the retention period is on <Link to="/modules">Modules</Link>.</NotConfigured>}
      <div className="grid">
        <div className="span3"><Card dense><Readout eyebrow="Requests" value={d.totals.requests} sub={`${fmtDate(`${d.from}T12:00:00Z`)} to ${fmtDate(`${d.to}T12:00:00Z`)}`} /></Card></div>
        <div className="span3"><Card dense><Readout eyebrow="Refused" value={d.totals.refused} sub="Not configured, or no client consent" /></Card></div>
        <div className="span3"><Card dense><Readout eyebrow="Accepted" value={d.totals.accepted} sub="Edited and kept by the coach" /></Card></div>
        <div className="span3"><Card dense><Readout eyebrow="Discarded" value={d.totals.discarded} sub="Text cleared at once" /></Card></div>
      </div>
      <div className="grid">
        <div className="span6"><Card><CardHead eyebrow="By purpose" title="What coaches asked for" />
          <Table dense label="Coach AI requests by purpose" head={<><th>Purpose</th><th className="num">Requests</th><th className="num">Refused</th><th className="num">Accepted</th></>}>
            {d.byPurpose.map((p) => <tr key={p.purpose}><td>{p.label}</td><td className="num">{p.requests}</td><td className="num">{p.refused}</td><td className="num">{p.accepted}</td></tr>)}
          </Table>
        </Card></div>
        <div className="span6"><Card><CardHead eyebrow="By coach" title="Who asked" />
          {d.byCoach.length ? <Table dense label="Coach AI requests by coach" head={<><th>Coach</th><th className="num">Requests</th><th className="num">Refused</th><th className="num">Accepted</th><th className="num">Discarded</th></>}>
            {d.byCoach.map((c) => <tr key={c.coachId}><td>{c.coachName}</td><td className="num">{c.requests}</td><td className="num">{c.refused}</td><td className="num">{c.accepted}</td><td className="num">{c.discarded}</td></tr>)}
          </Table> : <Empty title="No requests in this range" />}
        </Card></div>
      </div>
      <Card><CardHead eyebrow="By day (UTC)" title="Requests over the range" />
        {d.byDay.length ? <Table dense label="Coach AI requests by day" head={<><th>Day</th><th className="num">Requests</th><th className="num">Refused</th><th className="num">Accepted</th></>}>
          {d.byDay.map((x) => <tr key={x.date}><td>{fmtDate(`${x.date}T12:00:00Z`)}</td><td className="num">{x.requests}</td><td className="num">{x.refused}</td><td className="num">{x.accepted}</td></tr>)}
        </Table> : <Empty title="No requests in this range" />}
        <p className="muted" style={{ marginTop: 8 }}>{d.note} Drafts stored now: {Object.entries(d.stored).map(([k, v]) => `${k} ${v}`).join(', ')}. Prompt version {d.readiness.promptVersion}.</p>
      </Card>
    </>}
  </div>;
}
