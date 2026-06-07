import type { FastifyInstance } from "fastify";
import { getDb } from "../../db/client.js";
import { listSubscriptions, getSubscriptionById, createSubscription, softDeleteSubscription, CreateSubscriptionSchema } from "../../services/subscriptionService.js";
import { listEvents, getEventById, ingestEvent } from "../../services/eventService.js";
import { listDeliveryAttempts, getDeliveryAttemptsByEventId, getDeliveryAttemptById, resetForRetry, isRetryConflict } from "../../services/deliveryService.js";
import { getEchoLog } from "../debug.js";
import { formatTs, statusBadgeClass, truncate, shortId } from "./helpers.js";

function enrich(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...obj };
  if (typeof obj.created_at === "number") out.created_at_fmt = formatTs(obj.created_at as number);
  if (typeof obj.updated_at === "number") out.updated_at_fmt = formatTs(obj.updated_at as number);
  if (typeof obj.ingested_at === "number") out.ingested_at_fmt = formatTs(obj.ingested_at as number);
  if (typeof obj.next_attempt_at === "number") out.next_attempt_at_fmt = formatTs(obj.next_attempt_at as number);
  if (typeof obj.received_at === "number") out.received_at_fmt = formatTs(obj.received_at as number);
  if (typeof obj.status === "string") out.status_class = statusBadgeClass(obj.status as string);
  if (typeof obj.last_error === "string") out.last_error_short = truncate(obj.last_error as string);
  if (typeof obj.id === "string") out.short_id = shortId(obj.id as string);
  if (typeof obj.event_id === "string") out.short_event_id = shortId(obj.event_id as string);
  if (Array.isArray(obj.event_types)) out.event_types_str = (obj.event_types as string[]).join(", ");
  return out;
}

