"""
Conversation routes.

Expose the persisted query history so users can revisit past analyses instead of
losing every result the moment they ask the next question.
"""
from flask import Blueprint, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from app.extensions import db
from app.models.conversation_model import Conversation
from app.utils.responses import error_response, success_response

conversation_bp = Blueprint('conversations', __name__, url_prefix='/api/conversations')


@conversation_bp.route('', methods=['GET'])
@jwt_required()
def list_conversations():
    """List the caller's conversations, most recently updated first."""
    user_id = get_jwt_identity()
    conversations = Conversation.list_for_user(user_id)
    return success_response(
        'Conversations retrieved successfully',
        {'conversations': [conversation.to_dict() for conversation in conversations]},
    )


@conversation_bp.route('/<conversation_id>', methods=['GET'])
@jwt_required()
def get_conversation(conversation_id: str):
    """Return a conversation with its full message history."""
    user_id = get_jwt_identity()

    conversation = Conversation.find_for_user(conversation_id, user_id)
    if not conversation:
        return error_response('Conversation not found', 404)

    return success_response(
        'Conversation retrieved successfully',
        {'conversation': conversation.to_dict(include_messages=True)},
    )


@conversation_bp.route('/<conversation_id>', methods=['PATCH'])
@jwt_required()
def rename_conversation(conversation_id: str):
    """Rename a conversation."""
    user_id = get_jwt_identity()

    conversation = Conversation.find_for_user(conversation_id, user_id)
    if not conversation:
        return error_response('Conversation not found', 404)

    title = ((request.get_json(silent=True) or {}).get('title') or '').strip()
    if not title:
        return error_response('A title is required', 400)

    conversation.title = title[:200]
    db.session.commit()

    return success_response('Conversation renamed successfully', {'conversation': conversation.to_dict()})


@conversation_bp.route('/<conversation_id>', methods=['DELETE'])
@jwt_required()
def delete_conversation(conversation_id: str):
    """Delete a conversation and its messages."""
    user_id = get_jwt_identity()

    conversation = Conversation.find_for_user(conversation_id, user_id)
    if not conversation:
        return error_response('Conversation not found', 404)

    db.session.delete(conversation)
    db.session.commit()

    return success_response('Conversation deleted successfully')
