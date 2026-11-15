/* The image library for website image blocks (the web's components/ImagePicker.tsx): pick an uploaded image, upload a
   new one (PNG, JPEG or WebP, 3 MB, checked by content on the server), set the alternative text. The phone picks the
   file with expo-image-picker (the photo library; on the web the file dialog) and posts it as base64 JSON, the same
   body as the portal (POST /admin/assets). A chosen image asks for its alternative text (the field is marked while it
   is empty); the server has the last word when the block is saved, and the editor shows its message. */
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { errorText, get, post } from '../../lib/api';
import { apiBaseSync, remoteImage } from '../../lib/config';
import { useLoad } from '../../lib/useLoad';
import type { ImageValue } from '../../lib/admin/b2/content';
import { Button, ErrorBox, Field, Input, Loading, Notice, P, Row } from '../ui';
import { colors, font, radius, space } from '../../theme';

type Asset = { id: string; url: string; alt: string; filename: string; width: number | null; height: number | null; bytes: number };
const MAX_BYTES = 3 * 1024 * 1024;

/** An asset url as the API gives it (/api/public/assets/<id>) against the server in use. */
export function assetUri(url: string): string { return /^https?:\/\//.test(url) ? url : `${apiBaseSync()}${url}`; }

export function ImageLibrary({ value, onChange }: { value: ImageValue; onChange: (v: ImageValue) => void }) {
  const lib = useLoad<{ items: Asset[]; maxBytes: number }>('admin-assets', () => get('/admin/assets'), []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const items = lib.data?.items ?? [];
  const altMissing = !!value?.assetId && !value.alt.trim();
  const current = value?.assetId ? value.url ?? items.find((a) => a.id === value.assetId)?.url ?? '' : '';
  const upload = async () => {
    setErr(''); setMsg('');
    let picked: ImagePicker.ImagePickerResult;
    try { picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], base64: true, quality: 1, allowsMultipleSelection: false }); }
    catch (e) { setErr(errorText(e)); return; }
    if (picked.canceled || !picked.assets?.length) return;
    const a = picked.assets[0]!;
    setBusy(true);
    try {
      const b64 = a.base64 ?? (a.uri.startsWith('data:') ? a.uri.slice(a.uri.indexOf(',') + 1) : null);
      if (!b64) throw new Error('The image could not be read on this device.');
      const bytes = a.fileSize ?? Math.floor((b64.length * 3) / 4);
      if (bytes > (lib.data?.maxBytes ?? MAX_BYTES)) throw new Error('Images are limited to 3 MB; export a smaller or compressed file.');
      const name = a.fileName ?? `image.${(a.mimeType ?? 'image/jpeg').split('/')[1] ?? 'jpg'}`;
      // a new image never inherits the previous selection's alt text: the editor describes this image
      const r = await post<{ id: string; url: string; alt: string }>('/admin/assets', { filename: name, dataBase64: b64, alt: '' });
      setMsg('Image added to the library'); void lib.reload(); onChange({ assetId: r.id, alt: r.alt ?? '', url: r.url });
    } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  return <View style={{ gap: space.md }}>
    {value?.assetId ? <View style={{ gap: space.sm }}>
      {current ? <Image source={remoteImage(assetUri(current))} accessibilityLabel={value.alt || 'The chosen image'} style={styles.current} contentFit="cover" /> : null}
      <Field label="Alternative text" hint="What the image shows, for people who cannot see it." error={altMissing ? 'Describe what the image shows: people who cannot see it hear this text instead.' : undefined}><Input value={value.alt} maxLength={200} onChangeText={(v) => onChange({ ...value, alt: v })} autoFocus={altMissing} accessibilityLabel="Alternative text" /></Field>
      <Button title="Use the built-in image" variant="ghost" small onPress={() => onChange(null)} style={{ alignSelf: 'flex-start' }} />
    </View> : null}
    <Row><Button title="Upload an image" small busy={busy} onPress={upload} /><P muted small style={{ flex: 1 }}>PNG, JPEG or WebP, up to 3 MB. SVG is not accepted.</P></Row>
    {msg ? <Notice kind="success">{msg}</Notice> : null}
    {err ? <Notice kind="error">{err}</Notice> : null}
    <ErrorBox error={lib.error} onRetry={lib.reload} />
    {!lib.data ? (lib.error ? null : <Loading />) : items.length ? <View style={styles.grid}>
      {items.map((a) => {
        const selected = value?.assetId === a.id;
        return <Pressable key={a.id} accessibilityRole="button" accessibilityState={{ selected }} accessibilityLabel={`Choose ${a.filename}`} onPress={() => onChange({ assetId: a.id, alt: selected && value ? value.alt : a.alt ?? '', url: a.url })} style={[styles.tile, selected && { borderColor: colors.brand }]}>
          <Image source={remoteImage(assetUri(a.url))} accessibilityLabel={a.alt || a.filename} style={styles.thumb} contentFit="cover" />
          <Text style={styles.tileText} numberOfLines={2}>{`${a.filename}${a.width ? ` · ${a.width}×${a.height}` : ''}`}</Text>
        </Pressable>;
      })}
    </View> : <P muted small>The library is empty; upload the first image.</P>}
  </View>;
}

const styles = StyleSheet.create({
  current: { width: '100%', height: 160, borderRadius: radius.md, backgroundColor: colors.base },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tile: { width: '48%', flexGrow: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.base, overflow: 'hidden' },
  thumb: { width: '100%', height: 96, backgroundColor: colors.raised },
  tileText: { color: colors.muted, fontSize: font.tiny, padding: space.sm },
});
