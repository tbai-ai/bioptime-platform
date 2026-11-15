/* M9 Message attachments and announcements: the module's portal descriptor (routes, nav and the Home card) lives in
   module.tsx beside its pages; the registry (src/modules/index.ts) imports it from here. Files on messages are drawn by
   the core Messages page (src/pages/Messages.tsx), which M9 owns. */
export { messaging } from './module';
