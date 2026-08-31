# ---------------------------------------------------------------------------
# Build stage
# ---------------------------------------------------------------------------
FROM python:3.12-slim AS builder

# uv resolves and installs far faster than pip and honours the committed
# lockfile. Installed from PyPI rather than copied from ghcr.io/astral-sh/uv so
# the build needs only one registry; some networks cannot reach ghcr.io.
RUN pip install --no-cache-dir uv==0.9.6

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never

WORKDIR /app

# psycopg2 needs libpq and a compiler at build time only.
RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Install dependencies from the lockfile before copying source, so a code change
# does not invalidate the dependency layer.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev

COPY . .
RUN uv sync --frozen --no-dev

# ---------------------------------------------------------------------------
# Runtime stage
# ---------------------------------------------------------------------------
FROM python:3.12-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app

# libpq is needed at runtime; the compiler is not.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libpq5 curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 1000 appuser

COPY --from=builder --chown=appuser:appuser /app /app

USER appuser
EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
    CMD curl --fail --silent http://localhost:5000/health || exit 1

# gevent workers, not sync: the analysis endpoint holds a Server-Sent Events
# connection open for the duration of a run, which would tie up a sync worker
# and block every other request behind it.
CMD ["gunicorn", \
     "--bind", "0.0.0.0:5000", \
     "--worker-class", "gevent", \
     "--workers", "2", \
     "--worker-connections", "100", \
     "--timeout", "300", \
     "--access-logfile", "-", \
     "--error-logfile", "-", \
     "main:app"]
