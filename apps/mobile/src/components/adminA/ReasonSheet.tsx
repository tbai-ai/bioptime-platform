/* The portal's ReasonDialog (apps/dashboard/src/ui/index.tsx:207-217) as a bottom sheet, with its wording: the field
   "Reason (recorded in the audit log)", the placeholder "What you know, and why this is right", the check "Say why, in
   a few words." under three characters, the footer "Keep as is" and the confirm label (destructive when `destructive`),
   and `extra` fields above the reason (the coach's "Until (optional)", the caseload limit). The confirm runs
   `onConfirm(reason)`; a thrown error stays in the sheet, as on the web, and the sheet closes only on success. */
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Field, Input, Notice, P } from '@/components/ui';
import { Sheet } from '@/components/workspace';
import { errorText } from '@/lib/api';
import { space } from '@/theme';

export function ReasonSheet({ open, onClose, title, body, confirmLabel, destructive, onConfirm, extra, minLength = 3, label = 'Reason (recorded in the audit log)', placeholder = 'What you know, and why this is right', disabled }: { open: boolean; onClose: () => void; title: string; body?: string; confirmLabel: string; destructive?: boolean; onConfirm: (reason: string) => Promise<void> | void; extra?: React.ReactNode; minLength?: number; label?: string; placeholder?: string; disabled?: boolean }) {
  const [reason, setReason] = useState('');
  const [fieldErr, setFieldErr] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setReason(''); setFieldErr(''); setErr(''); setBusy(false); } }, [open]);
  const go = async () => {
    if (reason.trim().length < minLength) { setFieldErr('Say why, in a few words.'); return; }
    setBusy(true); setErr('');
    try { await onConfirm(reason.trim()); onClose(); } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  return <Sheet open={open} onClose={onClose} title={title} footer={<View style={{ flexDirection: 'row', gap: space.sm }}>
    <Button title="Keep as is" variant="secondary" onPress={onClose} disabled={busy} style={{ flex: 1 }} />
    <Button title={confirmLabel} variant={destructive ? 'danger' : 'primary'} onPress={go} busy={busy} disabled={disabled} style={{ flex: 1 }} />
  </View>}>
    {body ? <P muted>{body}</P> : null}
    {extra}
    <Field label={label} error={fieldErr || undefined}><Input value={reason} onChangeText={(v) => { setReason(v); if (fieldErr) setFieldErr(''); }} placeholder={placeholder} multiline numberOfLines={3} style={{ minHeight: 72, textAlignVertical: 'top' }} accessibilityLabel={label} /></Field>
    {err ? <Notice kind="error">{err}</Notice> : null}
  </Sheet>;
}
