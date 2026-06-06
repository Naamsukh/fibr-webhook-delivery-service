import Fastify from "fastify";
import fastifyView from "@fastify/view";
import fastifyStatic from "@fastify/static";
import Handlebars from "handlebars";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { config } from "./config.js";
import { getDb } from "./db/client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

export async function buildApp() {
  const app = Fastify({ logger: true });

  // Ensure DB is open and schema applied
  getDb();

  // Static files (CSS, JS for dashboard)
  await app.register(fastifyStatic, {
    root: path.join(projectRoot, "public"),
    prefix: "/public/",
  });

  // Handlebars views
  await app.register(fastifyView, {
    engine: { handlebars: Handlebars },
    root: path.join(__dirname, "views"),
    layout: "layout.hbs",
    options: {
      partials: {},
    },
    defaultContext: {
      title: "Webhook Delivery",
    },
  });

  // Health check (no auth)
  app.get("/health", async () => {
    try {
      getDb().prepare("SELECT 1").get();
      return { status: "ok", db: "ok", uptime: process.uptime() };
    } catch {
      return { status: "ok", db: "error", uptime: process.uptime() };
    }
  });

  // Redirect root to dashboard
  app.get("/", async (_req, reply) => {
    return reply.redirect("/dashboard");
  });

  // API routes (auth enforced inside authPlugin scope)
  const { authPlugin } = await import("./plugins/auth.js");
  const { subscriptionRoutes } = await import("./routes/api/subscriptions.js");
  const { eventRoutes } = await import("./routes/api/events.js");
  const { deliveryRoutes } = await import("./routes/api/deliveries.js");

  await app.register(
    async (apiApp) => {
      await apiApp.register(authPlugin);
      await apiApp.register(subscriptionRoutes, { prefix: "/subscriptions" });
      await apiApp.register(eventRoutes, { prefix: "/events" });
      await apiApp.register(deliveryRoutes, { prefix: "/delivery-attempts" });
    },
    { prefix: "/api" }
  );

  // Dashboard routes (no auth)
  const { dashboardRoutes } = await import("./routes/dashboard/index.js");
  await app.register(dashboardRoutes, { prefix: "/dashboard" });

  return app;
}

async function main() {
  const app = await buildApp();

  // Start delivery worker
  const { startWorker } = await import("./worker/poller.js");
  startWorker();

  await app.listen({ port: config.port, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
