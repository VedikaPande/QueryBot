# QueryBot — common tasks.
#
#   make help      list every target
#   make up        run the full stack
#   make test      run every test suite
#   make check     everything CI runs, locally

.DEFAULT_GOAL := help
.PHONY: help setup up down logs restart clean install test test-client test-server \
        test-sqlite test-agent lint typecheck check build migrate shell-db

# ---------------------------------------------------------------------------
help:
	@echo "QueryBot"
	@echo ""
	@echo "  Stack"
	@echo "    make setup       generate .env with fresh secrets"
	@echo "    make up          build and start every service"
	@echo "    make down        stop the stack"
	@echo "    make logs        follow the logs"
	@echo "    make clean       stop and delete volumes (destroys data)"
	@echo ""
	@echo "  Development"
	@echo "    make install     install dependencies for every service"
	@echo "    make migrate     apply database migrations"
	@echo ""
	@echo "  Quality"
	@echo "    make test        every test suite"
	@echo "    make lint        lint the client"
	@echo "    make typecheck   type-check the TypeScript services"
	@echo "    make check       everything CI runs"

# ---------------------------------------------------------------------------
# Stack
# ---------------------------------------------------------------------------
setup:
	@test -f .env && echo ".env already exists; leaving it alone." || ( \
		cp .env.example .env && \
		python -c "import re,secrets,pathlib; p=pathlib.Path('.env'); t=p.read_text(); \
		           t=re.sub(r'^(SECRET_KEY|JWT_SECRET_KEY|SERVICE_TOKEN|POSTGRES_PASSWORD)=.*$$', \
		                    lambda m: m.group(1)+'='+secrets.token_urlsafe(32), t, flags=re.M); \
		           p.write_text(t)" && \
		echo "Created .env with generated secrets. Add your GROQ_API_KEY before running 'make up'." )

up:
	docker compose up --build -d
	@echo ""
	@echo "  App   http://localhost:8080"
	@echo "  Docs  http://localhost:8080/api/docs"
	@echo ""
	@echo "  Follow the logs with 'make logs'."

down:
	docker compose down

logs:
	docker compose logs -f --tail=100

restart:
	docker compose restart

clean:
	docker compose down -v --remove-orphans

# ---------------------------------------------------------------------------
# Development
# ---------------------------------------------------------------------------
install:
	cd client && npm ci
	cd sqlite_server && npm ci
	cd server && uv sync --all-groups
	cd langgraph_agent && uv sync --all-groups

migrate:
	cd server && uv run flask --app main.py db upgrade

shell-db:
	docker compose exec postgres psql -U querybot -d querybot

# ---------------------------------------------------------------------------
# Quality
# ---------------------------------------------------------------------------
test: test-client test-sqlite test-server test-agent

test-client:
	cd client && npm test

test-sqlite:
	cd sqlite_server && npm test

test-server:
	cd server && uv run pytest -q

test-agent:
	cd langgraph_agent && GROQ_API_KEY=test CHART_DOCKER_ENABLED=false uv run pytest -q

lint:
	cd client && npm run lint

typecheck:
	cd client && npx tsc --noEmit -p tsconfig.app.json
	cd sqlite_server && npx tsc --noEmit

build:
	cd client && npm run build
	cd sqlite_server && npm run build

check: typecheck lint test
	@echo ""
	@echo "All checks passed."
