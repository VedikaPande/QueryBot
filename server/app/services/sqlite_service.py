"""
Client for the SQLite dataset service.

The browser never talks to that service directly. Every call passes through
here so user authentication and dataset ownership are enforced first, and so the
shared service token stays server-side.
"""
from typing import Any, Optional

import requests
from flask import current_app

from app.utils.logging import get_logger

logger = get_logger(__name__)


class SqliteServiceError(Exception):
    """Raised when the SQLite service is unreachable or rejects a request."""

    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _base_url() -> str:
    return str(current_app.config['SQLITE_SERVICE_URL']).rstrip('/')


def _headers() -> dict[str, str]:
    token = current_app.config.get('SERVICE_TOKEN')
    return {'Authorization': f'Bearer {token}'} if token else {}


def _timeout() -> int:
    return int(current_app.config.get('SQLITE_SERVICE_TIMEOUT', 120))


def _unwrap(response: requests.Response) -> Any:
    """
    Return the payload from the service's response envelope.

    Errors from the service are re-raised with their original status code so a
    404 for an expired dataset does not become an opaque 502.
    """
    try:
        body = response.json()
    except ValueError:
        raise SqliteServiceError('The dataset service returned a malformed response.')

    if not response.ok or body.get('success') is False:
        message = body.get('message') or 'The dataset service rejected the request.'
        raise SqliteServiceError(message, status_code=response.status_code)

    return body.get('data', body)


def _request(method: str, path: str, **kwargs: Any) -> Any:
    url = f'{_base_url()}{path}'
    try:
        response = requests.request(
            method,
            url,
            headers=_headers(),
            timeout=_timeout(),
            **kwargs,
        )
    except requests.Timeout:
        logger.error('Dataset service timed out: %s %s', method, path)
        raise SqliteServiceError('The dataset service timed out.', status_code=504)
    except requests.RequestException as exc:
        logger.error('Dataset service unreachable: %s', exc)
        raise SqliteServiceError('The dataset service is unavailable.', status_code=503)

    return _unwrap(response)


def upload_file(file_storage) -> dict:
    """Forward an uploaded file and return its identifier and schema."""
    files = {
        'file': (
            file_storage.filename,
            file_storage.stream,
            file_storage.mimetype or 'application/octet-stream',
        )
    }
    return _request('POST', '/upload-file', files=files)


def add_file(dataset_uuid: str, file_storage) -> dict:
    """Add another file to an existing dataset as new table(s)."""
    files = {
        'file': (
            file_storage.filename,
            file_storage.stream,
            file_storage.mimetype or 'application/octet-stream',
        )
    }
    return _request('POST', f'/databases/{dataset_uuid}/files', files=files)


def get_schema(dataset_uuid: str) -> dict:
    """Return schema text plus structured table metadata."""
    return _request('GET', f'/get-schema/{dataset_uuid}')


def execute_query(dataset_uuid: str, query: str, max_rows: Optional[int] = None) -> dict:
    """Run a read-only query. The service enforces the read-only restriction."""
    payload: dict[str, Any] = {'uuid': dataset_uuid, 'query': query}
    if max_rows is not None:
        payload['maxRows'] = max_rows
    return _request('POST', '/execute-query', json=payload)


def preview_table(dataset_uuid: str, table: str) -> dict:
    """Return the first rows of a table."""
    return _request('GET', f'/databases/{dataset_uuid}/preview/{table}')


def profile_dataset(dataset_uuid: str) -> dict:
    """Return per-column statistics, distributions, outliers and correlations."""
    return _request('GET', f'/databases/{dataset_uuid}/profile')


def delete_database(dataset_uuid: str) -> None:
    """Remove the underlying file. Missing files are treated as already deleted."""
    try:
        _request('DELETE', f'/databases/{dataset_uuid}')
    except SqliteServiceError as exc:
        if exc.status_code != 404:
            raise
        logger.info('Dataset %s was already absent from the dataset service', dataset_uuid)


def database_exists(dataset_uuid: str) -> bool:
    """Check whether the file is still present, i.e. has not expired."""
    try:
        _request('GET', f'/databases/{dataset_uuid}')
        return True
    except SqliteServiceError as exc:
        if exc.status_code == 404:
            return False
        raise
