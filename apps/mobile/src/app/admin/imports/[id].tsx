/* Admin › Imports › one import (the web's /admin/imports/:id, modules/support/AdminImports.tsx ImportDetail; support
   module, the imports part, imports.manage): the rows with their outcome and problems (GET /admin/imports/:id), and the
   steps: apply the valid rows once (POST …/apply), send the members' activation links (POST …/send-invitations), or
   withdraw an import that was not applied (POST …/cancel), each with a reason. A members import also needs
   members.view_restricted to apply or send; without it phone numbers are not shown. */
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { get, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDateTime } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { ReasonSheet } from '@/components/adminA/ReasonSheet';
import { useToast } from '@/components/adminA/toast';
import { LoadError } from '@/components/adminB1/parts';
import { Button, Card, Empty, Eyebrow, H2, Loading, Notice, P, Row } from '@/components/ui';
import { KeyValue } from '@/components/workspace';
import { AdminModuleScreen, takePendingToast, useScreenRefresh } from '@/components/adminModules/shared';
import { JobStatusPill, KIND_LABEL, OutcomePill, type ImportJob } from '@/components/adminModules/imports';
import { Enter } from '@/motion';
import { colors, font, space } from '@/theme';

type Dialog = null | 'apply' | 'invite' | 'cancel';

export default function AdminImportScreen() {
  return <AdminModuleScreen title="Import" noTitle module="support" feature="imports" permission="imports.manage">
    <ImportDetail />
  </AdminModuleScreen>;
}

