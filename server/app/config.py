"""
Configuration classes for each runtime environment.
"""
import os
from datetime import timedelta

from dotenv import load_dotenv

load_dotenv()


def _split_csv(value: str | None) -> list[str]:
    """Parse a comma-separated environment variable into a clean list."""
    if not value:
        return []
    return [item.strip() for item in value.split(',') if item.strip()]


def _int_env(name: str, default: int) -> int:
    """Read an integer environment variable, falling back when malformed."""
    try:
        return int(os.environ.get(name, ''))
    except ValueError:
        return default


class Config:
    """Settings shared by every environment."""

    SECRET_KEY = os.environ.get('SECRET_KEY') or 'dev-secret-key-change-in-production'

    # Database
    SQLALCHEMY_DATABASE_URI = os.environ.get('DATABASE_URL') or 'sqlite:///querybot.db'
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ENGINE_OPTIONS = {
        'pool_pre_ping': True,
        'pool_recycle': 300,
    }

    # JWT
    JWT_SECRET_KEY = os.environ.get('JWT_SECRET_KEY') or 'jwt-secret-change-in-production'
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(minutes=_int_env('JWT_ACCESS_TOKEN_MINUTES', 60))
    JWT_REFRESH_TOKEN_EXPIRES = timedelta(days=_int_env('JWT_REFRESH_TOKEN_DAYS', 7))
    JWT_ALGORITHM = 'HS256'

    JWT_TOKEN_LOCATION = ['cookies']
    JWT_COOKIE_SECURE = False  # Overridden in production, which requires HTTPS.
    JWT_COOKIE_HTTPONLY = True
    JWT_COOKIE_SAMESITE = 'Lax'
    JWT_ACCESS_COOKIE_NAME = 'access_token'
    JWT_REFRESH_COOKIE_NAME = 'refresh_token'
    JWT_ACCESS_COOKIE_PATH = '/'
    JWT_REFRESH_COOKIE_PATH = '/'
    JWT_COOKIE_CSRF_PROTECT = False

    BCRYPT_LOG_ROUNDS = 12
    PROPAGATE_EXCEPTIONS = True

    CORS_ORIGINS = _split_csv(os.environ.get('CORS_ORIGINS')) or [
        'http://localhost:5173',
        'http://127.0.0.1:5173',
    ]

    # LangGraph agent
    LANGSMITH_API_KEY = os.environ.get('LANGSMITH_API_KEY')
    LANGGRAPH_API_URL = os.environ.get('LANGGRAPH_API_URL', 'http://localhost:8000')
    LANGGRAPH_ASSISTANT_ID = os.environ.get('LANGGRAPH_ASSISTANT_ID', 'agent')

    # SQLite dataset service
    SQLITE_SERVICE_URL = os.environ.get('SQLITE_SERVICE_URL', 'http://localhost:3001')
    # Shared secret presented to the SQLite service; it never reaches the browser.
    SERVICE_TOKEN = os.environ.get('SERVICE_TOKEN', '')
    SQLITE_SERVICE_TIMEOUT = _int_env('SQLITE_SERVICE_TIMEOUT', 120)

    MAX_CONTENT_LENGTH = _int_env('MAX_UPLOAD_BYTES', 100 * 1024 * 1024)

    LOG_LEVEL = os.environ.get('LOG_LEVEL', 'INFO')

    # Cache and rate-limit backend. Optional: without it the cache is a no-op
    # and rate limits are enforced per worker process rather than globally.
    REDIS_URL = os.environ.get('REDIS_URL')

    # Cache lifetimes, in seconds. A dataset's schema is immutable once
    # uploaded, so it can be held for the full retention window.
    SCHEMA_CACHE_TTL = _int_env('SCHEMA_CACHE_TTL', 4 * 60 * 60)
    PREVIEW_CACHE_TTL = _int_env('PREVIEW_CACHE_TTL', 30 * 60)

    # Rate limits. The analysis endpoint is the expensive one: each call makes
    # several paid LLM requests.
    RATELIMIT_ANALYSIS = os.environ.get('RATELIMIT_ANALYSIS', '20 per hour;5 per minute')
    RATELIMIT_QUERY = os.environ.get('RATELIMIT_QUERY', '120 per hour')
    RATELIMIT_UPLOAD = os.environ.get('RATELIMIT_UPLOAD', '30 per hour')
    RATELIMIT_AUTH = os.environ.get('RATELIMIT_AUTH', '10 per minute')


class DevelopmentConfig(Config):
    """Local development."""

    DEBUG = True
    TESTING = False


class ProductionConfig(Config):
    """Production deployment."""

    DEBUG = False
    TESTING = False

    SECRET_KEY = os.environ.get('SECRET_KEY')
    JWT_SECRET_KEY = os.environ.get('JWT_SECRET_KEY')

    # Behind a TLS-terminating proxy the app itself speaks HTTP, so this is
    # configurable rather than unconditionally true.
    JWT_COOKIE_SECURE = os.environ.get('JWT_COOKIE_SECURE', 'true').lower() == 'true'
    # Cross-site cookies require SameSite=None, which browsers only honour on HTTPS.
    JWT_COOKIE_SAMESITE = os.environ.get('JWT_COOKIE_SAMESITE', 'Lax')
    JWT_COOKIE_CSRF_PROTECT = os.environ.get('JWT_COOKIE_CSRF_PROTECT', 'true').lower() == 'true'

    CORS_ORIGINS = _split_csv(os.environ.get('CORS_ORIGINS'))

    @classmethod
    def validate(cls) -> None:
        """Refuse to start with settings that would silently weaken security."""
        problems = []

        if not cls.SECRET_KEY:
            problems.append('SECRET_KEY must be set')
        if not cls.JWT_SECRET_KEY:
            problems.append('JWT_SECRET_KEY must be set')
        if not cls.CORS_ORIGINS:
            problems.append('CORS_ORIGINS must list the allowed frontend origins')
        if '*' in cls.CORS_ORIGINS:
            problems.append('CORS_ORIGINS may not be "*" when cookies are used')
        if not cls.SERVICE_TOKEN:
            problems.append('SERVICE_TOKEN must be set to authenticate against the SQLite service')
        if cls.SQLALCHEMY_DATABASE_URI.startswith('sqlite'):
            problems.append('DATABASE_URL must point at a production database, not SQLite')

        if problems:
            raise RuntimeError(
                'Invalid production configuration:\n  - ' + '\n  - '.join(problems)
            )


class TestingConfig(Config):
    """Automated tests."""

    DEBUG = True
    TESTING = True
    SQLALCHEMY_DATABASE_URI = 'sqlite:///:memory:'
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(minutes=5)
    WTF_CSRF_ENABLED = False


config = {
    'development': DevelopmentConfig,
    'production': ProductionConfig,
    'testing': TestingConfig,
    'default': DevelopmentConfig,
}
