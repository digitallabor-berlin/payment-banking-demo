import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { env } from "../env.js";
import * as schema from "./schema.js";

export type Db = BetterSQLite3Database<typeof schema>;

const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

/** Creates an unmemoized connection. Used by tests and by getDb(). */
export function createDb(filePath: string, runMigrations = true): Db {
  if (filePath !== ":memory:") {
    mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  }
  const sqlite = new Database(filePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  if (runMigrations) migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}

let instance: Db | null = null;

/** Memoized app connection. Migrations run once, on first access. */
export function getDb(): Db {
  instance ??= createDb(env.DATABASE_PATH);
  return instance;
}

export * as schema from "./schema.js";