/* The coach-plan row's MARK (CRITIQUE §32): the earlier app logged a workout with one tap. Here it opens a small sheet:
   the session, an optional effort rating and "Mark as done", which logs the session without set details
   (POST /me/workouts/:id/complete with no sets), then the earlier app's toast "{name} completed · logged". "Log set by
   set" opens the player instead. A session already logged is never marked again from here (logging again would replace
   the sets the member recorded): its DONE column opens the player. Effort is the intensity ladder (EffortLadder,
   motion v2 M76). */
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Field, Sheet, T, fx, haptics, invalidate, toast } from '@/fx';
import { errorText, post } from '@/lib/api';
import { EffortLadder } from './EffortLadder';
import { dayMonth, sessionMeta, skipReasonSentence, weekday, type SessionRow } from './shared';

export function MarkSheet({ session, onClose, onOpenPlayer }: { session: SessionRow | null; onClose: () => void; onOpenPlayer: (s: SessionRow) => void }) {
  const [rpe, setRpe] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<SessionRow | null>(session);
  useEffect(() => { if (session) { setShown(session); setRpe(null); } }, [session]);
  const s = session ?? shown;
  const mark = async () => {
    if (!s) return;
    setBusy(true);
    try {
      await post(`/me/workouts/${s.id}/complete`, { sets: [], rpe });
      haptics.success();
      toast.success(`${s.title} completed · logged`);
      invalidate(['workouts', 'programme', 'me', 'workouts.history', 'workouts.records']);
      onClose();
    } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); }
  };
  return <Sheet visible={!!session} onClose={onClose} title={s?.title ?? ''}>
    {s ? <View style={styles.gap}>
      <T v="caption" color={fx.ink.a60}>{`${sessionMeta(s)} · ${dayMonth(s.scheduledDate)}`}</T>
      {s.status === 'skipped' ? <T v="body" color={fx.ink.a70}>{`You skipped this session${skipReasonSentence(s.skipReason)} You can still log it if you did it after all.`}</T> : null}
      <T v="body" color={fx.ink.a70}>{`Mark ${weekday(s.scheduledDate)}'s session as done without the sets, or log it set by set.`}</T>
      <Field label="Effort, 1 very light to 10 maximal (optional)">
        <EffortLadder value={rpe} onChange={setRpe} />
      </Field>
      <Button title="Mark as done" icon="check" commit busy={busy} onPress={mark} />
      <Button title="Log set by set" variant="ghost" full iconRight="arrow-right" onPress={() => { onClose(); onOpenPlayer(s); }} />
    </View> : null}
  </Sheet>;
}

const styles = StyleSheet.create({
  gap: { gap: 16 },
});
