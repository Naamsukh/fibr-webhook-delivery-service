export const config = {
  port: Number(process.env.PORT) || 3000,
  adminKey: process.env.ADMIN_KEY || "dev-admin-key",
  dbPath: process.env.DB_PATH || "./data/webhooks.db",
  maxAttempts: Number(process.env.MAX_ATTEMPTS) || 8,
  maxConcurrent: Number(process.env.MAX_CONCURRENT) || 10,
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS) || 2000,
  deliveryTimeoutMs: Number(process.env.DELIVERY_TIMEOUT_MS) || 10000,
  inFlightTimeoutS: Number(process.env.IN_FLIGHT_TIMEOUT_S) || 30,
} as const;
