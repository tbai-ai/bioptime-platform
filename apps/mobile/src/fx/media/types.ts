/* The photo contract between the media package and every screen (AMENDED_PLAN_NOTES §6, PREMIUM §2.5).
   - M1 generates src/fx/media/photos.generated.ts: `export const PHOTOS: Record<string, PhotoRecord>` (one graded WebP
     master per id in three widths, 64, 1080 and 1600 px, a thumbhash and the credit).
   - M1 writes src/fx/media/slots.ts by hand: `slotPhoto(slot, key?)` (the photo id for a placement such as
     'home.hero.morning' or 'store.package.card.2'; `key` picks within a set by a stable hash) and `pickPhoto(set, key)`.
   - Screens never name a photo id or a file: they pass a slot to <Photo slot="…" />; a slot with no photo draws a quiet
     dark gradient in its place. */

export type PhotoSource = 'unsplash' | 'pexels' | 'owner';

export type PhotoCredit = {
  author: string;
  authorUrl?: string;
  source: PhotoSource;
  /** The page the photo was downloaded from. */
  url: string;
  /** "Unsplash License", "Pexels License" or the owner's confirmation line. */
  licence: string;
  /** Download (or confirmation) date, YYYY-MM-DD. */
  date?: string;
  downloaded?: string;
  edits?: string;
};

/** One bundled photo. `x64`, `x1080` and `x1600` are `require()`d WebP files of the same graded master. */
export type PhotoRecord = {
  id: string;
  x64?: number;
  x1080: number;
  x1600?: number;
  width: number;
  height: number;
  /** Base64 thumbhash, shown while the file decodes. */
  thumbhash?: string;
  /** Focal point in 0..1 of the frame, used for every crop (expo-image contentPosition). */
  focal: { x: number; y: number };
  alt: string;
  /** Mood only: hidden from screen readers. */
  decorative: boolean;
  /** Shows a person (a face or a body): never beside a name, a score or a logged value (AMENDED §6 people rule). */
  people: boolean;
  credit: PhotoCredit;
};

export type PhotosModule = { PHOTOS: Record<string, PhotoRecord> };

export type SlotsModule = {
  /** The photo id for a placement, or null when the slot has none. `key` picks within a set (stable hash). */
  slotPhoto: (slot: string, key?: string | number) => string | null;
  /** A photo id from a named set ('set.session.strength'), by a stable hash of `key`. */
  pickPhoto?: (set: string, key: string | number) => string | null;
};

/** Runtime tints over a graded photo (PREMIUM §1.6): the programme duotone, the red overlay of heroes and banners, or none. */
export type PhotoTint = 'programme' | 'red' | 'none';
