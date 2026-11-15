/* Today's activity (the earlier app's activity card, THEME §11.4, GAP_MAP §4.4): in a TiltCard (I 4).
   - Steps: live from this phone's step counter while it counts ("LIVE · ON THIS PHONE" with the live dot; never below
     the server's total for today, lib/today todaySteps: the figure Bio and /goals show), else today's value the
     server holds with its source ("From this phone"), else "—". The target is the member's own active steps
     goal, never a default: without one there is no bar and the card offers "Set a steps goal". The distance is the
     phone's approximation (steps × 0.75 m), so it is written "≈".
   - Three tiles from what the member logged: sessions done of those planned this week (labelled "This week", the same
     week Train's "3 sessions planned this week" counts), active minutes of the sessions
     completed today, and the plan tasks still open today. No calories: Bioptime never estimates them.
   - On a phone where counting is off, a row turns it on ("Count my steps on this phone": the motion permission). */
import React from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { fx, Icon, LiveDot, motionValues, ProgressBar, T, TiltCard, Toggle, GlassCard, type StepCounter, toast } from '@/fx';
import { CardHead, MiniStat } from './parts';
import { todaySteps } from '@/lib/today';
import { num } from './data';
import { HugText } from '@/fx/wordFit';

export function ActivityCard({ counter, serverSteps, serverSource, goal, sessions, activeMinutes, openTasks, workoutsOn, onSetGoal }: {
  counter: StepCounter; serverSteps: number | null; serverSource: string | null; goal: number | null;
  sessions: { done: number; planned: number } | null; activeMinutes: number | null; openTasks: number | null; workoutsOn: boolean; onSetGoal: (() => void) | null;
}) {
  const live = counter.status === 'counting' && counter.steps != null;
  const steps = todaySteps(live ? counter.steps : null, serverSteps);
  const km = steps != null ? Math.round((steps * 0.75) / 100) / 10 : null;
  const status = live ? 'Live · on this phone' : serverSteps != null ? (serverSource ?? 'Logged today') : null;
  const rest = [goal ? `/ ${num(goal)} steps` : 'steps', km != null && steps ? `≈ ${num(km, 1)} km` : null].filter(Boolean).join(' · ');
  const turnOn = async () => {
    const ok = await counter.enable();
    if (!ok) toast.info(counter.status === 'unavailable' ? 'This phone cannot count steps.' : 'Step counting needs the motion permission in your phone’s settings.');
  };
  return <TiltCard intensity={motionValues.tilt.activity}>
    <GlassCard>
      <CardHead icon="activity" title="Today's activity" right={status ? <View style={styles.status}>
        {live ? <LiveDot size={6} color={fx.hue.green500} /> : null}
        <T v="micro" color={fx.ink.a50} numberOfLines={1} style={styles.statusText}>{status}</T>
      </View> : null} />
      <View style={styles.stepsRow} accessible accessibilityLabel={steps == null ? 'Steps today: none counted yet' : `Steps today: ${num(steps)}${goal ? ` of ${num(goal)}` : ''}`}>
        <View style={styles.stepsLeft}>
          <Icon name="footprints" size={18} color={fx.ink.a50} />
          <T v="metric24" numberOfLines={1}>{steps == null ? '—' : num(steps)}</T>
        </View>
        {/* keeps its last word on a box that hugs it at 320 dpi (HugText, as TAB-01's labels) */}
        <HugText v="caption" color={fx.ink.a50} numberOfLines={2} style={styles.stepsRest}>{rest}</HugText>
      </View>
      {goal ? <ProgressBar value={steps != null ? steps / goal : 0} size="medium" completeGreen duration={600} style={styles.bar} accessibilityLabel={`${Math.round(((steps ?? 0) / goal) * 100)} % of your steps goal`} />
        : onSetGoal ? <Pressable accessibilityRole="link" onPress={onSetGoal} hitSlop={6} style={styles.goalLink}><T v="chip" color={fx.red.vivid}>Set a steps goal</T><Icon name="chevron-right" size={14} color={fx.red.vivid} /></Pressable> : <View style={styles.noGoal} />}
      <View style={styles.tiles}>
        {workoutsOn ? <MiniStat icon="dumbbell" value={sessions && sessions.planned ? `${sessions.done}/${sessions.planned}` : '—'} label="This week" a11y={sessions && sessions.planned ? `Sessions this week: ${sessions.done} done of ${sessions.planned} planned` : 'Sessions this week: none planned'} /> : null}
        {workoutsOn ? <MiniStat icon="clock" value={activeMinutes == null ? '—' : String(activeMinutes)} label="Active min" a11y={`Active minutes today: ${activeMinutes ?? 'none logged'}`} /> : null}
        <MiniStat icon="list-checks" value={openTasks == null ? '—' : String(openTasks)} label="Tasks left" a11y={`Tasks left today: ${openTasks ?? 0}`} />
      </View>
      {Platform.OS !== 'web' && counter.status !== 'counting' && counter.status !== 'starting' ? <View style={styles.toggleRow}>
        <View style={styles.flex}>
          <T v="section">Count my steps on this phone</T>
          {counter.status === 'denied' ? <T v="caption" color={fx.ink.a55}>Allow motion access for Bioptime in your phone’s settings.</T> : null}
        </View>
        <Toggle value={false} label="Count my steps on this phone" onChange={() => { void turnOn(); }} disabled={counter.status === 'unavailable'} />
      </View> : null}
      <T v="caption" color={fx.ink.a50} center style={styles.foot}>Steps are counted on this phone; sessions come from what you log.</T>
    </GlassCard>
  </TiltCard>;
}

const styles = StyleSheet.create({
  status: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  statusText: { letterSpacing: 1 },
  // the goal and the distance move under the count when they do not fit beside it, on up to two lines ('/ 9,000 st…'
  // hid '≈ 5.5 km' at 320 dp and text 1.3: N1)
  stepsRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', columnGap: 8, rowGap: 2, marginBottom: 12 },
  stepsLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepsRest: { flexShrink: 1, textAlign: 'right', marginLeft: 'auto' },
  bar: { marginBottom: 16 },
  goalLink: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start', minHeight: 24, marginBottom: 12 },
  tiles: { flexDirection: 'row', gap: 12 },
  noGoal: { height: 4 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: fx.line.a05 },
  flex: { flex: 1 },
  foot: { marginTop: 16, fontSize: 10, lineHeight: 15 },
});
