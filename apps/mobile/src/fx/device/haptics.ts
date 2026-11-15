/* Haptics (PREMIUM §1.8 map; AndroidHaptics names as in the SDK 58 docs). One call per event; at most one haptic every
   50 ms; nothing on the web (the module is never called there); nothing while the device setting "Haptics" is off; a
   failure never reaches the caller. Never during passive animation, scrolling or dragging, except at a threshold.
   The pairing (motion v2), one rule per event:
   - select: a tab commit only (a tab, a segment, a chip); never a cancelled swipe or a press a scroll took;
   - light: a tick, a copy or a drop (a set tick, a habit, an option chosen, a reference copied);
   - soft: a drag crossing a dismiss threshold (a sheet, an overlay, a toast swiped away);
   - success: a save (a session logged, a code verified, a booking confirmed, a rest that ended);
   - error: with every shake (a field error, a wrong code, a failed request), reduced motion included;
   - warning: only when a destructive confirm opens (sign out, cancel a booking, skip a workout);
   - limit: at a bound (a stepper's end);
   - commit: on release (onPress), never on press-in, so a press that turned into a scroll has none;
   - none on programmatic changes (a value set by the app, a restored tab, a deep link). */
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';
import { peekSetting } from './settings';

let last = 0;

function fire(ios: () => Promise<void>, android: Haptics.AndroidHaptics, minGap = 50): void {
  if (Platform.OS === 'web') return;
  if (peekSetting('haptics') === false) return;
  const now = Date.now();
  if (now - last < minGap) return;
  last = now;
  try {
    const p = Platform.OS === 'android' ? Haptics.performAndroidHapticsAsync(android) : ios();
    p.catch(() => undefined);
  } catch { /* no haptic engine */ }
}

const A = Haptics.AndroidHaptics;
const impact = (s: Haptics.ImpactFeedbackStyle) => () => Haptics.impactAsync(s);
const notify = (n: Haptics.NotificationFeedbackType) => () => Haptics.notificationAsync(n);

export const haptics = {
  /** Tab change (on commit), segment, chip, carousel snap, stepper value. */
  select: () => fire(() => Haptics.selectionAsync(), A.Segment_Tick),
  /** Stepper value while held (throttled to 60 ms). */
  step: () => fire(() => Haptics.selectionAsync(), A.Segment_Tick, 60),
  /** Stepper reached its minimum or maximum. */
  limit: () => fire(impact(Haptics.ImpactFeedbackStyle.Rigid), A.Long_Press),
  /** Toggle switched. */
  toggle: (on: boolean) => fire(impact(Haptics.ImpactFeedbackStyle.Light), on ? A.Toggle_On : A.Toggle_Off),
  /** A primary commit CTA released (sign in, log, book, buy, agree, send: onPress, never press-in); not navigation buttons. */
  commit: () => fire(impact(Haptics.ImpactFeedbackStyle.Light), A.Virtual_Key),
  /** Set tick, habit check, option selected, reference copied. */
  light: () => fire(impact(Haptics.ImpactFeedbackStyle.Light), A.Clock_Tick),
  /** Breathing inhale, sheet or overlay dismissed by a drag. */
  soft: () => fire(impact(Haptics.ImpactFeedbackStyle.Soft), A.Gesture_End),
  /** Task done, session logged, code verified, booking confirmed. */
  success: () => fire(notify(Haptics.NotificationFeedbackType.Success), A.Confirm),
  /** A destructive confirm opens (sign out, cancel a booking, skip a workout). */
  warning: () => fire(notify(Haptics.NotificationFeedbackType.Warning), A.Reject),
  /** Validation or network error (with the shake). */
  error: () => fire(notify(Haptics.NotificationFeedbackType.Error), A.Reject),
  /** Pull to refresh reached its trigger. */
  refresh: () => fire(impact(Haptics.ImpactFeedbackStyle.Light), A.Gesture_End),
};
