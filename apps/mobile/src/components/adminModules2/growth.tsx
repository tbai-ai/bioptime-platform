/* Growth in the administrative portal: what the discovery call and corporate enquiry screens share (the web's
   modules/growth/Notes.tsx and shared.tsx), from the existing primitives and tokens only.
   Notes          { notes, path, onSaved }   "Team notes": the timeline and the box to add one → POST {path} { body }
   PreferredTimes { slots, windows }         the times a visitor named (" · no longer offered") and their own words
   ContactCard    { eyebrow, title, email, phone, consentText, consentVersion, consentAt, note }   the "Contact" card: the
                  phone is shown only when the server sent it (members.view_restricted), as the web words it otherwise
   shareText      (path, filename, mime)   an authenticated text download (the newsletter CSV) handed to the share sheet;
                  a download in the browser */
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import React, { useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { errorText, loadToken, post } from '@/lib/api';
import { apiBaseSync, CLIENT_HEADER, gateHeaders } from '@/lib/config';
import { fmtDateTime } from '@/lib/format';
import type { Note, Slot } from '@/lib/admin/modules2/growth';
import { TimelineItem } from '@/components/adminA/parts';
import { Button, Empty, Input } from '@/components/ui';
import { KeyValue } from '@/components/workspace';
import { Hint, SectionCard } from './frame';
import { colors, font, space } from '@/theme';

export function Notes({ notes, path, onSaved, show }: { notes: Note[]; path: string; onSaved: () => void; show: (text: string, kind?: 'success' | 'error') => void }) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const add = async () => {
    if (body.trim().length < 2) return;
    setBusy(true);
    try { await post(path, { body: body.trim() }); setBody(''); show('Note added'); onSaved(); }
    catch (e) { show(errorText(e), 'error'); } finally { setBusy(false); }
  };
  return <SectionCard eyebrow="Team notes" title={`${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`}>
    {notes.length ? <View>{notes.map((n) => <TimelineItem key={n.id} title={n.author?.name ?? 'The team'} time={fmtDateTime(n.createdAt)} body={n.body} />)}</View>
      : <Empty title="No notes yet" body="Notes stay with the team: the person and any coach never see them." />}
    <Input value={body} maxLength={2000} onChangeText={setBody} placeholder="What happened, what was agreed, what comes next." multiline style={{ minHeight: 80, textAlignVertical: 'top' }} accessibilityLabel="New note" />
    <Hint>Saved with your name and the time; the audit log records that a note was added, not its words.</Hint>
    <Button title="Add note" small busy={busy} disabled={body.trim().length < 2} onPress={add} style={{ alignSelf: 'flex-start' }} />
  </SectionCard>;
}

export function PreferredTimes({ slots, windows }: { slots: Slot[]; windows: string | null }) {
  if (!slots.length && !windows) return <Text style={{ color: colors.muted, fontSize: font.small }}>None given</Text>;
  return <View style={{ gap: space.xs }}>
    {slots.map((s) => <Text key={s.id} style={{ color: colors.text, fontSize: font.small }}>{`• ${s.label}`}{s.withdrawn ? <Text style={{ color: colors.muted }}> · no longer offered</Text> : null}</Text>)}
    {windows ? <Text style={{ color: colors.text, fontSize: font.small }}>{`• “${windows}”`}</Text> : null}
  </View>;
}

export function ContactCard({ eyebrow, title, email, phone, consentText, consentVersion, consentAt, note }: { eyebrow: string; title: string; email: string; phone: string | null | undefined; consentText: string | null; consentVersion: string; consentAt: string; note: string }) {
  return <SectionCard eyebrow={eyebrow} title={title}>
    <KeyValue rows={[
      ['Email', email],
      ['Phone', phone === undefined ? <Text style={{ color: colors.muted, fontSize: font.small, textAlign: 'right' }}>Hidden: needs the restricted fields permission</Text> : phone ?? <Text style={{ color: colors.muted, fontSize: font.small }}>Not given</Text>],
      ['Agreed to', `${consentText ?? consentVersion} (${fmtDateTime(consentAt)})`],
    ]} />
    <Hint>{note}</Hint>
  </SectionCard>;
}

export async function shareText(path: string, filename: string, mime: string): Promise<void> {
  const token = await loadToken();
  const address = `${apiBaseSync()}/api${path}`;
  const res = await fetch(address, { headers: { Accept: mime, 'X-Bioptime-Client': CLIENT_HEADER, ...gateHeaders(address), ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  if (!res.ok) throw new Error(`The file could not be fetched (${res.status}).`);
  const text = await res.text();
  if (Platform.OS === 'web') {
    const doc = (globalThis as unknown as { document?: Document }).document;
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    if (doc) { const a = doc.createElement('a'); a.href = url; a.download = filename; doc.body.appendChild(a); a.click(); a.remove(); }
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return;
  }
  const file = new FileSystem.File(FileSystem.Paths.cache, filename);
  file.write(text);
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri, { mimeType: mime, dialogTitle: filename });
  else throw new Error('Sharing is not available on this device.');
}
