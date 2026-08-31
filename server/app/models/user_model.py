"""
The user account.
"""
import uuid
from datetime import datetime, timezone
from typing import Optional

import sqlalchemy as sa

from app.extensions import db


class User(db.Model):
    """An authenticated account."""

    __tablename__ = 'users'

    # sa.Uuid renders as a native UUID on PostgreSQL and CHAR(32) elsewhere, so
    # the same model works against the SQLite development database.
    id = db.Column(
        sa.Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        unique=True,
        nullable=False
    )

    fullname = db.Column(db.String(100), nullable=False)
    email = db.Column(db.String(255), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)

    created_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False
    )
    updated_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False
    )

    is_active = db.Column(db.Boolean, default=True, nullable=False)

    def __init__(self, fullname: str, email: str, password_hash: str):
        self.fullname = fullname
        # Normalised on the way in so lookups can match exactly.
        self.email = email.lower().strip()
        self.password_hash = password_hash

    def __repr__(self):
        return f'<User {self.email}>'

    def to_dict(self) -> dict:
        """Serialise for the API, without the password hash."""
        return {
            'id': str(self.id),
            'fullname': self.fullname,
            'email': self.email,
            'created_at': self.created_at.isoformat(),
            'updated_at': self.updated_at.isoformat(),
            'is_active': self.is_active
        }

    @classmethod
    def find_by_email(cls, email: str) -> Optional['User']:
        return cls.query.filter_by(email=email.lower().strip()).first()

    @classmethod
    def find_by_id(cls, user_id: str) -> Optional['User']:
        """
        Find a user by ID.

        The identifier is parsed before it reaches the query: passing a malformed
        string straight to the driver raises a DataError that surfaces as a 500
        rather than a clean "not found".
        """
        try:
            parsed = uuid.UUID(str(user_id))
        except (ValueError, AttributeError, TypeError):
            return None
        return cls.query.filter_by(id=parsed).first()

    def update_last_login(self):
        self.updated_at = datetime.now(timezone.utc)
        db.session.commit()

    def save(self):
        db.session.add(self)
        db.session.commit()

    def delete(self):
        db.session.delete(self)
        db.session.commit()