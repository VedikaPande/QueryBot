"""
Dataset model.

Records which user owns each database uploaded to the SQLite service. Without
this, any authenticated caller could query any dataset simply by supplying its
identifier - the identifier was the only thing standing between users' data.
"""
import uuid
from datetime import datetime, timezone
from typing import Optional

import sqlalchemy as sa

from app.extensions import db
from app.models.utils import to_uuid


class Dataset(db.Model):
    """An uploaded database owned by a single user."""

    __tablename__ = 'datasets'

    id = db.Column(sa.Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4, nullable=False)

    # Identifier assigned by the SQLite service; the handle used for querying.
    external_uuid = db.Column(sa.Uuid(as_uuid=True), unique=True, nullable=False, index=True)

    user_id = db.Column(
        sa.Uuid(as_uuid=True),
        db.ForeignKey('users.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
    )

    file_name = db.Column(db.String(255), nullable=False)
    size_bytes = db.Column(db.BigInteger, nullable=False, default=0)
    table_count = db.Column(db.Integer, nullable=False, default=0)
    row_count = db.Column(db.BigInteger, nullable=False, default=0)

    created_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    last_used_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    # Mirrors the SQLite service's retention window so the UI can warn before expiry.
    expires_at = db.Column(db.DateTime(timezone=True), nullable=True)

    conversations = db.relationship(
        'Conversation',
        back_populates='dataset',
        cascade='all, delete-orphan',
        passive_deletes=True,
    )

    def __repr__(self) -> str:
        return f'<Dataset {self.file_name} ({self.external_uuid})>'

    def to_dict(self) -> dict:
        return {
            'id': str(self.id),
            'uuid': str(self.external_uuid),
            'file_name': self.file_name,
            'size_bytes': self.size_bytes,
            'table_count': self.table_count,
            'row_count': self.row_count,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'last_used_at': self.last_used_at.isoformat() if self.last_used_at else None,
            'expires_at': self.expires_at.isoformat() if self.expires_at else None,
        }

    def touch(self) -> None:
        """Record that the dataset was used, without committing."""
        self.last_used_at = datetime.now(timezone.utc)

    @classmethod
    def find_for_user(cls, external_uuid: str, user_id: str) -> Optional['Dataset']:
        """
        Look up a dataset the given user owns.

        Returns ``None`` for a malformed identifier or one owned by someone else,
        so callers cannot distinguish "does not exist" from "not yours".
        """
        parsed_uuid = to_uuid(external_uuid)
        parsed_user = to_uuid(user_id)
        if parsed_uuid is None or parsed_user is None:
            return None

        return cls.query.filter_by(external_uuid=parsed_uuid, user_id=parsed_user).first()

    @classmethod
    def list_for_user(cls, user_id: str, limit: int = 50) -> list['Dataset']:
        """Most recently used datasets first."""
        parsed_user = to_uuid(user_id)
        if parsed_user is None:
            return []

        return (
            cls.query.filter_by(user_id=parsed_user)
            .order_by(cls.last_used_at.desc())
            .limit(limit)
            .all()
        )

    def save(self) -> None:
        db.session.add(self)
        db.session.commit()

    def delete(self) -> None:
        db.session.delete(self)
        db.session.commit()
