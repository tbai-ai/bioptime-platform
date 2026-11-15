/* M9 Message attachments and announcements (CAPABILITY_MAP.md 4.8; feature flag 'messaging'; migration
   0017_messaging.sql). Core coach and member conversations (api/http/routes/shared.ts) are not behind this flag; sending
   a message with files is.

   - Routes: api/http/routes/announcements.ts, each through def() with feature 'messaging' (announcements.manage on the
     team's routes). Removing an unsent file stays reachable while the module is off.
   - Files: kind 'message_attachment', private storage, opened through 5-minute tokens; the resolver below admits the
     participants and administrators holding members.manage (read only). Because the module stores private files,
     production refuses to enable it while storage is local disk (pending configuration: production object storage;
     malware scanning is pending configuration too).
   - Jobs: announcements_publish (every minute: scheduled announcements whose time has come); attachments_cleanup (hourly,
     also while the module is off: unsent files older than 24 hours are deleted).
   - Events: AnnouncementPublished notifies each member in the audience once (category 'announcement').
   - Demo: a few announcements in plain words (team, draft, scheduled, and one coach's to their own clients); no files.
   - Data export (exportSections): the announcements the member opened, and the names, types and sizes of the files on
     messages in their own conversations, as their own pages show them; never a file's contents, never drafts, audiences
     or withdrawal reasons.

   Everything below is referenced lazily (arrow functions), so the import cycle registry → module → domain → registry
   never reads a binding before it exists. */
import type { ApiModule } from './types.js';
import { messagingRoutes } from '../http/routes/announcements.js';
import * as attachments from '../domain/attachments.js';
import * as announcements from '../domain/announcements.js';

const MINUTE = 60_000;

export const messaging: ApiModule = {
  key: 'messaging',
  feature: 'messaging',
  routes: (app) => messagingRoutes(app),
  ungated: ['DELETE /conversations/:id/attachments/:attachmentId'],
  jobs: [
    { name: 'announcements_publish', everyMs: MINUTE, run: (ctx) => announcements.publishDue(ctx), idle: (r) => !(r as { published?: number } | undefined)?.published },
    // privacy clean-up: unsent files are deleted after 24 hours, whether or not the module is on
    { name: 'attachments_cleanup', everyMs: 60 * MINUTE, runWhenDisabled: true, run: (ctx) => attachments.discardStale(ctx), idle: (r) => !(r as { discarded?: number } | undefined)?.discarded },
  ],
  events: {
    AnnouncementPublished: [(ctx, _event, payload) => { announcements.deliver(ctx, String(payload.announcementId ?? '')); }],
  },
  fileAccess: { message_attachment: (ctx, file) => attachments.fileAccess(ctx, file) },
  seedDemo: (demo) => { announcements.seedDemo(demo); },
  exportSections: [
    { key: 'announcementReads', label: 'Announcements you have opened, as your Announcements page shows them (the text of one withdrawn since, or no longer meant for you, is left out)', build: (ctx, memberId) => announcements.exportReadsForMember(ctx, memberId) },
    { key: 'messageFiles', label: 'Files on messages in your conversations with your coach: name, type and size only (open each one in Messages)', build: (ctx, memberId) => attachments.exportFilesForMember(ctx, memberId) },
  ],
};
