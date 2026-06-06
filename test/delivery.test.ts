import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { createTestDb } from "../src/db/client.js";
import { createSubscription } from "../src/services/subscriptionService.js";
import { ingestEvent } from "../src/services/eventService.js";
import { executeDelivery, computeBackoffSecs, type DeliveryAttempt } from "../src/services/deliveryService.js";
import type Database from "better-sqlite3";

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function getFirstAttempt(db: Database.Database): DeliveryAttempt {
  return db.prepare("SELECT * FROM delivery_attempts LIMIT 1").get() as DeliveryAttempt;
}

function setupDelivery(db: Database.Database, eventTypes = ["*"]): DeliveryAttempt {
  createSubscription(db, { target_url: "https://example.com/hook", event_types: eventTypes });
  ingestEvent(db, { event_type: "order.created", payload: { test: true } });
  return getFirstAttempt(db);
}

describe("executeDelivery", () => {
  it("marks success on 200", async () => {
    const attempt = setupDelivery(db);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200, headers: { get: () => null } }));

    await executeDelivery(db, attempt);

    const updated = getFirstAttempt(db);
    expect(updated.status).toBe("success");
    expect(updated.last_http_status).toBe(200);
    expect(updated.attempt_number).toBe(1);
  });

  it("schedules retry on 503", async () => {
    const attempt = setupDelivery(db);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 503, headers: { get: () => null } }));

    await executeDelivery(db, attempt);

    const updated = getFirstAttempt(db);
    expect(updated.status).toBe("pending");
    expect(updated.last_http_status).toBe(503);
    expect(updated.attempt_number).toBe(1);
    expect(updated.next_attempt_at).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("exhausts immediately on 410 and deactivates subscription", async () => {
    const attempt = setupDelivery(db);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 410, headers: { get: () => null } }));

    await executeDelivery(db, attempt);

    const updated = getFirstAttempt(db);
    expect(updated.status).toBe("exhausted");

    const sub = db.prepare("SELECT active FROM subscriptions LIMIT 1").get() as { active: number };
    expect(sub.active).toBe(0);
  });

  it("exhausts immediately on 400 (permanent client error)", async () => {
    const attempt = setupDelivery(db);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 400, headers: { get: () => null } }));

    await executeDelivery(db, attempt);

    const updated = getFirstAttempt(db);
    expect(updated.status).toBe("exhausted");
  });

  it("schedules retry on network error", async () => {
    const attempt = setupDelivery(db);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    await executeDelivery(db, attempt);

    const updated = getFirstAttempt(db);
    expect(updated.status).toBe("pending");
    expect(updated.last_error).toContain("ECONNREFUSED");
  });

  it("exhausts after max_attempts reached", async () => {
    const attempt = setupDelivery(db);
    // Set attempt_number to max_attempts - 1 so next failure exhausts it
    db.prepare("UPDATE delivery_attempts SET attempt_number = ? WHERE id = ?").run(
      attempt.max_attempts - 1,
      attempt.id
    );
    const nearMaxAttempt = getFirstAttempt(db);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 500, headers: { get: () => null } }));

    await executeDelivery(db, nearMaxAttempt);

    const updated = getFirstAttempt(db);
    expect(updated.status).toBe("exhausted");
  });
});

describe("computeBackoffSecs", () => {
  it("grows exponentially", () => {
    // Without jitter, values approximate 10, 20, 40, 80...
    // With jitter (±20%) we just verify monotonic growth trend
    const b1 = computeBackoffSecs(1);
    const b3 = computeBackoffSecs(3);
    expect(b3).toBeGreaterThan(b1);
  });

  it("is always at least 1 second", () => {
    for (let i = 1; i <= 8; i++) {
      expect(computeBackoffSecs(i)).toBeGreaterThanOrEqual(1);
    }
  });

  it("caps at 1 hour", () => {
    expect(computeBackoffSecs(100)).toBeLessThanOrEqual(3600 * 1.2 + 1);
  });
});
