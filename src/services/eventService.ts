import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { z } from "zod";
import { findMatchingSubscriptions } from "./matchService.js";
import { config } from "../config.js";

export const IngestEventSchema = z.object({
  event_type: z.string().min(1),
  payload: z.record(z.unknown()),
});

export interface Event {
  id: string;
  event_type: string;
  payload: Record<string, unknown>;
  ingested_at: number;
}

interface RawEventRow {
  id: string;
  event_type: string;
  payload: string;
  ingested_at: number;
}

function toEvent(row: RawEventRow): Event {
  return { ...row, payload: JSON.parse(row.payload) as Record<string, unknown> };
}

export function ingestEvent(
  db: Database.Database,
  input: z.infer<typeof IngestEventSchema>
): { eventId: string; matchedSubscriptions: number } {
  const eventId = randomUUID();
  const now = Math.floor(Date.now() / 1000);

  const matchingSubs = findMatchingSubscriptions(db, input.event_type);

  // Insert event + fan-out attempts in a single transaction
  const insertFn = db.transaction(() => {
    db.prepare(
      "INSERT INTO events (id, event_type, payload, ingested_at) VALUES (?, ?, ?, ?)"
    ).run(eventId, input.event_type, JSON.stringify(input.payload), now);

    for (const sub of matchingSubs) {
      db.prepare(
        `INSERT INTO delivery_attempts (id, event_id, subscription_id, status, attempt_number, max_attempts, next_attempt_at, created_at, updated_at)
         VALUES (?, ?, ?, 'pending', 0, ?, ?, ?, ?)`
      ).run(randomUUID(), eventId, sub.id, config.maxAttempts, now, now, now);
    }
  });

  insertFn();

  return { eventId, matchedSubscriptions: matchingSubs.length };
}

export function getEventById(db: Database.Database, id: string): Event | null {
  const row = db
    .prepare("SELECT * FROM events WHERE id = ?")
    .get(id) as RawEventRow | undefined;
  return row ? toEvent(row) : null;
}

export function listEvents(
  db: Database.Database,
  opts: { limit?: number; offset?: number; event_type?: string } = {}
): { data: Event[]; total: number } {
  const limit = Math.min(opts.limit ?? 50, 200);
  const offset = opts.offset ?? 0;

  let where = "";
  const params: unknown[] = [];
  if (opts.event_type) {
    where = "WHERE event_type LIKE ?";
    params.push(opts.event_type.replace("*", "%"));
  }

  const total = (
    db.prepare(`SELECT COUNT(*) as n FROM events ${where}`).get(...params) as { n: number }
  ).n;

  const rows = db
    .prepare(`SELECT * FROM events ${where} ORDER BY ingested_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as RawEventRow[];

  return { data: rows.map(toEvent), total };
}
