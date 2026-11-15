/* Admin › Imports (the web's /admin/imports, modules/support/AdminImports.tsx ImportsHome; support module, the imports
   part, imports.manage; a members file also needs members.view_restricted): bring existing clients and their history
   onto Bioptime from a CSV. A file picked on the phone is checked in a dry run (POST /admin/imports { dryRun: true }:
   nothing stored) or staged for review (dryRun false: the rows and error report kept, nothing else written), then
   opened at /admin/imports/:id to apply, invite or withdraw. History: GET /admin/imports. */
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { errorText, get, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDateTime } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { Code } from '@/components/adminA/parts';
import { useToast } from '@/components/adminA/toast';
import { DetailRow, LoadError } from '@/components/adminB1/parts';
import { Button, Card, Empty, Eyebrow, Field, H2, Loading, Notice, P, Pill, Row } from '@/components/ui';
import { RecordList } from '@/components/workspace';
import { PickerField } from '@/components/coachModules/shared';
import { AdminModuleScreen, setPendingToast, useScreenRefresh } from '@/components/adminModules/shared';
import { JobStatusPill, KIND_LABEL, pickCsv, type Columns, type DryRunReport, type ImportJob, type ImportKind } from '@/components/adminModules/imports';
import { Enter } from '@/motion';
import { colors, font, space } from '@/theme';

export default function AdminImportsScreen() {
  return <AdminModuleScreen title="Imports" module="support" feature="imports" permission="imports.manage"
    sub="Bring existing clients and their history onto Bioptime from a CSV file. Every file is checked first; records are created only when you apply it, and members receive their activation link only when you send the invitations.">
    <ImportsHome />
  </AdminModuleScreen>;
}

