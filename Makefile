.PHONY: install dev build start test test-watch clean \
        docker-build docker-up docker-down docker-logs docker-shell docker-clean

IMAGE ?= fibr-webhook-delivery-service

# ── Local ──────────────────────────────────────────────────────────────────────

install:
	npm install

dev:
	npx tsx watch src/index.ts

build:
	npx tsc

start: build
	node dist/index.js

test:
	npx vitest run

test-watch:
	npx vitest

clean:
	rm -rf dist data/

# ── Docker ─────────────────────────────────────────────────────────────────────

docker-build:
	docker build -t $(IMAGE) .

docker-up:
	docker compose up --build -d

docker-down:
	docker compose down

docker-logs:
	docker compose logs -f app

docker-shell:
	docker compose exec app sh

docker-clean:
	docker compose down -v --rmi local
