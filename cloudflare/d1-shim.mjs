/*
 * d1-shim.mjs - run a Cloudflare Worker's fetch handler against real SQLite.
 *
 *   import { makeEnv } from './d1-shim.mjs';
 *   const env = makeEnv();                    // in-memory D1-compatible binding
 *   const res = await worker.fetch(request, env);
 *
 * WHY THIS EXISTS
 * ---------------
 * `wrangler dev` needs the workerd binary, which will not start on this machine
 * (it fails creating its scratch directories under a synced OneDrive folder). That
 * is an environment problem, not a code problem - but it would otherwise mean the
 * Worker's SQL was never executed even once.
 *
 * Cloudflare D1 speaks SQLite, and Node ships a SQLite driver, so the Worker's
 * logic can be exercised for real by adapting the small D1 surface it uses:
 *
 *   env.DB.prepare(sql)        -> .bind(...args) -> .run() | .first() | .all()
 *   env.DB.batch([stmts])
 *
 * Result shapes match D1: run() gives { meta: { last_row_id, changes } }, all()
 * gives { results: [...] }, first() gives the row or null.
 *
 * This validates the SQL and the response contract. It does NOT validate D1's
 * remote behaviour, limits, or cold starts - those need a real deployment.
 */
import { DatabaseSync } from 'node:sqlite';

/** Convert ? placeholders; node:sqlite accepts positional binding directly. */
class ShimStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.args = [];
  }

  bind(...args) {
    // D1 accepts numbers, strings, null; booleans must become integers.
    this.args = args.map((a) => (typeof a === 'boolean' ? (a ? 1 : 0) : a === undefined ? null : a));
    return this;
  }

  #stmt() {
    const stmt = this.db.prepare(this.sql);
    return stmt;
  }

  async run() {
    const stmt = this.#stmt();
    const info = stmt.run(...this.args);
    return {
      success: true,
      meta: {
        last_row_id: Number(info.lastInsertRowid),
        changes: Number(info.changes),
      },
      results: [],
    };
  }

  async all() {
    const stmt = this.#stmt();
    const rows = stmt.all(...this.args);
    return { success: true, results: rows.map((r) => ({ ...r })), meta: {} };
  }

  async first(column) {
    const stmt = this.#stmt();
    const row = stmt.get(...this.args);
    if (!row) return null;
    if (column) return row[column];
    return { ...row };
  }
}

class ShimD1 {
  constructor() {
    this.db = new DatabaseSync(':memory:');
    this.db.exec('PRAGMA foreign_keys = ON');
  }

  prepare(sql) {
    return new ShimStatement(this.db, sql);
  }

  async batch(statements) {
    const out = [];
    this.db.exec('BEGIN');
    try {
      for (const s of statements) out.push(await s.run());
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    return out;
  }

  async exec(sql) {
    this.db.exec(sql);
    return { count: 0, duration: 0 };
  }

  close() {
    this.db.close();
  }
}

export function makeEnv() {
  return { DB: new ShimD1() };
}
