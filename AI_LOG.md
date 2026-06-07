# AI Interaction Log

Six meaningful interactions documenting where AI assistance shaped the implementation.

---

## 1. Initial Architecture Design

**What I asked**: Given the full take-home spec, help me design the tech stack, file structure, DB schema, worker model, retry policy, and signing approach before writing any code.

**What came back**: A very thorough plan — Node.js + Fastify + better-sqlite3, complete SQL schema with partial indexes, the atomic `UPDATE ... WHERE id IN (SELECT ... LIMIT N) RETURNING *` pattern for worker claim, exponential backoff with jitter, and the `timestamp.body` signing convention.

**What I kept**: The overall structure, the partial index on `delivery_attempts(status, next_attempt_at) WHERE status IN ('pending', 'in_flight')` (a genuinely non-obvious SQLite optimization), and the timestamp-prefixed signing payload. The RETURNING clause for SQLite was something I knew about but wouldn't have reached for immediately.

**What I modified**: The model suggested Zod for validation on every route, which I kept, but it also suggested `fastify-plugin` for the auth hook — I dropped that dependency and registered the preHandler directly in a scoped plugin, which is simpler and requires no extra package.

---

## 2. Worker Crash Recovery Design

**What I asked**: What's the right way to implement at-least-once delivery with crash recovery in a single-process SQLite-backed system? Specifically: what happens to an in-flight delivery when the process dies mid-request?

**What came back**: The `in_flight` status + `updated_at` lease pattern. On startup, scan for `in_flight` rows with `updated_at` older than the delivery timeout threshold and reset them to `pending`. The threshold should be safely above the per-request timeout (30s threshold vs. 10s delivery timeout in my case).

**What I kept**: The entire approach. The insight that `in_flight` acts as a distributed lock with a lease expiry is exactly right and I wouldn't have named it that cleanly on my own.

**What I modified**: The suggested threshold was 60s; I tightened it to 30s (still 3x the delivery timeout) to recover faster after a crash without risking false positives.

---

## 3. Retry Policy — Permanent vs. Transient Failures

**What I asked**: Which 4xx status codes should cause an immediate exhaustion vs. a retry? The spec says "4xx usually means don't retry" but I wanted to think through the exceptions.

**What came back**: A clear categorization: 408 (Request Timeout) and 429 (Too Many Requests) are transient — the subscriber is reachable but temporarily can't handle the request. All other 4xx codes are permanent client errors where retrying the same payload won't help. It also flagged 410 as a special case: the subscriber is explicitly saying "stop sending to this URL," which should trigger subscription deactivation.

**What I kept**: The 408/429 exception and the 410 → deactivate-subscription behavior. These are the right calls and I wouldn't have thought about 410 deactivation unprompted.

**What I rejected**: The model suggested also retrying 503 with a check for a `Retry-After` header. I only implemented `Retry-After` handling for 429 — 503 does retry, but I don't bother parsing the header. The added code complexity wasn't worth it for a take-home scope.

---

## 4. Event Pattern Matching

**What I asked**: How should I implement glob-style event type matching (`user.*` matches single segment, `order.**` matches any depth)?

**What came back**: A clean two-branch implementation: `endsWith(".*")` checks that the prefix matches and the remainder contains no dots; `endsWith(".**")` just checks the prefix. Both work in pure string operations with no regex.

**What I kept**: The exact approach. It's readable and fast.

**What I modified**: The original suggestion also handled a `?` single-character wildcard. I dropped that — it's not in the spec, and YAGNI. I also added the edge-case test that `order.*` should not match `orders.created` (prefix false match), which the suggested implementation handled correctly but wasn't in the original test cases.

---

## 5. Handlebars Template Wiring

**What I asked**: How do I configure `@fastify/view` with Handlebars, a layout file, and static assets (`@fastify/static`) so the paths resolve correctly both in `tsx` dev mode (running from `src/`) and after `tsc` compilation (running from `dist/`)?

**What came back**: Use `fileURLToPath(import.meta.url)` to get `__dirname` in ESM, then `path.resolve(__dirname, "..")` to get the project root for the `public/` folder, and `path.join(__dirname, "views")` for the templates. This works correctly in both modes.

**What I kept**: The `__dirname` via `fileURLToPath` pattern — this is the standard ESM solution and I'd have used it anyway, but the explanation of why it diverges between `src/` and `dist/` was useful for sanity-checking the path construction.

**What I modified**: The suggested config included `layoutsDir` and `partialsDir` options that I didn't need given my simple template structure. I stripped those to keep the plugin registration minimal.

---

## 6. Gap Caught Post-Generation: Form Body Parsing

**What happened**: All dashboard forms (create subscription, send test event, retry) returned `415 Unsupported Media Type` when submitted. The AI-generated Fastify setup didn't include `@fastify/formbody`, which is required to parse `application/x-www-form-urlencoded` — the default encoding for HTML form POSTs. Fastify only parses `application/json` out of the box.

**What I asked**: Nothing — I diagnosed this myself from the 415 error code and Fastify's content-type handling docs. The AI had generated working-looking route handlers that cast `request.body` to the right type, but silently assumed form parsing was already configured.

**What I rejected**: I considered switching the dashboard forms to submit JSON via `fetch()` instead of native HTML forms (which would have avoided the issue entirely). I rejected that because it adds JavaScript as a hard dependency for core CRUD flows, breaks without JS enabled, and the whole point of server-rendered Handlebars was to stay simple. The right fix was to add the plugin, not change the architecture.

**Lesson**: AI-generated Fastify code tends to omit plugin registration for things that feel "standard" but aren't in Fastify's default scope. Worth auditing plugin registrations explicitly rather than assuming they're there.
