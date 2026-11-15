/* Which bundled photo goes where. Screens ask for a slot (a place in the app), never for a photo id, so a photo can be
   swapped here without touching a screen. The table follows AMENDED_PLAN_NOTES §6, with every photo a real licensed
   photograph (owner decision, 30 Oct 2026: no generated stills).

   People rule (PhotoEntry.people): a photo that shows a face or a body never sits behind or beside the member's name,
   greeting or avatar, or the coach's name or medallion; never shares a card with a member's score, lab value, record,
   streak or logged value; and never carries a caption. Header bands with people are fully faded before the first data
   card. Every slot below that is placed next to such things is people-free.

   An imageUrl from the API (test catalogue, store packages, course covers) always wins over these.

   Contract with <Photo> (./types.ts SlotsModule): slotPhoto(slot, key?) returns a photo id, or null for a slot that has
   no photo (Photo then draws its quiet fallback). `key` picks within a set slot by a stable hash. */
import type { PhotoId } from './photos.generated';

/** Slots that always show the same photo. */
const FIXED = {
  'auth.signin.backdrop': 'ph-signin-backdrop',
  'auth.register.backdrop': 'ph-signin-backdrop',
  'auth.phone.backdrop': 'ph-signin-backdrop',
  'auth.forgot.backdrop': 'ph-signin-backdrop',
  'auth.verify.backdrop': 'ph-signin-backdrop',
  'auth.socialFinish.backdrop': 'ph-signin-backdrop',

  'onboarding.slide1': 'ph-coach-connection',
  'onboarding.slide2': 'ph-tests-morning',
  'onboarding.slide3': 'ph-bio-progress',

  // Home hero by the greeting's hour: morning 05–12, afternoon 12–17, evening 17–21, night 21–05; all people-free.
  // 'home.hero' is the fallback when the hour is unknown.
  'home.hero.morning': 'ph-home-morning',
  'home.hero.afternoon': 'ph-home-afternoon',
  'home.hero.evening': 'ph-home-evening',
  'home.hero.night': 'ph-home-night',
  'home.hero': 'ph-home-night',
  'home.choosePackage': 'ph-programme-start',
  'home.hydration.card': 'ph-fuel-water',

  'train.header.all': 'ph-home-night',
  'train.header.other': 'ph-home-night',
  'train.header.strength': 'ph-train-strength',
  'train.header.conditioning': 'ph-train-cardio',
  'train.header.core': 'ph-train-hiit',
  'train.header.mobility': 'ph-train-mobility',
  'train.header.recovery': 'ph-train-flexibility',
  'train.header.balance': 'ph-train-yoga',
  'train.plan.header': 'ph-programme-start',

  'bio.header': 'ph-bio-progress',

  'life.header': 'ph-tests-leaf',
  'life.habits.header': 'ph-life-elders',

  'fuel.header': 'ph-fuel-homecooking',
  'fuel.search.header': 'ph-fuel-plate',
  'fuel.today.empty': 'ph-fuel-plate',
  // coach targets only, never the member's own values
  'fuel.mealPlan.card': 'ph-fuel-protein',

  // only while no coach is assigned yet (being matched)
  'coach.empty.header': 'ph-coach-connection',
  // band above "Book a consultation", with no coach name inside it
  'coach.booking.sheet': 'ph-coach-call',
  'coach.breathing.backdrop': 'ph-session-breath',

  'tests.header': 'ph-tests-abstract',
  'report.header': 'ph-tests-abstract',
  'booking.header': 'ph-tests-abstract',
  'bookTest.header': 'ph-tests-abstract',
  'tests.featured.card': 'ph-tests-morning',

  'store.bespoke': 'ph-coach-connection',
  'store.learn': 'ph-bio-progress',
  'store.refer': 'ph-life-walk',
  'learn.cover.fallback': 'ph-bio-progress',

  // still life, behind the avatar at .12
  'profile.header.backdrop': 'ph-profile-achieve',
} as const satisfies Record<string, PhotoId>;

/** Live sessions are always people-free: the host's name is shown beside them. */
const LIVE = {
  class: 'ph-home-afternoon',
  webinar: 'ph-bio-progress',
  workshop: 'ph-empty-calm',
} as const satisfies Record<string, PhotoId>;

const EMPTY = {
  workouts: 'ph-empty-calm',
  report: 'ph-empty-calm',
  meals: 'ph-empty-calm',
  messages: 'ph-empty-calm',
  default: 'ph-empty-calm',
} as const satisfies Record<string, PhotoId>;

/** Test catalogue cards cycle through abstract and people-free photos by position (no lab, syringe or medical staff). */
const TEST_CARDS = ['ph-tests-abstract', 'ph-tests-morning', 'ph-tests-ripple', 'ph-tests-leaf'] as const satisfies readonly PhotoId[];

/** Store packages by display order; the fourth and later share the last photo. */
const PACKAGES = ['ph-store-foundation', 'ph-store-build', 'ph-store-restore', 'ph-store-balance'] as const satisfies readonly PhotoId[];

