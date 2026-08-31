"""
Dataset service.

Owns the link between a user and the databases they have uploaded, so that every
query can be checked against the caller's identity.
"""
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from app.extensions import db
from app.models.dataset_model import Dataset
from app.services import sqlite_service
from app.utils.logging import get_logger

logger = get_logger(__name__)


def _parse_expiry(value: Optional[str]) -> Optional[datetime]:
    """Parse the ISO expiry reported by the dataset service."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        return None


def register_upload(user_id: str, file_storage) -> Dataset:
    """
    Upload a file to the dataset service and record the caller as its owner.

    The database row is written only after the upload succeeds, so a failed
    upload never leaves an orphaned ownership record.
    """
    payload = sqlite_service.upload_file(file_storage)

    tables = payload.get('tables') or []
    dataset = Dataset(
        external_uuid=uuid.UUID(payload['uuid']),
        user_id=uuid.UUID(str(user_id)),
        file_name=payload.get('fileName') or file_storage.filename or 'dataset',
        size_bytes=int(payload.get('sizeBytes') or 0),
        table_count=len(tables),
        row_count=sum(int(table.get('rowCount') or 0) for table in tables),
        expires_at=_parse_expiry(payload.get('expiresAt')),
    )
    dataset.save()

    logger.info(
        'Registered dataset %s for user %s (%d tables)',
        dataset.external_uuid,
        user_id,
        dataset.table_count,
    )
    return dataset


def add_file(dataset: Dataset, file_storage) -> dict:
    """
    Add another file to a dataset and refresh its recorded counts.

    Several files in one dataset is what makes cross-file questions work: they
    become tables in the same SQLite database, so the agent can JOIN them.
    """
    payload = sqlite_service.add_file(str(dataset.external_uuid), file_storage)

    tables = payload.get('tables') or []
    dataset.table_count = len(tables)
    dataset.row_count = sum(int(table.get('rowCount') or 0) for table in tables)
    dataset.size_bytes = int(payload.get('sizeBytes') or dataset.size_bytes)
    dataset.touch()
    db.session.commit()

    logger.info(
        'Added %s to dataset %s (now %d tables)',
        payload.get('fileName'),
        dataset.external_uuid,
        dataset.table_count,
    )
    return payload


def get_owned_dataset(user_id: str, dataset_uuid: str) -> Optional[Dataset]:
    """Return the dataset only if this user owns it."""
    return Dataset.find_for_user(dataset_uuid, user_id)


def list_datasets(user_id: str) -> list[Dataset]:
    return Dataset.list_for_user(user_id)


def touch(dataset: Dataset) -> None:
    """Mark a dataset as recently used and extend its displayed expiry."""
    dataset.touch()
    # The dataset service resets retention from the file's mtime on access; keep
    # the displayed expiry roughly in step rather than showing a stale time.
    if dataset.expires_at:
        dataset.expires_at = datetime.now(timezone.utc) + timedelta(hours=4)
    db.session.commit()


def delete_dataset(dataset: Dataset) -> None:
    """Delete the underlying file first, then the ownership record."""
    sqlite_service.delete_database(str(dataset.external_uuid))
    dataset.delete()
    logger.info('Deleted dataset %s', dataset.external_uuid)
