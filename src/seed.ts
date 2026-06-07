import type Database from "better-sqlite3";
import { config } from "./config.js";
import { listSubscriptions, createSubscription } from "./services/subscriptionService.js";

export function seedIfEmpty(db: Database.Database): void {
  const existing = listSubscriptions(db);
  if (existing.length > 0) return;

  const echoUrl = `http://localhost:${config.port}/debug/echo`;
  createSubscription(db, {
    target_url: echoUrl,
    event_types: ["*"],
  });

  console.log(`[seed] created test subscription → ${echoUrl}`);
}
