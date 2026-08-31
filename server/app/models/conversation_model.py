"""
Conversation and message models.

These give the app a memory: previous questions and their results are persisted,
so a user can revisit past analyses and the agent can be given prior turns as
context for follow-up questions.
"""
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

import sqlalchemy as sa

from app.extensions import db
from app.models.utils import to_uuid


class Conversation(db.Model):
    """A sequence of questions asked against one dataset."""

    __tablename__ = 'conversations'

    id = db.Column(sa.Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4, nullable=False)

    user_id = db.Column(
        sa.Uuid(as_uuid=True),
        db.ForeignKey('users.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
    )
    dataset_id = db.Column(
        sa.Uuid(as_uuid=True),
        db.ForeignKey('datasets.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
    )

    # Derived from the first question so the history list is readable at a glance.
    title = db.Column(db.String(200), nullable=False, default='New conversation')

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

    dataset = db.relationship('Dataset', back_populates='conversations')
    messages = db.relationship(
        'Message',
        back_populates='conversation',
        cascade='all, delete-orphan',
        passive_deletes=True,
        order_by='Message.created_at',
    )

    def __repr__(self) -> str:
        return f'<Conversation {self.title}>'

    def to_dict(self, include_messages: bool = False) -> dict:
        payload = {
            'id': str(self.id),
            'title': self.title,
            'dataset_id': str(self.dataset_id),
            'dataset_uuid': str(self.dataset.external_uuid) if self.dataset else None,
            'dataset_name': self.dataset.file_name if self.dataset else None,
            'message_count': len(self.messages),
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }
        if include_messages:
            payload['messages'] = [message.to_dict() for message in self.messages]
        return payload

    @staticmethod
    def build_title(question: str) -> str:
        """Trim a question down to a readable list entry."""
        cleaned = ' '.join((question or '').split())
        if not cleaned:
            return 'New conversation'
        return cleaned if len(cleaned) <= 80 else f'{cleaned[:77]}...'

    @classmethod
    def find_for_user(cls, conversation_id: str, user_id: str) -> Optional['Conversation']:
        parsed_id = to_uuid(conversation_id)
        parsed_user = to_uuid(user_id)
        if parsed_id is None or parsed_user is None:
            return None
        return cls.query.filter_by(id=parsed_id, user_id=parsed_user).first()

    @classmethod
    def list_for_user(cls, user_id: str, limit: int = 50) -> list['Conversation']:
        parsed_user = to_uuid(user_id)
        if parsed_user is None:
            return []

        return (
            cls.query.filter_by(user_id=parsed_user)
            .order_by(cls.updated_at.desc())
            .limit(limit)
            .all()
        )


class Message(db.Model):
    """A single turn: the user's question or the assistant's full response."""

    __tablename__ = 'messages'

    id = db.Column(sa.Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4, nullable=False)

    conversation_id = db.Column(
        sa.Uuid(as_uuid=True),
        db.ForeignKey('conversations.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
    )

    # 'user' | 'assistant' | 'error'
    role = db.Column(db.String(20), nullable=False)
    content = db.Column(db.Text, nullable=False, default='')

    # Assistant-only fields, null on user turns.
    sql_query = db.Column(db.Text, nullable=True)
    visualization = db.Column(db.String(50), nullable=True)
    # Presentation choices the user asked for - palette, sort, row limit. Stored
    # so styling accumulates over a conversation: "make it a pie chart" followed
    # by "now in green" has to keep the pie.
    chart_spec = db.Column(db.JSON, nullable=True)
    insights = db.Column(db.Text, nullable=True)
    data_narrative = db.Column(db.Text, nullable=True)
    formatted_table = db.Column(db.Text, nullable=True)
    # Chart PNG as base64. Stored as text so a result can be reopened later.
    chart_image_base64 = db.Column(db.Text, nullable=True)
    # Tabular results, kept as JSON for replay and re-export.
    result_rows = db.Column(db.JSON, nullable=True)
    result_columns = db.Column(db.JSON, nullable=True)
    error = db.Column(db.Text, nullable=True)
    duration_ms = db.Column(db.Integer, nullable=True)

    created_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    conversation = db.relationship('Conversation', back_populates='messages')

    def __repr__(self) -> str:
        return f'<Message {self.role}>'

    def to_dict(self) -> dict:
        payload: dict[str, Any] = {
            'id': str(self.id),
            'role': self.role,
            'content': self.content,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }

        # Omit null assistant fields so user turns stay compact on the wire.
        optional = {
            'sql_query': self.sql_query,
            'visualization': self.visualization,
            'chart_spec': self.chart_spec,
            'insights': self.insights,
            'data_narrative': self.data_narrative,
            'formatted_table': self.formatted_table,
            'chart_image_base64': self.chart_image_base64,
            'result_rows': self.result_rows,
            'result_columns': self.result_columns,
            'error': self.error,
            'duration_ms': self.duration_ms,
        }
        payload.update({key: value for key, value in optional.items() if value is not None})
        return payload
