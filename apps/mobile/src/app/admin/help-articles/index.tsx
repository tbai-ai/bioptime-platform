/* Admin › Help articles (the web's /admin/help-articles, modules/support/AdminHelpArticles.tsx; support module, the
   help_centre part, content.manage): the help centre's articles for members, coaches or both. Drafts are saved as they
   are written (POST /admin/help-articles, PATCH /admin/help-articles/:id); publishing and withdrawing ask for a reason
   (POST …/publish, …/unpublish), and so does saving a published article. The server keeps the body to the CMS
   allowlist; the preview here reads the same tags. On the phone the editor replaces the list while it is open. */
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { ApiError, errorText, get, patch, post } from '@/lib/api';
import { fmtDateTime, label } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { ReasonSheet } from '@/components/adminA/ReasonSheet';
import { useToast } from '@/components/adminA/toast';
import { MONO_FONT } from '@/components/adminB2/parts';
import { DetailRow, LoadError } from '@/components/adminB1/parts';
import { Button, Card, Empty, Eyebrow, Field, H2, Input, Loading, Notice, Row } from '@/components/ui';
import { RecordList } from '@/components/workspace';
import { PickerField, StatusPill } from '@/components/coachModules/shared';
import { AdminModuleScreen, HtmlPreview, useScreenRefresh } from '@/components/adminModules/shared';
import { Enter } from '@/motion';
import { colors, font, radius, space } from '@/theme';

type Article = { id: string; slug: string; title: string; body: string; audience: 'member' | 'coach' | 'all'; category: string; status: 'draft' | 'published'; sort: number; updatedAt: string; updatedBy: string | null; publishedAt: string | null };
type Draft = { id?: string; slug: string; title: string; body: string; audience: Article['audience']; category: string; sort: string; status?: Article['status'] };

const AUDIENCES = [{ value: 'member', label: 'Members' }, { value: 'coach', label: 'Coaches' }, { value: 'all', label: 'Members and coaches' }];
const audienceLabel = (a: string) => AUDIENCES.find((x) => x.value === a)?.label ?? a;
const EMPTY: Draft = { slug: '', title: '', body: '', audience: 'member', category: '', sort: '0' };
const toDraft = (a: Article): Draft => ({ id: a.id, slug: a.slug, title: a.title, body: a.body, audience: a.audience, category: a.category, sort: String(a.sort ?? 0), status: a.status });

export default function AdminHelpArticlesScreen() {
  return <AdminModuleScreen title="Help articles" module="support" feature="help_centre" permission="content.manage"
    sub="What members and coaches read under Help in the portal and the app. Save a draft, read it back, then publish it with a reason.">
    <Articles />
  </AdminModuleScreen>;
}

