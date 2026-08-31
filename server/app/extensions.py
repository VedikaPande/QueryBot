"""
Extensions initialization module.
Centralizes the initialization of all Flask extensions.
"""
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from flask_jwt_extended import JWTManager
from sqlalchemy import event
from sqlalchemy.engine import Engine
import bcrypt

# Initialize extensions
db = SQLAlchemy()
migrate = Migrate()
jwt = JWTManager()


@event.listens_for(Engine, 'connect')
def _enforce_sqlite_foreign_keys(dbapi_connection, _connection_record):
    """
    Turn on foreign-key enforcement for SQLite connections.

    SQLite ships with `PRAGMA foreign_keys` OFF, so every `ondelete='CASCADE'` in
    the models is silently inert on it. PostgreSQL enforces them, which means
    deleting a user cascaded correctly in production while leaving orphaned
    datasets, conversations and dashboard tiles behind in local development and
    tests — the environment where the behaviour would be noticed.
    """
    # Identified by capability rather than by importing the sqlite3 module, so
    # this also covers alternative drivers and leaves other engines untouched.
    if type(dbapi_connection).__module__.startswith('sqlite3'):
        cursor = dbapi_connection.cursor()
        cursor.execute('PRAGMA foreign_keys=ON')
        cursor.close()


def init_extensions(app):
    """Initialize all extensions with the Flask app."""
    db.init_app(app)
    migrate.init_app(app, db)
    jwt.init_app(app)

    # JWT failures use the same envelope as every other response so the client
    # can handle them uniformly.
    @jwt.expired_token_loader
    def expired_token_callback(_jwt_header, _jwt_payload):
        return {'success': False, 'message': 'Token has expired'}, 401

    @jwt.invalid_token_loader
    def invalid_token_callback(_error):
        return {'success': False, 'message': 'Invalid token'}, 401

    @jwt.unauthorized_loader
    def missing_token_callback(_error):
        return {'success': False, 'message': 'Authorization token is required'}, 401

    @jwt.revoked_token_loader
    def revoked_token_callback(_jwt_header, _jwt_payload):
        return {'success': False, 'message': 'Token has been revoked'}, 401


def hash_password(password: str) -> str:
    """Hash a password using bcrypt."""
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')


def check_password(password: str, hashed: str) -> bool:
    """Check if password matches the hashed password."""
    return bcrypt.checkpw(password.encode('utf-8'), hashed.encode('utf-8'))