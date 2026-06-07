import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../src/db/client.js";
import { createSubscription } from "../src/services/subscriptionService.js";
import { ingestEvent } from "../src/services/eventService.js";
import { recoverInFlight, reapStaleInFlight } from "../src/worker/recovery.js";
import type Database from "better-sqlite3";

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  createSubscription(db, { target_url: "https://example.com/hook", event_types: ["*"] });
  ingestEvent(db, { event_type: "test.event", payload: {} });
});

describe("recoverInFlight (startup)", () => {
  it("resets ALL in_flight attempts to pending regardless of age", () => {
    // A row claimed just before a crash is 'young'. Startup recovery must still
    // reclaim it — nothing is running in this process yet, so it is orphaned.
    const recentTime = Math.floor(Date.now() / 1000) - 5;
    db.prepare("UPDATE delivery_attempts SET status = 'in_flight', updated_at = ?").run(recentTime);

    const recovered = recoverInFlight(db);
    expect(recovered).toBe(1);

    const attempt = db.prepare("SELECT status FROM delivery_attempts LIMIT 1").get() as { status: string };
    expect(attempt.status).toBe("pending");
  });

  it("only affects in_flight rows, not pending or success", () => {
    db.prepare("UPDATE delivery_attempts SET status = 'success'").run();
    const oldTime = Math.floor(Date.now() / 1000) - 60;
    db.prepare("UPDATE delivery_attempts SET updated_at = ?").run(oldTime);

    const recovered = recoverInFlight(db);
    expect(recovered).toBe(0);
  });
});

describe("reapStaleInFlight (periodic)", () => {
  it("resets in_flight attempts older than the timeout to pending", () => {
    const staleTime = Math.floor(Date.now() / 1000) - 60; // 60 seconds ago
    db.prepare("UPDATE delivery_attempts SET status = 'in_flight', updated_at = ?").run(staleTime);

    const recovered = reapStaleInFlight(db);
    expect(recovered).toBe(1);

    const attempt = db.prepare("SELECT status FROM delivery_attempts LIMIT 1").get() as { status: string };
    expect(attempt.status).toBe("pending");
  });

  it("leaves recently-claimed in_flight attempts untouched", () => {
    const recentTime = Math.floor(Date.now() / 1000) - 5; // within threshold — still running
    db.prepare("UPDATE delivery_attempts SET status = 'in_flight', updated_at = ?").run(recentTime);

    const recovered = reapStaleInFlight(db);
    expect(recovered).toBe(0);

    const attempt = db.prepare("SELECT status FROM delivery_attempts LIMIT 1").get() as { status: string };
    expect(attempt.status).toBe("in_flight");
  });
});
