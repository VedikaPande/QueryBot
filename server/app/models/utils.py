"""
Model helpers.
"""
import uuid
from typing import Optional


def to_uuid(value) -> Optional[uuid.UUID]:
    """
    Coerce a value to a UUID, returning None when it is not one.

    Identifiers arrive as strings from JWT claims and URL parameters, but the
    columns are ``sa.Uuid``, which requires a real UUID object rather than
    coercing on the driver's behalf. Passing a raw string straight into a query
    raises a StatementError that surfaces as a 500 instead of a clean 404.
    """
    if isinstance(value, uuid.UUID):
        return value
    try:
        return uuid.UUID(str(value))
    except (ValueError, AttributeError, TypeError):
        return None
