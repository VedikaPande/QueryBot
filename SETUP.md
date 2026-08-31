# QueryBot setup guide

Everything you need to run QueryBot locally, plus what changes for production.

> **Just want it running?** Use Docker instead of the steps below:
>
> ```bash
> make setup     # writes .env with generated secrets
> # add your GROQ_API_KEY to .env
> make up        # http://localhost:8080
> ```
>
> The rest of this guide covers running the four services natively, which is
> what you want when developing one of them.

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| [Node.js](https://nodejs.org/) | 20+ | Client and SQLite service |
| [Python](https://www.python.org/downloads/) | 3.12+ | Flask API and agent |
| [uv](https://docs.astral.sh/uv/getting-started/installation/) | latest | Python dependency manager |
| [Docker](https://www.docker.com/products/docker-desktop) | optional | Chart rendering sandbox |
| [Groq API key](https://console.groq.com) | — | Required; the agent cannot run without it |

Without Docker the app still works — answers, tables and insights are unaffected —
but chart requests report that chart rendering is unavailable. Set
`CHART_DOCKER_ENABLED=false` to skip the Docker probe entirely.

Verify your toolchain:

```bash
node --version && python --version && uv --version && docker --version
```

## 1. Clone and install

```bash
git clone https://github.com/VedikaPande/QueryBot.git
cd QueryBot

cd client          && npm install && cd ..
cd sqlite_server   && npm install && cd ..
cd server          && uv sync     && cd ..
cd langgraph_agent && uv sync     && cd ..
```

## 2. Configure

Each service ships a `.env.example`. Copy it and fill in the values:

```bash
cp client/.env.example          client/.env
cp server/.env.example          server/.env
cp sqlite_server/.env.example   sqlite_server/.env
cp langgraph_agent/.env.example langgraph_agent/.env
```

### The three values that matter most

**`SERVICE_TOKEN`** — must be **identical** in `server/.env`, `sqlite_server/.env`
and `langgraph_agent/.env`. It is how the internal services authenticate to each
other. Generate one with:

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

**`SECRET_KEY` / `JWT_SECRET_KEY`** in `server/.env` — two *different* random
values. Production refuses to start if they are unset.

**A model provider key** in `langgraph_agent/.env`. Groq is the default because
it is the cheapest and fastest for this workload — get a key from
[console.groq.com](https://console.groq.com). To use another provider, set
`LLM_PROVIDER` and its key instead:

| `LLM_PROVIDER` | Key | Default model |
| --- | --- | --- |
| `groq` | `GROQ_API_KEY` | `openai/gpt-oss-120b` |
| `openai` | `OPENAI_API_KEY` | `gpt-5` |
| `anthropic` | `ANTHROPIC_API_KEY` | `claude-opus-5` |
| `google` | `GOOGLE_API_KEY` | `gemini-2.5-pro` |

Set `LLM_MODEL` to override the default. The agent refuses to start with a
message naming the variable if the selected provider's key is missing.

### Minimum working configuration

`server/.env`
```env
FLASK_ENV=development
SECRET_KEY=<random-48-chars>
JWT_SECRET_KEY=<a-different-random-48-chars>
DATABASE_URL=sqlite:///querybot.db
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
SQLITE_SERVICE_URL=http://localhost:3001
SERVICE_TOKEN=<shared-token>
LANGGRAPH_API_URL=http://localhost:8000
```

`sqlite_server/.env`
```env
PORT=3001
NODE_ENV=development
SERVICE_TOKEN=<the same shared token>
CORS_ORIGINS=http://localhost:5173
```

`langgraph_agent/.env`
```env
LLM_PROVIDER=groq
GROQ_API_KEY=<your key>
SQLITE_SERVICE_URL=http://localhost:3001
SERVICE_TOKEN=<the same shared token>
CHART_DOCKER_ENABLED=true
```

`client/.env`
```env
VITE_API_BASE_URL=http://localhost:5000/api
```

## 3. Create the database tables

```bash
cd server
uv run flask --app main.py db upgrade
cd ..
```

SQLite works out of the box for development. For PostgreSQL:

```sql
CREATE DATABASE querybot;
CREATE USER querybot_user WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE querybot TO querybot_user;
```

then set `DATABASE_URL=postgresql://querybot_user:your_password@localhost:5432/querybot`
and run the migration again.

## 4. Build the chart sandbox (optional)

Only needed for charts. The agent builds the image automatically on first use,
but you can do it ahead of time:

```bash
cd langgraph_agent
langgraph dev 
```
**Status**: Agent running on http://localhost:8000

#### Terminal 4: React Frontend
```bash
cd client
npm run dev
```
**Status**: Frontend running on http://localhost:5173

### Production Mode

#### 1. Build all services:

```bash
# Terminal 1 — SQLite dataset service
cd sqlite_server && npm run dev            # http://localhost:3001

# Terminal 2 — Flask API
cd server && uv run python main.py         # http://localhost:5000

# Terminal 3 — LangGraph agent
cd langgraph_agent && uv run langgraph dev --port 8000

# Terminal 4 — React client
cd client && npm run dev                   # http://localhost:5173
```

Open http://localhost:5173, create an account, upload a CSV and ask a question.

### Health checks

```bash
curl http://localhost:3001/health          # {"status":"ok",...}
curl http://localhost:5000/health          # {"status":"healthy"}
curl http://localhost:5000/api/langgraph/health
```

## Tests

```bash
cd sqlite_server   && npm test
cd server          && uv run pytest
cd langgraph_agent && uv run pytest
cd client          && npm run lint && npx tsc --noEmit -p tsconfig.app.json
```

## Production

Build the frontend and the SQLite service:

```bash
# Check Flask server
curl http://localhost:5000/health

# Check SQLite server
curl http://localhost:3001/health

# Check LangGraph agent
curl http://localhost:8000/health

# Check if frontend is accessible
curl http://localhost:5173
```

Expected responses should return status 200 with health information.

### API Keys Setup

#### Getting Groq API Key
1. Visit [console.groq.com](https://console.groq.com)
2. Sign up or log in
3. Navigate to API Keys section
4. Create a new API key
5. Copy and paste into `langgraph_agent/.env`

#### Getting LangSmith API Key
1. Visit [smith.langchain.com](https://smith.langchain.com)
2. Sign up or log in
3. Go to Settings > API Keys
4. Create a new API key
5. Copy and paste into `langgraph_agent/.env` and `server/.env`

---

**Congratulations! 🎉** Your QueryBot development environment should now be ready to use.
