/* Adding a progress photo from the phone (expo-image-picker: the photo library; on the web the file dialog), sent as
   base64 JSON to POST /me/progress/photos, as the member portal sends it. The server checks the type by content
   (JPEG, PNG or WebP), the size (5 MB) and the photo consent; its refusal comes back as the error's own message. */
import * as ImagePicker from 'expo-image-picker';
import { post } from '@/lib/api';

export type Pose = 'front' | 'side' | 'back' | 'other';
export const POSES: { value: Pose; label: string }[] = [
  { value: 'front', label: 'Front' }, { value: 'side', label: 'Side' }, { value: 'back', label: 'Back' }, { value: 'other', label: 'Other' },
];

const stripDataUri = (s: string) => { const i = s.indexOf('base64,'); return i >= 0 ? s.slice(i + 7) : s; };

/** Picks one image and uploads it. Returns false when the member cancelled the picker. */
export async function pickAndUploadPhoto(pose: Pose, maxBytes = 5 * 1024 * 1024): Promise<boolean> {
  const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], base64: true, quality: 0.85, allowsMultipleSelection: false });
  if (picked.canceled || !picked.assets?.length) return false;
  const a = picked.assets[0];
  const b64 = a.base64 ? stripDataUri(a.base64) : a.uri.startsWith('data:') ? stripDataUri(a.uri) : '';
  if (!b64) throw new Error('This photo could not be read. Choose another one.');
  if ((b64.length * 3) / 4 > maxBytes) throw new Error('This photo is larger than 5 MB. Choose a smaller one.');
  await post('/me/progress/photos', { dataBase64: b64, filename: a.fileName ?? undefined, pose, takenAt: new Date().toISOString() });
  return true;
}
