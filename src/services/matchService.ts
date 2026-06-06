import type Database from "better-sqlite3";
import { listActiveSubscriptions, type Subscription } from "./subscriptionService.js";

export function patternMatches(pattern: string, eventType: string): boolean {
  if (pattern === "*") return true;
  if (pattern === eventType) return true;

  // "user.*" matches "user.created" but NOT "user.profile.updated"
  if (pattern.endsWith(".*")) {
    const prefix = pattern.slice(0, -2);
    const remainder = eventType.slice(prefix.length + 1);
    return (
      eventType.startsWith(prefix + ".") &&
      !remainder.includes(".")
    );
  }

  // "order.**" matches anything under the "order." namespace
  if (pattern.endsWith(".**")) {
    const prefix = pattern.slice(0, -3);
    return eventType.startsWith(prefix + ".");
  }

  return false;
}

export function findMatchingSubscriptions(
  db: Database.Database,
  eventType: string
): Subscription[] {
  const active = listActiveSubscriptions(db);
  return active.filter((sub) =>
    sub.event_types.some((pattern) => patternMatches(pattern, eventType))
  );
}
