/* /admin/imports (imports.manage; a members file also needs members.view_restricted): move existing clients onto
   Bioptime. A CSV is checked in a dry run and staged with its error report; Apply creates the records once; for
   members, Send invitations sends the activation links, and nothing is sent before that. */
import React, { useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Link, useNavigate } from '../../lib/nav';
import { fmtDateTime, label } from '../../lib/format';
import { Alert, Button, Card, CardHead, Empty, Field, Pill, ReasonDialog, Select, Skeleton, Table, useApi, useToast, errorText } from '../../ui';
import './support.css';

type Kind = 'members' | 'progress_history';
type Columns = Record<Kind, { required: string[]; optional: string[]; example: string }>;
type Report = { rowCount: number; validCount: number; invalidCount: number; fileErrors: Array<{ code: string; message: string }>; errors: Array<{ row: number; errors: string[] }> };
type Job = { id: string; kind: Kind; status: string; fileName: string; fileSha256: string; rowCount: number; validCount: number; invalidCount: number; appliedCount: number; invitedCount: number; outcomes: Record<string, number>; fileErrors: Array<{ code: string; message: string }>; createdAt: string; createdBy: string | null; appliedAt: string | null; appliedBy: string | null; invitedAt: string | null; invitedBy: string | null; columns: Columns[Kind]; rows?: Array<{ row: number; outcome: string; data: Record<string, unknown>; errors: string[]; recordId: string | null }> };

const KIND_LABEL: Record<Kind, string> = { members: 'Members', progress_history: 'Progress history' };
const OUTCOME_PILL: Record<string, string> = { valid: 'active', invalid: 'failed', created: 'completed', invited: 'completed', skipped: 'cancelled', pending: 'pending' };
const STATUS_PILL: Record<string, string> = { uploaded: 'pending', validated: 'scheduled', applied: 'completed', failed: 'failed', cancelled: 'cancelled' };

export default function AdminImports() {
  const { id } = useParams();
  return id ? <ImportDetail id={id} /> : <ImportsHome />;
}

function ImportsHome() {
  const { can } = useAuth();
  const list = useApi(() => api.get<{ items: Job[]; columns: Columns; maxRows: number }>('/admin/imports'), []);
  const toast = useToast();
  const nav = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<Kind>('progress_history');
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState<'check' | 'stage' | null>(null);
  const contact = can('members.view_restricted');
  const cols = list.data?.columns?.[kind];
  const pick = (f: File | undefined) => {
    setReport(null);
    if (!f) { setFile(null); return; }
    if (f.size > 1024 * 1024) { toast('Files are limited to 1 MB; split it into smaller files', 'error'); return; }
    const reader = new FileReader();
    reader.onload = () => setFile({ name: f.name, text: String(reader.result ?? '') });
    reader.onerror = () => toast('The file could not be read', 'error');
    reader.readAsText(f);
  };
  const run = async (dryRun: boolean) => {
    if (!file) return;
    setBusy(dryRun ? 'check' : 'stage');
    try {
      const r = await api.post<Report & Job & { report?: Report }>('/admin/imports', { kind, fileName: file.name, csv: file.text, dryRun });
      if (dryRun) setReport(r); else { toast('Staged for review: nothing is created until you apply it'); nav(`/imports/${r.id}`); }
    } catch (e) { toast(errorText(e), 'error'); } finally { setBusy(null); }
  };
  const items = list.data?.items ?? [];
  return <div className="stack">
    <div className="pageHead"><div><h1>Imports</h1><p className="sub">Bring existing clients and their history onto Bioptime from a CSV file. Every file is checked first; records are created only when you apply it, and members receive their activation link only when you send the invitations.</p></div></div>
    {list.error && <Alert kind="error">{list.error}</Alert>}
    <div className="grid">
      <div className="span6"><Card><CardHead eyebrow="New import" title="Check a file" />
        <div className="form">
          <Field label="What the file holds"><Select value={kind} onChange={(e) => { setKind(e.target.value as Kind); setReport(null); }}><option value="progress_history">Progress history (weights, sleep, steps …)</option><option value="members" disabled={!contact}>Members (invited accounts){contact ? '' : ' · needs the restricted contact fields permission'}</option></Select></Field>
          {cols && <div className="small">Header row: <code className="supCsv">{cols.example}</code><div className="muted">Required: {cols.required.join(', ')}.{cols.optional.length ? ` Optional: ${cols.optional.join(', ')}.` : ''} At most {list.data?.maxRows} rows and 1 MB.{kind === 'progress_history' ? ' member is an email address or a member ID (BPM-00000); metric and unit come from the metric catalogue; at is a date (2026-03-14) or a date and time with its offset.' : ' Phone numbers include the country code.'}</div></div>}
          <Field label="CSV file"><input ref={fileRef} className="bp-input bp-input-dense" type="file" accept=".csv,text/csv" onChange={(e) => pick(e.target.files?.[0])} /></Field>
          <div className="row"><Button busy={busy === 'check'} disabled={!file} onClick={() => run(true)}>Check only</Button><Button variant="primary" busy={busy === 'stage'} disabled={!file} onClick={() => run(false)}>Check and stage</Button></div>
          <span className="muted small">Check only stores nothing. Check and stage keeps the file’s rows and error report for review; no account, value or message is created.</span>
        </div>
      </Card></div>
      <div className="span6">{report ? <ReportCard report={report} /> : <Card><CardHead eyebrow="Provenance" title="Every imported record says where it came from" /><p className="small">Imported progress values carry the source “import” and a note naming the file, the import and the row. Each imported account records the same in its history. Nothing is guessed or filled in: a row with a problem is reported and left out.</p></Card>}</div>
    </div>
    <Card dense><CardHead eyebrow="History" title="Imports" />{!list.data && !list.error ? <Skeleton rows={4} /> : items.length ? <Table label="Imports" head={<><th>File</th><th>Kind</th><th>Status</th><th className="num">Valid rows</th><th>Staged</th></>}>{items.map((j) => <tr key={j.id} className="link" onClick={() => nav(`/imports/${j.id}`)}><td><Link to={`/imports/${j.id}`}>{j.fileName}</Link></td><td>{KIND_LABEL[j.kind]}</td><td><Pill status={STATUS_PILL[j.status] ?? j.status}>{label(j.status)}</Pill></td><td className="num">{j.validCount} / {j.rowCount}</td><td className="small">{fmtDateTime(j.createdAt)}{j.createdBy ? ` · ${j.createdBy}` : ''}</td></tr>)}</Table> : <Empty title="No imports yet" />}</Card>
  </div>;
}

