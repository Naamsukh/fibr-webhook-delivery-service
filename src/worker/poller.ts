import { getDb } from "../db/client.js";
import { config } from "../config.js";
import { executeDelivery, type DeliveryAttempt } from "../services/deliveryService.js";
import { recoverInFlight } from "./recovery.js";

let activeDeliveries = 0;
let pollTimer: NodeJS.Timeout | null = null;

async function pollOnce(): Promise<void> {
  const available = config.maxConcurrent - activeDeliveries;
  if (available <= 0) return;

  const db = getDb();
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

export function getActiveDeliveries(): number {
  return activeDeliveries;
}
