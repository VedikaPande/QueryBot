"""
Standardised API response envelope.

Every response carries ``success``, ``message`` and optionally ``data``. The
previous envelope used a ``status`` string, which did not match the ``success``
boolean the frontend's types declared - the mismatch was invisible only because
the client read ``data`` directly.
"""
from typing import Any, Optional

from flask import jsonify


def success_response(
    message: str,
    data: Optional[Any] = None,
    status_code: int = 200,
) -> tuple:
    """Build a success envelope."""
    payload: dict[str, Any] = {'success': True, 'message': message}
    if data is not None:
        payload['data'] = data
    return jsonify(payload), status_code


def error_response(
    message: str,
    status_code: int = 400,
    errors: Optional[dict[str, Any]] = None,
) -> tuple:
    """Build an error envelope."""
    payload: dict[str, Any] = {'success': False, 'message': message}
    if errors is not None:
        payload['errors'] = errors
    return jsonify(payload), status_code


def validation_error_response(errors: dict[str, Any]) -> tuple:
    return error_response('Validation failed', 422, errors)


def unauthorized_response(message: str = 'Unauthorized access') -> tuple:
    return error_response(message, 401)


def forbidden_response(message: str = 'Forbidden') -> tuple:
    return error_response(message, 403)


def not_found_response(message: str = 'Resource not found') -> tuple:
    return error_response(message, 404)


def conflict_response(message: str = 'Resource conflict') -> tuple:
    return error_response(message, 409)


def internal_server_error_response(message: str = 'Internal server error') -> tuple:
    return error_response(message, 500)