function ImportsHome() {
  const { can } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [tick, setTick] = useState(0);
  const list = useLoad<{ items: ImportJob[]; columns: Columns; maxRows: number }>('admin-imports', () => get('/admin/imports'), [tick]);
  const pull = useScreenRefresh(list.loading, list.stale);
  useEffect(() => { if (pull) setTick((n) => n + 1); }, [pull]);
  const [kind, setKind] = useState<ImportKind>('progress_history');
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [report, setReport] = useState<DryRunReport | null>(null);
  const [busy, setBusy] = useState<'check' | 'stage' | 'pick' | null>(null);
  const contact = can('members.view_restricted');
  const cols = list.data?.columns?.[kind];
  const choose = async () => {
    setBusy('pick'); setReport(null);
    try {
      const r = await pickCsv();
      if (!r) return;
      if ('error' in r) { setFile(null); toast.show(r.error, 'error'); return; }
      setFile(r);
    } catch (e) { toast.show(errorText(e), 'error'); } finally { setBusy(null); }
  };
  const run = async (dryRun: boolean) => {
    if (!file) return;
    setBusy(dryRun ? 'check' : 'stage');
    try {
      const r = await post<DryRunReport & ImportJob>('/admin/imports', { kind, fileName: file.name, csv: file.text, dryRun });
      if (dryRun) setReport(r);
      else { setPendingToast('Staged for review: nothing is created until you apply it'); setFile(null); void list.reload(); router.push(`/admin/imports/${r.id}` as never); }
    } catch (e) { toast.show(errorText(e), 'error'); } finally { setBusy(null); }
  };
  const items = list.data?.items ?? [];
  return <View style={{ gap: space.md }}>
    {toast.node}
    <LoadError title="Imports could not be loaded" error={list.error} onRetry={list.reload} />
    <Enter index={1}><Card>
      <Eyebrow>New import</Eyebrow><H2>Check a file</H2>
      <PickerField label="What the file holds" value={kind} onChange={(v) => { setKind(v as ImportKind); setReport(null); }}
        options={[{ value: 'progress_history', label: 'Progress history (weights, sleep, steps …)' }, { value: 'members', label: `Members (invited accounts)${contact ? '' : ' · needs the restricted contact fields permission'}`, disabled: !contact }]} />
      {cols ? <View style={{ gap: space.xs, marginBottom: space.md }}>
        <Text style={{ color: colors.text, fontSize: font.small }}>Header row:</Text>
        <Code>{cols.example}</Code>
        <P muted small>{`Required: ${cols.required.join(', ')}.${cols.optional.length ? ` Optional: ${cols.optional.join(', ')}.` : ''} At most ${list.data?.maxRows ?? ''} rows and 1 MB.${kind === 'progress_history' ? ' member is an email address or a member ID (BPM-00000); metric and unit come from the metric catalogue; at is a date (2026-03-14) or a date and time with its offset.' : ' Phone numbers include the country code.'}`}</P>
      </View> : null}
      <Field label="CSV file" hint={file ? undefined : 'No file chosen.'}>
        <Row>
          <Button title={file ? 'Choose another file' : 'Choose a CSV file'} variant="secondary" small busy={busy === 'pick'} onPress={() => void choose()} />
          {file ? <Text style={{ color: colors.text, fontSize: font.small, flexShrink: 1 }} accessibilityLabel={`Chosen file ${file.name}`}>{file.name}</Text> : null}
        </Row>
      </Field>
      <Row>
        <Button title="Check only" variant="secondary" busy={busy === 'check'} disabled={!file || !!busy} onPress={() => void run(true)} />
        <Button title="Check and stage" busy={busy === 'stage'} disabled={!file || !!busy} onPress={() => void run(false)} />
      </Row>
      <P muted small>Check only stores nothing. Check and stage keeps the file’s rows and error report for review; no account, value or message is created.</P>
    </Card></Enter>
    {report ? <ReportCard report={report} /> : <Enter index={2}><Card>
      <Eyebrow>Provenance</Eyebrow><H2>Every imported record says where it came from</H2>
      <P small>Imported progress values carry the source “import” and a note naming the file, the import and the row. Each imported account records the same in its history. Nothing is guessed or filled in: a row with a problem is reported and left out.</P>
    </Card></Enter>}
    <Enter index={3}><View>
      {!list.data && !list.error ? <Loading /> : items.length ? <RecordList title="History · Imports">
        {items.map((j, i) => <DetailRow key={j.id} last={i === items.length - 1} title={j.fileName}
          lines={[`${KIND_LABEL[j.kind]} · ${j.validCount} / ${j.rowCount} valid rows`, `Staged ${fmtDateTime(j.createdAt)}${j.createdBy ? ` · ${j.createdBy}` : ''}`]}
          right={<JobStatusPill status={j.status} />} onPress={() => router.push(`/admin/imports/${j.id}` as never)} />)}
      </RecordList> : list.data ? <Card><Eyebrow>History</Eyebrow><H2>Imports</H2><Empty title="No imports yet" /></Card> : null}
    </View></Enter>
  </View>;
}

function ReportCard({ report }: { report: DryRunReport }) {
  return <Card>
    <Row between style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
      <View style={{ flex: 1 }}><Eyebrow>Dry run</Eyebrow><H2>{`${report.validCount} of ${report.rowCount} rows ready`}</H2></View>
      <Pill tone={report.fileErrors.length || report.invalidCount ? 'warning' : 'success'}>{report.fileErrors.length ? 'File problems' : report.invalidCount ? `${report.invalidCount} with errors` : 'All rows valid'}</Pill>
    </Row>
    {report.fileErrors.map((e) => <Notice key={e.code} kind="error">{e.message}</Notice>)}
    {report.errors.length ? <View>{report.errors.slice(0, 200).map((e) => <View key={e.row} style={{ paddingVertical: space.xs, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <Text style={{ color: colors.text, fontSize: font.small, fontWeight: '600' }}>{`Row ${e.row}`}</Text>
      <Text style={{ color: colors.muted, fontSize: font.small }}>{e.errors.join(' · ')}</Text>
    </View>)}</View> : !report.fileErrors.length ? <P small>Nothing to fix. Stage it to review the rows and apply.</P> : null}
    {report.errors.length > 200 ? <P muted small>The first 200 rows with errors are listed.</P> : null}
  </Card>;
}
