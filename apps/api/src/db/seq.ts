import type { Db } from './db.js';
import { reference, type ReferencePrefix } from '../lib/ids.js';

/** Next human reference (PAY-1001, BIO-24011, SUP-1001, CRN-1001 …), transactional. */
export function nextReference(db: Db, name: ReferencePrefix): string {
  return db.tx(() => {
    db.run('UPDATE sequences SET value = value + 1 WHERE name = ?', [name]);
    const row = db.get<{ value: number }>('SELECT value FROM sequences WHERE name = ?', [name]);
    if (!row) throw new Error(`sequence ${name} missing`);
    return reference(name, row.value);
  });
}