function ReportCard({ report }: { report: Report }) {
  return <Card><CardHead eyebrow="Dry run" title={`${report.validCount} of ${report.rowCount} rows ready`} right={<Pill status={report.fileErrors.length || report.invalidCount ? 'pending' : 'active'}>{report.fileErrors.length ? 'File problems' : report.invalidCount ? `${report.invalidCount} with errors` : 'All rows valid'}</Pill>} />
    {report.fileErrors.map((e) => <Alert key={e.code} kind="error">{e.message}</Alert>)}
    {report.errors.length ? <Table dense label="Rows with errors" head={<><th className="num">Row</th><th>Problems</th></>}>{report.errors.slice(0, 200).map((e) => <tr key={e.row}><td className="num">{e.row}</td><td className="small">{e.errors.join(' · ')}</td></tr>)}</Table> : !report.fileErrors.length && <p className="small">Nothing to fix. Stage it to review the rows and apply.</p>}
    {report.errors.length > 200 && <p className="muted small">The first 200 rows with errors are listed.</p>}
  </Card>;
}

function ImportDetail({ id }: { id: string }) {
  const { can } = useAuth();
  const r = useApi(() => api.get<Job>(`/admin/imports/${id}`), [id]);
  const toast = useToast();
  const [dlg, setDlg] = useState<null | 'apply' | 'invite' | 'cancel'>(null);
  const j = r.data;
  const contactOk = !j || j.kind !== 'members' || can('members.view_restricted');
  const pending = j?.outcomes?.created ?? 0;
  const describe = (row: NonNullable<Job['rows']>[number]) => {
    const d = row.data as Record<string, string | number | undefined>;
    return j?.kind === 'members' ? [d.name, d.email, d.phone].filter(Boolean).join(' · ') : [d.member, d.metric && `${d.metric} ${d.value ?? ''} ${d.unit ?? ''}`, d.at, d.note].filter(Boolean).join(' · ');
  };
  return <div className="stack">
    <div className="pageHead"><div><h1>{j?.fileName ?? 'Import'}</h1><p className="sub">{j ? `${KIND_LABEL[j.kind]} · staged ${fmtDateTime(j.createdAt)}${j.createdBy ? ` by ${j.createdBy}` : ''}` : ' '}</p></div><div className="actions">{j && <Pill status={STATUS_PILL[j.status] ?? j.status}>{label(j.status)}</Pill>}<Link className="bp-btn bp-btn-tertiary bp-btn-sm" to="/imports">All imports</Link></div></div>
    {r.error ? <Alert kind="error">{r.error}</Alert> : !j ? <Skeleton rows={6} /> : <>
      {!contactOk && <Alert kind="warning" title="Contact fields hidden">This members import needs the “View members’ restricted contact fields” permission to apply or send; phone numbers are not shown.</Alert>}
      {j.fileErrors.map((e) => <Alert key={e.code} kind="error">{e.message}</Alert>)}
      <div className="grid">
        <div className="span8"><Card><CardHead eyebrow="Rows" title={`${j.validCount} valid · ${j.invalidCount} with errors`} />{j.rows?.length ? <Table dense label="Import rows" head={<><th className="num">Row</th><th>Outcome</th><th>Data</th><th>Problems</th></>}>{j.rows.map((row) => <tr key={row.row}><td className="num">{row.row}</td><td><Pill status={OUTCOME_PILL[row.outcome] ?? 'pending'}>{label(row.outcome)}</Pill></td><td className="small">{describe(row)}</td><td className="small">{row.errors.join(' · ')}</td></tr>)}</Table> : <Empty title="No rows" body="The file could not be read; see the problems above." />}</Card></div>
        <div className="span4"><Card><CardHead eyebrow="Steps" title="Review, apply, invite" />
          <dl className="kv"><dt>File</dt><dd>{j.fileName}</dd><dt>SHA-256</dt><dd className="supCsv">{j.fileSha256.slice(0, 16)}…</dd><dt>Checked</dt><dd>{j.rowCount} rows</dd><dt>Applied</dt><dd>{j.appliedAt ? `${j.appliedCount} created · ${fmtDateTime(j.appliedAt)}${j.appliedBy ? ` · ${j.appliedBy}` : ''}` : 'Not yet'}</dd>{j.kind === 'members' && <><dt>Invitations</dt><dd>{j.invitedCount ? `${j.invitedCount} sent${j.invitedAt ? ` · ${fmtDateTime(j.invitedAt)}` : ''}` : 'None sent'}</dd></>}</dl>
          <div className="stack" style={{ marginTop: 12 }}>
            {j.status === 'validated' && <Button variant="primary" disabled={!contactOk} onClick={() => setDlg('apply')}>Apply {j.validCount} row{j.validCount === 1 ? '' : 's'}</Button>}
            {j.kind === 'members' && j.status === 'applied' && pending > 0 && <Button variant="primary" disabled={!contactOk} onClick={() => setDlg('invite')}>Send {pending} invitation{pending === 1 ? '' : 's'}</Button>}
            {(j.status === 'validated' || j.status === 'failed' || j.status === 'uploaded') && <Button variant="tertiary" disabled={!contactOk} onClick={() => setDlg('cancel')}>Withdraw this import</Button>}
            <p className="muted small">{j.kind === 'members' ? 'Applying creates the accounts in the invited state, without a password and without any message. Members hear from Bioptime only when you send the invitations: a single-use activation link that expires in 72 hours.' : 'Applying writes each valid value to the member’s progress with the source “import” and a note naming this file and row. The same value is never imported twice.'}</p>
          </div>
        </Card></div>
      </div>
    </>}
    <ReasonDialog open={!!dlg} onClose={() => setDlg(null)}
      title={dlg === 'apply' ? `Apply ${j?.validCount ?? 0} rows?` : dlg === 'invite' ? `Send ${pending} invitations?` : 'Withdraw this import?'}
      confirmLabel={dlg === 'apply' ? 'Apply' : dlg === 'invite' ? 'Send invitations' : 'Withdraw'} danger={dlg === 'cancel'}
      body={dlg === 'apply' ? (j?.kind === 'members' ? 'Each valid row becomes an invited account. No email is sent.' : 'Each valid row becomes a progress value with the source “import”.') : dlg === 'invite' ? 'Each member gets an email with a single-use activation link that expires in 72 hours. Rows already invited are skipped.' : 'Nothing was created from it; it stays listed as withdrawn.'}
      onConfirm={async (reason) => {
        const path = dlg === 'apply' ? 'apply' : dlg === 'invite' ? 'send-invitations' : 'cancel';
        const out = await api.post<{ sent?: number; alreadyApplied?: boolean }>(`/admin/imports/${id}/${path}`, { reason });
        toast(dlg === 'apply' ? (out.alreadyApplied ? 'Already applied; nothing changed' : 'Applied') : dlg === 'invite' ? `${out.sent ?? 0} invitation${out.sent === 1 ? '' : 's'} sent` : 'Withdrawn');
        r.reload();
      }} />
  </div>;
}
