/* M4 Imports in the admin workspace: what the Imports page and one import's page share (the web's
   modules/support/AdminImports.tsx): the shapes, the kind and status words, the pills, and picking a CSV on the phone
   (expo-document-picker; read as text, 1 MB at most, as the web's file input allows). Tokens from theme.ts only. */
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import React from 'react';
import { Platform } from 'react-native';
import { label } from '@/lib/format';
import { Pill } from '@/components/ui';
import { statusToneOf } from '@/components/coachModules/shared';

export type ImportKind = 'members' | 'progress_history';
export type Columns = Record<ImportKind, { required: string[]; optional: string[]; example: string }>;
export type DryRunReport = { rowCount: number; validCount: number; invalidCount: number; fileErrors: Array<{ code: string; message: string }>; errors: Array<{ row: number; errors: string[] }> };
export type ImportJob = {
  id: string; kind: ImportKind; status: string; fileName: string; fileSha256: string; rowCount: number; validCount: number; invalidCount: number; appliedCount: number; invitedCount: number;
  outcomes: Record<string, number>; fileErrors: Array<{ code: string; message: string }>; createdAt: string; createdBy: string | null; appliedAt: string | null; appliedBy: string | null;
  invitedAt: string | null; invitedBy: string | null; columns: Columns[ImportKind]; rows?: Array<{ row: number; outcome: string; data: Record<string, unknown>; errors: string[]; recordId: string | null }>;
};

export const KIND_LABEL: Record<ImportKind, string> = { members: 'Members', progress_history: 'Progress history' };
const OUTCOME_STATUS: Record<string, string> = { valid: 'active', invalid: 'failed', created: 'completed', invited: 'completed', skipped: 'cancelled', pending: 'pending' };
const JOB_STATUS: Record<string, string> = { uploaded: 'pending', validated: 'scheduled', applied: 'completed', failed: 'failed', cancelled: 'cancelled' };

export function JobStatusPill({ status }: { status: string }) { return <Pill tone={statusToneOf(JOB_STATUS[status] ?? status)}>{label(status)}</Pill>; }
export function OutcomePill({ outcome }: { outcome: string }) { return <Pill tone={statusToneOf(OUTCOME_STATUS[outcome] ?? 'pending')}>{label(outcome)}</Pill>; }

export const MAX_CSV_BYTES = 1024 * 1024;
export type PickedCsv = { name: string; text: string } | { error: string } | null;

/** The system document picker for one CSV file, read as text. null when cancelled; { error } for a file too large or
 *  unreadable, with the web's words. */
export async function pickCsv(): Promise<PickedCsv> {
  const r = await DocumentPicker.getDocumentAsync({ type: ['text/csv', 'text/comma-separated-values', 'application/csv', 'text/plain', 'application/vnd.ms-excel'], multiple: false, copyToCacheDirectory: true });
  if (r.canceled || !r.assets?.length) return null;
  const a = r.assets[0]!;
  if ((a.size ?? 0) > MAX_CSV_BYTES) return { error: 'Files are limited to 1 MB; split it into smaller files' };
  try {
    const text = Platform.OS === 'web' && a.file ? await a.file.text() : Platform.OS === 'web' ? await (await fetch(a.uri)).text() : await new File(a.uri).text();
    if (text.length > MAX_CSV_BYTES * 2) return { error: 'Files are limited to 1 MB; split it into smaller files' };
    return { name: a.name, text };
  } catch {
    return { error: 'The file could not be read' };
  }
}
