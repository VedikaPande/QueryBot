"""
Dataset routes.

Uploads, schema inspection and previews. Every endpoint requires an
authenticated user and scopes results to the datasets that user owns.
"""
from flask import current_app, request
from flask import Blueprint
from flask_jwt_extended import get_jwt_identity, jwt_required

from app.services import dataset_service, sqlite_service
from app.services.sqlite_service import SqliteServiceError
from app.utils import cache
from app.utils.logging import get_logger
from app.utils.rate_limit import limiter
from app.utils.responses import error_response, success_response

logger = get_logger(__name__)

dataset_bp = Blueprint('datasets', __name__, url_prefix='/api/datasets')

ALLOWED_EXTENSIONS = {'.csv', '.sqlite', '.db'}


def _dataset_cache_prefix(dataset_uuid: str) -> str:
    """Namespace for everything cached about one dataset."""
    return cache.build_key('dataset', dataset_uuid)


@dataset_bp.route('', methods=['GET'])
@jwt_required()
def list_datasets():
    """List the caller's datasets, most recently used first."""
    user_id = get_jwt_identity()
    datasets = dataset_service.list_datasets(user_id)
    return success_response(
        'Datasets retrieved successfully',
        {'datasets': [dataset.to_dict() for dataset in datasets]},
    )


@dataset_bp.route('', methods=['POST'])
@jwt_required()
@limiter.limit(lambda: current_app.config['RATELIMIT_UPLOAD'])
def upload_dataset():
    """Upload a CSV or SQLite file and record the caller as its owner."""
    user_id = get_jwt_identity()

    uploaded = request.files.get('file')
    if not uploaded or not uploaded.filename:
        return error_response('No file was uploaded', 400)

    extension = uploaded.filename[uploaded.filename.rfind('.'):].lower() if '.' in uploaded.filename else ''
    if extension not in ALLOWED_EXTENSIONS:
        return error_response(
            f'Unsupported file type. Accepted formats: {", ".join(sorted(ALLOWED_EXTENSIONS))}',
            400,
        )

    try:
        dataset = dataset_service.register_upload(user_id, uploaded)
    except SqliteServiceError as exc:
        logger.warning('Upload rejected by dataset service: %s', exc.message)
        return error_response(exc.message, exc.status_code)

    return success_response('File uploaded successfully', {'dataset': dataset.to_dict()}, 201)


@dataset_bp.route('/<dataset_uuid>/schema', methods=['GET'])
@jwt_required()
def get_schema(dataset_uuid: str):
    """
    Return the table and column structure for a dataset the caller owns.

    Cached: a dataset's schema cannot change after upload, and this is requested
    on every playground load and several times per analysis run.
    """
    user_id = get_jwt_identity()

    dataset = dataset_service.get_owned_dataset(user_id, dataset_uuid)
    if not dataset:
        return error_response('Dataset not found', 404)

    key = cache.build_key('dataset', str(dataset.external_uuid), 'schema')

    try:
        payload = cache.cached_json(
            key,
            current_app.config['SCHEMA_CACHE_TTL'],
            lambda: sqlite_service.get_schema(str(dataset.external_uuid)),
        )
    except SqliteServiceError as exc:
        return error_response(exc.message, exc.status_code)

    return success_response(
        'Schema retrieved successfully',
        {'tables': payload.get('tables', []), 'dataset': dataset.to_dict()},
    )


@dataset_bp.route('/<dataset_uuid>/files', methods=['POST'])
@jwt_required()
@limiter.limit(lambda: current_app.config['RATELIMIT_UPLOAD'])
def add_file(dataset_uuid: str):
    """
    Add another file to an existing dataset.

    Each file becomes a table in the same database, so questions can span them:
    upload orders.csv and customers.csv, then ask for revenue by customer country.
    """
    user_id = get_jwt_identity()

    dataset = dataset_service.get_owned_dataset(user_id, dataset_uuid)
    if not dataset:
        return error_response('Dataset not found', 404)

    uploaded = request.files.get('file')
    if not uploaded or not uploaded.filename:
        return error_response('No file was uploaded', 400)

    extension = uploaded.filename[uploaded.filename.rfind('.'):].lower() if '.' in uploaded.filename else ''
    if extension not in ALLOWED_EXTENSIONS:
        return error_response(
            f'Unsupported file type. Accepted formats: {", ".join(sorted(ALLOWED_EXTENSIONS))}',
            400,
        )

    try:
        payload = dataset_service.add_file(dataset, uploaded)
    except SqliteServiceError as exc:
        logger.warning('Could not add the file: %s', exc.message)
        return error_response(exc.message, exc.status_code)

    # The schema and profile both changed, so their cached copies are now wrong.
    cache.delete_prefix(_dataset_cache_prefix(str(dataset.external_uuid)))

    return success_response(
        f'Added {len(payload.get("addedTables") or [])} table(s)',
        {'dataset': dataset.to_dict(), 'addedTables': payload.get('addedTables') or []},
        201,
    )


@dataset_bp.route('/<dataset_uuid>/profile', methods=['GET'])
@jwt_required()
def profile_dataset(dataset_uuid: str):
    """
    Return a statistical profile of the dataset.

    Cached alongside the schema: the underlying data is immutable once uploaded,
    and profiling scans every row, so recomputing it per page load would be
    wasteful.
    """
    user_id = get_jwt_identity()

    dataset = dataset_service.get_owned_dataset(user_id, dataset_uuid)
    if not dataset:
        return error_response('Dataset not found', 404)

    key = cache.build_key('dataset', str(dataset.external_uuid), 'profile')

    try:
        payload = cache.cached_json(
            key,
            current_app.config['SCHEMA_CACHE_TTL'],
            lambda: sqlite_service.profile_dataset(str(dataset.external_uuid)),
        )
    except SqliteServiceError as exc:
        return error_response(exc.message, exc.status_code)

    return success_response('Profile retrieved successfully', payload)


@dataset_bp.route('/<dataset_uuid>/preview/<table>', methods=['GET'])
@jwt_required()
def preview_table(dataset_uuid: str, table: str):
    """Return the first rows of a table so users can inspect their data."""
    user_id = get_jwt_identity()

    dataset = dataset_service.get_owned_dataset(user_id, dataset_uuid)
    if not dataset:
        return error_response('Dataset not found', 404)

    key = cache.build_key('dataset', str(dataset.external_uuid), 'preview', table)

    try:
        payload = cache.cached_json(
            key,
            current_app.config['PREVIEW_CACHE_TTL'],
            lambda: sqlite_service.preview_table(str(dataset.external_uuid), table),
        )
    except SqliteServiceError as exc:
        return error_response(exc.message, exc.status_code)

    return success_response('Preview retrieved successfully', payload)


@dataset_bp.route('/<dataset_uuid>', methods=['DELETE'])
@jwt_required()
def delete_dataset(dataset_uuid: str):
    """Delete a dataset and everything derived from it."""
    user_id = get_jwt_identity()

    dataset = dataset_service.get_owned_dataset(user_id, dataset_uuid)
    if not dataset:
        return error_response('Dataset not found', 404)

    external_uuid = str(dataset.external_uuid)

    try:
        dataset_service.delete_dataset(dataset)
    except SqliteServiceError as exc:
        return error_response(exc.message, exc.status_code)

    # Drop the cached schema and previews; otherwise a newly uploaded dataset
    # that reused the identifier would serve the deleted one's structure.
    cache.delete_prefix(_dataset_cache_prefix(external_uuid))

    return success_response('Dataset deleted successfully')