/** Mood photos for a session by its dominant exercise category, used for the next-session banner, week cards,
    coach-plan thumbnails and the player fallback. They are category moods, never a demonstration of the exercise. */
const SESSION_SETS = {
  strength: ['ph-session-strength', 'ph-train-strength', 'ph-life-elders'],
  conditioning: ['ph-session-hiit', 'ph-session-cardio', 'ph-session-boxing', 'ph-session-ropes', 'ph-train-cardio'],
  core: ['ph-train-hiit'],
  mobility: ['ph-session-yoga', 'ph-train-mobility'],
  balance: ['ph-train-yoga', 'ph-store-balance'],
  recovery: ['ph-session-breath', 'ph-train-flexibility'],
  other: ['ph-home-night'],
} as const satisfies Record<string, readonly PhotoId[]>;

export type FixedSlot = keyof typeof FIXED;
export type LiveKind = keyof typeof LIVE;
export type EmptyKind = keyof typeof EMPTY;
export type SessionCategory = keyof typeof SESSION_SETS;
/** Every slot name slotPhoto knows. Live kinds and session categories from the API may be passed as they come:
    an unknown live kind falls back to `class`, an unknown session category to `other`. */
export type Slot =
  | FixedSlot
  | `home.liveSessions.${LiveKind}`
  | `train.live.${LiveKind}`
  | `session.header.${LiveKind}`
  | `empty.${EmptyKind}`
  | `tests.catalogue.card.${number}`
  | `store.package.card.${number}`
  | `store.package.sheet.${number}`
  | `set.session.${SessionCategory}`;

function nth<T>(list: readonly T[], n: number, wrap: boolean): T {
  const i = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  return list[wrap ? i % list.length : Math.min(i, list.length - 1)];
}

/** FNV-1a: the same key always lands on the same photo, on every device and every run. */
function stableHash(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The photos given to the sessions of a week shown side by side (spreadSessionPhotos), by category and session id. */
const spread = new Map<string, PhotoId>();
const setOf = (category: string): SessionCategory => (category in SESSION_SETS ? (category as SessionCategory) : 'other');

/** Gives the sessions shown side by side (a week, in the order shown) photos that differ wherever their set has enough:
    each takes its hashed photo, or the next one in its set that no earlier session of the week has taken (L-09: two
    strength sessions never share one photo). Every place that draws one of these sessions (Home's next-session banner
    and week cards, Train's rows, the player's cover) then reads the same photo for it through pickPhoto. The same
    week always gives the same photos (the order and the ids decide); a session never spread keeps its hashed photo. */
export function spreadSessionPhotos(sessions: readonly { id: string; category: string }[]): void {
  const taken = new Map<SessionCategory, Set<PhotoId>>();
  for (const s of sessions) {
    const category = setOf(s.category);
    const list: readonly PhotoId[] = SESSION_SETS[category];
    const used = taken.get(category) ?? new Set<PhotoId>();
    let i = stableHash(s.id) % list.length;
    for (let k = 0; k < list.length && used.has(list[i]); k++) i = (i + 1) % list.length;
    used.add(list[i]);
    taken.set(category, used);
    spread.set(`${category}|${s.id}`, list[i]);
  }
}

/** A photo id from a session set ('set.session.strength'): the one spreadSessionPhotos gave this session, else by a
    stable hash of `key` (the session or workout id). An unknown category uses `other`. */
export function pickPhoto(set: string, key: string | number): PhotoId {
  const category = setOf(set.startsWith('set.session.') ? set.slice('set.session.'.length) : set);
  const list: readonly PhotoId[] = SESSION_SETS[category];
  return spread.get(`${category}|${String(key)}`) ?? list[stableHash(String(key)) % list.length];
}

/** The photo id for a placement, or null when the slot has none. `key` picks within a set slot (default: its first). */
export function slotPhoto(slot: Slot | (string & {}), key?: string | number): PhotoId | null {
  if (Object.prototype.hasOwnProperty.call(FIXED, slot)) return FIXED[slot as FixedSlot];
  const dot = slot.lastIndexOf('.');
  const head = slot.slice(0, dot);
  const tail = slot.slice(dot + 1);
  switch (head) {
    case 'home.liveSessions':
    case 'train.live':
    case 'session.header':
      return LIVE[tail as LiveKind] ?? LIVE.class;
    case 'empty':
      return EMPTY[tail as EmptyKind] ?? EMPTY.default;
    case 'tests.catalogue.card':
      return nth(TEST_CARDS, Number(tail), true);
    case 'store.package.card':
    case 'store.package.sheet':
      return nth(PACKAGES, Number(tail), false);
    case 'set.session':
      return key == null ? SESSION_SETS[tail in SESSION_SETS ? (tail as SessionCategory) : 'other'][0] : pickPhoto(slot, key);
    default:
      return null;
  }
}
