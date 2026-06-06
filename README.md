# Webhook Delivery Service

A single-process webhook delivery service: subscribe to events, ingest them, and deliver them reliably with retries, backoff, and a dashboard.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. (Optional) configure via environment variables
cp .env.example .env
# Edit .env — defaults work out of the box

# 3. Start the server
npm run dev       # development (hot-reload via tsx)
npm start         # production (requires npm run build first)
```

The server starts at **http://localhost:3000** (configurable via `PORT`).

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `ADMIN_KEY` | `dev-admin-key` | Shared secret for `x-admin-key` header on API routes |
| `DB_PATH` | `./data/webhooks.db` | SQLite database file path |
| `MAX_ATTEMPTS` | `8` | Max delivery attempts before exhausting |
| `MAX_CONCURRENT` | `10` | Max concurrent deliveries in the worker |
| `POLL_INTERVAL_MS` | `2000` | Worker polling interval |
| `DELIVERY_TIMEOUT_MS` | `10000` | Per-request timeout when delivering |
| `IN_FLIGHT_TIMEOUT_S` | `30` | Stale in-flight threshold for crash recovery |

## API Reference

All `/api/*` routes require the header `x-admin-key: <ADMIN_KEY>`.

### Subscriptions

```bash
# Create
curl -s -X POST http://localhost:3000/api/subscriptions \
  -H "x-admin-key: dev-admin-key" \
  -H "Content-Type: application/json" \
  -d '{"target_url":"https://webhook.site/YOUR-ID","event_types":["order.*"]}'

# List
curl -s http://localhost:3000/api/subscriptions \
  -H "x-admin-key: dev-admin-key"

# Get one
curl -s http://localhost:3000/api/subscriptions/<id> \
  -H "x-admin-key: dev-admin-key"

# Update
curl -s -X PATCH http://localhost:3000/api/subscriptions/<id> \
  -H "x-admin-key: dev-admin-key" \
  -H "Content-Type: application/json" \
  -d '{"active":false}'

# Soft-delete
curl -s -X DELETE http://localhost:3000/api/subscriptions/<id> \
  -H "x-admin-key: dev-admin-key"
```

### Events (Ingest)

```bash
# Ingest an event (fans out to matching subscriptions)
curl -s -X POST http://localhost:3000/api/events \
  -H "x-admin-key: dev-admin-key" \
  -H "Content-Type: application/json" \
  -d '{"event_type":"order.created","payload":{"order_id":"abc123","amount":99.99}}'

# Response: {"event_id":"...","matched_subscriptions":1}

# List events
curl -s "http://localhost:3000/api/events?limit=20" \
  -H "x-admin-key: dev-admin-key"

# Get event + its delivery attempts
curl -s http://localhost:3000/api/events/<id> \
  -H "x-admin-key: dev-admin-key"
```

### Delivery Attempts

```bash
# List (filterable)
curl -s "http://localhost:3000/api/delivery-attempts?status=exhausted" \
  -H "x-admin-key: dev-admin-key"

# Manual retry
curl -s -X POST http://localhost:3000/api/delivery-attempts/<id>/retry \
  -H "x-admin-key: dev-admin-key"
```

### Health

```bash
curl -s http://localhost:3000/health
# {"status":"ok","db":"ok","uptime":42.1}
```

## Dashboard

Open **http://localhost:3000/dashboard** in your browser. No authentication required.

- **Overview** — stats cards + recent events
- **Subscriptions** — create, list, deactivate subscriptions
- **Events** — paginated event list with type filter
- **Event Detail** — full payload, all delivery attempts, inline Retry button

## Event Type Patterns

| Pattern | Matches |
|---|---|
| `*` | Everything |
| `order.created` | Exact match only |
| `user.*` | `user.created`, `user.deleted` (single segment) |
| `order.**` | `order.created`, `order.item.refunded` (any depth) |

## Payload Signing

When a subscription has a secret, each delivery includes:
```
X-Webhook-ID:        <delivery_attempt_id>
X-Webhook-Timestamp: <unix seconds>
X-Webhook-Signature: sha256=<hmac-sha256>
```

Signed payload: `"${timestamp}.${raw_body_json}"`

Subscriber verification:
```python
import hmac, hashlib, time

def verify(body: bytes, secret: str, timestamp: str, signature: str) -> bool:
    if abs(time.time() - int(timestamp)) > 300:
        return False
    expected = hmac.new(secret.encode(), f"{timestamp}.".encode() + body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(f"sha256={expected}", signature)
```

## Running Tests

```bash
npm test
```

40 tests covering pattern matching, signing, subscription CRUD, event fan-out, delivery state machine, and worker crash recovery.

## What's Working

- Full subscription CRUD with soft-delete
- Event ingest with fan-out to matching subscriptions
- Async delivery worker with exponential backoff + jitter
- Crash recovery (in-flight → pending on startup)
- Payload signing (HMAC-SHA256) with timestamp-based replay prevention
- Manual retry from API and dashboard
- Dashboard with overview, subscriptions, events, event detail
- 40 passing tests

## What I'd Improve with More Time

- **Webhook verification test endpoint** — a `/debug/echo` that logs received webhooks, useful for local testing without webhook.site
- **Metrics endpoint** — Prometheus-compatible `/metrics` (delivery success rate, p99 latency, queue depth)
- **Rate limiting on ingest** — prevent event storms from a single caller
- **Structured delivery logs** — store full response body (truncated) for debugging
- **Graceful shutdown** — drain in-flight deliveries before process exit
- **Configurable retry policy per subscription** — currently global
- **Event replay by subscription** — re-fan-out a historical event to a specific subscriber
