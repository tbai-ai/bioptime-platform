/* M2 Progress: the constant the module descriptor reads while the module registry is being built. This file imports
   nothing, on purpose.

   api/modules/progress.ts declares its file resolver as { fileAccess: { [PHOTO_FILE_KIND]: ... } }, which reads the
   value when the descriptor loads. api/domain/progress.ts imports the module registry (directly, and through
   api/domain/features.ts), the registry imports api/modules/progress.ts, and so when api/domain/progress.ts was the first
   file a process loaded, the descriptor read PHOTO_FILE_KIND before api/domain/progress.ts had set it ("Cannot access
   'PHOTO_FILE_KIND' before initialization"). The descriptor now reads it from here, and api/domain/progress.ts
   re-exports it as its first import, so its importers are unchanged. tests/integration/round7-privacy.test.ts loads
   api/domain/progress.ts first in a fresh process to keep it so. */

export const PHOTO_FILE_KIND = 'progress_photo';
