"""
Pending-migration detection.

Without this a schema change is invisible until a request happens to touch a
table that does not exist yet: the app boots cleanly, then returns a 500 with
`no such table: dashboards` from somewhere deep in SQLAlchemy. The cause is
obvious in hindsight and baffling in the moment.

Checked once at startup so the message arrives where it is useful — before any
request — and names the command that fixes it.
"""
import sys

from alembic.script import ScriptDirectory
from sqlalchemy import inspect, text

from app.extensions import db
from app.utils.logging import get_logger

logger = get_logger(__name__)

# `flask db upgrade` builds the app in order to run migrations, so the check has
# to stay out of the way of the very command it recommends.
_MIGRATION_COMMANDS = {'db', 'upgrade', 'downgrade', 'migrate', 'revision', 'stamp'}


def _is_running_migrations() -> bool:
    return any(argument in _MIGRATION_COMMANDS for argument in sys.argv[1:])


def check_pending_migrations(app) -> None:
    """
    Compare the database's Alembic revision with the latest on disk.

    Logs a prominent warning in development. In production a mismatch means the
    deploy skipped its migration step, which will fail unpredictably under load,
    so it is fatal instead.
    """
    if _is_running_migrations() or app.config.get('TESTING'):
        return

    try:
        with app.app_context():
            migrate = app.extensions.get('migrate')
            if migrate is None:
                return

            script = ScriptDirectory(str(migrate.directory))
            head = script.get_current_head()

            inspector = inspect(db.engine)
            if not inspector.has_table('alembic_version'):
                _report(
                    app,
                    'The database has no schema yet.',
                    'Create it with:  flask --app main.py db upgrade',
                )
                return

            current = db.session.execute(text('SELECT version_num FROM alembic_version')).scalar()

            if current == head:
                logger.debug('Database schema is up to date (%s)', current)
                return

            pending = _describe_pending(script, current, head)
            _report(
                app,
                f'The database is at revision {current}, but the code expects {head}.'
                + (f' Missing: {pending}.' if pending else ''),
                'Apply it with:  flask --app main.py db upgrade',
            )
    except Exception as exc:  # noqa: BLE001
        # A diagnostic must never be the reason the app will not start.
        logger.debug('Could not verify the database schema: %s', exc)


def _describe_pending(script: ScriptDirectory, current: str | None, head: str | None) -> str:
    """Name the revisions between the database and the code, for the message."""
    try:
        return ', '.join(
            revision.doc or revision.revision
            for revision in script.iterate_revisions(head, current)
        )
    except Exception:  # noqa: BLE001
        return ''


def _report(app, problem: str, remedy: str) -> None:
    """Warn loudly in development; refuse to start in production."""
    if app.config.get('DEBUG') or app.config.get('ENV') == 'development':
        banner = '=' * 72
        logger.warning('\n%s\nPENDING DATABASE MIGRATION\n%s\n%s\n\n%s\n%s',
                       banner, banner, problem, remedy, banner)
        return

    raise RuntimeError(f'{problem} {remedy}')
