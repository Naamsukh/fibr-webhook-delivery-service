# Design Decisions

## Storage

**Chose**: SQLite via `better-sqlite3` with WAL mode.

A single-process service has no need for a network-accessible database. SQLite is embedded, zero-dependency to deploy, and the WAL journal mode allows concurrent reads during writes — which matters because the HTTP server and the delivery worker are both reading the DB simultaneously. I chose `better-sqlite3` specifically because its synchronous API made worker loop logic easier to reason about: no async/await in the middle of a transaction, no risk of interleaving. The alternative was PostgreSQL, which would have been overkill for a local tool — it adds operational complexity (process management, connection pool config) that buys nothing here. Pure in-memory was ruled out by the requirements.

## Concurrency / Worker Model

**Chose**: In-process `setInterval` poll loop, claiming work with a single atomic `UPDATE ... WHERE id IN (SELECT ... LIMIT N) RETURNING *`.

The requirement said single process, so a separate worker process was off the table. I considered `worker_threads` but the overhead isn't justified when the bottleneck is outbound HTTP, not CPU. The poll loop runs every 2 seconds, atomically claims up to `MAX_CONCURRENT=10` pending rows by flipping them to `in_flight`, then fires each delivery as a detached async task. SQLite's serialized writes make the claim query safe without external locks — only one writer can run at a time. The `LIMIT N` cap prevents one backlogged subscriber from starving others. The downside of polling vs. a proper queue (like BullMQ) is latency jitter: a delivery can sit for up to 2 seconds before the next poll. For a take-home this is fine; in production I'd use a proper queue with push-based wakeup.

Recovery is split in two because `in_flight` means different things at different times. At **startup** no deliveries are running in this fresh process, so every `in_flight` row is by definition orphaned and is reset unconditionally — applying an age cutoff here would strand a row claimed seconds before a crash. While **running**, a separate reaper resets rows stuck `in_flight` past `IN_FLIGHT_TIMEOUT_S` (safely above the delivery timeout), which catches a hung request or a crash-restart that outran startup. On SIGINT/SIGTERM the process drains: stop accepting HTTP, wait for in-flight deliveries up to a deadline, then checkpoint and close SQLite. Anything past the deadline stays `in_flight` and is reclaimed on the next boot — at-least-once still holds.

## Retry Policy

**Chose**: Exponential backoff starting at 10s, doubling each attempt, capped at 1 hour, with ±20% random jitter. Max 8 attempts (configurable via `MAX_ATTEMPTS`). 4xx errors (except 408 and 429) exhaust immediately; 5xx and network errors retry. 410 Gone deactivates the subscription.

The jitter prevents thundering herd — if 100 subscriptions all fail at once, they don't all retry at the same second. I diverged from "don't retry 4xx" in two cases: 408 (Request Timeout) and 429 (Too Many Requests) are transient conditions that will resolve without a code fix, so they retry. 410 is special: it's the subscriber explicitly signaling they don't want webhooks anymore, so I treat it as a hard stop and deactivate the subscription. The `max_attempts` is captured per row at creation time so changing the config mid-flight doesn't disrupt existing sequences.

## Payload Signing

**Chose**: HMAC-SHA256 over `"${timestamp}.${rawBodyString}"`, sent as `X-Webhook-Signature: sha256=<hex>` alongside `X-Webhook-Timestamp`.

The timestamp in the signed payload is the key design choice. Signing just the body would allow replay attacks: an attacker who intercepts a valid webhook could re-send it hours later. By including the timestamp in the signed input and having subscribers reject signatures where `abs(now - timestamp) > 300s`, replay is prevented. The raw body string (not re-serialized JSON) is signed to ensure byte-for-byte reproducibility — if the subscriber re-serializes the JSON they might get different key ordering. The `sha256=` prefix follows Stripe's convention, which most developers already know. The alternative (ECDSA with per-subscription key pairs) would be more secure but adds key management complexity that's out of scope.

## Dashboard Scope

**Chose**: Server-rendered Handlebars templates with plain HTML forms and minimal vanilla JS. No frontend framework, no build step.

The requirement said "plain is fine" and we're graded on completeness not aesthetics. A React SPA would require a build pipeline, API client code, and state management — all complexity that doesn't add to the core evaluation criteria. Server-side rendering gives you everything for free: working links, pagination, form submissions, progressive enhancement. The only JS I added is a 5-line auto-refresh snippet for the event detail page when deliveries are in flight. This kept the dashboard shippable within the time budget. If this were a real product I'd want a React frontend with live updates via SSE or WebSocket, but that's a post-take-home conversation.