export async function dashboardRoutes(app: FastifyInstance) {
  const db = getDb();

  // Overview + Send Test Event form
  app.get("/", async (_req, reply) => {
    const subscriptions = listSubscriptions(db);
    const events = listEvents(db, { limit: 10 });

    const oneDayAgo = Math.floor(Date.now() / 1000) - 86400;
    const eventsLast24h = (db.prepare("SELECT COUNT(*) as n FROM events WHERE ingested_at >= ?").get(oneDayAgo) as { n: number }).n;
    const pendingCount = (db.prepare("SELECT COUNT(*) as n FROM delivery_attempts WHERE status = 'pending'").get() as { n: number }).n;
    const exhaustedCount = (db.prepare("SELECT COUNT(*) as n FROM delivery_attempts WHERE status = 'exhausted'").get() as { n: number }).n;

    return reply.view("overview.hbs", {
      total_subscriptions: subscriptions.length,
      active_subscriptions: subscriptions.filter((s) => s.active).length,
      events_last_24h: eventsLast24h,
      pending_deliveries: pendingCount,
      exhausted_deliveries: exhaustedCount,
      recent_events: events.data.map((e) => enrich(e as unknown as Record<string, unknown>)),
    });
  });

  // Send Test Event (form submit from overview)
  app.post("/send-test-event", async (request, reply) => {
    const body = request.body as Record<string, string>;
    const eventType = (body.event_type || "test.event").trim();
    let payload: Record<string, unknown> = { hello: "world", timestamp: Date.now() };
    try {
      if (body.payload) payload = JSON.parse(body.payload) as Record<string, unknown>;
    } catch { /* use default */ }

    const result = ingestEvent(db, { event_type: eventType, payload });
    return reply.redirect(`/dashboard/events/${result.eventId}`);
  });

  // Echo log (webhooks received at /debug/echo)
  app.get("/echo", async (_req, reply) => {
    const log = getEchoLog().map((e) => ({
      ...enrich(e as unknown as Record<string, unknown>),
      body_json: JSON.stringify(e.body, null, 2),
      sig_class: e.signature_valid === true ? "badge-success"
                : e.signature_valid === false ? "badge-exhausted"
                : "badge-unknown",
      sig_label: e.signature_valid === true ? "valid timestamp"
               : e.signature_valid === false ? "stale/bad timestamp"
               : "unsigned",
    }));
    return reply.view("echo.hbs", { entries: log, total: log.length });
  });

  // Subscriptions list + create form
  app.get("/subscriptions", async (_req, reply) => {
    const subs = listSubscriptions(db).map((s) => enrich(s as unknown as Record<string, unknown>));
    return reply.view("subscriptions.hbs", { subscriptions: subs });
  });

  // Create subscription (form submit)
  app.post("/subscriptions", async (request, reply) => {
    const body = request.body as Record<string, string>;
    const event_types = (body.event_types || "*").split(",").map((s) => s.trim()).filter(Boolean);
    const parsed = CreateSubscriptionSchema.safeParse({
      target_url: body.target_url,
      secret: body.secret || undefined,
      event_types: event_types.length ? event_types : ["*"],
    });
    if (!parsed.success) {
      const subs = listSubscriptions(db).map((s) => enrich(s as unknown as Record<string, unknown>));
      return reply.view("subscriptions.hbs", { subscriptions: subs, error: parsed.error.flatten().fieldErrors });
    }
    createSubscription(db, parsed.data);
    return reply.redirect("/dashboard/subscriptions");
  });

  // Subscription detail
  app.get("/subscriptions/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const sub = getSubscriptionById(db, id);
    if (!sub) return reply.status(404).view("404.hbs", { message: "Subscription not found" });

    const attempts = listDeliveryAttempts(db, { subscription_id: id, limit: 50 });
    return reply.view("subscription-detail.hbs", {
      subscription: enrich(sub as unknown as Record<string, unknown>),
      attempts: attempts.data.map((a) => enrich(a as unknown as Record<string, unknown>)),
      total: attempts.total,
    });
  });

  // Deactivate subscription (form submit)
  app.post("/subscriptions/:id/delete", async (request, reply) => {
    const { id } = request.params as { id: string };
    softDeleteSubscription(db, id);
    return reply.redirect("/dashboard/subscriptions");
  });

  // Events list
  app.get("/events", async (request, reply) => {
    const q = request.query as { page?: string; event_type?: string };
    const page = Math.max(1, Number(q.page ?? 1));
    const limit = 25;
    const offset = (page - 1) * limit;
    const result = listEvents(db, { limit, offset, event_type: q.event_type });
    const totalPages = Math.ceil(result.total / limit);

    return reply.view("events.hbs", {
      events: result.data.map((e) => enrich(e as unknown as Record<string, unknown>)),
      total: result.total,
      page,
      total_pages: totalPages,
      prev_page: page > 1 ? page - 1 : null,
      next_page: page < totalPages ? page + 1 : null,
      event_type_filter: q.event_type ?? "",
    });
  });

  // Event detail
  app.get("/events/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const event = getEventById(db, id);
    if (!event) return reply.status(404).view("404.hbs", { message: "Event not found" });

    const attempts = getDeliveryAttemptsByEventId(db, id);
    return reply.view("event-detail.hbs", {
      event: enrich({ ...event, payload_json: JSON.stringify(event.payload, null, 2) } as Record<string, unknown>),
      attempts: attempts.map((a) => ({
        ...enrich(a as unknown as Record<string, unknown>),
        canRetry: a.status === "exhausted" || a.status === "failed",
      })),
    });
  });

  // Manual retry (form submit from event detail)
  app.post("/delivery-attempts/:id/retry", async (request, reply) => {
    const { id } = request.params as { id: string };
    const attempt = getDeliveryAttemptById(db, id);
    if (!attempt) return reply.status(404).view("404.hbs", { message: "Delivery attempt not found" });
    if (!isRetryConflict(attempt)) {
      resetForRetry(db, id);
    }
    return reply.redirect(`/dashboard/events/${attempt.event_id}`);
  });
}
