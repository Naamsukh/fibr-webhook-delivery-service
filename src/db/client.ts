import Database from "better-sqlite3";
import { config } from "../config.js";
import { applySchema } from "./schema.js";
import fs from "node:fs";
import path from "node:path";

function openDb(dbPath: string): Database.Database {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  applySchema(db);
  return db;
}

// Singleton for the application DB
let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    _db = openDb(config.dbPath);
  }
  return _db;
}

// Checkpoint the WAL and close the application DB. Called on graceful shutdown.
export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

// For tests — open a fresh in-memory DB
export function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  applySchema(db);
  return db;
}
