"""
Dashboard routes.

Owner endpoints require authentication and verify ownership. The public endpoint
is deliberately unauthenticated: it is reached with a share token that acts as the
capability, and it returns a reduced payload with the SQL and account details
stripped.
"""
from flask import Blueprint, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from app.extensions import db
from app.models.conversation_model import Conversation, Message
from app.models.dashboard_model import TILE_SIZES, Dashboard, DashboardTile
from app.models.utils import to_uuid
from app.utils.logging import get_logger
from app.utils.rate_limit import limiter
from app.utils.responses import error_response, success_response

logger = get_logger(__name__)

dashboard_bp = Blueprint('dashboards', __name__, url_prefix='/api/dashboards')

TILE_VIEWS = ('chart', 'table', 'answer')

# A dashboard beyond this many tiles stops being readable and the public payload
# becomes very large, since every chart is an inline base64 PNG.
MAX_TILES = 30


@dashboard_bp.route('', methods=['GET'])
@jwt_required()
def list_dashboards():
    """List the caller's dashboards, most recently updated first."""
    dashboards = Dashboard.list_for_user(get_jwt_identity())
    return success_response(
        'Dashboards retrieved successfully',
        {'dashboards': [dashboard.to_dict() for dashboard in dashboards]},
    )


@dashboard_bp.route('', methods=['POST'])
@jwt_required()
def create_dashboard():
    """Create an empty dashboard."""
    user_id = get_jwt_identity()
    data = request.get_json(silent=True) or {}

    title = (data.get('title') or '').strip() or 'Untitled dashboard'

    dashboard = Dashboard(
        user_id=to_uuid(user_id),
        title=title[:200],
        description=(data.get('description') or '').strip()[:2000] or None,
    )
    db.session.add(dashboard)
    db.session.commit()

    logger.info('Dashboard created', extra={'dashboard': str(dashboard.id)})
    return success_response('Dashboard created successfully', {'dashboard': dashboard.to_dict()}, 201)


@dashboard_bp.route('/<dashboard_id>', methods=['GET'])
@jwt_required()
def get_dashboard(dashboard_id: str):
    """Return a dashboard with its tiles."""
    dashboard = Dashboard.find_for_user(dashboard_id, get_jwt_identity())
    if not dashboard:
        return error_response('Dashboard not found', 404)

    return success_response(
        'Dashboard retrieved successfully',
        {'dashboard': dashboard.to_dict(include_tiles=True)},
    )


@dashboard_bp.route('/<dashboard_id>', methods=['PATCH'])
@jwt_required()
def update_dashboard(dashboard_id: str):
    """Rename a dashboard, edit its description, or toggle public sharing."""
    dashboard = Dashboard.find_for_user(dashboard_id, get_jwt_identity())
    if not dashboard:
        return error_response('Dashboard not found', 404)

    data = request.get_json(silent=True) or {}

    if 'title' in data:
        title = (data.get('title') or '').strip()
        if not title:
            return error_response('A title is required', 400)
        dashboard.title = title[:200]

    if 'description' in data:
        dashboard.description = (data.get('description') or '').strip()[:2000] or None

    if 'shared' in data:
        if data['shared']:
            dashboard.enable_sharing()
            logger.info('Dashboard sharing enabled', extra={'dashboard': str(dashboard.id)})
        else:
            dashboard.disable_sharing()
            logger.info('Dashboard sharing revoked', extra={'dashboard': str(dashboard.id)})

    db.session.commit()
    return success_response('Dashboard updated successfully', {'dashboard': dashboard.to_dict()})


@dashboard_bp.route('/<dashboard_id>', methods=['DELETE'])
@jwt_required()
def delete_dashboard(dashboard_id: str):
    """Delete a dashboard and its tiles. The underlying analyses are untouched."""
    dashboard = Dashboard.find_for_user(dashboard_id, get_jwt_identity())
    if not dashboard:
        return error_response('Dashboard not found', 404)

    db.session.delete(dashboard)
    db.session.commit()
    return success_response('Dashboard deleted successfully')


@dashboard_bp.route('/<dashboard_id>/tiles', methods=['POST'])
@jwt_required()
def add_tile(dashboard_id: str):
    """
    Pin an analysis onto a dashboard.

    The message must belong to the caller. Without that check a user could pin —
    and then publicly share — any result in the system by supplying its id.
    """
    user_id = get_jwt_identity()

    dashboard = Dashboard.find_for_user(dashboard_id, user_id)
    if not dashboard:
        return error_response('Dashboard not found', 404)

    if len(dashboard.tiles) >= MAX_TILES:
        return error_response(f'A dashboard holds at most {MAX_TILES} tiles', 400)

    data = request.get_json(silent=True) or {}

    message_id = to_uuid(data.get('messageId'))
    if message_id is None:
        return error_response('A valid message identifier is required', 400)

    # Joined through Conversation so ownership is enforced in the query itself.
    message = (
        db.session.query(Message)
        .join(Conversation, Message.conversation_id == Conversation.id)
        .filter(Message.id == message_id, Conversation.user_id == to_uuid(user_id))
        .first()
    )
    if not message:
        return error_response('Result not found', 404)

    view = data.get('view') if data.get('view') in TILE_VIEWS else 'chart'
    size = data.get('size') if data.get('size') in TILE_SIZES else 'medium'

    # Pinning a chart view when no chart exists would render an empty tile.
    if view == 'chart' and not message.chart_image_base64:
        view = 'table' if message.result_rows else 'answer'

    tile = DashboardTile(
        dashboard_id=dashboard.id,
        message_id=message.id,
        title=(data.get('title') or '').strip()[:200] or _title_for(message),
        view=view,
        size=size,
        # Appended to the end; the client reorders explicitly afterwards.
        position=len(dashboard.tiles),
    )

    db.session.add(tile)
    db.session.commit()

    return success_response('Pinned to the dashboard', {'tile': tile.to_dict()}, 201)


