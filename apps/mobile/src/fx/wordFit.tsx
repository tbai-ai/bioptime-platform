/* Words that never break in the middle (A1W-m2, after FU-m8's stat label): in a narrow column (a 320 dp phone, a large
   text size) a label shrinks just enough for its longest word to fit the column whole, and it still wraps between
   words. The longest word is measured as it is drawn now, by an invisible copy of the label's words in the same type
   (one word a line), so the rule holds at any system text size on Android and iOS and under the web build's
   large-text pass alike (an estimate from the text size cannot see the web's). A word that fits leaves the label
   exactly as it was. In the kit since the small-screen round, so the kit's own rows use it (screens/bio/wordFit
   re-exports it for the screens that imported it there).
   - WordMeasure: the invisible copy (no touch, hidden from screen readers and, on the web, from the page's text
     (visibility: a copy split into words put 'blood / sample' into the page's text, VWR1-1), clipped to nothing); it
     hands over the widest word's width and, on the web, the size the type is drawn at now. With `pairs` it measures
     a short word together with each word beside it as well, so a column that keeps them together never leaves a short
     word alone on a line ('Vitamin / D / (25-OH)', 'Protein / at / breakfast' beside a pill: VA-5).
   - FitText: a T whose size follows that fit; `cap` keeps a caller's own fit when it is smaller (Stat's estimate).
     Android draws a shrunk word a little wider than its size predicts, so it keeps a pixel and 2 % back. With `pairs`
     a word of one or two letters and the word beside it fit a line together too (never 'Vitamin / D / (25-OH)').
   - useBeside / Beside: a text column with a side part (a value, a pill, a count, a time, a link) that never squeezes
     the column's words: the side sits beside the column while the widest word of the column's labels, as drawn now,
     fits whole in the room it leaves (a label measured with `pairs`: a short word with its neighbours too), and
     otherwise takes a line of its own under the column. Android's layout never moves a side that does not shrink out
     of a wrapping row (SB-1: a name at 31 dp beside its pill against a basis of 120), so the place is measured, as
     Profile › Orders places its chip. The room is the column's width with the side beside it (measured with the side
     under it: that width less the side and the gap), so a move never moves it back.
   - keepShort: a label's short words joined to a neighbour by no-break spaces, so a line never ends or starts with one
     alone ('Mobility · 20 / min', '(CBC)' alone, 'Total Vitamin / D': RV2-1); the glued words measure as one word. */
