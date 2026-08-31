"""
Rate limiting.

The analysis endpoint calls a paid LLM several times per question, so an
unthrottled caller can run up real cost and exhaust the provider quota for
everyone. Limits are keyed by authenticated user where possible, falling back to
client IP for anonymous traffic.
"""
from flask import request
from flask_jwt_extended import get_jwt_identity, verify_jwt_in_request
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

from app.utils.logging import get_logger
from app.utils.responses import error_response

logger = get_logger(__name__)


def _rate_limit_key() -> str:
    """
    Identify the caller.

    Keying on the user means one person cannot multiply their allowance by
    changing IP, and shared-NAT users are not throttled as a group.
    """
    try:
        verify_jwt_in_request(optional=True)
        identity = get_jwt_identity()
        if identity:
            return f'user:{identity}'
    except Exception:  # noqa: BLE001 - an unreadable token just falls back to IP
        pass

    return f'ip:{get_remote_address()}'


limiter = Limiter(
    key_func=_rate_limit_key,
    # Applied to every endpoint unless overridden, as a backstop against
    # scripted abuse of the cheaper routes.
    default_limits=['600 per hour'],
    strategy='fixed-window',
    headers_enabled=True,
)


def init_rate_limiting(app) -> None:
    """Attach the limiter, using Redis when available."""
    redis_url = app.config.get('REDIS_URL')

    if redis_url:
        app.config['RATELIMIT_STORAGE_URI'] = redis_url
    else:
        # In-memory counters are per-process, so several gunicorn workers each
        # enforce their own copy of the limit. Acceptable for local development;
        # Redis is what makes the limit correct across workers.
        logger.warning('No REDIS_URL set: rate limits are per-process and approximate')

    app.config.setdefault('RATELIMIT_HEADERS_ENABLED', True)
    limiter.init_app(app)

    @app.errorhandler(429)
    def too_many_requests(error):
        logger.warning('Rate limit exceeded by %s on %s', _rate_limit_key(), request.path)
        return error_response(
            'You are sending requests too quickly. Please wait a moment and try again.',
            429,
        )
