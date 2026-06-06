import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../src/db/client.js";
import {
  createSubscription,
  getSubscriptionById,
  listSubscriptions,
  patchSubscription,
  softDeleteSubscription,
  toPublic,
} from "../src/services/subscriptionService.js";
import type Database from "better-sqlite3";

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
});

describe("createSubscription", () => {
  it("creates a subscription with defaults", () => {
    const sub = createSubscription(db, { target_url: "https://example.com/hook", event_types: ["*"] });
    expect(sub.id).toBeDefined();
    expect(sub.target_url).toBe("https://example.com/hook");
    expect(sub.event_types).toEqual(["*"]);
    expect(sub.active).toBe(true);
    expect(sub.secret).toBeNull();
  });

  it("stores secret", () => {
    const sub = createSubscription(db, { target_url: "https://example.com/hook", secret: "mysecret", event_types: ["*"] });
    expect(sub.secret).toBe("mysecret");
  });
});

describe("getSubscriptionById", () => {
  it("returns null for missing id", () => {
    expect(getSubscriptionById(db, "nonexistent")).toBeNull();
  });

  it("round-trips a created subscription", () => {
    const sub = createSubscription(db, { target_url: "https://example.com/hook", event_types: ["order.*"] });
    const fetched = getSubscriptionById(db, sub.id);
    expect(fetched?.event_types).toEqual(["order.*"]);
  });
});

describe("listSubscriptions", () => {
  it("filters by active status", () => {
    createSubscription(db, { target_url: "https://a.com", event_types: ["*"] });
    const sub2 = createSubscription(db, { target_url: "https://b.com", event_types: ["*"] });
    softDeleteSubscription(db, sub2.id);

    const active = listSubscriptions(db, true);
    expect(active.length).toBe(1);
    expect(active[0].target_url).toBe("https://a.com");

    const inactive = listSubscriptions(db, false);
    expect(inactive.length).toBe(1);
  });
});

describe("patchSubscription", () => {
  it("updates fields", () => {
    const sub = createSubscription(db, { target_url: "https://example.com", event_types: ["*"] });
    const patched = patchSubscription(db, sub.id, { target_url: "https://new.com", event_types: ["order.created"] });
    expect(patched?.target_url).toBe("https://new.com");
    expect(patched?.event_types).toEqual(["order.created"]);
  });

  it("returns null for missing id", () => {
    expect(patchSubscription(db, "missing", { target_url: "https://x.com" })).toBeNull();
  });
});

describe("softDeleteSubscription", () => {
  it("sets active to false", () => {
    const sub = createSubscription(db, { target_url: "https://example.com", event_types: ["*"] });
    softDeleteSubscription(db, sub.id);
    expect(getSubscriptionById(db, sub.id)?.active).toBe(false);
  });

  it("returns false for missing id", () => {
    expect(softDeleteSubscription(db, "nope")).toBe(false);
  });
});

describe("toPublic", () => {
  it("masks secret", () => {
    const sub = createSubscription(db, { target_url: "https://example.com", secret: "my-long-secret", event_types: ["*"] });
    const pub = toPublic(sub);
    expect((pub as Record<string, unknown>).secret).toBeUndefined();
    expect(pub.secret_masked).toBe("my-l****");
  });

  it("returns null secret_masked when no secret", () => {
    const sub = createSubscription(db, { target_url: "https://example.com", event_types: ["*"] });
    expect(toPublic(sub).secret_masked).toBeNull();
  });
});