def _title_for(message: Message) -> str:
    """Derive a tile title from the question that produced the result."""
    conversation = message.conversation
    if conversation and conversation.title:
        return conversation.title[:200]
    return (message.content or 'Result')[:200]


@dashboard_bp.route('/<dashboard_id>/tiles/<tile_id>', methods=['PATCH'])
@jwt_required()
def update_tile(dashboard_id: str, tile_id: str):
    """Rename a tile, change which part of the result it shows, or resize it."""
    dashboard = Dashboard.find_for_user(dashboard_id, get_jwt_identity())
    if not dashboard:
        return error_response('Dashboard not found', 404)

    tile = next((t for t in dashboard.tiles if str(t.id) == str(tile_id)), None)
    if not tile:
        return error_response('Tile not found', 404)

    data = request.get_json(silent=True) or {}

    if 'title' in data:
        tile.title = (data.get('title') or '').strip()[:200] or tile.title
    if data.get('view') in TILE_VIEWS:
        tile.view = data['view']
    if data.get('size') in TILE_SIZES:
        tile.size = data['size']

    db.session.commit()
    return success_response('Tile updated successfully', {'tile': tile.to_dict()})


@dashboard_bp.route('/<dashboard_id>/tiles/order', methods=['PATCH'])
@jwt_required()
def reorder_tiles(dashboard_id: str):
    """
    Reorder tiles from a list of tile ids.

    Ids not belonging to this dashboard are ignored rather than rejected, so a
    stale client cannot reorder another dashboard's tiles.
    """
    dashboard = Dashboard.find_for_user(dashboard_id, get_jwt_identity())
    if not dashboard:
        return error_response('Dashboard not found', 404)

    order = (request.get_json(silent=True) or {}).get('tileIds')
    if not isinstance(order, list):
        return error_response('A list of tile identifiers is required', 400)

    by_id = {str(tile.id): tile for tile in dashboard.tiles}
    position = 0

    for tile_id in order:
        tile = by_id.pop(str(tile_id), None)
        if tile is not None:
            tile.position = position
            position += 1

    # Anything the client omitted keeps a stable position after the listed tiles.
    for tile in by_id.values():
        tile.position = position
        position += 1

    db.session.commit()
    return success_response(
        'Tiles reordered successfully',
        {'dashboard': dashboard.to_dict(include_tiles=True)},
    )


@dashboard_bp.route('/<dashboard_id>/tiles/<tile_id>', methods=['DELETE'])
@jwt_required()
def remove_tile(dashboard_id: str, tile_id: str):
    """Unpin a tile. The underlying analysis is untouched."""
    dashboard = Dashboard.find_for_user(dashboard_id, get_jwt_identity())
    if not dashboard:
        return error_response('Dashboard not found', 404)

    tile = next((t for t in dashboard.tiles if str(t.id) == str(tile_id)), None)
    if not tile:
        return error_response('Tile not found', 404)

    # The survivors are captured before the delete. Reading `dashboard.tiles`
    # after `delete` + `flush` still yields the removed tile from the loaded
    # collection, so renumbering there assigned position 0 to the row on its way
    # out and left the rest starting at 1.
    survivors = sorted(
        (candidate for candidate in dashboard.tiles if candidate.id != tile.id),
        key=lambda candidate: candidate.position,
    )

    db.session.delete(tile)

    # Close the gap so positions stay contiguous and later inserts cannot collide.
    for index, remaining in enumerate(survivors):
        remaining.position = index

    db.session.commit()
    return success_response('Tile removed successfully')


# ---------------------------------------------------------------------------
# Public access
# ---------------------------------------------------------------------------

public_dashboard_bp = Blueprint('public_dashboards', __name__, url_prefix='/api/public')


@public_dashboard_bp.route('/dashboards/<token>', methods=['GET'])
# Unauthenticated, so limited by IP to keep the token space from being probed.
@limiter.limit('60 per hour')
def get_shared_dashboard(token: str):
    """
    Return a publicly shared dashboard.

    Intentionally requires no session: the token is the capability. The payload
    omits the SQL, the message ids and every account detail, so a link discloses
    the findings and nothing else. Revoking sharing invalidates it immediately.
    """
    dashboard = Dashboard.find_by_share_token(token)
    if not dashboard:
        # Same response whether the token never existed or was revoked, so the
        # endpoint cannot be used to distinguish the two.
        return error_response('This dashboard is not available', 404)

    return success_response(
        'Dashboard retrieved successfully',
        {'dashboard': dashboard.to_dict(include_tiles=True, public=True)},
    )
