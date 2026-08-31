# Contributing

## Getting set up

```bash
make setup      # writes .env with generated secrets
# add your GROQ_API_KEY to .env
make up         # builds and starts everything
```

Then open http://localhost:8080. The API reference is at
http://localhost:8080/api/docs.

For work on a single service it is usually quicker to run that one natively and
leave the rest in Docker:

```bash
docker compose up -d postgres redis sqlite-service agent
cd server && uv run python main.py     # or: cd client && npm run dev
```

## Before you push

```bash
make check      # typecheck + lint + every test suite
```

## Layout

```
client/           React SPA
server/           Flask API — auth, ownership, history, proxying
sqlite_server/    Dataset storage and read-only query execution
langgraph_agent/  NL → SQL, charts, insights
docs/             Architecture and decision records
```

Inside the agent, one module per workflow concern — the graph in
`workflow_manager.py` wires them together:

```
llm_manager.py        Provider-agnostic model access (Groq/OpenAI/Anthropic/Google)
question_classifier.py  Relevance, output kind, and follow-up intent
refinement.py         Restyling a previous result instead of re-querying
sql_agent.py          Generate → validate → execute → repair → answer
visualization.py      Which chart type suits the result
chart_templates.py    The plotting script, one template per chart type
chart_generator.py    Runs that script, in-process or in the sandbox
insights_generator.py Analysis, follow-up questions, data-quality notes
```

## Conventions

**Comments explain why, not what.** If a line needs explaining, prefer clearer
code; reserve comments for constraints the code cannot express — a workaround, a
security property, a non-obvious ordering requirement.

**Errors reach the user in their language.** "Dataset not found. It may have
expired — please upload it again." beats "404". Log the technical detail; show
the person what to do.

**Never return `403` for a resource owned by someone else.** Return `404`, so
identifiers cannot be probed for existence.

**Every new endpoint gets an authorization test.** Ownership bugs are silent and
serious; a test is the only thing that keeps them from recurring.

**Update the OpenAPI document** in `server/app/static/openapi.yaml` when you
change an endpoint. A test asserts the core paths are present.

## Testing

| Suite | Command | Covers |
|---|---|---|
| Client | `make test-client` | Stream merging, exports, components |
| SQLite service | `make test-sqlite` | SQL guard, path traversal, CSV handling |
| API | `make test-server` | Auth, ownership, rate limits, caching |
| Agent | `make test-agent` | State schema, routing, chart codegen |

Tests are named as statements about behaviour — `test_querying_someone_elses_dataset_is_rejected`
— so a failure reads as a description of what broke.

Where a test guards against a specific bug, say so in a comment. Otherwise a
later reader will "simplify" the assertion and reintroduce it.

## Database changes

```bash
cd server
uv run flask --app main.py db migrate -m "what changed"
# read the generated file before committing it
uv run flask --app main.py db upgrade
```

Autogenerate is a starting point, not an answer. It reflects against your local
SQLite database and will occasionally propose a type change that is a no-op on
PostgreSQL. Delete anything that is not a real change; CI verifies migrations
apply, roll back and reapply against a real PostgreSQL instance.

## Pull requests

- One concern per PR.
- Describe what changed and why. If it fixes a bug, say what the bug was.
- CI must be green. It runs lint, type-check, every test suite and the image builds.
