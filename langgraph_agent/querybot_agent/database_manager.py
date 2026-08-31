"""
Client for the SQLite dataset service.
"""
import logging
from typing import Any, Optional

import requests

from querybot_agent.config import settings

logger = logging.getLogger(__name__)


class DatabaseError(Exception):
    """Raised when the dataset service cannot serve a request."""


class DatabaseManager:
    """Reads schema and executes queries against the dataset service."""

    def __init__(self, base_url: Optional[str] = None):
        self.base_url = (base_url or settings.sqlite_service_url).rstrip('/')
        self._session = requests.Session()
        self._session.headers.update(settings.auth_headers)
        # Schema is requested by several nodes within one run and never changes
        # mid-run; fetching it once avoids three redundant round trips per query.
        self._schema_cache: dict[str, str] = {}

    def _unwrap(self, response: requests.Response) -> Any:
        """Extract the payload from the service's response envelope."""
        try:
            body = response.json()
        except ValueError:
            raise DatabaseError('The dataset service returned a malformed response.')

        if not response.ok or body.get('success') is False:
            raise DatabaseError(body.get('message') or f'Request failed with status {response.status_code}')

        # The service wraps payloads in `data`; fall back to the body for
        # compatibility with any deployment still returning a bare object.
        return body.get('data', body)

    def get_schema(self, uuid: str, refresh: bool = False) -> str:
        """Return the prompt-facing schema description for a dataset."""
        if not refresh and uuid in self._schema_cache:
            return self._schema_cache[uuid]

        try:
            response = self._session.get(
                f'{self.base_url}/get-schema/{uuid}',
                timeout=settings.request_timeout,
            )
            payload = self._unwrap(response)
        except requests.RequestException as exc:
            raise DatabaseError(f'Could not reach the dataset service: {exc}') from exc

        schema = payload.get('schema', '')
        if not schema:
            raise DatabaseError('The dataset service returned an empty schema.')

        self._schema_cache[uuid] = schema
        return schema

    def get_tables(self, uuid: str) -> list[dict]:
        """Return structured table metadata."""
        try:
            response = self._session.get(
                f'{self.base_url}/get-schema/{uuid}',
                timeout=settings.request_timeout,
            )
            return self._unwrap(response).get('tables', [])
        except requests.RequestException as exc:
            raise DatabaseError(f'Could not reach the dataset service: {exc}') from exc

    def execute_query(self, uuid: str, query: str) -> list[Any]:
        """
        Execute a read-only query and return rows as positional lists.

        The dataset service rejects anything that is not a single read-only
        statement, so a hallucinated UPDATE never reaches the database.
        """
        try:
            response = self._session.post(
                f'{self.base_url}/execute-query',
                json={'uuid': uuid, 'query': query, 'maxRows': settings.max_result_rows},
                timeout=settings.request_timeout,
            )
            payload = self._unwrap(response)
        except requests.RequestException as exc:
            raise DatabaseError(f'Could not reach the dataset service: {exc}') from exc

        if payload.get('truncated'):
            logger.warning(
                'Result truncated at %s rows for dataset %s', settings.max_result_rows, uuid
            )

        return payload.get('results', [])

    def execute_query_detailed(self, uuid: str, query: str) -> dict:
        """Execute a query and return the full payload, including column names."""
        try:
            response = self._session.post(
                f'{self.base_url}/execute-query',
                json={'uuid': uuid, 'query': query, 'maxRows': settings.max_result_rows},
                timeout=settings.request_timeout,
            )
            return self._unwrap(response)
        except requests.RequestException as exc:
            raise DatabaseError(f'Could not reach the dataset service: {exc}') from exc
