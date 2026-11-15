/* Admin › Theme (the web's /admin/theme, pages/admin/Theme.tsx; theme.manage). Design tokens over the brand book
   (GET /admin/theme): ten colours, four radii and the font, edited as a draft (PUT /admin/theme), checked for contrast
   while typing with the same WCAG arithmetic as the server (lib/admin/b2/theme localWarnings), previewed on this screen
   and on the website (?theme=draft in the browser), published, rolled back or reset to the brand book with a reason
   (POST /admin/theme/publish|rollback|reset; publishing is refused below WCAG AA). The portal and the app keep the
   brand book; the published theme applies to the website and the preview card here, which is drawn from the draft's
   own values (data, not design tokens) as the web's preview CSS draws it. Each colour is typed as hex (rgba() for the
   border) or picked in a sheet (components/adminB2/ColourSheet), the phone's stand-in for the web's colour input. The
   preview draws its texts in the draft's font (components/adminB2/previewFont), as the web's --bp-font-sans; its
   eyebrow stays in the label face, as on the web. Nothing is requested without theme.manage. */
import * as WebBrowser from 'expo-web-browser';
import { Stack } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { api, errorText, get, post } from '@/lib/api';
import { apiBaseSync } from '@/lib/config';
import { useLoad } from '@/lib/useLoad';
import { gated, useAllowed } from '@/lib/admin/b2/pill';
import { COLOURS, colourValue, FONT_LABELS, localWarnings, pickerHex, RADII, withAlphaOf, type ColourKey, type Theme, type ThemeState } from '@/lib/admin/b2/theme';
import { ColourSheet } from '@/components/adminB2/ColourSheet';
import { usePreviewFont } from '@/components/adminB2/previewFont';
import { ChoiceChips, MONO_FONT, ReasonSheet, Swatch, useToast } from '@/components/adminB2/parts';
import { Button, Card, ErrorBox, Eyebrow, Field, H2, Input, Loading, Notice, P, Row, StaleBanner } from '@/components/ui';
import { NotificationBell, RequirePermission, RoleGate, WorkspaceScreen } from '@/components/workspaceShell';
import { Enter, MotionCard } from '@/motion';
import { colors, font, radius, space } from '@/theme';

type DialogKind = 'publish' | 'reset' | 'rollback';

/* Administrators and owners only: anyone else sees the workspace notice, and nothing here asks the API. */
export default function AdminTheme() {
  return <RoleGate workspace="admin"><AdminThemeScreen /></RoleGate>;
}

