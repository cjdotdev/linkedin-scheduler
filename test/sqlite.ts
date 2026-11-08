// D1 is SQLite: the tests run the scheduler's real SQL against an in-memory SQLite database
// (node:sqlite), through the same small interface D1 offers.
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { Sql, SqlStatement } from "../src/core/types";

class Statement implements SqlStatement {
  constructor(
    private db: DatabaseSync,
    private query: string,
    private values: unknown[] = [],
  ) {}
  bind(...values: unknown[]) {
    return new Statement(this.db, this.query, values);
  }
  async first<T>() {
    return (this.db.prepare(this.query).get(...(this.values as never[])) as T) ?? null;
  }
  async run() {
    return { meta: { changes: Number(this.db.prepare(this.query).run(...(this.values as never[])).changes) } };
  }
  async all<T>() {
    return { results: this.db.prepare(this.query).all(...(this.values as never[])) as T[] };
  }
}

export function memoryDb(): Sql & { raw: DatabaseSync } {
  const raw = new DatabaseSync(":memory:");
  raw.exec(readFileSync(new URL("../migrations/0001_init.sql", import.meta.url), "utf8"));
  return {
    raw,
    prepare: (query) => new Statement(raw, query),
    batch: async (statements) => Promise.all(statements.map((s) => s.run())),
  };
}
