# Lingual Project — Test & Development Commands

.PHONY: test test-backend test-frontend test-firebase test-all coverage-backend help

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

# ---------------------------------------------------------------------------
# Combined
# ---------------------------------------------------------------------------

test: test-backend test-frontend  ## Run backend + frontend tests
test-all: test-backend test-frontend test-firebase test-e2e  ## Run all test suites including Firebase and E2E

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
