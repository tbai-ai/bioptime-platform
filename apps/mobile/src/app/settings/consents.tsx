/* Privacy and sharing: every consent on record (GET /me/consents), each with the wording the portal uses, its date
   and policy version, and a switch that records a new choice (POST /me/consents). Terms and privacy were accepted at
   sign-up and are shown locked. The Coach AI consent is given and withdrawn on its own screen; while one is on record
   it is named here with a link. Reached from Profile › Settings. */
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { errorText, get, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { Button, ErrorState, fx, GlassCard, Notice, Overlay, Reveal, RingSpinner, T, Toggle } from '@/fx';

const KINDS: Array<{ kind: string; title: string; body: string; locked?: boolean }> = [
  { kind: 'health_data', title: 'Process my health information', body: 'Goals, measurements and blood test results, to run your programme. While it is withdrawn, new blood test bookings in the portal and app wait until you give it again; what your coach can see follows the separate "My coach may see my health information" choice; nothing already recorded is deleted.' },
  { kind: 'coach_sharing', title: 'My coach may see my health information', body: 'Off: your coach still sees your name, member ID, age, gender, goals, programme and plan (and city and state unless Bioptime switches those off), the tasks a coach set for you and whether you did them (such as any habits, workouts, check-ins or courses a coach assigned), any live sessions you sign up for, and what you send them in Messages, including any files. They can message you and arrange appointments. Private while it is off: your measurements, progress log, wellness score and blood tests, and, if you use them, your progress photos, goal values, check-in answers, next steps from blood tests, diet profile, meal logs and photos, workout logs, the habits you add yourself, habit notes, and courses a coach did not assign. A coach never sees your phone number, email, address, PIN code or date of birth.' },
  { kind: 'lab_consent', title: 'Share my details with the partner laboratory', body: 'Your name, phone, email, gender, date of birth and collection address, only for collections you book. Bookings already with the laboratory still complete.' },
  { kind: 'marketing', title: 'Bioptime news by email', body: 'Occasional, and never with health detail.' },
  { kind: 'terms', title: 'Terms of use', body: 'Accepted when the account was created.', locked: true },
  { kind: 'privacy', title: 'Privacy policy', body: 'Accepted when the account was created.', locked: true },
];

/** A dated version as members read dates: "the policy of 17 Oct 2026" for "2026-10-17" or "app-2026-10-17"; any other
 *  version keeps its name. A locked choice (terms, privacy) keeps its full colour: its switch shows it cannot be changed,
 *  and dimming the card took its text under 4.5:1. */
function datedVersion(version: string | null | undefined, what: string): string {
  const m = /(\d{4}-\d{2}-\d{2})/.exec(version ?? '');
  return m ? `the ${what} of ${fmtDate(`${m[1]}T12:00:00Z`)}` : `version ${version ?? '—'}`;
}
const policyOf = (version: string | null | undefined) => datedVersion(version, 'policy');
/** The Coach AI consent's wording, dated the same way ("draft-2026-10-23b" → "the draft wording of 23 Oct 2026"); a
 *  draft version says so, as the coach's view of the same consent does (pending review by counsel). */
const wordingOf = (version: string | null | undefined) => datedVersion(version, /draft/i.test(version ?? '') ? 'draft wording' : 'wording');

export default function Consents() {
  const router = useRouter();
  const { config } = useAuth();
  const c = useLoad<any>('consents', () => get('/me/consents'), []);
  // the Coach AI consent is given and withdrawn on its own screen (it needs the current wording); while one is on record
  // it is named here with a link (/coach-ai is a file route, open whatever the 'ai' flag)
  const ai = c.data?.ai_processing as { granted: boolean; version: string; at: string } | undefined;
  const [toast, setToast] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const set = async (kind: string, granted: boolean) => {
    setSaving(kind); setToast(null);
    try { await post('/me/consents', { kind, version: `app-${config?.privacyVersion ?? '2026-10-17'}`, granted }); await c.reload(); }
    catch (e) { setToast(errorText(e)); } finally { setSaving(null); }
  };
  return <Overlay kind="back" title="Privacy and sharing" subtitle="Each choice is recorded with its date and the policy version. Change any of them here." fallback="/(tabs)/profile?tab=settings">
    <ErrorState error={c.error} onRetry={c.reload} />
    {toast ? <Notice kind="error">{toast}</Notice> : null}
    {c.loading && !c.data ? <View style={styles.loading}><RingSpinner label="Loading your choices" /></View> : <>
      {KINDS.map((k, i) => {
        const cur = c.data?.[k.kind];
        return <Reveal key={k.kind} index={i} mount>
          <GlassCard>
            <View style={styles.head}>
              <T v="cardTitle" style={styles.flex}>{k.title}</T>
              <Toggle value={!!cur?.granted} label={k.title} disabled={k.locked || saving === k.kind} onChange={(v) => { void set(k.kind, v); }} />
            </View>
            <T v="bodySm" color={fx.ink.a70} style={styles.body}>{k.body}</T>
            <T v="caption" color={fx.ink.a70} style={styles.state}>{cur ? `${cur.granted ? 'Granted' : 'Withdrawn'} ${fmtDate(cur.at)} · ${policyOf(cur.version)}` : 'Not set'}</T>
          </GlassCard>
        </Reveal>;
      })}
      {ai?.granted ? <GlassCard>
        <T v="bodySm" color={fx.ink.a70}>{`Coach AI drafts: given ${fmtDate(ai.at)}, under ${wordingOf(ai.version)}. Review or withdraw it on Coach AI and your data.`}</T>
        <Button title="Open Coach AI and your data" variant="link" iconRight={null} onPress={() => router.push('/coach-ai')} style={styles.link} />
      </GlassCard> : null}
      <GlassCard>
        <T v="label" accessibilityRole="header">Your rights</T>
        <T v="bodySm" color={fx.ink.a70} style={styles.body}>Under the Digital Personal Data Protection Act, 2023 you can see, correct, download and erase your data, and raise a grievance. Downloads and deletion are under Profile › Settings › Your data; anything else, write to privacy@bioptime.com.</T>
      </GlassCard>
    </>}
  </Overlay>;
}

const styles = StyleSheet.create({
  loading: { paddingVertical: 48, alignItems: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  flex: { flex: 1, minWidth: 0 },
  body: { marginTop: 8 },
  state: { marginTop: 10 },
  link: { alignSelf: 'flex-start', marginTop: 8 },
});
