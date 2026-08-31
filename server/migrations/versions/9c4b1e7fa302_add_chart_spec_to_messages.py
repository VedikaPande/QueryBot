"""Add chart_spec to messages

Records the presentation choices a user asked for - chart type, palette, sort and
row limit - so a follow-up turn can build on them instead of resetting them.

Revision ID: 9c4b1e7fa302
Revises: 86aed14377db
Create Date: 2026-08-18 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '9c4b1e7fa302'
down_revision = '86aed14377db'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('messages', schema=None) as batch_op:
        batch_op.add_column(sa.Column('chart_spec', sa.JSON(), nullable=True))


def downgrade():
    with op.batch_alter_table('messages', schema=None) as batch_op:
        batch_op.drop_column('chart_spec')
