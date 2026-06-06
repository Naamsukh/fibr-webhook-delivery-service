import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { z } from "zod";

export const CreateSubscriptionSchema = z.object({
  target_url: z.string().url("must be a valid URL"),
  secret: z.string().min(1).optional(),
  event_types: z.array(z.string().min(1)).nonempty().default(["*"]),
});

export const PatchSubscriptionSchema = z.object({
  target_url: z.string().url("must be a valid URL").optional(),
  secret: z.string().min(1).nullable().optional(),
  event_types: z.array(z.string().min(1)).nonempty().optional(),
  active: z.boolean().optional(),
});

export interface Subscription {
  id: string;
  target_url: string;
  secret: string | null;
  event_types: string[];
  active: boolean;
  created_at: number;
  updated_at: number;
}

interface RawRow {
  id: string;
  target_url: string;
  secret: string | null;
  event_types: string;
  active: number;
  created_at: number;
  updated_at: number;
}

function toSubscription(row: RawRow): Subscription {
  return {
    ...row,
    event_types: JSON.parse(row.event_types) as string[],
    active: row.active === 1,
  };
}

function maskSecret(secret: string | null): string | null {
  if (!secret) return null;
  return secret.slice(0, 4) + "****";
}

export function createSubscription(
  db: Database.Database,
  input: z.infer<typeof CreateSubscriptionSchema>
): Subscription {
  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO subscriptions (id, target_url, secret, event_types, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, input.target_url, input.secret ?? null, JSON.stringify(input.event_types), now, now);
  return getSubscriptionById(db, id)!;
}

export function getSubscriptionById(
  db: Database.Database,
  id: string
): Subscription | null {
  const row = db
    .prepare("SELECT * FROM subscriptions WHERE id = ?")
    .get(id) as RawRow | undefined;
  return row ? toSubscription(row) : null;
}

export function listSubscriptions(
  db: Database.Database,
  active?: boolean
): Subscription[] {
  let sql = "SELECT * FROM subscriptions";
  const params: unknown[] = [];
  if (active !== undefined) {
    sql += " WHERE active = ?";
    params.push(active ? 1 : 0);
  }
  sql += " ORDER BY created_at DESC";
  const rows = db.prepare(sql).all(...params) as RawRow[];
  return rows.map(toSubscription);
}

export function listActiveSubscriptions(db: Database.Database): Subscription[] {
  return listSubscriptions(db, true);
}

export function patchSubscription(
  db: Database.Database,
  id: string,
  patch: z.infer<typeof PatchSubscriptionSchema>
): Subscription | null {
  const existing = getSubscriptionById(db, id);
  if (!existing) return null;

  const updates: string[] = [];
  const values: unknown[] = [];

  if (patch.target_url !== undefined) {
    updates.push("target_url = ?");
    values.push(patch.target_url);
  }
  if ("secret" in patch) {
    updates.push("secret = ?");
    values.push(patch.secret ?? null);
  }
  if (patch.event_types !== undefined) {
    updates.push("event_types = ?");
    values.push(JSON.stringify(patch.event_types));
  }
  if (patch.active !== undefined) {
    updates.push("active = ?");
    values.push(patch.active ? 1 : 0);
  }

  if (updates.length === 0) return existing;

  const now = Math.floor(Date.now() / 1000);
  updates.push("updated_at = ?");
  values.push(now, id);

  db.prepare(`UPDATE subscriptions SET ${updates.join(", ")} WHERE id = ?`).run(...values);
  return getSubscriptionById(db, id);
}

export function softDeleteSubscription(db: Database.Database, id: string): boolean {
  const now = Math.floor(Date.now() / 1000);
  const result = db
    .prepare("UPDATE subscriptions SET active = 0, updated_at = ? WHERE id = ?")
    .run(now, id);
  return result.changes > 0;
}

export function toPublic(sub: Subscription): Omit<Subscription, "secret"> & { secret_masked: string | null } {
  const { secret, ...rest } = sub;
  return { ...rest, secret_masked: maskSecret(secret) };
}
