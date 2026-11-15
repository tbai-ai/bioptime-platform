/* The live preview of a rich-text block (the web's previewHtml + .cmsPreview in pages/admin/Content.tsx and
   styles/dashboard.css), drawn with React Native text instead of a DOM: the same allow-list as the server's sanitiser
   (p, br, strong/b, em/i, ul, ol, li, h3, a), every other element unwrapped so its words stay and nothing else of it,
   every attribute dropped except a link's href, kept only when it passes the web's test (https, a path on the site, a
   page of the site, an anchor). Nothing is ever executed or fetched: the input is only read as text. A link whose
   address passed opens outside the app (parts openOutside; site paths against the server's origin). The server's
   sanitiser remains the authority on save.
   RichTextPreview { html }   the dashed preview box with the formatted copy */
import React from 'react';
import { StyleSheet, Text, View, type TextStyle } from 'react-native';
import { apiBaseSync } from '../../lib/config';
import { openOutside } from './parts';
import { colors, radius, space } from '../../theme';

type Node = { kind: 'text'; text: string } | { kind: 'el'; tag: string; href?: string; children: Node[] };

const ALLOWED = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'ul', 'ol', 'li', 'h3', 'a']);
const BLOCK = new Set(['p', 'ul', 'ol', 'li', 'h3']);
const VOID = new Set(['br', 'img', 'hr', 'input', 'meta', 'link', 'wbr', 'source', 'area', 'base', 'col', 'embed', 'param', 'track']);

/** The web's href test, as previewHtml applies it. */
function safeHref(raw: string): string | undefined {
  const h = raw.trim();
  const ok = /^https:\/\//i.test(h) || (/^\/(?![/\\])/.test(h) && !/[\s"'<>\\]/.test(h)) || /^[\w./-]+\.html(#[\w-]*)?$/.test(h) || /^#[\w-]+$/.test(h);
  return ok ? h : undefined;
}

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp|#39);/gi, (m, e: string) => {
    const k = e.toLowerCase();
    if (k === 'amp') return '&'; if (k === 'lt') return '<'; if (k === 'gt') return '>'; if (k === 'quot') return '"';
    if (k === 'apos' || k === '#39') return '\''; if (k === 'nbsp') return ' ';
    const n = k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
  });
}

/** A forgiving reader for the small allow-list: allowed elements become nodes, any other element is unwrapped (its text
 *  stays, as the web's replaceWith(...childNodes)), comments vanish, an unmatched closing tag is ignored. */
export function parseRichText(html: string): Node[] {
  const root: Node = { kind: 'el', tag: '#root', children: [] };
  const stack: Array<Extract<Node, { kind: 'el' }>> = [root as Extract<Node, { kind: 'el' }>];
  const top = () => stack[stack.length - 1]!;
  const re = /<!--[\s\S]*?(?:-->|$)|<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)|(<)/g;
  for (const m of html.matchAll(re)) {
    const [whole, tagName, attrs, text, lt] = m;
    if (text !== undefined || lt !== undefined) { top().children.push({ kind: 'text', text: decode(text ?? lt!) }); continue; }
    if (!tagName) continue; // a comment
    const tag = tagName.toLowerCase();
    const closing = whole.startsWith('</');
    if (!ALLOWED.has(tag)) continue; // unwrapped: the element goes, what is inside it stays where it is
    if (closing) {
      const at = stack.map((n) => n.tag).lastIndexOf(tag);
      if (at > 0) stack.length = at;
      continue;
    }
    if (tag === 'br') { top().children.push({ kind: 'el', tag, children: [] }); continue; }
    // a new paragraph, list item or heading closes an open paragraph, as an HTML parser does
    if (BLOCK.has(tag) && top().tag === 'p') stack.pop();
    if (tag === 'li') { const at = stack.map((n) => n.tag).lastIndexOf('li'); const list = Math.max(stack.map((n) => n.tag).lastIndexOf('ul'), stack.map((n) => n.tag).lastIndexOf('ol')); if (at > list && at > 0) stack.length = at; }
    let href: string | undefined;
    if (tag === 'a') { const h = /\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs ?? ''); href = h ? safeHref(decode(h[2] ?? h[3] ?? h[4] ?? '')) : undefined; }
    const el: Extract<Node, { kind: 'el' }> = { kind: 'el', tag, href, children: [] };
    top().children.push(el);
    if (!VOID.has(tag)) stack.push(el);
  }
  return (root as Extract<Node, { kind: 'el' }>).children;
}

