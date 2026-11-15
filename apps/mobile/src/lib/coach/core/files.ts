/* Files in the coach workspace: picking a file to attach to a message (expo-document-picker, expo-image-picker), the
   upload body the API wants (base64 in JSON, as the web sends it: POST /conversations/:id/attachments), and opening a
   file. A file on a message opens through its 5-minute token (POST /attachments/:id/file-token → { url }); a calendar
   file (.ics) needs the bearer token, so it is fetched through the API client's token: on the phone it is written to the
   cache with expo-file-system and handed to the share sheet (expo-sharing); on the web the authenticated blob opens in a
   new tab. Limits as the web's modules/messaging/shared.tsx: PNG, JPEG, WebP or PDF, 5 MB each, five on one message. */
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import { loadToken, post } from '@/lib/api';
import { apiBaseSync, gateHeaders } from '@/lib/config';

export const ATTACH_MAX_BYTES = 5 * 1024 * 1024;
export const ATTACH_MAX_PER_MESSAGE = 5;
export const ATTACH_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];

export type Attachment = { id: string; messageId?: string | null; conversationId?: string; name: string; mime: string; bytes: number; kind: 'image' | 'pdf'; sent?: boolean; mine?: boolean; createdAt?: string };
export type PickedFile = { name: string; mime: string; bytes: number; dataBase64: string };

function stripDataUri(s: string): string { const i = s.indexOf('base64,'); return i >= 0 ? s.slice(i + 7) : s; }
function bytesOfBase64(b64: string): number { const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0; return Math.floor((b64.length * 3) / 4) - pad; }

/** The system document picker, limited to the four types; returns the picked files with their base64 content. */
export async function pickDocuments(): Promise<PickedFile[]> {
  const r = await DocumentPicker.getDocumentAsync({ type: ATTACH_TYPES, multiple: true, copyToCacheDirectory: true, base64: true });
  if (r.canceled) return [];
  const out: PickedFile[] = [];
  for (const a of r.assets ?? []) {
    const web = (a as { base64?: string }).base64;
    let b64 = web ? stripDataUri(web) : '';
    if (!b64 && Platform.OS !== 'web') { try { b64 = await new File(a.uri).base64(); } catch { b64 = ''; } }
    if (!b64) continue;
    out.push({ name: a.name, mime: a.mimeType ?? 'application/octet-stream', bytes: a.size ?? bytesOfBase64(b64), dataBase64: b64 });
  }
  return out;
}

/** The photo library, images only. */
export async function pickImages(): Promise<PickedFile[]> {
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: ATTACH_MAX_PER_MESSAGE, base64: true, quality: 0.9 });
  if (r.canceled) return [];
  const out: PickedFile[] = [];
  for (const a of r.assets ?? []) {
    let b64 = a.base64 ? stripDataUri(a.base64) : '';
    if (!b64 && Platform.OS !== 'web') { try { b64 = await new File(a.uri).base64(); } catch { b64 = ''; } }
    if (!b64) continue;
    const mime = a.mimeType ?? (a.uri.toLowerCase().endsWith('.png') ? 'image/png' : a.uri.toLowerCase().endsWith('.webp') ? 'image/webp' : 'image/jpeg');
    const name = a.fileName ?? `photo-${Date.now()}.${mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'}`;
    out.push({ name, mime, bytes: a.fileSize ?? bytesOfBase64(b64), dataBase64: b64 });
  }
  return out;
}

const safeName = (name: string) => name.replace(/[^\w.-]+/g, '_').slice(0, 80) || 'file';

/** Open a URL that needs no auth (a 5-minute file token). On the phone the file is downloaded to the cache and handed
 *  to the share sheet, which previews or opens it; on the web it opens in the browser. */
export async function openTokenUrl(url: string, name: string, mime?: string): Promise<void> {
  const full = url.startsWith('http') ? url : `${apiBaseSync()}${url}`;
  if (Platform.OS === 'web') { await WebBrowser.openBrowserAsync(full); return; }
  const dest = new File(Paths.cache, safeName(name));
  if (dest.exists) dest.delete();
  const file = await File.downloadFileAsync(full, dest, { headers: gateHeaders(full) });
  await Sharing.shareAsync(file.uri, { mimeType: mime, dialogTitle: name });
}

/** A file on a message: its token, then the file. */
export async function openAttachment(a: Attachment): Promise<void> {
  const t = await post<{ url: string }>(`/attachments/${a.id}/file-token`);
  await openTokenUrl(t.url, a.name, a.mime);
}

/** A file behind a bearer-only route (GET /coach/appointments/:id/ics): fetched with the session token. */
export async function openAuthenticatedFile(path: string, name: string, mime: string): Promise<void> {
  const token = await loadToken();
  const url = `${apiBaseSync()}/api${path}`;
  const headers: Record<string, string> = { 'X-Bioptime-Client': 'mobile', ...gateHeaders(url) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (Platform.OS === 'web') {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`The file could not be fetched (${res.status}).`);
    const blob = await res.blob();
    const doc = (globalThis as unknown as { document?: Document; URL: typeof URL }).document;
    const href = URL.createObjectURL(blob);
    if (doc) { const a = doc.createElement('a'); a.href = href; a.download = name; a.rel = 'noopener'; doc.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(href), 60_000); }
    else await WebBrowser.openBrowserAsync(href);
    return;
  }
  const dest = new File(Paths.cache, safeName(name));
  if (dest.exists) dest.delete();
  const file = await File.downloadFileAsync(url, dest, { headers });
  await Sharing.shareAsync(file.uri, { mimeType: mime, dialogTitle: name });
}
