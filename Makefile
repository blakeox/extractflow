COMPOSE ?= docker compose
PYTHON ?= python3

.PHONY: doctor dev-up dev-down logs ps config test test-python test-ui test-e2e

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
	PYTHONPATH=shared $(PYTHON) -m pytest tests/shared
	PYTHONPATH=backend:shared $(PYTHON) -m pytest tests/backend
	PYTHONPATH=worker:shared $(PYTHON) -m pytest tests/worker

test-ui:
	npm --prefix frontend run test -- --run

test-e2e:
	npm --prefix frontend run test:e2e
