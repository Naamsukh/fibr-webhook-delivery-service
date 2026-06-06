import type Database from "better-sqlite3";
import { config } from "../config.js";

// On startup, any in_flight row older than inFlightTimeoutS was in-progress
// when the process died — reset it to pending so the poller picks it up.
export function recoverInFlight(db: Database.Database): number {
  const cutoff = Math.floor(Date.now() / 1000) - config.inFlightTimeoutS;
  const result = db
    .prepare(
      `UPDATE delivery_attempts
       SET status = 'pending', updated_at = unixepoch()
       WHERE status = 'in_flight' AND updated_at < ?`
    )
    .run(cutoff);

  if (result.changes > 0) {
    console.log(`[recovery] reset ${result.changes} stale in_flight → pending`);
  }
  return result.changes;
}
