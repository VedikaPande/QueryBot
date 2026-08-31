"""
Marshmallow schemas for user data validation and serialization.
"""
import re
from marshmallow import Schema, fields, validate, ValidationError


def validate_password_strength(password):
    """Validate password strength requirements."""
    if not re.search(r'[A-Z]', password):
        raise ValidationError('Password must contain at least one uppercase letter')
    if not re.search(r'[a-z]', password):
        raise ValidationError('Password must contain at least one lowercase letter')
    if not re.search(r'\d', password):
        raise ValidationError('Password must contain at least one number')
    if not re.search(r'[!@#$%^&*(),.?":{}|<>]', password):
        raise ValidationError('Password must contain at least one special character')


class UserSignupSchema(Schema):
    """Schema for user signup validation."""

    fullname = fields.Str(
        required=True,
        validate=[
            validate.Length(min=2, max=100, error="Fullname must be between 2 and 100 characters"),
            validate.Regexp(
                r'^[a-zA-Z\s\-\'\.]+$',
                error="Fullname can only contain letters, spaces, hyphens, apostrophes, and periods"
            )
        ],
        error_messages={'required': 'Fullname is required'}
    )

    email = fields.Email(
        required=True,
        validate=validate.Length(max=255, error="Email must be less than 255 characters"),
        error_messages={
            'required': 'Email is required',
            'invalid': 'Please enter a valid email address'
        }
    )

    password = fields.Str(
        required=True,
        validate=[
            validate.Length(min=8, max=128, error="Password must be between 8 and 128 characters"),
            validate_password_strength
        ],
        error_messages={'required': 'Password is required'}
    )

    confirm_password = fields.Str(
        required=True,
        error_messages={'required': 'Password confirmation is required'}
    )

    def load(self, json_data, *args, **kwargs):
        """Override load to add password confirmation validation."""
        data = super().load(json_data, *args, **kwargs)

        # Validate password confirmation
        if data.get('password') != data.get('confirm_password'):
            raise ValidationError({'confirm_password': ['Passwords do not match']})

        return data


class UserLoginSchema(Schema):
    """Schema for user login validation."""

    email = fields.Email(
        required=True,
        error_messages={
            'required': 'Email is required',
            'invalid': 'Please enter a valid email address'
        }
    )

    password = fields.Str(
        required=True,
        error_messages={'required': 'Password is required'}
    )


class UserResponseSchema(Schema):
    """Schema for user response serialization."""

    id = fields.Str(dump_only=True)
    fullname = fields.Str(dump_only=True)
    email = fields.Email(dump_only=True)
    created_at = fields.DateTime(dump_only=True)
    updated_at = fields.DateTime(dump_only=True)
    is_active = fields.Bool(dump_only=True)


class AuthResponseSchema(Schema):
    """Schema for authentication response."""

    user = fields.Nested(UserResponseSchema, dump_only=True)
    access_token = fields.Str(dump_only=True)
    refresh_token = fields.Str(dump_only=True, allow_none=True)
    token_type = fields.Str(dump_only=True)


# Initialize schema instances
user_signup_schema = UserSignupSchema()
user_login_schema = UserLoginSchema()
user_response_schema = UserResponseSchema()
auth_response_schema = AuthResponseSchema()