/* Where a notification opens in the client app (BUILD_PLAN §6.2 and §7.2). Push is not configured in Phase 1, so this
   is used by the Home bell's inbox sheet and the Notifications screen (and, once pushes arrive, by the push handler):
   the notification's `data` names what it is about, and the most specific key wins. A sessionId is a workout session
   ("wks_…") or a live session ("lvs_…"); the id's prefix decides, then the category. Reminders from the reminder queue
   carry { refType, refId } instead. Nothing to open (a welcome, an email verification sent by email): null, and the
   row is not a link. */

export type NotificationLike = { category?: string | null; kind?: string | null; data?: Record<string, unknown> | null };

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const enc = encodeURIComponent;

/** The app route for a notification, or null when it has nothing to open. */
export function notificationRoute(n: NotificationLike | null | undefined): string | null {
  if (!n) return null;
  const d = (n.data && typeof n.data === 'object' ? n.data : {}) as Record<string, unknown>;
  const category = n.category ?? n.kind ?? '';
  const id = (k: string) => str(d[k]);

  // results and bookings first: they are the most specific
  if (id('reportId')) return `/report/${enc(id('reportId')!)}`;
  if (id('bookingId')) return `/booking/${enc(id('bookingId')!)}`;
  if (id('checkinId')) return `/checkin/${enc(id('checkinId')!)}`;

  // workouts: a session of the programme opens the player; the programme itself opens Train
  const session = id('sessionId');
  if (session) {
    if (session.startsWith('lvs_') || (!session.startsWith('wks_') && (category === 'session' || category === 'session_reminder'))) return `/session/${enc(session)}`;
    return `/workout/${enc(session)}`;
  }
  if (id('workoutId')) return `/workout/${enc(id('workoutId')!)}`;
  if (id('exerciseId')) return `/exercise/${enc(id('exerciseId')!)}`;
  if (id('programId') || (id('programmeId') && category === 'workout')) return '/(tabs)/train';
  if (id('planId')) return '/(tabs)/train?view=plan';

  // food first: feedback on a logged meal names the note too, and belongs with the meal
  if (id('mealLogId') || id('mealPlanId')) return '/(tabs)/fuel';

  // the coach: messages, consultations, notes and the assignment
  if (id('conversationId') || id('messageId')) return '/(tabs)/coach';
  if (id('appointmentId')) return '/(tabs)/coach';
  if (id('noteId')) return '/recommendations';
  if (id('coachId') || id('assignmentId')) return '/(tabs)/coach';

  // goals, habits, learning, bespoke plans, news
  if (id('goalId') || id('milestoneId')) return '/goals';
  if (id('habitId')) return '/habits';
  if (id('lessonId')) return `/learn/${enc(id('lessonId')!)}`;
  if (id('courseId')) return `/learn?course=${enc(id('courseId')!)}`;
  if (id('customPlanId')) return '/bespoke';
  if (id('announcementId')) return '/announcements';
  if (id('followUpId')) return '/(tabs)/life?section=next-steps';

  // orders, help and data requests
  if (id('supportRequestId')) return `/support/${enc(id('supportRequestId')!)}`;
  if (id('refundRequestId') || id('orderId') || Array.isArray(d.documentIds)) return '/billing';
  if (id('dataRequestId')) return '/settings/data';
  if (id('programmeId')) return '/(tabs)/profile';

  // a reminder from the queue: what it reminds about
  const ref = id('refType');
  const refId = id('refId');
  if (ref === 'habit') return '/habits';
  if (ref === 'checkin' && refId) return `/checkin/${enc(refId)}`;
  if (ref === 'live_session' && refId) return `/session/${enc(refId)}`;
  if (ref === 'lab_preparation') return refId && refId.startsWith('bkg_') ? `/booking/${enc(refId)}` : '/(tabs)/tests';
  if (ref === 'booking' && refId) return `/booking/${enc(refId)}`;
  if (ref === 'appointment') return '/(tabs)/coach';
  return null;
}

/** Where a route opens, in the app's own words ("Train › Plan"), for a row that links there; null when it has no name. */
export function notificationPlace(route: string | null): string | null {
  if (!route) return null;
  const [path, query = ''] = route.split('?');
  const tabs: Record<string, string> = { '/(tabs)/coach': 'Coach', '/(tabs)/fuel': 'Fuel', '/(tabs)/tests': 'Tests', '/(tabs)/profile': 'Profile', '/(tabs)/life': 'Life', '/(tabs)/bio': 'Bio' };
  if (path === '/(tabs)/train') return /view=plan/.test(query) ? 'Train › Plan' : 'Train';
  if (tabs[path]) return tabs[path];
  const pages: Array<[RegExp, string]> = [
    [/^\/workout\//, 'Train › the session'], [/^\/exercise\//, 'Train › the exercise'], [/^\/session\//, 'the live session'],
    [/^\/report\//, 'the report'], [/^\/booking\//, 'the booking'], [/^\/checkin\//, 'Bio › the check-in'], [/^\/goals$/, 'Bio › Goals'],
    [/^\/habits$/, 'Life › Habits'], [/^\/recommendations$/, 'your coach’s notes'], [/^\/learn/, 'Learn'], [/^\/bespoke$/, 'Bespoke'],
    [/^\/announcements$/, 'News'], [/^\/support\//, 'your request'], [/^\/billing$/, 'Billing'], [/^\/settings\/data$/, 'Your data'],
  ];
  return pages.find(([rx]) => rx.test(path))?.[1] ?? null;
}

/** A notification's text as the client app shows it. The server writes one text for the web portal, the email and the
 *  app, and some of it sends the reader to the portal's places ("Open Progress, then Check-ins.", "open My programme to
 *  see this week's actions"), which this app does not have: those sentences are left out here (the row opens the right
 *  place, and says which: notificationPlace). The portal and the email keep their words. */
export function notificationBody(body: string | null | undefined): string | null {
  if (!body) return null;
  const s = body
    .replace(/:\s*open My programme to see this week[’']s actions\.?/i, '.')
    .replace(/\s*\bOpen (Progress|Workouts|Appointments|Live sessions)\b[^.]*\.?/g, '')
    .trim();
  return s || null;
}
