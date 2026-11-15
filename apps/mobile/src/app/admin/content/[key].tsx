/* Admin › Website content › one block (the web's BlockEditor in pages/admin/Content.tsx; content.manage). The block's
   label, key, state and current value, and the editor for its type: text, rich text (a multiline field with the
   allow-list note and the live formatted preview of components/adminB2/RichText, the web's previewHtml; the server
   sanitises on save), url, on/off, the questions-and-answers list and the image picker with the image library
   (components/adminB2/ImageLibrary; alternative text is required before an image block is saved or published, in the
   API's own words). Save draft (PUT /admin/content/:key), Discard draft (DELETE …/draft) and Reset to the built-in copy
   with a reason (POST …/reset). As on the web the fields carry no caption of their own (the block's label heads the
   card); each is named by the block's label for screen readers. The state pill takes the portal's colours; nothing is
   requested without content.manage. */
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { api, errorText, get, post } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { altRequired, blockPillStatus, blockState, blockStateLine, effectiveValue, imageWithoutAlt, type Block, type FaqItem, type ImageValue } from '@/lib/admin/b2/content';
import { gated, pillTone, useAllowed } from '@/lib/admin/b2/pill';
import { ImageLibrary } from '@/components/adminB2/ImageLibrary';
import { RichTextPreview } from '@/components/adminB2/RichText';
import { MONO_FONT, MonoText, ReasonSheet, Toggle, useToast } from '@/components/adminB2/parts';
import { Button, Card, ErrorBox, Eyebrow, Field, H2, Input, Loading, Notice, P, Pill, Row, StaleBanner } from '@/components/ui';
import { NotificationBell, RequirePermission, RoleGate, WorkspaceScreen } from '@/components/workspaceShell';
import { Enter, MotionCard } from '@/motion';
import { colors, radius, space } from '@/theme';

/* Administrators and owners only: anyone else sees the workspace notice, and nothing here asks the API. */
export default function AdminContentBlock() {
  return <RoleGate workspace="admin"><AdminContentBlockScreen /></RoleGate>;
}

function AdminContentBlockScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const router = useRouter();
  const blockKey = decodeURIComponent(String(key ?? ''));
  const allowed = useAllowed('content.manage');
  const list = useLoad<{ items: Block[] } | null>(allowed ? `admin-content-${blockKey}` : null, gated(allowed, () => get<{ items: Block[] }>('/admin/content')), [blockKey, allowed]);
  const block = list.data?.items.find((b) => b.key === blockKey) ?? null;
  const [toast, showToast] = useToast();
  const [value, setValue] = useState<unknown>(undefined);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetErr, setResetErr] = useState<string | null>(null);
  useEffect(() => { if (block && value === undefined) setValue(effectiveValue(block)); }, [block, value]);
  const state = block ? blockState(block) : 'default';
  const save = async () => {
    if (!block) return;
    if (imageWithoutAlt(block.type, value)) { setErr(altRequired(block.label)); return; } // never sent without alternative text
    setBusy('save'); setErr('');
    try { await api('PUT', `/admin/content/${encodeURIComponent(block.key)}`, { value }); showToast('Draft saved'); void list.reload(); }
    catch (e) { setErr(errorText(e)); } finally { setBusy(''); }
  };
  const discard = async () => {
    if (!block) return;
    setBusy('discard'); setErr('');
    try { await api('DELETE', `/admin/content/${encodeURIComponent(block.key)}/draft`); showToast('Draft discarded'); setValue(block.published ?? block.default); void list.reload(); }
    catch (e) { showToast(errorText(e), 'error'); } finally { setBusy(''); }
  };
  const reset = async (reason: string) => {
    if (!block) return;
    setBusy('reset'); setResetErr(null);
    try { await post(`/admin/content/${encodeURIComponent(block.key)}/reset`, { reason }); showToast('Back to the built-in copy'); setValue(block.default); setResetting(false); void list.reload(); }
    catch (e) { setResetErr(errorText(e)); } finally { setBusy(''); }
  };
  const text = typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
  return <WorkspaceScreen workspace="admin" title={block?.label ?? 'Block'} sub={block ? `${block.page} · ${block.section}` : undefined} refreshing={list.loading} onRefresh={list.reload}>
    <Stack.Screen options={{ title: 'Website content', headerRight: () => <NotificationBell /> }} />
    <RequirePermission permission="content.manage">
      {toast}
      <StaleBanner at={list.stale} /><ErrorBox error={list.error} onRetry={list.reload} />
      {list.loading && !list.data ? <Loading /> : list.data && !block ? <Notice kind="warning" title="Block was not found">There is no website block with this key.</Notice> : block ? <>
        <Enter index={1}><View style={{ gap: space.xs }}>
          <Row between><MonoText small>{block.key}</MonoText><Pill tone={pillTone(blockPillStatus(state))}>{state}</Pill></Row>
          <P muted small>{blockStateLine(block)}</P>
        </View></Enter>
        <MotionCard index={2} pressable={false}><Card>
          <Eyebrow>Edit</Eyebrow><H2>{block.label}</H2>
          {block.type === 'text' ? <View style={{ marginBottom: space.lg }}><Input value={text} maxLength={block.max ?? undefined} onChangeText={setValue} multiline={!!block.max && block.max > 160} numberOfLines={block.max && block.max > 160 ? 5 : 1} style={block.max && block.max > 160 ? { minHeight: 110, textAlignVertical: 'top' } : undefined} accessibilityLabel={block.label} /></View> : null}
          {block.type === 'url' ? <View style={{ marginBottom: space.lg }}><Input value={text} onChangeText={setValue} placeholder="/packages or https://…" autoCapitalize="none" autoCorrect={false} keyboardType="url" accessibilityLabel={block.label} /></View> : null}
          {block.type === 'richtext' ? <View style={{ gap: space.sm, marginBottom: space.lg }}>
            <Input value={text} maxLength={block.max ?? undefined} onChangeText={setValue} multiline numberOfLines={8} autoCapitalize="none" autoCorrect={false} style={{ minHeight: 140, textAlignVertical: 'top', fontFamily: MONO_FONT, fontSize: 12.5 }} accessibilityLabel={block.label} />
            <P muted small>{'Allowed: <p> <br> <strong> <em> <ul> <ol> <li> <h3> <a href="https://… or /…">. Everything else is removed when saved.'}</P>
            <RichTextPreview html={text} />
          </View> : null}
          {block.type === 'boolean' ? <Row between><P>{value ? 'On' : 'Off'}</P><Toggle value={!!value} onChange={setValue} label={block.label} /></Row> : null}
          {block.type === 'faq' ? <FaqEditor value={Array.isArray(value) ? (value as FaqItem[]) : []} onChange={setValue} /> : null}
          {/* the chosen image, its alternative text and the library are all in the picker, as on the web */}
          {block.type === 'image' ? <ImageLibrary value={value && typeof value === 'object' ? (value as ImageValue) : null} onChange={setValue} /> : null}
          {err ? <Notice kind="error">{err}</Notice> : null}
          <Row>
            <Button title="Save draft" small busy={busy === 'save'} onPress={save} />
            <Button title="Cancel" variant="ghost" small onPress={() => { setValue(effectiveValue(block)); setErr(''); router.back(); }} />
          </Row>
        </Card></MotionCard>
        {state !== 'default' ? <Enter index={3}><Row>
          {state === 'draft' ? <Button title="Discard draft" variant="secondary" small busy={busy === 'discard'} onPress={discard} /> : null}
          <Button title="Reset" variant="secondary" small onPress={() => { setResetErr(null); setResetting(true); }} />
        </Row></Enter> : null}
      </> : null}
      <ReasonSheet open={resetting} onClose={() => setResetting(false)} title={block ? `Return “${block.label}” to its built-in copy?` : ''} confirmLabel="Reset" busy={busy === 'reset'} error={resetErr}
        body="The draft and the published value are removed; the website shows the built-in copy at once." onConfirm={reset} />
    </RequirePermission>
  </WorkspaceScreen>;
}

function FaqEditor({ value, onChange }: { value: FaqItem[]; onChange: (v: unknown) => void }) {
  const set = (i: number, k: 'q' | 'a', v: string) => onChange(value.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return <View style={{ gap: space.md }}>
    {value.map((item, i) => <View key={i} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: space.md, backgroundColor: colors.base }}>
      <Field label={`Question ${i + 1}`}><Input value={item.q} maxLength={200} onChangeText={(v) => set(i, 'q', v)} accessibilityLabel={`Question ${i + 1}`} /></Field>
      <Field label="Answer" hint="Text; <strong>, <em>, lists and links to https or this site are kept, everything else is stripped."><Input value={item.a} maxLength={1200} onChangeText={(v) => set(i, 'a', v)} multiline numberOfLines={4} style={{ minHeight: 90, textAlignVertical: 'top' }} accessibilityLabel={`Answer ${i + 1}`} /></Field>
      <Row>
        <Button title="Up" variant="ghost" small disabled={i === 0} onPress={() => { const v = [...value]; [v[i - 1], v[i]] = [v[i]!, v[i - 1]!]; onChange(v); }} />
        <Button title="Down" variant="ghost" small disabled={i === value.length - 1} onPress={() => { const v = [...value]; [v[i + 1], v[i]] = [v[i]!, v[i + 1]!]; onChange(v); }} />
        <Button title="Remove" variant="danger" small onPress={() => onChange(value.filter((_, j) => j !== i))} />
      </Row>
    </View>)}
    <Row><Button title="Add a question" small onPress={() => onChange([...value, { q: '', a: '' }])} /><P muted small style={{ flex: 1 }}>Empty list: the website shows its built-in questions.</P></Row>
  </View>;
}
