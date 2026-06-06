import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../src/db/client.js";
import { createSubscription } from "../src/services/subscriptionService.js";
import { ingestEvent, getEventById, listEvents } from "../src/services/eventService.js";
import type Database from "better-sqlite3";

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
});

describe("ingestEvent", () => {
  it("persists the event", () => {
    const result = ingestEvent(db, { event_type: "order.created", payload: { id: 1 } });
    expect(result.eventId).toBeDefined();
    const event = getEventById(db, result.eventId);
    expect(event?.event_type).toBe("order.created");
    expect(event?.payload).toEqual({ id: 1 });
  });

  it("returns matched_subscriptions=0 when no subscriptions exist", () => {
    const result = ingestEvent(db, { event_type: "order.created", payload: {} });
    expect(result.matchedSubscriptions).toBe(0);
  });

  it("creates delivery_attempts for matching subscriptions", () => {
    createSubscription(db, { target_url: "https://a.com", event_types: ["order.*"] });
    createSubscription(db, { target_url: "https://b.com", event_types: ["user.*"] });

    const result = ingestEvent(db, { event_type: "order.created", payload: {} });
    expect(result.matchedSubscriptions).toBe(1);

    const attempts = db
      .prepare("SELECT * FROM delivery_attempts WHERE event_id = ?")
      .all(result.eventId) as { status: string; subscription_id: string }[];
    expect(attempts.length).toBe(1);
    expect(attempts[0].status).toBe("pending");
  });

  it("fans out to all matching subscriptions", () => {
    createSubscription(db, { target_url: "https://a.com", event_types: ["*"] });
    createSubscription(db, { target_url: "https://b.com", event_types: ["order.created"] });

    const result = ingestEvent(db, { event_type: "order.created", payload: {} });
    expect(result.matchedSubscriptions).toBe(2);

    const attempts = db
      .prepare("SELECT * FROM delivery_attempts WHERE event_id = ?")
      .all(result.eventId) as unknown[];
    expect(attempts.length).toBe(2);
  });

  it("skips inactive subscriptions", () => {
    const sub = createSubscription(db, { target_url: "https://a.com", event_types: ["*"] });
    db.prepare("UPDATE subscriptions SET active = 0 WHERE id = ?").run(sub.id);

    const result = ingestEvent(db, { event_type: "order.created", payload: {} });
    expect(result.matchedSubscriptions).toBe(0);
  });
});

describe("listEvents", () => {
  it("paginates correctly", () => {
    for (let i = 0; i < 5; i++) {
      ingestEvent(db, { event_type: "test.event", payload: { i } });
    }
    const page1 = listEvents(db, { limit: 3, offset: 0 });
    expect(page1.total).toBe(5);
    expect(page1.data.length).toBe(3);

    const page2 = listEvents(db, { limit: 3, offset: 3 });
    expect(page2.data.length).toBe(2);
  });
});
