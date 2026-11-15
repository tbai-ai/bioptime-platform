/* SQLite through Node's built-in driver. One connection per process (SQLite serialises writes), WAL mode, foreign keys on,
   migrations applied from db/migrations/*.sql in name order inside a transaction each. Query helpers keep call sites short. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

const here = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.join(here, 'migrations');

export type Row = Record<string, unknown>;
export type Params = SQLInputValue[] | Record<string, SQLInputValue>;

export class Db {
  readonly raw: DatabaseSync;
  readonly path: string;
  private txDepth = 0;

  constructor(filePath: string) {
    this.path = filePath;
    if (filePath !== ':memory:') fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.raw = new DatabaseSync(filePath);
    this.raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
  }

  all<T = Row>(sql: string, params: Params = []): T[] {
    const stmt = this.raw.prepare(sql);
    return (Array.isArray(params) ? stmt.all(...params) : stmt.all(params)) as T[];
  }
  get<T = Row>(sql: string, params: Params = []): T | undefined {
    const stmt = this.raw.prepare(sql);
    return (Array.isArray(params) ? stmt.get(...params) : stmt.get(params)) as T | undefined;
  }
  run(sql: string, params: Params = []): { changes: number; lastInsertRowid: number | bigint } {
    const stmt = this.raw.prepare(sql);
    const r = Array.isArray(params) ? stmt.run(...params) : stmt.run(params);
    return { changes: Number(r.changes), lastInsertRowid: r.lastInsertRowid };
  }
  exec(sql: string): void { this.raw.exec(sql); }

  /** Nested-safe transaction: the outermost BEGIN/COMMIT wins; an exception rolls everything back. */
  tx<T>(fn: () => T): T {
    if (this.txDepth > 0) { this.txDepth++; try { return fn(); } finally { this.txDepth--; } }
    this.raw.exec('BEGIN IMMEDIATE');
    this.txDepth = 1;
    try {
      const out = fn();
      this.raw.exec('COMMIT');
      return out;
    } catch (e) {
      try { this.raw.exec('ROLLBACK'); } catch { /* already rolled back */ }
      throw e;
    } finally {
      this.txDepth = 0;
    }
  }

  /** Insert from an object; keys are column names. */
  insert(table: string, row: Record<string, SQLInputValue | undefined>): void {
    const keys = Object.keys(row).filter((k) => row[k] !== undefined);
    const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
    this.run(sql, keys.map((k) => row[k] as SQLInputValue));
  }
  /** Update by id from an object. */
  update(table: string, id: string, patch: Record<string, SQLInputValue | undefined>, idColumn = 'id'): number {
    const keys = Object.keys(patch).filter((k) => patch[k] !== undefined);
    if (!keys.length) return 0;
    const sql = `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE ${idColumn} = ?`;
    return this.run(sql, [...keys.map((k) => patch[k] as SQLInputValue), id]).changes;
  }

  migrate(): string[] {
    this.raw.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
    const applied = new Set(this.all<{ version: string }>('SELECT version FROM schema_migrations').map((r) => r.version));
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    const done: string[] = [];
    for (const f of files) {
      if (applied.has(f)) continue;
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
      this.tx(() => {
        this.raw.exec(sql);
        this.run('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [f, new Date().toISOString()]);
      });
      done.push(f);
    }
    return done;
  }

  close(): void { this.raw.close(); }
}

/** JSON columns in and out. */
export const j = {
  in: (v: unknown): string => JSON.stringify(v ?? null),
  out: <T>(v: unknown, fallback: T): T => {
    if (v === null || v === undefined) return fallback;
    if (typeof v !== 'string') return v as T;
    try { return JSON.parse(v) as T; } catch { return fallback; }
  },
};
