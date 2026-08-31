# ---------------------------------------------------------------------------
# Build stage
# ---------------------------------------------------------------------------
FROM python:3.12-slim AS builder

# Installed from PyPI rather than copied from ghcr.io/astral-sh/uv so the build
# needs only one registry; some networks cannot reach ghcr.io.
RUN pip install --no-cache-dir uv==0.9.6

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc g++ \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project

COPY . .
RUN uv sync --frozen

# ---------------------------------------------------------------------------
# Runtime stage
# ---------------------------------------------------------------------------
FROM python:3.12-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    MPLBACKEND=Agg \
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app

# No Docker CLI is installed. Charts render in-process from the deterministic
# template, which contains no untrusted code; only the model-written fallback
# needs the sandbox, and reaching the host daemon from here would require
# mounting its socket — effectively granting root on the host — plus matching the
# socket's gid. Run the agent natively if you need that fallback.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 1000 appuser

COPY --from=builder --chown=appuser:appuser /app /app

RUN mkdir -p /app/generated_charts && chown appuser:appuser /app/generated_charts

USER appuser
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl --fail --silent http://localhost:8000/ok || exit 1

CMD ["langgraph", "dev", "--host", "0.0.0.0", "--port", "8000", "--no-browser"]