function AdminThemeScreen() {
  const allowed = useAllowed('theme.manage');
  const t = useLoad<ThemeState | null>(allowed ? 'admin-theme' : null, gated(allowed, () => get<ThemeState>('/admin/theme')), [allowed]);
  const [toast, showToast] = useToast();
  const [draft, setDraft] = useState<Theme | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [picking, setPicking] = useState<ColourKey | null>(null);
  const seed = (x: Theme) => { setDraft(x); setTexts(Object.fromEntries(Object.entries(x).map(([k, v]) => [k, String(v)]))); };
  useEffect(() => { if (t.data && !draft) seed(t.data.draft); }, [t.data, draft]);
  const d = t.data;
  const set = (k: keyof Theme, v: string | number) => { if (!draft) return; setDraft({ ...draft, [k]: v } as Theme); setTexts((x) => ({ ...x, [k]: String(v) })); setDirty(true); };
  const setColour = (k: ColourKey, raw: string) => { if (!draft) return; const v = colourValue(k, raw); if (v) set(k, v); else setTexts((x) => ({ ...x, [k]: draft[k] })); };
  const save = async () => {
    if (!draft) return;
    setBusy(true);
    try { const r = await api<{ warnings?: string[] }>('PUT', '/admin/theme', { tokens: draft }); setDirty(false); showToast(r.warnings?.length ? 'Draft saved with contrast warnings' : 'Draft saved'); void t.reload(); }
    catch (e) { showToast(errorText(e), 'error'); } finally { setBusy(false); }
  };
  const act = async (reason: string) => {
    setBusy(true); setErr(null);
    try {
      if (dialog === 'publish') { await post('/admin/theme/publish', { reason }); showToast('Theme published; the website uses it now'); }
      else if (dialog === 'rollback') { await post('/admin/theme/rollback', { reason }); showToast('The previous theme is live again'); }
      else { await post('/admin/theme/reset', { reason }); showToast('Back to the brand book defaults'); }
      setDialog(null); setDirty(false);
      // a roll back or a reset replaces the draft: the fields show the server's new draft, not the one typed before
      const fresh = await get<ThemeState>('/admin/theme');
      t.setData(fresh);
      if (dialog !== 'publish') seed(fresh.draft);
    } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  const previewSite = async () => { try { await WebBrowser.openBrowserAsync(`${apiBaseSync()}/?theme=draft`); } catch (e) { showToast(errorText(e), 'error'); } };
  const warnings = draft ? localWarnings(draft) : [];
  const fontFamily = usePreviewFont(draft?.fontSans ?? 'system-ui');
  return <WorkspaceScreen workspace="admin" title="Theme and branding" sub="Design tokens over the brand book. The preview below and the website preview use the saved draft; publishing is refused below WCAG AA contrast." refreshing={t.loading} onRefresh={t.reload}>
    <Stack.Screen options={{ title: 'Theme', headerRight: () => <NotificationBell /> }} />
    <RequirePermission permission="theme.manage">
      {toast}
      <StaleBanner at={t.stale} /><ErrorBox error={t.error} onRetry={t.reload} />
      {!d || !draft ? (t.error ? null : <Loading />) : <>
        <Enter index={1}><View style={{ gap: space.sm }}>
          <Row>
            <Button title="Preview on the website" variant="secondary" small onPress={previewSite} />
            <Button title="Roll back" variant="ghost" small onPress={() => { setErr(null); setDialog('rollback'); }} />
            <Button title="Reset to brand defaults" variant="ghost" small onPress={() => { setErr(null); setDialog('reset'); }} />
          </Row>
          <Row>
            <Button title="Save draft" small busy={busy && !dialog} disabled={!dirty} onPress={save} />
            <Button title="Publish" small disabled={dirty || !d.hasDraft} onPress={() => { setErr(null); setDialog('publish'); }} />
          </Row>
          {d.publishedProblems.length > 0 ? <Notice kind="warning" title="The live theme fails the contrast check">{`The website shows the brand defaults until a theme that passes is published or the theme is reset. ${d.publishedProblems.join('; ')}.`}</Notice> : null}
          {d.hasDraft && !dirty ? <Notice kind="info">{`An unpublished draft is saved. ${d.isCustom ? 'A custom theme is live.' : 'The brand defaults are live.'}`}</Notice> : null}
          {warnings.length > 0 ? <Notice kind="warning" title="Contrast below WCAG AA"><View style={{ gap: space.xs }}>{warnings.map((w) => <Text key={w} style={{ color: colors.muted, fontSize: font.small }}>{w}</Text>)}<Text style={{ color: colors.muted, fontSize: font.small }}>Publishing is refused until these pass. Drafts can still be saved.</Text></View></Notice> : null}
        </View></Enter>
        <MotionCard index={2} pressable={false}><Card>
          <Eyebrow>Colours</Eyebrow><H2>Palette</H2>
          {COLOURS.map(([k, name, hint]) => <View key={k} style={{ paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.border, gap: space.xs }}>
            <Row>
              <Pressable accessibilityRole="button" accessibilityLabel={name} onPress={() => setPicking(k)} hitSlop={8}><Swatch colour={pickerHex(draft[k])} /></Pressable>
              <View style={{ flex: 1, minWidth: 0 }}><P style={{ fontWeight: '600' }}>{name}</P><P muted small>{hint}</P></View>
            </Row>
            <Row>
              <Input value={texts[k] ?? draft[k]} onChangeText={(v) => setTexts((x) => ({ ...x, [k]: v }))} onBlur={() => setColour(k, texts[k] ?? draft[k])} autoCapitalize="none" autoCorrect={false} accessibilityLabel={`${name} value`} style={{ flex: 1, fontFamily: MONO_FONT }} />
              {draft[k] !== d.defaults[k] ? <Button title="Default" variant="ghost" small onPress={() => set(k, d.defaults[k])} /> : null}
            </Row>
          </View>)}
        </Card></MotionCard>
        <MotionCard index={3} pressable={false}><Card>
          <Eyebrow>Shape and type</Eyebrow><H2>Radii and font</H2>
          {RADII.map(([k, name, hint, max]) => <Field key={k} label={name} hint={`${hint}; px`}><Input value={texts[k] ?? String(draft[k])} onChangeText={(v) => setTexts((x) => ({ ...x, [k]: v.replace(/[^\d]/g, '') }))} onBlur={() => { const n = Math.max(0, Math.min(max, Number(texts[k] ?? draft[k]) || 0)); set(k, n); }} keyboardType="number-pad" accessibilityLabel={name} /></Field>)}
          <Field label="Font" hint="The website loads Montserrat; the system font needs no download. Labels stay in JetBrains Mono."><ChoiceChips options={d.fonts.map((f) => ({ value: f, label: FONT_LABELS[f] ?? f }))} value={draft.fontSans} onChange={(v) => set('fontSans', v)} /></Field>
        </Card></MotionCard>
        <MotionCard index={4} pressable={false}><Card>
          <Eyebrow>Live preview</Eyebrow><H2>How it reads</H2>
          {/* the web's .themePreview: canvas, eyebrow in the accent text, headline, muted copy, the two buttons (a white
              label on the button fill; the secondary outlined with the border) and a card on the surface; the border keeps
              its rgba() opacity. The sample buttons are pictures of buttons, not controls. */}
          <View style={{ backgroundColor: draft.bgCanvas, borderRadius: radius.lg, padding: space.xl, gap: space.md, borderWidth: 1, borderColor: draft.border }} accessibilityLabel="Theme preview">
            <Text style={{ color: draft.accentText, fontSize: font.tiny, letterSpacing: 1.6, textTransform: 'uppercase', fontWeight: '600' }}>Longevity coaching</Text>
            <Text style={{ color: draft.textPrimary, fontSize: font.title, fontWeight: '700', letterSpacing: -0.5, fontFamily }}>Engineer your best years.</Text>
            <Text style={{ color: draft.textMuted, fontSize: font.body, fontFamily }}>A coach, blood tests at home and consultations, in one package. Muted text looks like this.</Text>
            <Row>
              <View style={{ backgroundColor: draft.actionPrimary, borderRadius: draft.buttonRadius, paddingHorizontal: space.lg, paddingVertical: space.sm }}><Text style={{ color: colors.onAccent, fontWeight: '600', fontSize: font.small, fontFamily }}>Primary action</Text></View>
              <View style={{ borderColor: draft.border, borderWidth: 1, borderRadius: draft.buttonRadius, paddingHorizontal: space.lg, paddingVertical: space.sm }}><Text style={{ color: draft.textPrimary, fontWeight: '600', fontSize: font.small, fontFamily }}>Secondary</Text></View>
            </Row>
            <View style={{ backgroundColor: draft.surface, borderRadius: draft.cardRadius, padding: space.md, borderWidth: 1, borderColor: draft.border }}>
              <Text style={{ color: draft.textPrimary, fontWeight: '700', fontFamily }}>A card on a surface</Text>
              <Text style={{ color: draft.textMuted, fontSize: font.small, marginTop: space.xs, fontFamily }}>Body copy on the surface colour, with a border below.</Text>
            </View>
          </View>
          <P muted small>The portal itself keeps the brand book; the published theme applies to the website and this preview.</P>
        </Card></MotionCard>
      </>}
      <ReasonSheet open={!!dialog} onClose={() => setDialog(null)} destructive={dialog === 'reset'} title={dialog === 'publish' ? 'Publish this theme?' : dialog === 'rollback' ? 'Return to the previous theme?' : 'Reset to the brand book?'} confirmLabel={dialog === 'publish' ? 'Publish' : dialog === 'rollback' ? 'Roll back' : 'Reset'} busy={busy} error={err} cancelLabel="Not yet" placeholder="" gate="disabled"
        body={dialog === 'publish' ? 'The website picks the new tokens up on its next load. The theme that was live is kept for a roll back.' : dialog === 'rollback' ? `The theme that was live before the last publish is republished. The current one is not kept (it stays in the audit log), so this cannot be undone by another roll back.${d?.hasDraft ? ' The saved draft is discarded too.' : ''}` : 'Draft and published theme are removed; the brand book defaults apply at once.'}
        onConfirm={act} />
      <ColourSheet open={!!picking} title={picking ? COLOURS.find(([k]) => k === picking)?.[1] ?? '' : ''} value={picking && draft ? pickerHex(draft[picking]) : '#000000'} onClose={() => setPicking(null)}
        onPick={(hex) => { if (picking && draft) setColour(picking, withAlphaOf(draft[picking], hex)); setPicking(null); }} />
    </RequirePermission>
  </WorkspaceScreen>;
}
