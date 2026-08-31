"""
Flask application factory for the QueryBot server.
"""
import os

from flask import Flask
from flask_cors import CORS
from sqlalchemy import text

from app.config import config
from app.extensions import db, init_extensions
from app.utils.cache import init_cache
from app.utils.logging import configure_logging, get_logger
from app.utils.rate_limit import init_rate_limiting
from app.utils.schema_check import check_pending_migrations

logger = get_logger(__name__)


def create_app(config_name: str | None = None) -> Flask:
    """Build and configure the Flask application."""
    if config_name is None:
        config_name = os.environ.get('FLASK_ENV', 'development')

    config_class = config.get(config_name, config['default'])

    app = Flask(__name__)
    app.config.from_object(config_class)

    configure_logging(app)

    # Production settings are validated after loading so a misconfigured deploy
    # fails at startup rather than at the first request.
    if hasattr(config_class, 'validate'):
        config_class.validate()

    # Behind nginx, honour X-Forwarded-* so client IPs and the scheme are
    # correct. Without this every request appears to come from the proxy, which
    # would make IP-based rate limiting throttle all users as one.
    if app.config.get('TRUST_PROXY', not app.debug):
        from werkzeug.middleware.proxy_fix import ProxyFix

        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

    CORS(
        app,
        origins=app.config['CORS_ORIGINS'],
        allow_headers=['Content-Type', 'Authorization', 'X-Requested-With', 'X-CSRF-TOKEN'],
        supports_credentials=True,
        methods=['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
        expose_headers=['X-Conversation-Id'],
    )

    init_extensions(app)
    init_cache(app)
    init_rate_limiting(app)

    # Register every model on the metadata so Alembic autogenerate sees them all.
    from app import models  # noqa: F401

    register_blueprints(app)
    register_error_handlers(app)
    register_health_checks(app)

    # Surfaces a pending migration at startup rather than as an opaque
    # "no such table" 500 the first time a request touches a new table.
    check_pending_migrations(app)

    logger.info('Application started in %s mode', config_name)
    return app


def register_blueprints(app: Flask) -> None:
    """Register every blueprint. Imported here to avoid circular imports."""
    from app.routes.auth_routes import auth_bp
    from app.routes.conversation_routes import conversation_bp
    from app.routes.dashboard_routes import dashboard_bp, public_dashboard_bp
    from app.routes.dataset_routes import dataset_bp
    from app.routes.langgraph_routes import langgraph_bp
    from app.routes.meta_routes import meta_bp

    app.register_blueprint(auth_bp)
    app.register_blueprint(dataset_bp)
    app.register_blueprint(conversation_bp)
    app.register_blueprint(dashboard_bp)
    app.register_blueprint(public_dashboard_bp)
    app.register_blueprint(langgraph_bp)
    app.register_blueprint(meta_bp)


def register_health_checks(app: Flask) -> None:
    """Register the root and health endpoints."""

    @app.route('/')
    def index():
        return {'message': 'QueryBot API', 'status': 'running', 'version': '1.0.0'}

    @app.route('/health')
    def health():
        try:
            db.session.execute(text('SELECT 1'))
        except Exception as exc:  # noqa: BLE001
            logger.warning('Health check failed: %s', exc)
            return {'status': 'unhealthy', 'database': 'unavailable'}, 503

        return {'status': 'healthy', 'database': 'ok'}


def register_error_handlers(app: Flask) -> None:
    """Return the shared JSON envelope for framework-level errors."""
    from app.utils.responses import error_response

    @app.errorhandler(400)
    def bad_request(_error):
        return error_response('Bad request', 400)

    @app.errorhandler(401)
    def unauthorized(_error):
        return error_response('Unauthorized access', 401)

    @app.errorhandler(403)
    def forbidden(_error):
        return error_response('Forbidden', 403)

    @app.errorhandler(404)
    def not_found(_error):
        return error_response('Resource not found', 404)

    @app.errorhandler(405)
    def method_not_allowed(_error):
        return error_response('Method not allowed', 405)

    @app.errorhandler(413)
    def payload_too_large(_error):
        return error_response('The uploaded file is too large', 413)

    @app.errorhandler(422)
    def validation_error(_error):
        return error_response('Validation failed', 422)

    @app.errorhandler(500)
    def internal_error(error):
        # Log the cause; return a generic message so internals are not disclosed.
        logger.exception('Unhandled server error: %s', error)
        return error_response('Internal server error', 500)
