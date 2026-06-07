import type Database from "better-sqlite3";
import { config } from "../config.js";

// Startup recovery. When the process boots, no deliveries are running in *this*
// process yet, so ANY row still marked in_flight was orphaned by a crash —
// reset all of them to pending unconditionally. (An age-based cutoff here is
// wrong: a row that went in_flight a few seconds before a crash would be younger
// than the cutoff and get stranded forever.)
export function recoverInFlight(db: Database.Database): number {
  const result = db
    .prepare(
      `UPDATE delivery_attempts
       SET status = 'pending', updated_at = unixepoch()
       WHERE status = 'in_flight'`
    )
    .run();

  if (result.changes > 0) {
    console.log(`[recovery] reset ${result.changes} orphaned in_flight → pending on startup`);
  }
  return result.changes;
}

// Periodic reaper for a *running* process. A row stuck in_flight longer than
// inFlightTimeoutS (safely above the delivery timeout) is presumed dead — e.g.
// the process crashed and restarted faster than startup recovery could observe
// it, or a delivery hung past its abort. Here the cutoff is required so we don't
// reset deliveries that are still genuinely in progress in this process.
export function reapStaleInFlight(db: Database.Database): number {
  const cutoff = Math.floor(Date.now() / 1000) - config.inFlightTimeoutS;
  const result = db
    .prepare(
      `UPDATE delivery_attempts
       SET status = 'pending', updated_at = unixepoch()
       WHERE status = 'in_flight' AND updated_at < ?`
    )
    .run(cutoff);

  if (result.changes > 0) {
    console.log(`[reaper] reset ${result.changes} stale in_flight → pending`);
  }
  return result.changes;
}
