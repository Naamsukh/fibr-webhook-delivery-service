import type Database from "better-sqlite3";

export function applySchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id          TEXT    PRIMARY KEY,
      target_url  TEXT    NOT NULL,
      secret      TEXT,
      event_types TEXT    NOT NULL DEFAULT '["*"]',
      active      INTEGER NOT NULL DEFAULT 1,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_subscriptions_active
      ON subscriptions(active);

    CREATE TABLE IF NOT EXISTS events (
      id          TEXT    PRIMARY KEY,
      event_type  TEXT    NOT NULL,
      payload     TEXT    NOT NULL,
      ingested_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_events_ingested_at
      ON events(ingested_at DESC);

    CREATE INDEX IF NOT EXISTS idx_events_type
      ON events(event_type);

    CREATE TABLE IF NOT EXISTS delivery_attempts (
      id               TEXT    PRIMARY KEY,
      event_id         TEXT    NOT NULL REFERENCES events(id),
      subscription_id  TEXT    NOT NULL REFERENCES subscriptions(id),
      status           TEXT    NOT NULL DEFAULT 'pending',
      attempt_number   INTEGER NOT NULL DEFAULT 0,
      max_attempts     INTEGER NOT NULL DEFAULT 8,
      next_attempt_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      last_http_status INTEGER,
      last_error       TEXT,
      created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at       INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_da_status_next
      ON delivery_attempts(status, next_attempt_at)
      WHERE status IN ('pending', 'in_flight');

    CREATE INDEX IF NOT EXISTS idx_da_event_id
      ON delivery_attempts(event_id);

    CREATE INDEX IF NOT EXISTS idx_da_subscription_id
      ON delivery_attempts(subscription_id);
  `);
}
