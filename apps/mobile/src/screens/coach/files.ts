/* Files in the coach chat (module 'messaging') and the consultation calendar file.
   - Attaching: the system document picker or the photo library (expo-document-picker, expo-image-picker), read as
     base64 and posted as the API wants it (POST /conversations/:id/attachments { dataBase64, filename }, as the web
     portal sends it). PNG, JPEG, WebP or PDF, 5 MB each, five on one message; the server checks the content again.
     A file the member added but did not send can be removed (DELETE …/attachments/:id, works while the module is off).
   - Opening a file on a message: its 5-minute token (POST /attachments/:id/file-token → { url }); on the phone the
     file is saved to the cache and handed to the share sheet (which previews it), on the web it opens in the browser.
   - The calendar file of a consultation (GET /me/appointments/:id/ics, module 'sessions') or of a live session the
     member holds a place in (GET /me/sessions/:id/ics, used by session/[id]) needs the session token: on the web the
     authenticated download, on the phone the share sheet with the .ics. */
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import { api, loadToken, post } from '@/lib/api';
import { apiBaseSync, gateHeaders } from '@/lib/config';

export const ATTACH_MAX_BYTES = 5 * 1024 * 1024;
export const ATTACH_MAX_PER_MESSAGE = 5;
export const ATTACH_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];

export type Attachment = { id: string; name: string; mime: string; bytes: number; kind: 'image' | 'pdf'; messageId?: string | null };
export type PickedFile = { name: string; mime: string; bytes: number; dataBase64: string };

const stripDataUri = (s: string) => { const i = s.indexOf('base64,'); return i >= 0 ? s.slice(i + 7) : s; };
const bytesOfBase64 = (b64: string) => Math.floor((b64.length * 3) / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
const safeName = (name: string) => name.replace(/[^\w.-]+/g, '_').slice(0, 80) || 'file';

/** "PDF · 240 KB", "Image · 1.2 MB". */
export function fileLine(a: Pick<Attachment, 'kind' | 'bytes' | 'mime'>): string {
  const kind = a.kind === 'pdf' || a.mime === 'application/pdf' ? 'PDF' : 'Image';
  const size = a.bytes >= 1024 * 1024 ? `${(a.bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.ceil(a.bytes / 1024))} KB`;
  return `${kind} · ${size}`;
}

/** The document picker, limited to the four types. */
export async function pickDocuments(): Promise<PickedFile[]> {
  const r = await DocumentPicker.getDocumentAsync({ type: ATTACH_TYPES, multiple: true, copyToCacheDirectory: true, base64: true });
  if (r.canceled) return [];
  const out: PickedFile[] = [];
  for (const a of r.assets ?? []) {
    const web = (a as { base64?: string }).base64;
    let b64 = web ? stripDataUri(web) : '';
    if (!b64 && Platform.OS !== 'web') { try { b64 = await new File(a.uri).base64(); } catch { b64 = ''; } }
    if (!b64 && a.uri?.startsWith('data:')) b64 = stripDataUri(a.uri);
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
    if (!b64 && a.uri?.startsWith('data:')) b64 = stripDataUri(a.uri);
    if (!b64) continue;
    const lower = (a.fileName ?? a.uri).toLowerCase();
    const mime = a.mimeType ?? (lower.endsWith('.png') ? 'image/png' : lower.endsWith('.webp') ? 'image/webp' : 'image/jpeg');
    const name = a.fileName ?? `photo-${Date.now()}.${mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'}`;
    out.push({ name, mime, bytes: a.fileSize ?? bytesOfBase64(b64), dataBase64: b64 });
  }
  return out;
}

/** Why a picked file cannot go (before it is sent), or null. */
export function refuseFile(f: PickedFile): string | null {
  if (!ATTACH_TYPES.includes(f.mime)) return `${f.name} is not a PNG, JPEG, WebP or PDF file.`;
  if (f.bytes > ATTACH_MAX_BYTES) return `${f.name} is larger than 5 MB.`;
  return null;
}

/** Upload one file for the next message. */
export function uploadAttachment(conversationId: string, f: PickedFile): Promise<Attachment> {
  return post<Attachment>(`/conversations/${conversationId}/attachments`, { dataBase64: f.dataBase64, filename: f.name });
}

/** Remove a file the member added and has not sent. */
export function discardAttachment(conversationId: string, attachmentId: string): Promise<unknown> {
  return api('DELETE', `/conversations/${conversationId}/attachments/${attachmentId}`);
}

async function openTokenUrl(url: string, name: string, mime?: string): Promise<void> {
  const full = url.startsWith('http') ? url : `${apiBaseSync()}${url}`;
  if (Platform.OS === 'web') { await WebBrowser.openBrowserAsync(full); return; }
  const dest = new File(Paths.cache, safeName(name));
  if (dest.exists) dest.delete();
  const file = await File.downloadFileAsync(full, dest, { headers: gateHeaders(full) });
  await Sharing.shareAsync(file.uri, { mimeType: mime, dialogTitle: name });
}

/** A file on a message: its 5-minute token, then the file. */
export async function openAttachment(a: Attachment): Promise<void> {
  const t = await post<{ url: string }>(`/attachments/${a.id}/file-token`);
  await openTokenUrl(t.url, a.name, a.mime);
}

/** The consultation's calendar file (.ics, times in IST). */
export function openConsultationIcs(appointmentId: string): Promise<void> {
  return openCalendarFile(`/me/appointments/${appointmentId}/ics`, `consultation-${appointmentId}.ics`);
}

/** A calendar file the API makes for the member (`path` under /api: a consultation, a live session they hold a place
 *  in), with the session token: downloaded on the web, handed to the share sheet on the phone. */
export async function openCalendarFile(path: string, name: string): Promise<void> {
  const token = await loadToken();
  const url = `${apiBaseSync()}/api${path}`;
  const headers: Record<string, string> = { 'X-Bioptime-Client': 'mobile', ...gateHeaders(url) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (Platform.OS === 'web') {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`The calendar file could not be fetched (${res.status}).`);
    const blob = await res.blob();
    const doc = (globalThis as unknown as { document?: Document }).document;
    const href = URL.createObjectURL(blob);
    if (doc) { const link = doc.createElement('a'); link.href = href; link.download = name; link.rel = 'noopener'; doc.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(href), 60_000); }
    else await WebBrowser.openBrowserAsync(href);
    return;
  }
  const dest = new File(Paths.cache, safeName(name));
  if (dest.exists) dest.delete();
  const file = await File.downloadFileAsync(url, dest, { headers });
  await Sharing.shareAsync(file.uri, { mimeType: 'text/calendar', dialogTitle: 'Add to calendar', UTI: 'public.calendar-event' });
}
