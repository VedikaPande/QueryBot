"""
Registration, login and token refresh.

Each method returns the ``(body, status)`` pair the routes hand back to Flask.
Tokens are set as cookies by the route, not here.
"""
from typing import Any, Dict, Optional, Tuple

from flask_jwt_extended import create_access_token
from marshmallow import ValidationError

from app.extensions import check_password, db, hash_password
from app.models.user_model import User
from app.schemas.user_schema import user_login_schema, user_response_schema, user_signup_schema
from app.utils.logging import get_logger
from app.utils.responses import (
    conflict_response,
    error_response,
    success_response,
    unauthorized_response,
    validation_error_response,
)

logger = get_logger(__name__)


class AuthService:
    """Authentication operations."""

    @staticmethod
    def register_user(data: Dict[str, Any]) -> Tuple[Dict, int]:
        """Create an account, or explain why it could not be created."""
        try:
            validated = user_signup_schema.load(data)
        except ValidationError as err:
            return validation_error_response(err.messages)

        if User.find_by_email(validated['email']):
            return conflict_response('Email already registered')

        try:
            user = User(
                fullname=validated['fullname'],
                email=validated['email'],
                password_hash=hash_password(validated['password']),
            )
            user.save()

            return success_response(
                message='User registered successfully',
                data={'user': user_response_schema.dump(user)},
                status_code=201,
            )
        except Exception:  # noqa: BLE001 - the cause is logged, not surfaced
            db.session.rollback()
            logger.exception('Registration failed for %s', validated['email'])
            return error_response('Registration failed. Please try again.', 500)

    @staticmethod
    def login_user(data: Dict[str, Any]) -> Tuple[Dict, int]:
        """Authenticate a user."""
        try:
            validated = user_login_schema.load(data)
        except ValidationError as err:
            return validation_error_response(err.messages)

        user = User.find_by_email(validated['email'])

        # The same message for an unknown email and a wrong password, so the
        # response cannot be used to discover which addresses are registered.
        if not user or not check_password(validated['password'], user.password_hash):
            return unauthorized_response('Invalid email or password')

        if not user.is_active:
            return unauthorized_response('Account is deactivated')

        try:
            user.update_last_login()
            return success_response(
                message='Login successful',
                data={'user': user_response_schema.dump(user)},
            )
        except Exception:  # noqa: BLE001
            logger.exception('Login failed for user %s', user.id)
            return error_response('Login failed. Please try again.', 500)

    @staticmethod
    def get_user_by_id(user_id: str) -> Optional[User]:
        return User.find_by_id(user_id)

    @staticmethod
    def refresh_token(user_id: str) -> Tuple[Dict, int]:
        """Issue a new access token for the holder of a valid refresh token."""
        user = User.find_by_id(user_id)
        if not user or not user.is_active:
            return unauthorized_response('Invalid refresh token')

        try:
            return success_response(
                message='Token refreshed successfully',
                data={
                    'access_token': create_access_token(identity=str(user.id)),
                    'token_type': 'Bearer',
                },
            )
        except Exception:  # noqa: BLE001
            logger.exception('Token refresh failed for user %s', user.id)
            return error_response('Token refresh failed. Please try again.', 500)
