# Architecture

How QueryBot is put together, and why.

## Contents

- [System overview](#system-overview)
- [Request lifecycle](#request-lifecycle)
- [The agent workflow](#the-agent-workflow)
- [Data model](#data-model)
- [Security model](#security-model)
- [Caching](#caching)
- [Observability](#observability)
- [Decision records](#decision-records)

## System overview

Four services, each with one job.

```
                          ┌───────────────────────────┐
                          │          Browser          │
                          └─────────────┬─────────────┘
                                        │  httpOnly JWT cookies
                          ┌─────────────▼─────────────┐
                          │  nginx  ·  React SPA      │  :8080  (only public port)
                          │  serves static, /api →    │
                          └─────────────┬─────────────┘
                                        │
                          ┌─────────────▼─────────────┐
             ┌───────────►│        Flask API          │◄──────────┐
             │            │  authentication           │           │
        ┌────┴────┐       │  dataset ownership        │      ┌────┴─────┐
        │ Postgres│◄──────┤  conversation history     ├─────►│  Redis   │
        │  users  │       │  rate limiting            │      │  cache   │
        │datasets │       └────┬─────────────────┬────┘      │  limits  │
        │messages │            │                 │           └──────────┘
        └─────────┘            │ service token   │ service token
                    ┌──────────▼──────┐   ┌──────▼───────────┐
                    │ SQLite service  │◄──┤ LangGraph agent  │
                    │ upload · schema │   │ NL → SQL         │
                    │ read-only query │   │ charts, insights │
                    └────────┬────────┘   └──────┬───────────┘
                             │                   │
                       ┌─────▼──────┐   ┌────────▼─────────┐
                       │  uploads   │   │  Docker sandbox  │
                       │  volume    │   │  chart renderer  │
                       └────────────┘   └──────────────────┘
```

**Why four services rather than one.** They have genuinely different runtime
needs. The SQLite service does synchronous, CPU-bound file work that would block
a Python event loop. The agent holds long-lived connections to a model provider
and needs to spawn containers. The API is I/O-bound request handling. Splitting
them means each can be scaled, restarted and secured on its own terms — and the
two that touch user data can be kept off the public network entirely.

**Why the browser only talks to Flask.** It is the single place where a request
is authenticated and checked against dataset ownership. The SQLite service will
happily execute a query against any dataset it holds, given the service token —
which is exactly why it must never be reachable from a browser.

## Request lifecycle

Asking a question:

1. The browser posts to `/api/langgraph/run` with the question, the dataset
   identifier and an optional conversation id. The JWT cookie rides along.
2. nginx forwards to Flask on the internal network.
3. Flask assigns a request id, verifies the JWT, applies the rate limit
   (20/hour — each call makes several paid model requests), and confirms the
   caller owns the dataset.
4. The user's turn is persisted, and the last six turns become agent context.
5. Flask opens a stream to the agent and re-emits each node update to the
   browser as a Server-Sent Event.
6. The agent classifies the question, writes SQL, has the SQLite service run it
   read-only, then renders a chart and derives insights.
7. When the stream closes, Flask writes the assistant turn — answer, SQL, chart,
   rows — so the analysis can be reopened later.

The stream is why the API runs on gevent workers rather than sync ones: a run
takes tens of seconds, and a sync worker held open for that long would block
every other request queued behind it.

## The agent workflow

A LangGraph state machine, not a linear chain, because most questions do not
need every step:

```
              ┌──────────────────┐
              │ classify_question│
              └────────┬─────────┘
                 relevant?
            no ┌───────┴────────┐ yes
    ┌──────────▼──────┐   ┌─────▼──────────┐
    │ handle_irrelevant│   │ parse_question │
    └──────────┬──────┘   └─────┬──────────┘
               │                │
               │          ┌─────▼──────────┐
               │          │get_unique_nouns│  sample real column values so the
               │          └─────┬──────────┘  model filters on 'NEW YORK', not
               │                │             the 'New York' it would invent
               │          ┌─────▼──────────┐
               │          │  generate_sql  │
               │          └─────┬──────────┘
               │          ┌─────▼──────────┐
               │          │validate_and_fix│
               │          └─────┬──────────┘
               │          ┌─────▼──────────┐
               │          │  execute_sql   │
               │          └─────┬──────────┘
               │          ┌─────▼──────────┐
               │          │ format_results │
               │          └─────┬──────────┘
               │          ┌─────▼──────────────┐
               │          │choose_visualization│
               │          └─────┬──────────────┘
               │         chart worth drawing?
               │        ┌───────┴────────┐
               │  ┌─────▼──────┐   ┌─────▼─────┐
               │  │generate_   │   │skip_chart │
               │  │chart       │   └─────┬─────┘
               │  └─────┬──────┘         │
               │        └───────┬────────┘
               │          table needed?
               │        ┌───────┴────────┐
               │  ┌─────▼──────┐   ┌─────▼─────┐
               │  │format_table│   │skip_table │
               │  └─────┬──────┘   └─────┬─────┘
               │        └───────┬────────┘
               │        more than one row?
               │        ┌───────┴────────┐
               │  ┌─────▼──────────┐     │
               │  │generate_insights│    │
               │  └─────┬──────────┘     │
               │        └───────┬────────┘
               │        ┌───────▼────────┐
               └───────►│finalize_response│
                        └────────────────┘
```

Routing is what keeps it affordable. "How many rows are there?" returns a single
number: no chart, no distribution analysis, three model calls instead of eight.

## Data model

```
users
  id            uuid  pk
  email         text  unique, indexed
  password_hash text        bcrypt, cost 12
  is_active     bool
     │
     │ 1:N  (cascade)
     ▼
datasets
  id            uuid  pk
  external_uuid uuid  unique, indexed   handle used by the SQLite service
  user_id       uuid  fk → users, indexed
  file_name     text
  expires_at    timestamptz             mirrors the retention sweep
     │
     │ 1:N  (cascade)
     ▼
conversations
  id            uuid  pk
  user_id       uuid  fk → users, indexed
  dataset_id    uuid  fk → datasets, indexed
  title         text                    derived from the first question
     │
     │ 1:N  (cascade)
     ▼
messages
  id                 uuid  pk
  conversation_id    uuid  fk → conversations, indexed
  role               text        user | assistant | error
  content            text
  sql_query          text
  chart_image_base64 text        so a result can be reopened intact
  result_rows        jsonb       replayable and re-exportable
```

`datasets.external_uuid` is separate from `datasets.id` on purpose: the
identifier the SQLite service knows is a different concern from the primary key,
and keeping them apart means the storage layer can be replaced without touching
foreign keys.

Every foreign key cascades, so deleting an account removes its datasets,
conversations and messages in one statement rather than leaving orphans.

## Security model

| Concern | Control |
|---|---|
| Session theft via XSS | Tokens live in `httpOnly` cookies; no JavaScript can read them |
| Cross-site requests | `SameSite=Lax`, an explicit CORS allow-list, never `*` |
| Reading another user's data | Ownership verified on every dataset access; answers `404`, not `403`, so identifiers cannot be probed |
| SQL injection / data exfiltration | Only a single read-only `SELECT`/`WITH`; `ATTACH`, `PRAGMA` and `load_extension` rejected; database opened read-only |
| Path traversal | Dataset ids must be canonical UUIDs and the resolved path is confined to the uploads directory |
| Arbitrary code execution | Generated plotting code runs in a container with no network, 512MB, one CPU and a non-root user |
| Cost abuse | Per-user rate limits on the endpoints that call the model |
| Internal services exposed | Service token required; only the client port is published |
| Secrets in the image | Nothing baked in; everything is injected at runtime |
| Misconfiguration | Production refuses to start without secrets, a real database and a CORS allow-list |

The recurring principle: **the identifier is not the authorisation**. Knowing a
UUID grants nothing on its own.

## Caching

Redis, with a deliberate fallback: if it is unreachable the cache degrades to a
no-op and the app keeps serving. A cache outage should make things slower, not
break them.

| Cached | TTL | Why it is safe |
|---|---|---|
| Dataset schema | 4h | Immutable once uploaded; read on every playground load and several times per run |
| Table preview | 30m | Same rows for the same dataset |

Invalidation is straightforward because the underlying data is immutable: the
only event that requires eviction is deleting a dataset, which drops the whole
`querybot:dataset:<uuid>:*` prefix via `SCAN` — never `KEYS`, which blocks the
Redis event loop for the duration of the scan.

## Logging

JSON in production so a log aggregator can index it; human-readable locally.
Each service exposes `/health`, which checks the dependency it cannot work
without — the database for the API, a writable uploads directory for the dataset
service.

---

## Decision records

### ADR-001 — Route the browser through the API rather than to each service

**Context.** The original design had the browser upload straight to the SQLite
service and post questions to Flask, which meant two origins and two places
where access would have to be enforced.

**Decision.** All browser traffic goes to Flask. It authenticates, checks
ownership and proxies onward with a service token.

**Consequences.** One place to get authorization right. Internal services stay
off the public network. The cost is an extra hop on uploads, which is
inconsequential against the model latency that dominates a request.

### ADR-002 — Store JWTs in httpOnly cookies, not localStorage

**Context.** The frontend needs an authenticated session across reloads.

**Decision.** The server sets `httpOnly`, `SameSite=Lax` cookies. Nothing
token-shaped is kept in Redux or `localStorage`.

**Consequences.** A token cannot be exfiltrated by injected script, which is the
failure mode that makes `localStorage` unsuitable. In exchange, CSRF becomes a
consideration — handled by `SameSite` plus an explicit CORS allow-list — and the
client cannot inspect expiry, so it refreshes reactively on a `401` instead.

### ADR-003 — An allow-list for SQL, not a deny-list

**Context.** The agent generates SQL from user input and runs it against a user
database. The model can be steered, so its output is untrusted.

**Decision.** Accept only a single statement whose leading keyword is `SELECT`
or `WITH`. Reject everything else, strip comments and string literals before
matching so a keyword cannot be smuggled inside a quoted value, and open the
database read-only.

**Consequences.** Some legitimate read-only constructs are refused. That is the
right trade: a deny-list has to anticipate every dangerous form, while an
allow-list only has to recognise the safe ones. `ATTACH` in particular would
otherwise let a query read any SQLite file the process can open — read-only mode
alone does not stop it.

### ADR-004 — Render charts in a container, not in-process

**Context.** Producing a chart means executing generated Python.

**Decision.** Run it in a container with no network, 512MB, one CPU, a two-minute
timeout and a non-root user. When Docker is unavailable, report that charts are
unavailable and answer the question anyway.

**Consequences.** Charts cost a container start, roughly a second. In return,
generated code cannot read the filesystem, reach the network or outlive its
timeout. Enabling this in Compose requires mounting the host Docker socket,
which is effectively root on the host — so it is off by default and documented
rather than quietly enabled.

### ADR-005 — Deterministic chart code first, the model second

**Context.** The original implementation asked a ReAct agent to write plotting
code on every chart, and separately built a code template that was passed along
as a suggestion.

**Decision.** Build the plotting script deterministically from the chosen chart
type and the result shape. Fall back to the agent only if that fails to produce
an image.

**Consequences.** The common path drops a model round trip, becomes reproducible
and cannot fail on a hallucinated API. The fallback preserves the ability to
handle shapes the templates do not cover. Values are injected as JSON literals
rather than interpolated into generated f-strings — the previous approach
produced invalid Python for any question containing a brace.

### ADR-006 — Declare every workflow key on the state schema

**Context.** LangGraph silently discards node outputs that are not declared on
the state schema. Several keys — `is_relevant` among them — were being returned
and dropped, so relevance routing always read its default.

**Decision.** Declare every key any node writes, and cover it with a test that
asserts the keys survive a node boundary.

**Consequences.** The failure mode was invisible: no error, just a router
reading a default forever. The test is what stops it recurring.

### ADR-007 — TypeScript 6, not 7

**Context.** TypeScript 7 is released, but `typescript-eslint` still declares a
peer range of `<6.1.0`.

**Decision.** Pin to TypeScript 6 until the linter supports 7.

**Consequences.** Forcing 7 would mean either no linting or an unsupported
resolution. Linting on every file is worth more than being one major ahead on
the compiler. Revisit when `typescript-eslint` ships support.

### ADR-008 — Execution-guided self-correction instead of a single attempt

**Context.** The agent generated SQL, ran it once, and surfaced any database error
straight to the user. A wrong column name — the single most common failure —
produced "no such column: revenu" and nothing else.

**Decision.** When a query fails, feed the database's own error message back to
the model along with every prior attempt, and re-execute. Bounded at two repairs.

**Consequences.** The database knows things the schema text cannot express: that a
column is stored as text, that an alias is out of scope, that a function does not
exist in SQLite. Recovering from that feedback is what the research on this
problem converges on — [LitE-SQL](https://arxiv.org/html/2510.09014v1) attributes
its 72% BIRD execution accuracy to exactly this loop.

The bound matters as much as the loop. Past two attempts the model tends to
re-propose the same mistake, so further retries buy latency and tokens and
nothing else. A repair that returns an identical query also stops immediately,
since it would fail identically. The termination condition is tested directly,
because a repair edge that never stops would hang every failing request.

### ADR-009 — Profile datasets in SQL, not with a model

**Context.** A user uploading an unfamiliar CSV had no idea what it contained.
The first several questions went on discovering the schema by trial and error,
and each one cost a full agent run.

**Decision.** Profile the dataset immediately on upload, entirely in SQL: column
type inference from values, missing-value counts, cardinality, min/max/mean/
median/stdev, outlier counts by interquartile range, value distributions,
duplicate rows, and Pearson correlations between numeric columns. Derive
plain-language highlights from the results.

**Consequences.** It is instant, free and exact — no tokens, no hallucination
risk, and the numbers are computed rather than described. The user starts from an
understanding of their data instead of building one through failed questions, and
correlations surface relationships nobody thought to ask about.

Two subtleties are load-bearing:

*Distinctness is not identity.* The first implementation excluded any all-distinct
numeric column from correlation as an "identifier". In a small dataset revenue and
temperature are usually entirely distinct, so this silently excluded exactly the
columns worth correlating. The reliable signal is a declared primary key, or a
unique integer with an identifier-like name.

*Pearson is not robust to outliers.* One extreme value can mask an otherwise
perfect relationship. That produces a false negative — a real relationship goes
unreported — never a false claim, which is the safe direction for something shown
to a user as a finding. It is pinned by a test so nobody later "fixes" the missing
correlation by loosening the reporting threshold and starts producing spurious
ones.

### ADR-010 — A tile points at a message; a share link is a capability

**Context.** Answers were ephemeral: ask, read, move on. Dashboards make a result
persist, and sharing puts one in front of people without accounts.

**Decision.** A tile stores a foreign key to the `Message` that produced it, plus
presentation (which view, what width, what position) — never a copy of the chart
or rows. Sharing is a per-dashboard random token, and the public endpoint takes
that token instead of a session.

**Consequences.**

*No duplicated truth.* The message already holds the answer, SQL, chart PNG and
rows, so a tile re-renders from the single copy. Deleting the conversation
cascades the tiles away, which is right: a tile whose source is gone has nothing
to render.

*The token is not the id.* A dashboard's id appears in its owner's own URLs and
logs, so reusing it as the capability would make every dashboard guessable from
anywhere it had ever been mentioned. The token is 32 random bytes, revocable, and
re-enabling sharing mints a new one so a revoked link stays dead.

*The public payload is a different shape, not the same shape filtered in the UI.*
`to_dict(public=True)` omits the SQL — which discloses the schema — along with the
message ids, the token itself and every ownership field. Hiding those in the
frontend would leave them in the response body for anyone who opened the network
tab.

*Ownership is checked on the pin, not just the dashboard.* Pinning takes a message
id, so without verifying that the message belongs to the caller a user could pin
someone else's result and then publish it through a share link. The check is a
join through `Conversation` in the query itself, so it cannot be forgotten.

### ADR-011 — Enforce SQLite foreign keys in development

**Context.** Every foreign key is declared `ondelete='CASCADE'`. PostgreSQL
enforces that; SQLite ships with `PRAGMA foreign_keys` **off**.

**Decision.** A SQLAlchemy `connect` listener turns the pragma on for SQLite
connections.

**Consequences.** Cascades were working in production and silently doing nothing
in local development and tests — the environments where a developer would notice
orphaned rows. That is the worst possible split, because the weaker environment is
the one used to build confidence. Two tests now assert the pragma is on and that
deleting a user leaves no datasets, conversations, messages or tiles behind.

### ADR-012 — Hand-rolled table instead of a table library

**Context.** Results need sorting, filtering and pagination. `@tanstack/react-table`
v9 is a complete API rewrite from v8.

**Decision.** Implement it directly — roughly sixty lines over an in-memory
array.

**Consequences.** One fewer dependency, no exposure to another API rewrite, and
full control over null ordering and numeric-versus-lexicographic sorting (the
bug where `9` sorts above `10`). A virtualised grid over 100k rows would justify
the library; capped at 5,000 rows, it does not.

### ADR-013 — Restyle the previous result instead of re-answering the question

**Context.** "Make it a pie chart" is a follow-up about the answer already on
screen, not a new question about the data. Routing it through the normal workflow
costs six model calls and regenerates the SQL from scratch, so the second chart is
built from a query the model wrote independently of the first. On anything with a
filter or a join, that query differs — the user asks for a colour change and the
numbers move.

**Decision.** Classify each turn as `new`, `requery` or `restyle`, and give
`restyle` its own path: re-execute the stored SQL verbatim, apply the requested
presentation change, re-render. Detection rides along with the existing question
classifier rather than adding a node, so a first question makes exactly as many
model calls as it did before. Chart type, palette, sort and row limit are the
recognised changes, each validated against an allow-list; anything outside them is
classified as `requery` rather than approximated.

**Alternatives considered.** Sending the previous rows back to the agent, which
avoids the database round trip but puts up to 5,000 rows in every request payload
and needs a truncation rule that would silently change what the chart shows.
Re-generating the SQL with the previous query as context — cheaper to build, but
it still spends the model calls and still permits drift. Re-executing is a
millisecond-scale SQLite query and makes drift structurally impossible.

**Consequences.** A restyle is one classification call and one query rather than
six calls, and the numbers are guaranteed identical because the query is byte-for-
byte the same. Insights are carried forward when only the presentation changed and
dropped when a sort or limit changed the rows, so the prose never describes rows
that are no longer on screen. Styling is persisted per message, which is what lets
it accumulate: a pie chart stays a pie chart when the next turn asks for green.
A wrong classification degrades to the full workflow rather than to a wrong chart —
every failure path in the parser returns `new`.

### ADR-014 — One provider abstraction over four LLM vendors

**Context.** The agent was wired directly to `ChatGroq`. Being locked to one
vendor is a real constraint — model retirements have broken runs twice — and
different deployments have different cost and capability needs.

**Decision.** Route every call through `LLMManager`, selected by `LLM_PROVIDER`
(Groq, OpenAI, Anthropic, Google) with a per-provider default model that
`LLM_MODEL` overrides. Integrations are imported lazily, so a missing package
reports which one to install rather than failing at import.

**Consequences.** Switching vendor is one environment variable, and no node knows
which one is in use. Two provider-specific details had to be absorbed rather than
abstracted away: current Claude models reject `temperature` outright — a request
carrying it returns a 400, not a warning — so it is omitted for those models and
determinism comes from the prompts; and Google names the output cap
`max_output_tokens` where the others use `max_tokens`. Both live in a table in one
file. Response flattening also had to become provider-aware: reasoning models
return content as a list of blocks including thinking blocks with no `text` field,
and stringifying those put their repr inside the JSON the caller then parses.
