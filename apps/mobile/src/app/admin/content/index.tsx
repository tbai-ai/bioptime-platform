/* Admin › Website content (the web's /admin/content, pages/admin/Content.tsx; content.manage, publishing content.publish).
   Every editable block of the website (GET /admin/content), grouped by page (tabs) and section (cards), each block a row
   opening its editor (src/app/admin/content/[key].tsx) with its draft / published / default state; the draft preview
   opens the real website with ?cms=draft in the browser (the website asks for the portal's own sign-in there); the
   publish step asks for a reason (POST /admin/content/publish) and keeps a refusal in the server's words. The state pill
   takes the portal's colours (draft and built-in amber, published green); nothing is requested without content.manage. */
import { Image } from 'expo-image';
import * as WebBrowser from 'expo-web-browser';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { errorText, get, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { apiBaseSync, remoteImage } from '@/lib/config';
import { useLoad } from '@/lib/useLoad';
import { altRequired, blockPillStatus, blockState, blockSummary, blockStateLine, effectiveValue, imageUrl, imageWithoutAlt, type Block } from '@/lib/admin/b2/content';
import { gated, pillTone, useAllowed } from '@/lib/admin/b2/pill';
import { assetUri } from '@/components/adminB2/ImageLibrary';
import { DetailRow, ReasonSheet, useToast } from '@/components/adminB2/parts';
import { Button, Card, ErrorBox, Eyebrow, H2, Loading, Notice, P, Row, StaleBanner } from '@/components/ui';
import { RecordList, SegmentTabs } from '@/components/workspace';
import { NotificationBell, RequirePermission, RoleGate, WorkspaceScreen } from '@/components/workspaceShell';
import { Enter, MotionCard } from '@/motion';
import { colors, radius, space } from '@/theme';

/* Administrators and owners only: anyone else sees the workspace notice, and nothing here asks the API. */
export default function AdminContent() {
  return <RoleGate workspace="admin"><AdminContentScreen /></RoleGate>;
}

function AdminContentScreen() {
  const { can } = useAuth();
  const router = useRouter();
  const canPublish = can('content.publish'); // POST /admin/content/publish needs it; drafts need only content.manage
  const allowed = useAllowed('content.manage');
  const list = useLoad<{ items: Block[]; previewUrl: string } | null>(allowed ? 'admin-content' : null, gated(allowed, () => get<{ items: Block[]; previewUrl: string }>('/admin/content')), [allowed]);
  const [toast, showToast] = useToast();
  const [page, setPage] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [publishErr, setPublishErr] = useState('');
  const [busy, setBusy] = useState(false);
  const first = useRef(true);
  useFocusEffect(useCallback(() => { if (first.current) { first.current = false; return; } if (allowed) void list.reload(); }, [list.reload, allowed])); // eslint-disable-line react-hooks/exhaustive-deps
  const items = list.data?.items ?? [];
  const pages = useMemo(() => Array.from(new Set(items.map((b) => b.page))), [items]);
  const current = page || pages[0] || '';
  const drafts = items.filter((b) => b.draft !== null);
  const sections = useMemo(() => { const m = new Map<string, Block[]>(); for (const b of items.filter((x) => x.page === current)) m.set(b.section, [...(m.get(b.section) ?? []), b]); return Array.from(m.entries()); }, [items, current]);
  const preview = async () => { const url = `${apiBaseSync()}${list.data?.previewUrl ?? '/?cms=draft'}`; try { await WebBrowser.openBrowserAsync(url); } catch (e) { showToast(errorText(e), 'error'); } };
  // a refusal (a block the server will not publish, such as an image without alternative text) stays in the dialog, in the server's words
  const publish = async (reason: string) => {
    setPublishErr('');
    const noAlt = drafts.find((d) => imageWithoutAlt(d.type, d.draft));
    if (noAlt) { setPublishErr(altRequired(noAlt.label)); return; }
    setBusy(true);
    try { await post('/admin/content/publish', { reason }); showToast(`Published ${drafts.length} block${drafts.length === 1 ? '' : 's'}; the website shows them now`); setPublishing(false); void list.reload(); }
    catch (e) { setPublishErr(errorText(e)); } finally { setBusy(false); }
  };
  return <WorkspaceScreen workspace="admin" title="Website content" sub="Headlines, copy, calls to action, navigation labels, the announcement bar, questions and answers, SEO titles. Save drafts, preview them on the real site, then publish with a reason." refreshing={list.loading} onRefresh={list.reload}>
    <Stack.Screen options={{ title: 'Website content', headerRight: () => <NotificationBell /> }} />
    <RequirePermission permission="content.manage">
      {toast}
      <StaleBanner at={list.stale} /><ErrorBox error={list.error} onRetry={list.reload} />
      {list.loading && !list.data ? <Loading /> : list.data ? <>
        <Enter index={1}><View style={{ gap: space.sm }}>
          <Row>
            <Button title="Preview drafts on the website" variant="secondary" small onPress={preview} />
            {canPublish ? <Button title={`Publish${drafts.length ? ` ${drafts.length} draft${drafts.length === 1 ? '' : 's'}` : ''}`} small disabled={!drafts.length} onPress={() => { setPublishErr(''); setPublishing(true); }} /> : null}
          </Row>
          {!canPublish ? <P muted small>Publishing needs the “Publish website content” permission; an administrator who holds it publishes the drafts.</P> : null}
          <Notice kind="info" title="What this cannot do">Text fields never accept code. Rich text keeps paragraphs, bold, italics, lists, small headings and links to https or the site itself; anything else is stripped on save. Layout and the 3D hero are code, changed by a developer; the pictures listed under Images can be swapped here.</Notice>
        </View></Enter>
        <Enter index={2}><SegmentTabs items={pages.map((p) => ({ id: p, label: p, count: items.filter((b) => b.page === p && b.draft !== null).length }))} value={current} onChange={setPage} /></Enter>
        {sections.map(([section, blocks], i) => <MotionCard key={section} index={3 + i} pressable={false}><Card>
          <Eyebrow>{current}</Eyebrow><H2>{section}</H2>
          <RecordList>
            {blocks.map((b) => {
              const st = blockState(b), thumb = b.type === 'image' ? imageUrl(effectiveValue(b)) : null;
              // as the web's block card: the label, the summary (with the image's thumbnail), the state line and the state pill
              return <DetailRow key={b.key} title={b.label} lines={[blockSummary(b), blockStateLine(b)]} pills={[{ label: st, tone: pillTone(blockPillStatus(st)) }]} onPress={() => router.push(`/admin/content/${encodeURIComponent(b.key)}` as never)}
                leading={thumb ? <Image source={remoteImage(assetUri(thumb))} accessibilityLabel={String((effectiveValue(b) as { alt?: string }).alt ?? '')} contentFit="cover" style={{ width: 36, height: 36, borderRadius: radius.sm, backgroundColor: colors.raised }} /> : undefined} />;
            })}
          </RecordList>
        </Card></MotionCard>)}
      </> : null}
      {canPublish ? <ReasonSheet open={publishing} onClose={() => setPublishing(false)} title="Publish the drafts?" confirmLabel="Publish to the website" busy={busy} error={publishErr || null} onConfirm={publish} cancelLabel="Not yet" placeholder="Why this change, in a few words" gate="disabled"
        body={`${drafts.length} ${drafts.length === 1 ? 'block goes' : 'blocks go'} live at once: ${drafts.map((d) => d.label).join(', ')}.`} /> : null}
    </RequirePermission>
  </WorkspaceScreen>;
}
