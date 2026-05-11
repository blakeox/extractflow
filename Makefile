COMPOSE ?= docker compose
PYTHON ?= $(shell ./scripts/resolve-python.sh)

.PHONY: doctor dev-up dev-down logs ps config test test-python test-ui test-e2e eval-langextract verify-frontend verify-python verify-pre-commit verify-pre-push format-check format-write lint-frontend release-package

doctor:
	./scripts/dev-doctor.sh

dev-up:
	./scripts/dev-up.sh

dev-down:
	$(COMPOSE) down

logs:
	$(COMPOSE) logs -f --tail=150

ps:
	$(COMPOSE) ps

config:
	$(COMPOSE) config

test: test-python test-ui

test-python:
	./scripts/verify-python.sh

test-ui:
	./scripts/verify-frontend.sh

test-e2e:
	npm --prefix frontend run test:e2e

eval-langextract:
	"$(PYTHON)" ./scripts/evaluate-langextract.py

verify-python:
	./scripts/verify-python.sh

verify-frontend:
	./scripts/verify-frontend.sh

verify-pre-commit:
	./scripts/verify-pre-commit.sh

verify-pre-push:
	./scripts/verify-pre-push.sh

format-check:
	npm run format:check

format-write:
	npm run format:write

lint-frontend:
	npm --prefix frontend run lint

release-package:
	./scripts/package-release-artifacts.sh
