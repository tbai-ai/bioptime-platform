/* The colour picker of the Theme screen: the phone's stand-in for the web's <input type="color"> beside each token. A
   sheet with the colour as it stands, its hex value, and its red, green and blue channels (0 to 255), each typed or
   stepped by one. It returns a #RRGGBB value; the screen keeps an rgba() border's opacity (lib/admin/b2/theme
   withAlphaOf) and normalises the value as the server does. The hex field on the screen stays the other way in. */
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Input, P, Row } from '../ui';
import { Sheet } from '../workspace';
import { MonoText } from './parts';
import { colors, radius, space } from '../../theme';

type RGB = [number, number, number];
const CHANNELS = ['Red', 'Green', 'Blue'] as const;
const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(Number.isFinite(n) ? n : 0)));
function toRgb(hex: string): RGB {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  const n = m ? parseInt(m[1]!, 16) : 0;
  return [n >> 16, (n >> 8) & 255, n & 255];
}
const toHex = (c: RGB) => `#${c.map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase()}`;

export function ColourSheet({ open, title, value, onClose, onPick }: { open: boolean; title: string; value: string; onClose: () => void; onPick: (hex: string) => void }) {
  const [rgb, setRgb] = useState<RGB>([0, 0, 0]);
  const [texts, setTexts] = useState<string[]>(['0', '0', '0']);
  useEffect(() => { if (open) { const c = toRgb(value); setRgb(c); setTexts(c.map(String)); } }, [open, value]);
  const setChannel = (i: number, n: number) => {
    const next = [...rgb] as RGB;
    next[i] = clamp(n);
    setRgb(next); setTexts(next.map(String));
  };
  const hex = toHex(rgb);
  return <Sheet open={open} onClose={onClose} title={title} footer={<View style={{ flexDirection: 'row', gap: space.sm }}>
    <Button title="Cancel" variant="secondary" onPress={onClose} style={{ flex: 1 }} />
    {/* from what is typed, so a channel still being edited counts */}
    <Button title="Use this colour" onPress={() => onPick(toHex(texts.map((t) => clamp(Number(t))) as RGB))} style={{ flex: 1 }} />
  </View>}>
    <View accessibilityLabel={`Colour ${hex}`} style={{ height: 72, borderRadius: radius.md, backgroundColor: hex, borderWidth: 1, borderColor: colors.borderStrong }} />
    <MonoText>{hex}</MonoText>
    {CHANNELS.map((name, i) => <Row key={name}>
      <P style={{ width: 56 }}>{name}</P>
      <Button title="−" variant="secondary" small disabled={rgb[i]! <= 0} onPress={() => setChannel(i, rgb[i]! - 1)} />
      <Input value={texts[i]} onChangeText={(v) => setTexts(texts.map((t, j) => (j === i ? v.replace(/[^\d]/g, '').slice(0, 3) : t)))} onBlur={() => setChannel(i, Number(texts[i]))} onSubmitEditing={() => setChannel(i, Number(texts[i]))} keyboardType="number-pad" maxLength={3} accessibilityLabel={`${name}, 0 to 255`} style={{ width: 72, textAlign: 'center' }} />
      <Button title="+" variant="secondary" small disabled={rgb[i]! >= 255} onPress={() => setChannel(i, rgb[i]! + 1)} />
    </Row>)}
  </Sheet>;
}
