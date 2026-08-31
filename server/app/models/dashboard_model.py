"""
Dashboard models.

Answers are ephemeral by default: you ask, you read, you move on. Pinning a
result onto a dashboard turns a one-off question into something that persists and
can be shared, which is the difference between a chat toy and an analytics tool.

A tile references the `Message` that produced it rather than copying the chart and
rows. The message already stores everything needed to re-render — answer, SQL,
chart PNG, result rows — so a tile is a pointer plus presentation, and there is
exactly one copy of the truth.
"""
import secrets
import uuid
from datetime import datetime, timezone
from typing import Optional

import sqlalchemy as sa

from app.extensions import db
from app.models.utils import to_uuid

# Tile widths, as columns of a 12-column grid.
TILE_SIZES = ('small', 'medium', 'large', 'full')
TILE_SIZE_COLUMNS = {'small': 3, 'medium': 4, 'large': 6, 'full': 12}


class Dashboard(db.Model):
    """A named collection of pinned results belonging to one user."""

    __tablename__ = 'dashboards'

    id = db.Column(sa.Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4, nullable=False)

    user_id = db.Column(
        sa.Uuid(as_uuid=True),
        db.ForeignKey('users.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
    )

    title = db.Column(db.String(200), nullable=False, default='Untitled dashboard')
    description = db.Column(db.Text, nullable=True)

    # Public sharing.
    # A high-entropy token, not the dashboard id: the id appears in the owner's
    # own URLs and logs, so reusing it would make every dashboard guessable from
    # anywhere it had ever been mentioned. Null means sharing is off.
    share_token = db.Column(db.String(64), unique=True, nullable=True, index=True)
    shared_at = db.Column(db.DateTime(timezone=True), nullable=True)

    created_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    tiles = db.relationship(
        'DashboardTile',
        back_populates='dashboard',
        cascade='all, delete-orphan',
        passive_deletes=True,
        order_by='DashboardTile.position',
    )

    def __repr__(self) -> str:
        return f'<Dashboard {self.title}>'

    @property
    def is_shared(self) -> bool:
        return self.share_token is not None

    def enable_sharing(self) -> str:
        """Generate a share token, or return the existing one."""
        if not self.share_token:
            # 32 bytes url-safe: far beyond guessable, and safe in a URL.
            self.share_token = secrets.token_urlsafe(32)
            self.shared_at = datetime.now(timezone.utc)
        return self.share_token

    def disable_sharing(self) -> None:
        """Revoke the link. A new one is minted if sharing is re-enabled."""
        self.share_token = None
        self.shared_at = None

    def to_dict(self, include_tiles: bool = False, public: bool = False) -> dict:
        payload = {
            'id': str(self.id),
            'title': self.title,
            'description': self.description,
            'tile_count': len(self.tiles),
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }

        # Ownership and the token itself are withheld from public responses: a
        # viewer of a shared link should learn nothing about the account.
        if not public:
            payload['is_shared'] = self.is_shared
            payload['share_token'] = self.share_token
            payload['shared_at'] = self.shared_at.isoformat() if self.shared_at else None

        if include_tiles:
            payload['tiles'] = [tile.to_dict(public=public) for tile in self.tiles]

        return payload

    @classmethod
    def find_for_user(cls, dashboard_id: str, user_id: str) -> Optional['Dashboard']:
        parsed_id = to_uuid(dashboard_id)
        parsed_user = to_uuid(user_id)
        if parsed_id is None or parsed_user is None:
            return None
        return cls.query.filter_by(id=parsed_id, user_id=parsed_user).first()

    @classmethod
    def find_by_share_token(cls, token: str) -> Optional['Dashboard']:
        """Look up a publicly shared dashboard. No user context required."""
        if not token or len(token) > 64:
            return None
        return cls.query.filter_by(share_token=token).first()

    @classmethod
    def list_for_user(cls, user_id: str, limit: int = 50) -> list['Dashboard']:
        parsed_user = to_uuid(user_id)
        if parsed_user is None:
            return []
        return (
            cls.query.filter_by(user_id=parsed_user)
            .order_by(cls.updated_at.desc())
            .limit(limit)
            .all()
        )


class DashboardTile(db.Model):
    """One pinned result on a dashboard."""

    __tablename__ = 'dashboard_tiles'

    id = db.Column(sa.Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4, nullable=False)

    dashboard_id = db.Column(
        sa.Uuid(as_uuid=True),
        db.ForeignKey('dashboards.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
    )

    # The analysis this tile displays. Deleting the conversation removes the tile:
    # a tile whose source is gone has nothing to render.
    message_id = db.Column(
        sa.Uuid(as_uuid=True),
        db.ForeignKey('messages.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
    )

    # The question, captured at pin time so renaming stays local to the tile.
    title = db.Column(db.String(200), nullable=False, default='')
    # 'chart' | 'table' | 'answer' — which part of the result to show.
    view = db.Column(db.String(20), nullable=False, default='chart')
    size = db.Column(db.String(20), nullable=False, default='medium')
    position = db.Column(db.Integer, nullable=False, default=0)

    created_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    dashboard = db.relationship('Dashboard', back_populates='tiles')
    message = db.relationship('Message')

    def __repr__(self) -> str:
        return f'<DashboardTile {self.title[:30]}>'

    def to_dict(self, public: bool = False) -> dict:
        payload = {
            'id': str(self.id),
            'title': self.title,
            'view': self.view,
            'size': self.size,
            'columns': TILE_SIZE_COLUMNS.get(self.size, 4),
            'position': self.position,
        }

        message = self.message
        if message:
            payload['answer'] = message.content
            payload['chart_image_base64'] = message.chart_image_base64
            payload['result_rows'] = message.result_rows
            payload['result_columns'] = message.result_columns
            payload['visualization'] = message.visualization
            payload['created_at'] = message.created_at.isoformat() if message.created_at else None

            # The SQL is withheld publicly: it discloses the schema, and a shared
            # dashboard is meant to convey findings, not the data model.
            if not public:
                payload['sql_query'] = message.sql_query
                payload['message_id'] = str(message.id)

        return payload
