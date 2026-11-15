/* Meal photos (POST /me/meal-logs/:id/photo): one picture from the photo library (no camera permission is configured
   in this build), PNG, JPEG or WebP up to 4 MB, sent as base64 in JSON as every upload is; the server checks the content
   and stores it privately. Nothing is estimated from a photo. Opening one takes a five-minute link
   (POST /files/:id/token). */
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';
import { post } from '@/lib/api';
import { onClearCache } from '@/lib/cache';
import { apiBaseSync } from '@/lib/config';

export const MEAL_PHOTO_MAX_BYTES = 4 * 1024 * 1024;
export type PickedPhoto = { uri: string; filename: string; mime: string; bytes: number; dataBase64: string };

const strip = (s: string) => { const i = s.indexOf('base64,'); return i >= 0 ? s.slice(i + 7) : s; };
const bytesOf = (b64: string) => Math.floor((b64.length * 3) / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);

/** Opens the photo library; null when nothing was picked. Throws a readable Error when the picture cannot be used. */
export async function pickMealPhoto(): Promise<PickedPhoto | null> {
  const r = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'], allowsMultipleSelection: false, base64: true, quality: 0.7, exif: false,
    preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
  });
  if (r.canceled || !r.assets?.length) return null;
  const a = r.assets[0];
  let b64 = a.base64 ? strip(a.base64) : '';
  if (!b64 && Platform.OS !== 'web') { try { b64 = await new File(a.uri).base64(); } catch { b64 = ''; } }
  if (!b64) throw new Error('That photo could not be read. Try another one.');
  const mime = a.mimeType ?? (a.uri.toLowerCase().endsWith('.png') ? 'image/png' : a.uri.toLowerCase().endsWith('.webp') ? 'image/webp' : 'image/jpeg');
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(mime)) throw new Error('Pick a PNG, JPEG or WebP photo.');
  const bytes = bytesOf(b64);
  if (bytes > MEAL_PHOTO_MAX_BYTES) throw new Error('That photo is larger than 4 MB. Pick a smaller one.');
  const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
  return { uri: a.uri, filename: a.fileName ?? `meal-${Date.now()}.${ext}`, mime, bytes, dataBase64: b64 };
}

export function uploadMealPhoto(logId: string, p: PickedPhoto) {
  return post(`/me/meal-logs/${logId}/photo`, { filename: p.filename, dataBase64: p.dataBase64 });
}

/** A five-minute address for a private meal photo. The row thumbnail and the photo sheet share one address while it
 *  is young (four minutes, inside the link's five), so a Today render does not ask for a new link per row; the
 *  addresses are dropped with every clearCache (sign-in, sign-out, a dead session). */
const LINK_REUSE_MS = 4 * 60_000;
const links = new Map<string, { at: number; url: Promise<string> }>();
onClearCache(() => links.clear());

export function mealPhotoUrl(fileId: string): Promise<string> {
  const held = links.get(fileId);
  if (held && Date.now() - held.at < LINK_REUSE_MS) return held.url;
  const url = post<{ url: string }>(`/files/${fileId}/token`).then((t) => (/^https?:\/\//.test(t.url) ? t.url : `${apiBaseSync()}${t.url}`));
  links.set(fileId, { at: Date.now(), url });
  url.catch(() => { if (links.get(fileId)?.url === url) links.delete(fileId); });
  return url;
}

/** Forget a photo's address (it was removed). */
export function forgetMealPhoto(fileId: string | null | undefined): void {
  if (fileId) links.delete(fileId);
}
