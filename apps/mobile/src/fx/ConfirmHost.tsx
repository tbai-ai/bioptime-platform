/* The app's confirmations in its own look (SMA-5): on a phone, lib/alert's Alert.alert (sign out, delete a meal or a photo,
   archive a habit, cancel a booking, withdraw a request, accept a proposal, ask for your data) opens the kit's glass
   sheet instead of the system's grey dialog: the title, the message at white/70, each action as a button (a
   destructive one as the kit's danger button, redGlass; any other as the red primary, a commit) and the cancel button as
   the ghost under them. A tap on the scrim, a drag down and Android's back run the cancel button, as the system dialog's
   back does; the sheet is an accessibility modal (the kit's Sheet). One question at a time: a new one replaces one still
   open. The web keeps the browser's own dialogs (lib/alert). Mount <ConfirmHost /> once, in the root layout. */
import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { StyleSheet, View, type AlertButton } from 'react-native';
import { fx } from '@/theme';
import { Button } from './Button';
import { Sheet } from './Sheet';
import { T } from './Text';

type Ask = { id: number; title: string; message?: string; buttons: AlertButton[] };

let current: Ask | null = null;
let hosts = 0;
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => { listeners.forEach((l) => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const snapshot = () => current;

/** Whether a ConfirmHost is mounted to show a question (lib/alert falls back to the system dialog when none is). */
export function confirmHostReady(): boolean { return hosts > 0; }

/** Asks `title` with `message` and `buttons` (React Native's Alert.alert arguments) in the kit's sheet. */
export function showConfirm(title: string, message?: string, buttons?: AlertButton[]): void {
  current = { id: ++seq, title, message, buttons: buttons && buttons.length ? buttons : [{ text: 'OK' }] };
  emit();
}

/** Closes the question on screen (if it is still `id`) and runs the button the member chose, if any. */
function answer(id: number, button: AlertButton | undefined): void {
  if (!current || current.id !== id) return;
  current = null;
  emit();
  button?.onPress?.();
}

export function ConfirmHost(): React.JSX.Element {
  const ask = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => { hosts += 1; return () => { hosts -= 1; }; }, []);
  // the last question stays drawn while its sheet leaves
  const [shown, setShown] = useState<Ask | null>(ask);
  if (ask && ask !== shown) setShown(ask);
  const q = ask ?? shown;
  const cancel = q?.buttons.find((b) => b.style === 'cancel');
  const actions = q ? q.buttons.filter((b) => b.style !== 'cancel') : [];
  return <Sheet visible={!!ask} onClose={() => { if (ask) answer(ask.id, cancel); }} title={q?.title ?? ''}>
    {q ? <View style={styles.body}>
      {q.message ? <T v="body" color={fx.ink.a70}>{q.message}</T> : null}
      {actions.map((b, i) => <Button key={`${q.id}-${i}`} title={b.text ?? 'OK'} variant={b.style === 'destructive' ? 'redGlass' : 'primary'} commit
        onPress={() => answer(q.id, b)} />)}
      {cancel ? <Button title={cancel.text ?? 'Cancel'} variant="ghost" full onPress={() => answer(q.id, cancel)} /> : null}
    </View> : null}
  </Sheet>;
}

const styles = StyleSheet.create({
  body: { gap: 16 },
});