const isBlock = (n: Node) => n.kind === 'el' && BLOCK.has(n.tag);

function open(href: string) {
  openOutside(/^https:/i.test(href) ? href : `${apiBaseSync()}${href.startsWith('/') || href.startsWith('#') ? '' : '/'}${href}`);
}

/** Inline content as nested Text: bold, italics, links and line breaks. */
function inline(nodes: Node[], key = 'i'): React.ReactNode[] {
  return nodes.map((n, i) => {
    const k = `${key}.${i}`;
    if (n.kind === 'text') return n.text.replace(/\s+/g, ' ');
    if (n.tag === 'br') return '\n';
    const kids = inline(n.children, k);
    if (n.tag === 'strong' || n.tag === 'b') return <Text key={k} style={styles.strong}>{kids}</Text>;
    if (n.tag === 'em' || n.tag === 'i') return <Text key={k} style={styles.em}>{kids}</Text>;
    if (n.tag === 'a') return n.href ? <Text key={k} accessibilityRole="link" style={styles.link} onPress={() => open(n.href!)}>{kids}</Text> : <Text key={k}>{kids}</Text>;
    return <Text key={k}>{kids}</Text>; // a block element met inside a line: its words, in the line
  });
}

/** Blocks in order; loose inline content between them becomes a paragraph of its own. */
function blocks(nodes: Node[], key = 'b', style?: TextStyle): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let run: Node[] = [];
  const flush = () => {
    const words = run.some((n) => n.kind === 'el' || n.text.trim());
    if (words) out.push(<Text key={`${key}.r${out.length}`} style={[styles.p, style]}>{inline(run, `${key}.r${out.length}`)}</Text>);
    run = [];
  };
  nodes.forEach((n, i) => {
    if (!isBlock(n) || n.kind !== 'el') { run.push(n); return; }
    flush();
    const k = `${key}.${i}`;
    if (n.tag === 'p') out.push(<Text key={k} style={[styles.p, style]}>{inline(n.children, k)}</Text>);
    else if (n.tag === 'h3') out.push(<Text key={k} accessibilityRole="header" style={styles.h3}>{inline(n.children, k)}</Text>);
    else if (n.tag === 'ul' || n.tag === 'ol') {
      const items = n.children.filter((c) => c.kind === 'el' && c.tag === 'li');
      const loose = n.children.filter((c) => !(c.kind === 'el' && c.tag === 'li') && (c.kind === 'el' || c.text.trim()));
      out.push(<View key={k} style={styles.list}>
        {items.map((li, j) => <View key={`${k}.${j}`} style={styles.item}>
          <Text style={styles.marker}>{n.tag === 'ol' ? `${j + 1}.` : '•'}</Text>
          <View style={{ flex: 1, minWidth: 0, gap: space.xs }}>{blocks((li as Extract<Node, { kind: 'el' }>).children, `${k}.${j}`)}</View>
        </View>)}
        {loose.length ? blocks(loose, `${k}.x`) : null}
      </View>);
    } else out.push(...blocks(n.children, k, style)); // a stray list item: its content
  });
  flush();
  return out;
}

export function RichTextPreview({ html }: { html: string }) {
  const nodes = parseRichText(html);
  const shown = blocks(nodes);
  return <View style={styles.box} accessibilityLabel="Rich text preview">{shown.length ? shown : null}</View>;
}

// the web's .cmsPreview: padding 10/14, a dashed hairline, the small radius, 14-point copy, h3 at 16, list text indented
// 20 (the marker in that indent)
const styles = StyleSheet.create({
  box: { paddingVertical: 10, paddingHorizontal: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, borderRadius: radius.sm, gap: space.sm, minHeight: 20 },
  p: { color: colors.text, fontSize: 14, lineHeight: 21 },
  h3: { color: colors.text, fontSize: 16, fontWeight: '700' },
  strong: { fontWeight: '700' },
  em: { fontStyle: 'italic' },
  link: { color: colors.accentText, textDecorationLine: 'underline' },
  list: { gap: space.xs },
  item: { flexDirection: 'row', gap: 6 },
  marker: { color: colors.text, fontSize: 14, lineHeight: 21, width: 14, textAlign: 'right' },
});
