/* The data export's file kind and who may open it, in a file of their own with no runtime imports.

   api/modules/support.ts reads both while the module registry is being built ({ fileAccess: { [EXPORT_KIND]: ... } }).
   dataExport.ts imports files.ts and the registry, which import api/modules/support.ts again, so when dataExport.ts was
   the first file loaded, support.ts read EXPORT_KIND before dataExport.ts had set it ("Cannot access 'EXPORT_KIND'
   before initialization"). dataExport.ts re-exports both from here as its first import, so this file is always
   evaluated first and the values exist whichever file is loaded first (tests/integration/round7-core.test.ts loads
   dataExport.ts first in a fresh process). */
import type { FileAccessResolver } from './files.js';

export const EXPORT_KIND = 'data_export';

/** Only the member the export belongs to opens it; not their coach, not an administrator. */
export const canOpenExport: FileAccessResolver = (ctx, file) => !!ctx.actor && ctx.actor.role === 'member' && !!file.owner_id && ctx.actor.id === file.owner_id;
