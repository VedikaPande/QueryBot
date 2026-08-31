# QueryBot

[![CI](https://github.com/VedikaPande/QueryBot/actions/workflows/ci.yml/badge.svg)](https://github.com/VedikaPande/QueryBot/actions/workflows/ci.yml)
[![License: ISC](https://img.shields.io/badge/license-ISC-blue.svg)](#licence)

> Ask questions about your data in plain English and get answers, charts and SQL back.

Upload a CSV or SQLite database, ask a question the way you would ask a colleague,
and QueryBot writes the SQL, runs it, explains the result, draws a chart and shows
you the query it used — which you can edit and re-run yourself.

**Built for** analysts, product managers and anyone who has data but would rather not
write SQL to interrogate it.

## Features

**It understands your data before you ask.** Upload a file and it is profiled
immediately, in SQL: inferred column types, what is missing, cardinality,
distributions, outliers, duplicate rows, and which numeric columns move together.
Plain-language highlights call out what matters — a column that is 34% empty, one
that holds a single value throughout, a distribution skewed enough that the median
is the fairer summary. No model call, so it is instant and exact.

**It recovers from its own mistakes.** When generated SQL fails, the database's
error message is fed back to the model and the query is rewritten, up to twice.
A wrong column name or a text/number mismatch — the most common failures — get
fixed instead of landing in your lap as `no such column: revenu`. This is the
mechanism [research on text-to-SQL](https://arxiv.org/html/2510.09014v1) credits
for most of the accuracy gains on real databases.

**It tells you what to ask next.** Every answer comes with three follow-ups
derived from the actual result, and every correlation found during profiling is
clickable as a question. An answer raises the next question; the tool follows.

**It warns you when a number is misleading.** Computed caveats sit above the
answer: that a total covers 2 of 4 rows because the rest are null, that one
extreme value is skewing an average, that the result hit the row cap and may be
incomplete.

**You can talk to the chart.** "Make it a pie chart", "use warmer colours",
"top 5 only" — these change the answer you are already looking at instead of
asking the data again. The previous query is re-executed rather than rewritten, so
the numbers cannot drift between the two charts, and the turn costs one
classification call instead of six. Styling accumulates: ask for a pie chart, then
for green, and you get a green pie chart.

**Findings don't evaporate.** Pin any result to a dashboard, resize and reorder
the tiles, switch a tile between its chart, table and answer — then share the
whole thing with a link that works without an account. The shared view is a
different payload, not the same one hidden in the UI: the SQL, the message ids and
every account detail are stripped server-side, and revoking a link takes effect
immediately.

Also:

- **Multi-turn conversations** — "now break that down by region" resolves against earlier turns, and edits the previous query rather than starting over
- **Four model providers** — Groq, OpenAI, Anthropic or Google, selected with one environment variable
- **Query history** — every analysis is saved with its chart, SQL and rows, and can be reopened
- **See and edit the SQL** — correct the generated query and re-run it instantly, with no model call
- **Automatic charts** — bar, line, pie, scatter, histogram, box and heatmap, chosen to fit the result
- **Exports** — CSV, Excel, JSON, Markdown, PNG and a formatted PDF report
- **Light and dark themes** — follows your system preference
- **Read-only by construction** — only single `SELECT`/`WITH` statements execute, against a read-only handle

## Architecture

```
                  ┌──────────────────┐
                  │   React client   │  :5173
                  └────────┬─────────┘
                           │  cookies (httpOnly JWT)
                  ┌────────▼─────────┐
                  │    Flask API     │  :5000
                  │  auth · history  │
                  │    ownership     │
                  └───┬──────────┬───┘
        service token │          │ service token
              ┌───────▼──┐   ┌───▼──────────────┐
              │  SQLite  │◄──┤ LangGraph agent  │  :8000
              │  service │   │  SQL · charts    │
              │   :3001  │   │    insights      │
              └──────────┘   └────────┬─────────┘
                                      │
                              ┌───────▼────────┐
                              │ Docker sandbox │
                              │ chart renderer │
                              └────────────────┘
```

The browser only ever talks to the Flask API. It authenticates the user, checks
that they own the dataset in question, and proxies to the internal services using
a shared service token. Neither the SQLite service nor the agent is meant to be
reachable from the public internet.

| Service | Stack | Responsibility | Port |
|---------|-------|----------------|------|
| **Client** | React 19, TypeScript, Vite 8, Tailwind 4 | Interface | 5173 |
| **Flask API** | Flask, SQLAlchemy, JWT | Auth, ownership, history, proxying | 5000 |
| **SQLite service** | Node, Express 5, better-sqlite3 | Dataset storage and read-only queries | 3001 |
| **LangGraph agent** | Python, LangGraph, Groq/OpenAI/Anthropic/Gemini | NL→SQL, charts, insights | 8000 |

## Security model

- Every data endpoint requires an authenticated user.
- Datasets are owned by the user who uploaded them; ownership is checked on every read.
- The SQLite service accepts only single, read-only `SELECT`/`WITH` statements. `ATTACH`, `PRAGMA` and `load_extension` are rejected, and the database is opened read-only.
- Dataset identifiers must be well-formed UUIDs and are confined to the uploads directory before touching the filesystem.
- Internal services require a shared `SERVICE_TOKEN`; production refuses to start without one.
- Generated chart code runs in a container with no network, capped memory and CPU, and a non-root user.
- Uploads are deleted automatically after a retention window (4 hours by default).

## Tech stack

![React](https://img.shields.io/badge/React_19-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white)
![Tailwind](https://img.shields.io/badge/Tailwind_4-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)
![Redux](https://img.shields.io/badge/Redux_Toolkit-593D88?style=for-the-badge&logo=redux&logoColor=white)

![Flask](https://img.shields.io/badge/Flask-000000?style=for-the-badge&logo=flask&logoColor=white)
![Python](https://img.shields.io/badge/Python_3.12+-3776AB?style=for-the-badge&logo=python&logoColor=white)
![Node](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express_5-000000?style=for-the-badge&logo=express&logoColor=white)

![LangChain](https://img.shields.io/badge/LangGraph-121212?style=for-the-badge&logo=chainlink&logoColor=white)
![Groq](https://img.shields.io/badge/Groq-F55036?style=for-the-badge&logo=groq&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white)

## Quick start

> **⚠️ Need help?** Check the [SETUP.md](./SETUP.md) for detailed installation guide, troubleshooting, and configuration options.
 <img width="1919" height="998" alt="Screenshot 2025-11-14 223617" src="https://github.com/user-attachments/assets/762264f8-48c1-4472-8e08-392adf325366" />

<img width="1919" height="996" alt="Screenshot 2025-11-14 224011" src="https://github.com/user-attachments/assets/7e9fb0fc-2f1f-48dc-8739-c794553d2c0e" />

<img width="1891" height="995" alt="Screenshot 2025-11-14 224055" src="https://github.com/user-attachments/assets/11597fff-d011-4d3c-b541-0bcb317b5cb5" />
<img width="1918" height="989" alt="Screenshot 2025-11-14 224117" src="https://github.com/user-attachments/assets/075684ff-13eb-4688-996a-6b08224ed8dd" />
<img<img width="1919" height="988" alt="Screenshot 2025-11-14 224227" src="https://github.com/user-attachments/assets/525613d7-96d8-4e2b-a4b8-8987ae8b99e0" />
<i<img width="1919" height="988" alt="Screenshot 2025-11-14 224227" src="https://github.com/user-attachments/assets/18f9c8d6-f654-4c96-99e7-82a437e87ae4" />
<img width="1919" height="988" alt="Screenshot 2025-11-14 224227" src="https://github.com/user-attachments/assets/9bbcd0b5-a5b9-460c-bd62-668bf3fda0c2" />


 