import React, { useState } from 'react';
import { PixelRatio, Platform, StyleSheet, View, type LayoutChangeEvent, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { T, type TProps } from './Text';
import { type as typeScale, type TypeVariant } from './type';

/** The spaces a line may break at: every white space but the no-break space (keepShort's glue). */
const BREAKS = /[^\S\u00a0]+/;

/** A label's words as a line may break them: at spaces, and on the web after a hyphen too ("CHECK-" "IN"). A phone's
 *  line breaker keeps a hyphenated word whole (Android drew "CHECK-I/N"), so there it counts as one word. Words joined
 *  by a no-break space count as one. */
export function wordsOf(text: string): string[] {
  const words = text.split(BREAKS).filter(Boolean);
  return Platform.OS === 'web' ? words.flatMap((w) => w.replace(/-/g, '-\n').split('\n')).filter(Boolean) : words;
}

/** A short word (`max` letters or fewer, its brackets and punctuation aside: "D", "at", "(T3,"), which reads badly
 *  alone on a line. */
const PUNCT = /[()[\]{},.;:!?'"‘’“”·•–—-]/g;
const isShort = (w: string, max: number) => w.replace(PUNCT, '').length <= max;
/** A word of punctuation only ('·', '–'), which belongs to the word before it. */
const isPunct = (w: string) => w.length > 0 && w.replace(PUNCT, '').length === 0;

/** Every two neighbouring words of a label of which one is short, as a line must hold them together for the short word
 *  never to stand alone ("Vitamin D", "D (25-OH)"); none for a label without a short word. A side that moves under a
 *  label costs nothing, so Beside keeps words of up to three letters with a neighbour; a label that shrinks costs its
 *  size, so FitText keeps only words of one or two ("LDL cholesterol" may still take two lines). */
export function pairsOf(text: string, max = 3): string[] {
  const words = text.split(BREAKS).filter(Boolean);
  return words.slice(1).flatMap((w, i) => (isShort(words[i], max) || isShort(w, max) ? [`${words[i]} ${w}`] : []));
}

/** `text` with each short word (`max` letters or fewer, as pairsOf) joined to a neighbour by a no-break space: the last
 *  word to the word before it, any other to the word after it, and a word of punctuation only ('·') to the word before
 *  it. A line then never holds a short word alone (RV2-1: the pairs only made room for both, the line breaker could
 *  still part them); the glued words measure as one (wordsOf). Only plain spaces are changed (a line break stays). */
export function keepShort(text: string, max = 3): string {
  const parts = text.split(/([^\S\u00a0]+)/); // words at even places, the spaces after them at odd places
  const words = parts.filter((_, i) => i % 2 === 0);
  if (words.length < 2) return text;
  return parts.map((p, i) => {
    if (i % 2 === 0 || p !== ' ') return p;
    const k = (i - 1) / 2;
    const a = words[k], b = words[k + 1];
    if (!a || !b) return p;
    const glue = (isShort(a, max) && !isPunct(a)) || isPunct(b) || (k + 2 === words.length && isShort(b, max));
    return glue ? '\u00a0' : p;
  }).join('');
}

/** The widest word as drawn now; `fontSize` and `lineHeight` are the web's drawn type (null on a phone, where T scales
 *  the type by the system text size itself). */
export type DrawnWord = { width: number; fontSize: number | null; lineHeight: number | null };

const TEXT_KEYS = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'textTransform', 'fontVariant'] as const;

/** Only the type of a style (the copy keeps no margins or layout of the label's own). */
function typeOnly(style: StyleProp<TextStyle>): TextStyle {
  const flat = (StyleSheet.flatten(style) ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of TEXT_KEYS) if (flat[k] !== undefined) out[k] = flat[k];
  return out as TextStyle;
}

/** The web's drawn size of the copy (its large-text pass changes it after the first render). */
function drawnType(e: LayoutChangeEvent): { fontSize: number | null; lineHeight: number | null } {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') return { fontSize: null, lineHeight: null };
  const el = (e.nativeEvent as unknown as { target?: unknown }).target as Element | undefined;
  if (!el || typeof el.nodeType !== 'number') return { fontSize: null, lineHeight: null };
  const cs = window.getComputedStyle(el);
  const size = parseFloat(cs.fontSize);
  const line = parseFloat(cs.lineHeight);
  return { fontSize: Number.isFinite(size) ? size : null, lineHeight: Number.isFinite(line) ? line : null };
}

const same = (a: DrawnWord | null, b: DrawnWord) => !!a && a.width === b.width && a.fontSize === b.fontSize && a.lineHeight === b.lineHeight;

/** The invisible copy of `text`'s words, one a line, in the label's type: `onWord` gets the widest one's width. Put it
 *  inside the label's own box (it is positioned absolutely, so it takes no room and never wraps the row it sits in).
 *  `whole`: the label on one line instead (its whole width). */
export function WordMeasure({ text, v, style, maxFontSizeMultiplier, pairs, whole, onWord }: {
  text: string; v: TypeVariant; style?: StyleProp<TextStyle>; maxFontSizeMultiplier?: number; pairs?: boolean | number; whole?: boolean; onWord: (w: DrawnWord) => void;
}) {
  return <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden style={[styles.measure, WEB_HIDDEN]}>
    <View style={styles.wide}>
      <T v={v} maxFontSizeMultiplier={maxFontSizeMultiplier} style={[typeOnly(style), styles.alone]}
        onLayout={(e) => { const width = e.nativeEvent.layout.width; if (width > 0) onWord({ width, ...drawnType(e) }); }}>
        {whole ? text : (pairs ? [...wordsOf(text), ...pairsOf(text, pairs === true ? 3 : pairs)] : wordsOf(text)).join('\n')}
      </T>
    </View>
  </View>;
}

/** What a fit keeps back for the rounding of the measured width: a point everywhere, and on Android two physical pixels
 *  more and 2 % of a shrunk size (a shrunk word drew a glyph wider than its size predicts: 'Advance/d', SWB-13). */
export const WORD_KEEP = 1 + (Platform.OS === 'android' ? 2 / PixelRatio.get() : 0);
const KEEP = WORD_KEEP;
const SHRINK_KEEP = Platform.OS === 'android' ? 0.98 : 1;

/** A label that shrinks (to `min` at most) only as far as its longest word needs to fit its box whole; it still wraps
 *  between words. `cap(width)`: the caller's own fit for that box width, kept when smaller. `width`: the room the
 *  caller measured, for a label whose own box hugs its text (it would otherwise shrink with the text it fits). `pairs`:
 *  its words of one or two letters stay on a line with a neighbour (keepShort). A word still wider than the box at
 *  `min` (a long real name in a narrow column at a large text size) breaks with a hyphen, and a capped label gets a
 *  line more for it (R1-04: 'Comprehe/nsive' broke raw). */
export function FitText({ v = 'body', children, style, cap, min = 0.6, boxStyle, width, pairs, ...rest }: Omit<TProps, 'children'> & {
  children: string; cap?: (width: number) => number; min?: number; boxStyle?: StyleProp<ViewStyle>; width?: number; pairs?: boolean;
}) {
  const [own, setBox] = useState(0);
  const box = width ?? own;
  const [word, setWord] = useState<DrawnWord | null>(null);
  // Android: the widest word as drawn at the size the fit gives, and the share the fit was trimmed by for it
  const [drawn, setDrawn] = useState<{ key: string; width: number } | null>(null);
  const [trim, setTrim] = useState<{ key: string; k: number } | null>(null);
  const text = pairs ? keepShort(children, 2) : children;
  const base = StyleSheet.flatten([typeScale[v], style]) as TextStyle;
  const room = box - KEEP;
  const fitKey = `${text}|${box}|${word?.width ?? 0}`;
  const k = trim && trim.key === fitKey ? trim.k : 1;
  const ratio = word && box > 0 && word.width > room ? Math.floor((room / word.width) * SHRINK_KEEP * k * 100) / 100 : 1;
  const measured = Math.max(min, ratio);
  const fit = Math.min(cap ? cap(box) : 1, measured);
  // the widest word does not fit even at the floor: it breaks with a hyphen, on a line more
  const floor = ratio < min;
  const size = word?.fontSize ?? base.fontSize ?? 14;
  const line = word?.lineHeight ?? base.lineHeight;
  const small = fit < 1 ? { fontSize: size * fit, lineHeight: line != null ? line * fit : undefined, letterSpacing: base.letterSpacing != null ? base.letterSpacing * fit : undefined } : null;
  const lines = floor && rest.numberOfLines ? rest.numberOfLines + 1 : rest.numberOfLines;
  // a phone can draw a shrunk word wider than its size predicts (at 320 dp and text 1.3 the fit 0.77 drew
  // 'Immunohistochemistry' at about 0.84 of its size: over its line, it broke raw, 'Comprehensive Imm' / 'unohisto...',
  // R1-04): the word is measured again as drawn, and while it is still over the room the fit goes down by that share
  const checks = Platform.OS === 'android' && fit < 1 && !floor && fit === measured;
  const over = checks && drawn && drawn.key === `${fitKey}|${fit}` && drawn.width > room ? room / drawn.width : 1;
  if (over < 1) setTrim({ key: fitKey, k: Math.floor(k * over * 100) / 100 });
  return <View style={[styles.box, boxStyle]} onLayout={width !== undefined ? undefined : (e) => { const w = Math.floor(e.nativeEvent.layout.width); if (w !== own) setBox(w); }}>
    <T v={v} style={[style, small, floor ? HYPHENS : null]} {...rest} numberOfLines={lines} android_hyphenationFrequency={floor ? 'normal' : rest.android_hyphenationFrequency}>{text}</T>
    <WordMeasure text={text} v={v} style={style} maxFontSizeMultiplier={rest.maxFontSizeMultiplier} pairs={pairs ? 2 : undefined} onWord={(w) => setWord((o) => (same(o, w) ? o : w))} />
    {checks ? <WordMeasure key={fit} text={text} v={v} style={[style, small]} maxFontSizeMultiplier={rest.maxFontSizeMultiplier} pairs={pairs ? 2 : undefined}
      onWord={(w) => setDrawn({ key: `${fitKey}|${fit}`, width: w.width })} /> : null}
  </View>;
}

/** The web's hyphenation for a word that breaks (FitText at its floor); a phone uses android_hyphenationFrequency. */
const HYPHENS = Platform.OS === 'web' ? ({ hyphens: 'auto', WebkitHyphens: 'auto' } as unknown as TextStyle) : null;

/** A label of the column whose words the side must leave whole (its text and type, as WordMeasure takes them). */
export type BesideWords = { text: string; v: TypeVariant; style?: StyleProp<TextStyle>; maxFontSizeMultiplier?: number; pairs?: boolean };

/** Where a side part goes (see the header): `beside` while the widest of the column's words fits the room the side
 *  leaves, else under the column. Spread `onCol` on the column (a column that takes the free width beside the side,
 *  and the whole width under it), `onSide` on the side's own box (at its own width: never stretched), and put
 *  `measure(words)` inside the column. `reserve`: the column's width its words do not get (an icon before them).
 *  `enabled` false: always under. Going back beside needs two points more than staying there, so a room that rounds a
 *  pixel differently in the two places never flips the side back and forth. `lines`: as Beside's, the side also goes
 *  under when the first label would likely need more lines than that beside it (VWR2-1: a booking name in three narrow
 *  lines beside its pill at text 1.0). */
export function useBeside(gap: number, enabled = true, reserve = 0, lines?: number) {
  const [word, setWord] = useState<number[]>([]);
  const [whole, setWhole] = useState(0);
  const [col, setCol] = useState<{ width: number; beside: boolean } | null>(null);
  const [side, setSide] = useState(0);
  const widest = word.reduce((m, w) => Math.max(m, w || 0), 0);
  const room = col ? (col.beside ? col.width : col.width - gap - side) : null;
  // the room is the same with the side beside or under it, so this never flips the side back and forth either
  const capped = !!lines && whole > 0 && room != null && side > 0 && whole > lines * (room - reserve - widest / 2);
  const beside = placeBeside(enabled, room, side, widest + reserve, !col || col.beside) && !capped;
  const onWord = (i: number) => (w: DrawnWord) => setWord((o) => (o[i] === w.width ? o : Object.assign([...o], { [i]: w.width })));
  return {
    beside,
    onWord,
    onCol: (e: LayoutChangeEvent) => { const width = Math.floor(e.nativeEvent.layout.width); setCol((c) => (c && c.width === width && c.beside === beside ? c : { width, beside })); },
    onSide: (e: LayoutChangeEvent) => { const width = Math.ceil(e.nativeEvent.layout.width); setSide((s) => (s === width ? s : width)); },
    measure: (words: Array<BesideWords | null | undefined | false>) => {
      const first = words[0] || null;
      return [...words.map((w, i) => (w && w.text
        ? <WordMeasure key={i} text={w.text} v={w.v} style={w.style} maxFontSizeMultiplier={w.maxFontSizeMultiplier} pairs={w.pairs} onWord={onWord(i)} />
        : null)),
      lines && first && first.text ? <WordMeasure key="whole" text={first.text} v={first.v} style={first.style} maxFontSizeMultiplier={first.maxFontSizeMultiplier} whole
        onWord={(d) => setWhole((o) => (o === d.width ? o : d.width))} /> : null];
    },
  };
}

/** Beside or under: the room's test, with the two points of hysteresis (see useBeside). */
function placeBeside(enabled: boolean, room: number | null, side: number, need: number, wasBeside: boolean): boolean {
  if (!enabled) return false;
  if (room == null || !side || !need) return true;
  return need <= room - KEEP - (wasBeside ? 0 : 2);
}

/** A column (`children`) and its `side` laid out by useBeside's rule: in a row (the column takes the free width, or with
 *  `grow` false only what its words need, the side right after it; the side keeps its own width; `align` the row's
 *  cross alignment) while the column's widest word fits beside the side, else the side on a line of its own under the
 *  column (`under`: at its start or end, `underGap` above it). The room is the whole row's width less the side and the
 *  gap, the same in both places (a column that hugs its words would otherwise measure its own width as the room and
 *  flip the side back and forth). `lines`: the first label's line cap (numberOfLines); the side also moves under when
 *  the label would likely need more lines than that beside it (its whole width, measured as drawn, over the room less
 *  half its widest word, the room a wrapped line keeps on average), so the cap does not cut it short beside the side
 *  ('Your coach replied to your …' in five lines beside a date at text 2.0: VWR1-2). */
export function Beside({ words, side, children, gap = 12, align = 'center', under = 'start', underGap = 4, grow = true, reserve = 0, enabled = true, lines, style, columnStyle }: {
  words: Array<BesideWords | null | undefined | false>; side: React.ReactNode; children: React.ReactNode; gap?: number;
  align?: 'center' | 'flex-start' | 'flex-end' | 'baseline'; under?: 'start' | 'end'; underGap?: number; grow?: boolean; reserve?: number; enabled?: boolean;
  lines?: number; style?: StyleProp<ViewStyle>; columnStyle?: StyleProp<ViewStyle>;
}) {
  const [word, setWord] = useState<number[]>([]);
  const [whole, setWhole] = useState(0);
  const [row, setRow] = useState(0);
  const [sideW, setSideW] = useState(0);
  const [was, setWas] = useState(true);
  const widest = word.reduce((m, w) => Math.max(m, w || 0), 0);
  const first = words[0] || null;
  // the label's lines beside the side: none of this depends on where the side is, so it never flips it back and forth
  const capped = !!lines && !!first && whole > 0 && row > 0 && sideW > 0 && whole > lines * (row - gap - sideW - reserve - widest / 2);
  const beside = placeBeside(enabled, row ? row - gap - sideW : null, sideW, widest + reserve, was) && !capped;
  if (beside !== was) setWas(beside);
  return <View style={[beside ? [styles.row, { gap, alignItems: align }, grow ? null : styles.start] : { gap: underGap }, style]}
    onLayout={(e) => { const w = Math.floor(e.nativeEvent.layout.width); setRow((r) => (r === w ? r : w)); }}>
    <View style={[beside ? (grow ? styles.column : styles.hug) : null, columnStyle]}>
      {children}
      {words.map((w, i) => (w && w.text
        ? <WordMeasure key={i} text={w.text} v={w.v} style={w.style} maxFontSizeMultiplier={w.maxFontSizeMultiplier} pairs={w.pairs}
          onWord={(d) => setWord((o) => (o[i] === d.width ? o : Object.assign([...o], { [i]: d.width })))} />
        : null))}
      {lines && first && first.text ? <WordMeasure text={first.text} v={first.v} style={first.style} maxFontSizeMultiplier={first.maxFontSizeMultiplier} whole
        onWord={(d) => setWhole((o) => (o === d.width ? o : d.width))} /> : null}
    </View>
    {side ? <View style={beside ? styles.side : under === 'end' ? styles.underEnd : styles.underStart}
      onLayout={(e) => { const w = Math.ceil(e.nativeEvent.layout.width); setSideW((v) => (v === w ? v : w)); }}>{side}</View> : null}
  </View>;
}

/** A label whose box hugs its text (a pill's word, a status word, a caption beside an icon). Android lays a text out at
 *  its box's whole-pixel width, which can come out a hair under the width it measured: the last word (or the last
 *  letter of a single word) then wraps onto a line the box has no height for ('ACTIVE' drawn 'ACTIV', 'SLEEP · 13 NOV'
 *  drawn 'SLEEP ·', 'Wed · 4 exercises' drawn 'Wed · 4' at 320 dpi: TAB-01; H and Button's titles had the same). Once
 *  it has laid out on one line it gets two physical pixels more than it measured (once per text; a label that wraps
 *  for real is left as it is). Elsewhere it is a T. */
export function HugText(props: TProps) {
  // (a label that wraps for real gets nothing: it is drawn on more lines than its own line breaks)
  const [fitted, setFitted] = useState<{ key: string; minWidth: number } | null>(null);
  const [lines, setLines] = useState(0);
  const key = typeof props.children === 'string' || typeof props.children === 'number' ? String(props.children) : '';
  if (Platform.OS !== 'android' || !key) return <T {...props} />;
  // drawn on as many lines as it has (a line break of its own counts: 'SLEEP' / '13 NOV')
  const minWidth = fitted && fitted.key === key && lines > 0 && lines <= key.split('\n').length ? fitted.minWidth : 0;
  return <T {...props}
    onLayout={(e) => { props.onLayout?.(e); const w = e.nativeEvent.layout.width; if (w > 0 && (!fitted || fitted.key !== key)) setFitted({ key, minWidth: w + 2 / PixelRatio.get() }); }}
    onTextLayout={(e) => { props.onTextLayout?.(e); const n = e.nativeEvent.lines.length; setLines((o) => (o === n ? o : n)); }}
    style={[props.style, minWidth ? { minWidth } : null]} />;
}

/** A T whose words of text may break after an address's '@' and each '.' (a zero-width space there, on a phone): an
 *  email address has no break of its own, so a narrow line broke it anywhere ('bioptim/e' at 320 dp and text 1.3:
 *  EMAIL). Only for text that is read, not copied (it is not selectable). The web draws the text as it is (its page
 *  text is what its checks read, and it has no system text size). */
export function AddressText({ children, ...props }: TProps) {
  const broken = Platform.OS === 'web' ? children : React.Children.map(children, (c) => (typeof c === 'string' ? c.replace(/([@.])(?=\S)/g, '$1\u200b') : c));
  return <T {...props} selectable={false}>{broken}</T>;
}

/** The web: the copy is laid out and measured but is no part of the page's text (innerText, find in page, selection). */
const WEB_HIDDEN = Platform.OS === 'web' ? ({ visibility: 'hidden' } as unknown as ViewStyle) : null;

const styles = StyleSheet.create({
  box: { alignSelf: 'stretch' },
  // clipped to nothing and drawn at no opacity: it takes no room, adds no scroll width and shows nothing
  measure: { position: 'absolute', left: 0, top: 0, width: 0, height: 0, overflow: 'hidden', opacity: 0 },
  wide: { width: 2000, alignItems: 'flex-start' },
  alone: { alignSelf: 'flex-start' },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  column: { flex: 1, minWidth: 0 },
  hug: { flexShrink: 1, minWidth: 0 },
  start: { justifyContent: 'flex-start' },
  side: { flexShrink: 0 },
  underStart: { alignSelf: 'flex-start' },
  underEnd: { alignSelf: 'flex-end' },
});
