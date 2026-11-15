/* M11 Coach AI drafting: the module's portal entry (pages, navigation, the coach client-record tab and the retention
   setting), defined in ./module.tsx with the pages as files in this folder. Drafts are shown only to the coach who asked
   for them; members see only their own consent. The same panel (./shared AiDraftInline) is placed in the coach's
   Messages thread and plan editor, which load it lazily (pages/Messages.tsx, pages/PlanEditor.tsx). */
export { ai } from './module';
