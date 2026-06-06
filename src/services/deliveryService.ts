import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { config } from "../config.js";
import { computeSignature, signatureHeader } from "../signing.js";
import { getSubscriptionById, softDeleteSubscription } from "./subscriptionService.js";
import { getEventById } from "./eventService.js";

export type DeliveryStatus = "pending" | "in_flight" | "success" | "failed" | "exhausted";

export interface DeliveryAttempt {
  id: string;
  event_id: string;
  subscription_id: string;
  status: DeliveryStatus;
  attempt_number: number;
  max_attempts: number;
  next_attempt_at: number;
  last_http_status: number | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}

export function getDeliveryAttemptById(
  db: Database.Database,
  id: string
): DeliveryAttempt | null {
  return (
    (db.prepare("SELECT * FROM delivery_attempts WHERE id = ?").get(id) as DeliveryAttempt | undefined) ?? null
  );
}

export function getDeliveryAttemptsByEventId(
  db: Database.Database,
  eventId: string
): DeliveryAttempt[] {
  return db
    .prepare("SELECT * FROM delivery_attempts WHERE event_id = ? ORDER BY created_at ASC")
    .all(eventId) as DeliveryAttempt[];
}

export function listDeliveryAttempts(
  db: Database.Database,
  opts: {
    event_id?: string;
    subscription_id?: string;
    status?: string;
    limit?: number;
    offset?: number;
  } = {}
): { data: DeliveryAttempt[]; total: number } {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.event_id) { conditions.push("event_id = ?"); params.push(opts.event_id); }
  if (opts.subscription_id) { conditions.push("subscription_id = ?"); params.push(opts.subscription_id); }
  if (opts.status) { conditions.push("status = ?"); params.push(opts.status); }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(opts.limit ?? 50, 200);
  const offset = opts.offset ?? 0;

  const total = (
    db.prepare(`SELECT COUNT(*) as n FROM delivery_attempts ${where}`).get(...params) as { n: number }
  ).n;

  const data = db
    .prepare(`SELECT * FROM delivery_attempts ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as DeliveryAttempt[];

  return { data, total };
}

// Jittered exponential backoff capped at 1 hour
export function computeBackoffSecs(attemptNumber: number): number {
  const base = 10;
  const cap = 3600;
  const exp = Math.min(base * Math.pow(2, attemptNumber - 1), cap);
  const jitter = exp * 0.2 * (Math.random() * 2 - 1);
  return Math.max(1, Math.round(exp + jitter));
}

// Returns true for status codes that should trigger a retry
function shouldRetry(httpStatus: number): boolean {
  if (httpStatus >= 200 && httpStatus < 300) return false;
  // Permanent client errors — retrying won't help
  if ([400, 401, 402, 403, 404, 405, 406, 407, 409, 411, 412, 413, 414, 415, 416, 417, 422, 423, 424, 426, 428, 431, 451].includes(httpStatus)) return false;
  if (httpStatus === 410) return false; // Gone — also unsubscribes
  return true; // 429, 408, 5xx, unknown
}

export async function executeDelivery(
  db: Database.Database,
  attempt: DeliveryAttempt
): Promise<void> {
  const event = getEventById(db, attempt.event_id);
  const subscription = getSubscriptionById(db, attempt.subscription_id);

  if (!event || !subscription) {
    markExhausted(db, attempt, null, "Event or subscription not found");
    return;
  }

  const body = JSON.stringify({
    id: event.id,
    type: event.event_type,
    payload: event.payload,
  });

  const timestampSecs = Math.floor(Date.now() / 1000);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Webhook-ID": attempt.id,
    "X-Webhook-Timestamp": String(timestampSecs),
  };

  if (subscription.secret) {
    const sig = computeSignature(body, subscription.secret, timestampSecs);
    headers["X-Webhook-Signature"] = signatureHeader(sig);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.deliveryTimeoutMs);

  let httpStatus: number | null = null;

  try {
    const res = await fetch(subscription.target_url, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });

    httpStatus = res.status;

    if (httpStatus >= 200 && httpStatus < 300) {
      markSuccess(db, attempt, httpStatus);
      return;
    }

    // 410 Gone — treat as exhausted and deactivate subscription
    if (httpStatus === 410) {
      softDeleteSubscription(db, subscription.id);
      markExhausted(db, attempt, httpStatus, "Subscriber returned 410 Gone — subscription deactivated");
      return;
    }

    if (!shouldRetry(httpStatus)) {
      markExhausted(db, attempt, httpStatus, `HTTP ${httpStatus} (permanent failure)`);
      return;
    }

    // Retry: check Retry-After header for 429
    let backoff = computeBackoffSecs(attempt.attempt_number + 1);
    if (httpStatus === 429) {
      const retryAfter = res.headers.get("retry-after");
      if (retryAfter) {
        const parsed = parseInt(retryAfter, 10);
        if (!isNaN(parsed)) backoff = Math.max(backoff, parsed);
      }
    }

    scheduleRetry(db, attempt, httpStatus, `HTTP ${httpStatus}`, backoff);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    scheduleRetry(db, attempt, null, msg, computeBackoffSecs(attempt.attempt_number + 1));
  } finally {
    clearTimeout(timeout);
  }
}

function markSuccess(db: Database.Database, attempt: DeliveryAttempt, httpStatus: number) {
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `UPDATE delivery_attempts
     SET status = 'success', last_http_status = ?, attempt_number = attempt_number + 1, updated_at = ?
     WHERE id = ?`
  ).run(httpStatus, now, attempt.id);
}

function scheduleRetry(
  db: Database.Database,
  attempt: DeliveryAttempt,
  httpStatus: number | null,
  error: string,
  backoffSecs: number
) {
  const now = Math.floor(Date.now() / 1000);
  const nextAttemptNum = attempt.attempt_number + 1;
  const exhausted = nextAttemptNum >= attempt.max_attempts;

  db.prepare(
    `UPDATE delivery_attempts
     SET status = ?, attempt_number = ?, next_attempt_at = ?, last_http_status = ?, last_error = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    exhausted ? "exhausted" : "pending",
    nextAttemptNum,
    exhausted ? now : now + backoffSecs,
    httpStatus,
    error,
    now,
    attempt.id
  );
}

function markExhausted(
  db: Database.Database,
  attempt: DeliveryAttempt,
  httpStatus: number | null,
  error: string
) {
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `UPDATE delivery_attempts
     SET status = 'exhausted', last_http_status = ?, last_error = ?, attempt_number = attempt_number + 1, updated_at = ?
     WHERE id = ?`
  ).run(httpStatus, error, now, attempt.id);
}

export function resetForRetry(
  db: Database.Database,
  id: string
): DeliveryAttempt | null {
  const attempt = getDeliveryAttemptById(db, id);
  if (!attempt) return null;
  if (attempt.status === "pending" || attempt.status === "in_flight") return null; // 409 — signal with null+check

  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `UPDATE delivery_attempts
     SET status = 'pending', attempt_number = 0, next_attempt_at = ?, last_error = NULL, last_http_status = NULL, updated_at = ?
     WHERE id = ?`
  ).run(now, now, id);

  return getDeliveryAttemptById(db, id);
}

export function isRetryConflict(attempt: DeliveryAttempt): boolean {
  return attempt.status === "pending" || attempt.status === "in_flight";
}
