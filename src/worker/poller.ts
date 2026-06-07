import { getDb } from "../db/client.js";
import { config } from "../config.js";
import { executeDelivery, type DeliveryAttempt } from "../services/deliveryService.js";
import { recoverInFlight, reapStaleInFlight } from "./recovery.js";

let activeDeliveries = 0;
let pollTimer: NodeJS.Timeout | null = null;
let draining = false;

async function pollOnce(): Promise<void> {
  if (draining) return;

  const db = getDb();

  // Sweep deliveries stuck in_flight beyond the timeout (e.g. a fast
  // crash-restart that outran startup recovery, or a hung request) back to
  // pending before claiming new work.
  reapStaleInFlight(db);

  const available = config.maxConcurrent - activeDeliveries;
  if (available <= 0) return;

  const nowSecs = Math.floor(Date.now() / 1000);

  // Claim a batch atomically — SQLite serializes writes, no external lock needed
  const claimed = db
    .prepare(
      `UPDATE delivery_attempts
       SET status = 'in_flight', updated_at = ?
       WHERE id IN (
         SELECT id FROM delivery_attempts
         WHERE status = 'pending' AND next_attempt_at <= ?
         ORDER BY next_attempt_at ASC
         LIMIT ?
       )
       RETURNING *`
    )
    .all(nowSecs, nowSecs, available) as DeliveryAttempt[];

  for (const attempt of claimed) {
    activeDeliveries++;
    executeDelivery(db, attempt).finally(() => {
      activeDeliveries--;
    });
  }
}

export function startWorker(): void {
  const db = getDb();
  recoverInFlight(db);
  pollTimer = setInterval(() => {
    pollOnce().catch((err) => console.error("[worker] poll error:", err));
  }, config.pollIntervalMs);
  console.log(`[worker] started, polling every ${config.pollIntervalMs}ms`);
}

export function stopWorker(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// Graceful shutdown: stop polling, then wait for in-flight deliveries to finish
// up to a deadline. Anything still running when the deadline hits is left as
// in_flight and recovered on next startup (at-least-once still holds).
export async function shutdownWorker(deadlineMs = 15000): Promise<void> {
  draining = true;
  stopWorker();
  const start = Date.now();
  while (activeDeliveries > 0 && Date.now() - start < deadlineMs) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (activeDeliveries > 0) {
    console.log(`[worker] shutdown deadline hit with ${activeDeliveries} in-flight; will recover on restart`);
  } else {
    console.log("[worker] drained cleanly");
  }
}

export function getActiveDeliveries(): number {
  return activeDeliveries;
}
