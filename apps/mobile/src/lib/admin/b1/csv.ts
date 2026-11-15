/* The CSV export of an analytics report: the same GET /admin/analytics/<name>.csv?from&to the portal links to
   (apps/api/src/http/routes/cms.ts:79-86; attachment "bioptime-<name>-<from>-<to>.csv"), fetched with the session's
   Bearer token since the portal's cookie has no native counterpart. On the web the browser downloads it; on a phone it
   is written to the app's cache (expo-file-system) and offered through the share sheet (expo-sharing). Every run,
   JSON or CSV, is audited by the server as report.run. */
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { ApiError, loadToken, qs } from '@/lib/api';
import { apiBaseSync, CLIENT_HEADER, gateHeaders, loadApiBase } from '@/lib/config';

export type CsvOutcome = { filename: string; how: 'download' | 'share' | 'saved' };

function filenameFrom(disposition: string | null, fallback: string): string {
  const m = /filename="?([^";]+)"?/i.exec(disposition ?? '');
  return (m?.[1] ?? fallback).replace(/[^\w.-]+/g, '-');
}

export async function exportReportCsv(name: string, from: string, to: string): Promise<CsvOutcome> {
  await loadApiBase();
  const token = await loadToken();
  const url = `${apiBaseSync()}/api/admin/analytics/${encodeURIComponent(name)}.csv${qs({ from, to })}`;
  const headers: Record<string, string> = { Accept: 'text/csv, application/json', 'X-Bioptime-Client': CLIENT_HEADER, ...gateHeaders(url) };
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try { res = await fetch(url, { headers }); } catch { throw new ApiError(0, null); }
  const text = await res.text();
  if (!res.ok) { let json: unknown = null; try { json = JSON.parse(text); } catch { json = null; } throw new ApiError(res.status, json); }
  const filename = filenameFrom(res.headers.get('content-disposition'), `bioptime-${name}-${from}-${to}.csv`);
  if (Platform.OS === 'web') {
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href; a.download = filename; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 2000);
    return { filename, how: 'download' };
  }
  const file = new File(Paths.cache, filename);
  file.create({ overwrite: true });
  await file.write(text);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text', dialogTitle: filename });
    return { filename, how: 'share' };
  }
  return { filename, how: 'saved' };
}
