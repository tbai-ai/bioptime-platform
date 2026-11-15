/* Website content (Admin › Website content): the block shape of GET /admin/content and the small rules the web page
   keeps beside the server (apps/dashboard/src/pages/admin/Content.tsx): the alternative-text rule for image blocks
   (the same words as the API's CONTENT_ALT_REQUIRED), the one-line summary of a block and its state. */
import { fmtDateTime } from '../../format';

export type BlockType = 'text' | 'richtext' | 'url' | 'boolean' | 'faq' | 'image';
export type Block = { key: string; type: BlockType; label: string; section: string; page: string; max: number | null; default: unknown; published: unknown; publishedAt: string | null; publishedBy: string | null; draft: unknown; draftUpdatedAt: string | null; draftBy: string | null };
export type ImageValue = { assetId: string; alt: string; url?: string } | null;
export type FaqItem = { q: string; a: string };
export type BlockState = 'draft' | 'published' | 'default';

/* An image block needs alternative text before it is saved or published: the same rule and the same words as the API's
   CONTENT_ALT_REQUIRED (apps/api domain/content.ts), checked here too. The server stays the authority. */
export const altRequired = (blockLabel: string) => `${blockLabel.replace(/\s*\(empty[^)]*\)\s*$/, '')}: describe the image in the alternative text (what it shows, for people who cannot see it) before saving or publishing.`;
export const imageWithoutAlt = (type: BlockType, v: unknown) => type === 'image' && !!v && typeof v === 'object' && !!(v as { assetId?: unknown }).assetId && !String((v as { alt?: unknown }).alt ?? '').trim();

export function blockState(b: Block): BlockState { return b.draft !== null ? 'draft' : b.published !== null ? 'published' : 'default'; }
/** The status the web's state pill is coloured by: a draft 'draft', published 'active', the built-in copy 'pending'. */
export function blockPillStatus(s: BlockState): 'draft' | 'active' | 'pending' { return s === 'draft' ? 'draft' : s === 'published' ? 'active' : 'pending'; }
export function effectiveValue(b: Block): unknown { return b.draft ?? b.published ?? b.default; }

/** The one-line summary under a block's label. */
export function blockSummary(b: Block): string {
  const effective = effectiveValue(b);
  if (b.type === 'boolean') return effective ? 'On' : 'Off';
  if (b.type === 'image') return effective && typeof effective === 'object' ? `Library image · ${(effective as { alt?: string }).alt || 'no alt text'}` : 'Built-in image';
  if (b.type === 'faq') return `${(Array.isArray(effective) && effective.length) || 'built-in'} entries`;
  return String(effective ?? '').replace(/<[^>]+>/g, '').slice(0, 140) || '(empty)';
}

/** "Draft by … 12 Oct, 14:30 IST" / "Published by …" / "Built-in default", plus the character limit. */
export function blockStateLine(b: Block): string {
  const state = blockState(b);
  const who = state === 'draft' ? `Draft by ${b.draftBy ?? '?'} ${b.draftUpdatedAt ? fmtDateTime(b.draftUpdatedAt) : ''}` : state === 'published' ? `Published by ${b.publishedBy ?? '?'} ${b.publishedAt ? fmtDateTime(b.publishedAt) : ''}` : 'Built-in default';
  return `${who.trim()}${b.max ? ` · up to ${b.max} characters` : ''}`;
}

/** The image a block shows, as the web's <img>: the value's url when it carries one. */
export function imageUrl(v: unknown): string | null {
  return v && typeof v === 'object' && typeof (v as { url?: unknown }).url === 'string' ? (v as { url: string }).url : null;
}
