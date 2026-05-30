# Lingual Project — Test & Development Commands

.PHONY: test test-backend test-frontend test-firebase test-postgres test-all coverage-backend help

# ---------------------------------------------------------------------------
# Individual test suites
# ---------------------------------------------------------------------------

test-backend:  ## Run all backend Python tests
	python3 -m unittest discover -s backend/tests -p "test_*.py" -v

test-frontend:  ## Run all frontend Vitest tests
	cd frontend && npm run test -- --run

test-firebase:  ## Run Firebase emulator rule tests (requires Java)
	cd firebase-tests && npm test

test-e2e:  ## Run E2E browser tests (requires backend + frontend running)
	bash e2e/test-teacher-dashboard.sh
	bash e2e/test-student-assignment.sh

# Java home for the Firestore emulator. Honors an existing JAVA_HOME (env or
# `make JAVA_HOME=...`); otherwise uses the local temurin install on macOS, and
# falls back to `java` on PATH (Linux/CI/cloud sandbox) where that dir is absent.
TEMURIN_MAC := /Library/Java/JavaVirtualMachines/temurin-25.jdk/Contents/Home
JAVA_HOME ?= $(shell test -d $(TEMURIN_MAC) && echo $(TEMURIN_MAC))

test-emulator:  ## Run Firestore emulator integration tests (requires Java)
	$(if $(JAVA_HOME),JAVA_HOME=$(JAVA_HOME)) \
	firebase emulators:exec --only firestore --project lingu-480600 \
	'FIRESTORE_EMULATOR_HOST=localhost:8787 python3 -m unittest backend.tests.test_firestore_indexes -v'

# Postgres DDL/migration tests (gated like test-emulator). Uses an existing
# DATABASE_URL if set, otherwise spins up an ephemeral postgres:18 in Docker.
# uuidv7() requires Postgres 18. Host port 55432 avoids colliding with any
# local Postgres already on the default 5432.
PG_TESTS := backend.tests.test_postgres_schema backend.tests.test_postgres_migration backend.tests.test_backfill_postgres backend.tests.test_dual_write_enrollments_pg
PG_HOST_PORT := 55432
PG_DSN := postgresql+pg8000://lingual:lingual@127.0.0.1:$(PG_HOST_PORT)/lingual

test-postgres:  ## Run Postgres schema/migration tests (Docker postgres:18 or DATABASE_URL)
	@if [ -n "$$DATABASE_URL" ]; then \
	  python3 -m unittest $(PG_TESTS) -v; \
	else \
	  echo "Starting ephemeral postgres:18 on host port $(PG_HOST_PORT) ..."; \
	  docker rm -f lingual-pg-test >/dev/null 2>&1 || true; \
	  docker run -d --rm --name lingual-pg-test \
	    -e POSTGRES_PASSWORD=lingual -e POSTGRES_USER=lingual -e POSTGRES_DB=lingual \
	    -p $(PG_HOST_PORT):5432 postgres:18 >/dev/null; \
	  trap 'docker stop lingual-pg-test >/dev/null 2>&1' EXIT; \
	  ready=0; \
	  for i in $$(seq 1 30); do \
	    if docker exec lingual-pg-test pg_isready -U lingual >/dev/null 2>&1; then ready=1; break; fi; \
	    sleep 1; \
	  done; \
	  if [ "$$ready" != "1" ]; then \
	    echo "ERROR: postgres:18 did not become ready in 30s" >&2; \
	    docker logs lingual-pg-test 2>&1 | tail -20 >&2; exit 1; \
	  fi; \
	  DATABASE_URL=$(PG_DSN) python3 -m unittest $(PG_TESTS) -v; \
	fi

# ---------------------------------------------------------------------------
# Combined
# ---------------------------------------------------------------------------

test: test-backend test-frontend  ## Run backend + frontend tests
test-all: test-backend test-frontend test-firebase test-postgres test-e2e  ## Run all test suites including Firebase, Postgres, and E2E

# ---------------------------------------------------------------------------
# Coverage
# ---------------------------------------------------------------------------

coverage-backend:  ## Run backend tests with coverage report
	python3 -m coverage run --source=backend -m unittest discover -s backend/tests -p "test_*.py"
	python3 -m coverage report --show-missing --skip-covered
	python3 -m coverage html -d coverage_html
	@echo "HTML report: coverage_html/index.html"

# ---------------------------------------------------------------------------
# Help
# ---------------------------------------------------------------------------

help:  ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'