function Articles() {
  const toast = useToast();
  const [tick, setTick] = useState(0);
  const list = useLoad<{ items: Article[] }>('admin-help-articles', () => get('/admin/help-articles'), [tick]);
  const pull = useScreenRefresh(list.loading, list.stale);
  useEffect(() => { if (pull) setTick((n) => n + 1); }, [pull]);
  const [edit, setEdit] = useState<Draft | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [reasonFor, setReasonFor] = useState<null | { kind: 'publish' | 'unpublish' | 'save'; article: Draft }>(null);
  useEffect(() => { setErrs({}); }, [edit?.id]);
  const items = list.data?.items ?? [];
  const payload = (d: Draft) => ({ title: d.title.trim(), body: d.body, audience: d.audience, category: d.category.trim() || undefined, sort: Number(d.sort) || 0, ...(d.slug.trim() ? { slug: d.slug.trim() } : {}) });
  const save = async (d: Draft, reason?: string) => {
    setBusy(true); setErrs({});
    try {
      const saved = d.id ? await patch<Article>(`/admin/help-articles/${d.id}`, { ...payload(d), ...(reason ? { reason } : {}) }) : await post<Article>('/admin/help-articles', payload(d));
      toast.show(d.id ? 'Saved' : 'Draft saved'); setEdit(toDraft(saved)); void list.reload();
    } catch (e) {
      if (e instanceof ApiError) setErrs(e.fieldErrors());
      toast.show(errorText(e), 'error'); throw e;
    } finally { setBusy(false); }
  };
  const onSave = () => { if (!edit) return; if (edit.id && edit.status === 'published') setReasonFor({ kind: 'save', article: edit }); else void save(edit).catch(() => undefined); };
  const set = (k: keyof Draft) => (v: string) => setEdit((e) => (e ? { ...e, [k]: v } : e));
  return <View style={{ gap: space.md }}>
    {toast.node}
    {!edit ? <Button title="New article" small onPress={() => setEdit({ ...EMPTY })} style={{ alignSelf: 'flex-start' }} /> : null}
    <Notice kind="info" title="Words Bioptime supplies">Write how to use Bioptime. Clinical guidance, response times or service levels, and legal or policy text need the owner’s and counsel’s approved wording before they appear here. Bodies keep paragraphs, bold, italics, lists, small headings and https or same-site links; anything else is removed when saved.</Notice>
    <LoadError title="Help articles could not be loaded" error={list.error} onRetry={list.reload} />
    {edit ? <Enter key={edit.id ?? 'new'}><Card>
      <Row between style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}><Eyebrow>{edit.id ? label(edit.status) : 'New'}</Eyebrow><H2>{edit.id ? 'Edit article' : 'New article'}</H2></View>
        <Button title="Close" variant="ghost" small onPress={() => setEdit(null)} />
      </Row>
      <Field label="Title" error={errs.title}><Input value={edit.title} onChangeText={set('title')} maxLength={160} accessibilityLabel="Title" /></Field>
      <PickerField label="For" error={errs.audience} value={edit.audience} options={AUDIENCES} onChange={set('audience')} />
      <Field label="Section (optional)" hint="Articles are grouped by it." error={errs.category}><Input value={edit.category} onChangeText={set('category')} maxLength={60} accessibilityLabel="Section (optional)" /></Field>
      <Field label="Order (optional)" error={errs.sort}><Input value={edit.sort} onChangeText={(v) => set('sort')(v.replace(/\D/g, ''))} keyboardType="number-pad" accessibilityLabel="Order (optional)" /></Field>
      <Field label="Address (optional)" hint="Lower-case letters, digits and hyphens. Taken from the title when empty." error={errs.slug}><Input value={edit.slug} onChangeText={set('slug')} maxLength={80} autoCapitalize="none" autoCorrect={false} accessibilityLabel="Address (optional)" /></Field>
      <Field label="Body" hint={'Allowed: <p> <br> <strong> <em> <ul> <ol> <li> <h3> <a href="https://… or /…">.'} error={errs.body}>
        <Input value={edit.body} onChangeText={set('body')} maxLength={20000} multiline numberOfLines={10} autoCapitalize="none" autoCorrect={false} accessibilityLabel="Body"
          style={{ minHeight: 200, textAlignVertical: 'top', fontFamily: MONO_FONT, fontSize: font.small }} />
      </Field>
      {edit.body.trim() ? <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: space.md, gap: space.sm, marginBottom: space.md }}>
        <Eyebrow>Preview</Eyebrow><HtmlPreview html={edit.body} />
      </View> : null}
      <Row>
        <Button title={edit.id ? 'Save' : 'Save draft'} busy={busy} disabled={edit.title.trim().length < 3 || !edit.body.trim()} onPress={onSave} />
        {edit.id && edit.status === 'draft' ? <Button title="Publish" variant="secondary" onPress={() => setReasonFor({ kind: 'publish', article: edit })} /> : null}
        {edit.id && edit.status === 'published' ? <Button title="Withdraw" variant="ghost" onPress={() => setReasonFor({ kind: 'unpublish', article: edit })} /> : null}
      </Row>
    </Card></Enter> : !list.data && !list.error ? <Loading /> : items.length ? <RecordList title="Help articles">
      {items.map((a, i) => <DetailRow key={a.id} last={i === items.length - 1} title={a.title}
        lines={[`${a.category} · /${a.slug}`, `For ${audienceLabel(a.audience)}`, `Updated ${fmtDateTime(a.updatedAt)}${a.updatedBy ? ` · ${a.updatedBy}` : ''}`]}
        right={<StatusPill status={a.status === 'published' ? 'published' : 'draft'} />} onPress={() => setEdit(toDraft(a))} />)}
    </RecordList> : list.data ? <Card><Empty title="No articles yet" body="Write the first one with New article." /></Card> : null}
    <ReasonSheet open={!!reasonFor} onClose={() => setReasonFor(null)}
      title={reasonFor?.kind === 'publish' ? `Publish “${reasonFor.article.title}”?` : reasonFor?.kind === 'unpublish' ? `Withdraw “${reasonFor.article.title}”?` : 'Save the published article?'}
      confirmLabel={reasonFor?.kind === 'publish' ? 'Publish' : reasonFor?.kind === 'unpublish' ? 'Withdraw' : 'Save'}
      body={reasonFor?.kind === 'publish' ? `Readers see it at once (${audienceLabel(reasonFor.article.audience).toLowerCase()}). Unsaved changes are not published; save first.` : reasonFor?.kind === 'unpublish' ? 'It goes back to draft and disappears from Help.' : 'Readers see the change at once.'}
      onConfirm={async (reason) => {
        const r = reasonFor;
        if (!r) return;
        if (r.kind === 'save') { await save(r.article, reason); return; }
        const out = await post<Article>(`/admin/help-articles/${r.article.id}/${r.kind}`, { reason });
        toast.show(r.kind === 'publish' ? 'Published' : 'Withdrawn'); setEdit(toDraft(out)); void list.reload();
      }} />
  </View>;
}
