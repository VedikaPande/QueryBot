"""
Model package.

Importing every model here guarantees they are registered on the SQLAlchemy
metadata before Alembic autogenerates a migration; a model that is only imported
lazily at request time is invisible to autogenerate and gets silently omitted.
"""
from app.models.conversation_model import Conversation, Message
from app.models.dashboard_model import Dashboard, DashboardTile
from app.models.dataset_model import Dataset
from app.models.user_model import User

__all__ = ['User', 'Dataset', 'Conversation', 'Message', 'Dashboard', 'DashboardTile']