function ImportDetail() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const { can } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [tick, setTick] = useState(0);
  // the rows carry contact fields: never kept on the device
  const r = useLoad<ImportJob>(null, () => get(`/admin/imports/${id}`), [id, tick]);
  const pull = useScreenRefresh(r.loading);
  React.useEffect(() => { if (pull) setTick((n) => n + 1); }, [pull]);
  const [dlg, setDlg] = useState<Dialog>(null);
  React.useEffect(() => { const t = takePendingToast(); if (t) toast.show(t); }, [toast.show]);
  const j = r.data;
  const contactOk = !j || j.kind !== 'members' || can('members.view_restricted');
  const pending = j?.outcomes?.created ?? 0;
  const describe = (row: NonNullable<ImportJob['rows']>[number]) => {
    const d = row.data as Record<string, string | number | undefined>;
    return j?.kind === 'members' ? [d.name, d.email, d.phone].filter(Boolean).join(' · ') : [d.member, d.metric && `${d.metric} ${d.value ?? ''} ${d.unit ?? ''}`, d.at, d.note].filter(Boolean).join(' · ');
  };
  return <View style={{ gap: space.md }}>
    <Enter><View style={{ gap: space.xs }}>
      <Text style={{ color: colors.text, fontSize: font.title, fontWeight: '700', letterSpacing: -0.5 }}>{j?.fileName ?? 'Import'}</Text>
      {j ? <Text style={{ color: colors.muted, fontSize: font.body, lineHeight: 21 }}>{`${KIND_LABEL[j.kind]} · staged ${fmtDateTime(j.createdAt)}${j.createdBy ? ` by ${j.createdBy}` : ''}`}</Text> : null}
      <Row>{j ? <JobStatusPill status={j.status} /> : null}<Button title="All imports" variant="ghost" small onPress={() => router.push('/admin/imports' as never)} /></Row>
    </View></Enter>
    {toast.node}
    {r.error ? <LoadError title="The import could not be loaded" error={r.error} onRetry={r.reload} /> : !j ? <Loading /> : <>
      {!contactOk ? <Notice kind="warning" title="Contact fields hidden">This members import needs the “View members’ restricted contact fields” permission to apply or send; phone numbers are not shown.</Notice> : null}
      {j.fileErrors.map((e) => <Notice key={e.code} kind="error">{e.message}</Notice>)}
      <Enter index={1}><Card>
        <Eyebrow>Rows</Eyebrow><H2>{`${j.validCount} valid · ${j.invalidCount} with errors`}</H2>
        {j.rows?.length ? j.rows.map((row) => <View key={row.row} style={{ paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 2 }}>
          <Row between style={{ flexWrap: 'nowrap' }}><Text style={{ color: colors.text, fontSize: font.small, fontWeight: '600' }}>{`Row ${row.row}`}</Text><OutcomePill outcome={row.outcome} /></Row>
          <Text style={{ color: colors.text, fontSize: font.small }}>{describe(row) || '—'}</Text>
          {row.errors.length ? <Text style={{ color: colors.errorText, fontSize: font.small }}>{row.errors.join(' · ')}</Text> : null}
        </View>) : <Empty title="No rows" body="The file could not be read; see the problems above." />}
      </Card></Enter>
      <Enter index={2}><Card>
        <Eyebrow>Steps</Eyebrow><H2>Review, apply, invite</H2>
        <KeyValue rows={[
          ['File', j.fileName],
          { label: 'SHA-256', value: `${j.fileSha256.slice(0, 16)}…`, mono: true },
          ['Checked', `${j.rowCount} rows`],
          ['Applied', j.appliedAt ? `${j.appliedCount} created · ${fmtDateTime(j.appliedAt)}${j.appliedBy ? ` · ${j.appliedBy}` : ''}` : 'Not yet'],
          ...(j.kind === 'members' ? [['Invitations', j.invitedCount ? `${j.invitedCount} sent${j.invitedAt ? ` · ${fmtDateTime(j.invitedAt)}` : ''}` : 'None sent'] as [string, string]] : []),
        ]} />
        <View style={{ gap: space.sm, marginTop: space.sm }}>
          {j.status === 'validated' ? <Button title={`Apply ${j.validCount} row${j.validCount === 1 ? '' : 's'}`} disabled={!contactOk} onPress={() => setDlg('apply')} /> : null}
          {j.kind === 'members' && j.status === 'applied' && pending > 0 ? <Button title={`Send ${pending} invitation${pending === 1 ? '' : 's'}`} disabled={!contactOk} onPress={() => setDlg('invite')} /> : null}
          {j.status === 'validated' || j.status === 'failed' || j.status === 'uploaded' ? <Button title="Withdraw this import" variant="ghost" disabled={!contactOk} onPress={() => setDlg('cancel')} /> : null}
          <P muted small>{j.kind === 'members' ? 'Applying creates the accounts in the invited state, without a password and without any message. Members hear from Bioptime only when you send the invitations: a single-use activation link that expires in 72 hours.' : 'Applying writes each valid value to the member’s progress with the source “import” and a note naming this file and row. The same value is never imported twice.'}</P>
        </View>
      </Card></Enter>
    </>}
    <ReasonSheet open={!!dlg} onClose={() => setDlg(null)} destructive={dlg === 'cancel'}
      title={dlg === 'apply' ? `Apply ${j?.validCount ?? 0} rows?` : dlg === 'invite' ? `Send ${pending} invitations?` : 'Withdraw this import?'}
      confirmLabel={dlg === 'apply' ? 'Apply' : dlg === 'invite' ? 'Send invitations' : 'Withdraw'}
      body={dlg === 'apply' ? (j?.kind === 'members' ? 'Each valid row becomes an invited account. No email is sent.' : 'Each valid row becomes a progress value with the source “import”.') : dlg === 'invite' ? 'Each member gets an email with a single-use activation link that expires in 72 hours. Rows already invited are skipped.' : 'Nothing was created from it; it stays listed as withdrawn.'}
      onConfirm={async (reason) => {
        const which = dlg;
        if (!which) return;
        const path = which === 'apply' ? 'apply' : which === 'invite' ? 'send-invitations' : 'cancel';
        const out = await post<{ sent?: number; alreadyApplied?: boolean }>(`/admin/imports/${id}/${path}`, { reason });
        toast.show(which === 'apply' ? (out.alreadyApplied ? 'Already applied; nothing changed' : 'Applied') : which === 'invite' ? `${out.sent ?? 0} invitation${out.sent === 1 ? '' : 's'} sent` : 'Withdrawn');
        setTick((n) => n + 1);
      }} />
  </View>;
}
