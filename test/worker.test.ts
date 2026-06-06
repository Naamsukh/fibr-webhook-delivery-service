import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../src/db/client.js";
import { createSubscription } from "../src/services/subscriptionService.js";
import { ingestEvent } from "../src/services/eventService.js";
import { recoverInFlight } from "../src/worker/recovery.js";
import type Database from "better-sqlite3";

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  createSubscription(db, { target_url: "https://example.com/hook", event_types: ["*"] });
  ingestEvent(db, { event_type: "test.event", payload: {} });
});

describe("recoverInFlight", () => {
  it("resets stale in_flight attempts to pending", () => {
    const staleTime = Math.floor(Date.now() / 1000) - 60; // 60 seconds ago
    db.prepare("UPDATE delivery_attempts SET status = 'in_flight', updated_at = ?").run(staleTime);

    const recovered = recoverInFlight(db);
    expect(recovered).toBe(1);

    const attempt = db.prepare("SELECT status FROM delivery_attempts LIMIT 1").get() as { status: string };
    expect(attempt.status).toBe("pending");
  });

  it("leaves fresh in_flight attempts untouched", () => {
    const recentTime = Math.floor(Date.now() / 1000) - 5; // 5 seconds ago (within threshold)
    db.prepare("UPDATE delivery_attempts SET status = 'in_flight', updated_at = ?").run(recentTime);

    const recovered = recoverInFlight(db);
    expect(recovered).toBe(0);

    const attempt = db.prepare("SELECT status FROM delivery_attempts LIMIT 1").get() as { status: string };
    expect(attempt.status).toBe("in_flight");
  });

  it("only affects in_flight rows, not pending or success", () => {
    db.prepare("UPDATE delivery_attempts SET status = 'success'").run();
    const oldTime = Math.floor(Date.now() / 1000) - 60;
    db.prepare("UPDATE delivery_attempts SET updated_at = ?").run(oldTime);

    const recovered = recoverInFlight(db);
    expect(recovered).toBe(0);
  });
});
