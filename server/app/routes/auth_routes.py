"""
Authentication routes.

Tokens are delivered as httpOnly cookies rather than in the response body, so
client-side script can never read them. The service layer produces the JSON; the
handlers here only attach or clear the cookies.
"""
from flask import Blueprint, make_response, request

from flask_jwt_extended import (
    create_access_token,
    create_refresh_token,
    get_jwt_identity,
    jwt_required,
    set_access_cookies,
    set_refresh_cookies,
    unset_jwt_cookies,
)

from app.schemas.user_schema import user_response_schema
from app.services.auth_service import AuthService
from app.utils.logging import get_logger
from app.utils.responses import error_response, success_response

logger = get_logger(__name__)

auth_bp = Blueprint('auth', __name__, url_prefix='/api/auth')


def _with_cookies(flask_response, status_code: int, user_id: str):
    """Reissue a service response with fresh access and refresh cookies."""
    response = make_response(flask_response.get_data(), status_code)
    response.content_type = 'application/json'
    set_access_cookies(response, create_access_token(identity=str(user_id)))
    set_refresh_cookies(response, create_refresh_token(identity=str(user_id)))
    return response


def _current_user():
    """The signed-in user, or an error response explaining why there is none."""
    user = AuthService.get_user_by_id(get_jwt_identity())

    if not user:
        return None, error_response('User not found', 404)
    if not user.is_active:
        return None, error_response('Account is deactivated', 403)

    return user, None


@auth_bp.route('/signup', methods=['POST'])
def signup():
    """Register an account and sign the new user in."""
    data = request.get_json(silent=True)
    if not data:
        return error_response('Request must contain JSON data', 400)

    try:
        flask_response, status_code = AuthService.register_user(data)
        if status_code != 201:
            return flask_response, status_code

        user = flask_response.get_json()['data']['user']
        return _with_cookies(flask_response, status_code, user['id'])
    except Exception:  # noqa: BLE001
        logger.exception('Signup failed')
        return error_response('Registration failed. Please try again.', 500)


@auth_bp.route('/login', methods=['POST'])
def login():
    """Authenticate and set the session cookies."""
    data = request.get_json(silent=True)
    if not data:
        return error_response('Request must contain JSON data', 400)

    try:
        flask_response, status_code = AuthService.login_user(data)
        if status_code != 200:
            return flask_response, status_code

        user = flask_response.get_json()['data']['user']
        return _with_cookies(flask_response, status_code, user['id'])
    except Exception:  # noqa: BLE001
        logger.exception('Login failed')
        return error_response('Login failed. Please try again.', 500)


@auth_bp.route('/refresh', methods=['POST'])
@jwt_required(refresh=True)
def refresh():
    """Issue a new access cookie from the refresh cookie."""
    try:
        user, failure = _current_user()
        if failure:
            # A deleted or deactivated account must not keep refreshing.
            logger.warning('Refresh rejected for user %s', get_jwt_identity())
            return error_response('Invalid refresh token', 401)

        flask_response, status_code = success_response(
            'Token refreshed successfully', {'message': 'Access token refreshed'}
        )

        response = make_response(flask_response.get_data(), status_code)
        response.content_type = 'application/json'
        set_access_cookies(response, create_access_token(identity=str(user.id)))
        return response
    except Exception:  # noqa: BLE001
        logger.exception('Token refresh failed')
        return error_response('Token refresh failed. Please try again.', 401)


@auth_bp.route('/profile', methods=['GET'])
@jwt_required()
def get_profile():
    """Return the signed-in user's profile."""
    user, failure = _current_user()
    if failure:
        return failure

    return success_response('Profile retrieved successfully', {'user': user_response_schema.dump(user)})


@auth_bp.route('/check', methods=['GET'])
@jwt_required()
def check_auth():
    """Confirm the session is still valid, and return the user with it."""
    user, failure = _current_user()
    if failure:
        return failure

    return success_response('Authentication valid', {'user': user_response_schema.dump(user)})


@auth_bp.route('/logout', methods=['POST'])
@jwt_required()
def logout():
    """Clear the session cookies."""
    flask_response, status_code = success_response('Logged out successfully')

    response = make_response(flask_response.get_data(), status_code)
    response.content_type = 'application/json'
    unset_jwt_cookies(response)
    return response
