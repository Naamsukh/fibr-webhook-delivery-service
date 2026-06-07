# AI Interaction Log

Six interactions where AI meaningfully shaped — or tried to shape — the implementation.

---

## 1. Worker Model: Rejecting Bull/BullMQ

**What I asked**: What are my options for a delivery worker in a single-process Node.js service? I want retries, concurrency control, and crash recovery without overcomplicating things.

**What came back**: Three options laid out clearly — a simple `setInterval` poll loop, `worker_threads` for CPU isolation, or a proper job queue like BullMQ backed by Redis. The model leaned toward BullMQ, calling it "production-grade" and noting it handles retries, backoff, and concurrency out of the box.

**What I rejected**: BullMQ. The spec explicitly says single process, and BullMQ requires Redis — that's a second infrastructure dependency for a take-home where the whole point is simplicity. I've used it in production and it's great, but it would have been the wrong tool here. Reaching for it would signal I couldn't scope appropriately.

**What I kept**: The atomic `UPDATE ... WHERE id IN (SELECT ... LIMIT N) RETURNING *` pattern for the poll loop. I wouldn't have written it that way instinctively — I'd have done a SELECT then a separate UPDATE, which has a race window. The single-statement approach is both correct and elegant, and it works because SQLite serializes writes. That detail went straight into `src/worker/poller.ts`.

---

## 2. Crash Recovery and At-Least-Once Delivery

**What I asked**: I'm storing delivery attempts in SQLite. What actually happens if the process crashes while a fetch() is in flight — how do I recover without losing the delivery?

**What came back**: The `in_flight` status acting as a lease. Mark the row `in_flight` before firing the HTTP request, then on startup reset any `in_flight` rows older than a threshold back to `pending`. The threshold should be safely above the delivery timeout so you don't recover things that are still genuinely running.

**What I kept**: The entire mental model. Calling it a "lease" was the click for me — I understood it immediately as the same pattern used in distributed task queues, just without the network layer. The concrete implication (duplicate delivery is possible but rare, subscribers should be idempotent) is documented in DECISIONS.md because I think it's the most important correctness property of the whole system.

**What I changed**: The suggested timeout threshold was 60 seconds. My delivery timeout is 10 seconds, so 60s felt conservative. I tightened it to 30s — still 3x the timeout, still safe, but recovers faster after a crash. Small call, but it's mine.

---

## 3. Retry Policy: Where I Pushed Back on the Spec

**What I asked**: The spec says "4xx usually means don't retry." I wanted to think through whether that rule should be applied literally.

**What came back**: A sensible breakdown — 408 (Request Timeout) and 429 (Too Many Requests) are transient and should retry. 410 (Gone) is a signal to stop delivering to this URL entirely, not just this attempt. Everything else in 4xx is a permanent client error.

**What I kept**: The 410 → deactivate subscription behavior. This wasn't in the spec and I wouldn't have thought of it, but it's clearly right. If a subscriber returns 410 they're telling you to stop, and silently exhausting attempts without deactivating the subscription would just queue up future failures too.

**What I rejected**: The suggestion to also parse `Retry-After` on 503 responses. I only handle it for 429 (where the header is standard and meaningful) not 503 (where it's rarely set). The model was technically correct but I made a judgment call: adding that code path for a header that almost never appears in 5xx responses isn't worth it for a take-home. I documented the decision rather than pretending the tradeoff doesn't exist.

---

## 4. Dashboard: Rejecting the React Suggestion

**What I asked**: What's the right approach for the dashboard UI given I want minimal complexity and no build step?

**What came back**: Two options — server-rendered templates (Handlebars or EJS) or a lightweight React SPA that hits the existing API. The model said React would give a "better user experience" with real-time updates and was the more modern approach.

**What I rejected**: React. Not because it's wrong in general but because it was wrong here. A React SPA means a build pipeline, a bundler config, a separate dev server or proxy setup, and JavaScript as a hard dependency for basic CRUD. The spec literally says "the dashboard can be plain." Adding a build step to impress evaluators with framework choice is exactly the wrong instinct.

**What I kept**: Handlebars with `@fastify/view`. Server-rendered HTML means the dashboard works as a proper web app — forms submit, links work, pages load. I added exactly one line of JavaScript: an auto-refresh on the event detail page when deliveries are pending. Everything else is progressively enhanced from plain HTML. That felt like the right call and I'd make it again.

---

## 5. Schema Design: Stripping the Metadata Blob

**What I asked**: Review my initial delivery_attempts schema — am I missing anything?

**What came back**: A suggested addition: a `metadata` JSON column on `delivery_attempts` for "extensibility" — storing things like response headers, full response body, custom tags. The model framed it as forward-compatible design.

**What I rejected**: The metadata blob. JSON blobs in relational schemas are a smell I've learned to distrust — they're queryable in theory and a mess in practice. If I need response headers later, I'll add a typed column. The spec asks for last HTTP status and an error message, both of which I have as explicit columns. Adding a blob "just in case" would be speculative complexity. I kept the schema tight: exactly the columns the application uses, no more.

**What this surfaced**: The AI had a mild tendency throughout this project to add forward-compatibility hooks — extra columns, extra config options, extra abstraction layers. In almost every case I stripped them. A take-home isn't the place to design for hypothetical v2 requirements.

---

## 6. Bug Caught: Missing Form Body Parser

**What happened**: Every dashboard form — create subscription, send test event, deactivate, retry — returned `415 Unsupported Media Type` when submitted. The AI-generated Fastify setup was missing `@fastify/formbody`, which is required to parse `application/x-www-form-urlencoded`. Fastify only handles JSON by default.

**How I caught it**: The 415 status code pointed directly at content-type handling. I checked Fastify's docs, confirmed the plugin was missing, and added it. The AI-written route handlers looked correct — they cast `request.body` to the right type — but silently assumed parsing was already wired up. It wasn't.

**What I considered**: Switching dashboard forms to submit JSON via `fetch()` instead. That would have fixed the 415 without the plugin. I rejected it because it makes JavaScript a hard dependency for core flows, breaks progressive enhancement, and treats a configuration gap as an architectural problem. The right fix was the plugin, not a workaround.

**The pattern**: This was the clearest example of AI generating code that looks right but has a hidden assumption. The handlers were fine. The app setup was incomplete. Worth reading the full request lifecycle, not just the route handler, whenever something isn't working.
