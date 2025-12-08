"""
Database module for Lingual app using Firestore.

Schema:
- users/{uid}
    - email: str
    - name: str
    - created_at: timestamp
    - updated_at: timestamp
    - profile:
        - goals: list[str]
        - learning_duration: int (0-10 scale)
        - ui_language: str ('en' or 'ko')
    - assessment:
        - responses: dict (item_id -> response)
        - current_item_index: int
        - completed: bool
        - completed_at: timestamp (optional)
    - results:
        - global_stage: int (0-5)
        - domain_bands: dict (domain -> band)
        - domain_raw_scores: dict (domain -> score)
        - item_scores: dict (item_id -> score)
    - selected_categories: list[str]
    - chat_history: list[dict] (role, content)
"""

from firebase_admin import firestore
from datetime import datetime


def get_db():
    """Get Firestore client."""
    return firestore.client()


def get_user_ref(uid):
    """Get reference to user document."""
    db = get_db()
    return db.collection('users').document(uid)


def create_user(uid, email, name):
    """Create a new user document."""
    user_ref = get_user_ref(uid)
    user_data = {
        'email': email,
        'name': name,
        'created_at': firestore.SERVER_TIMESTAMP,
        'updated_at': firestore.SERVER_TIMESTAMP,
        'profile': {
            'goals': [],
            'learning_duration': 0,
            'ui_language': 'en'
        },
        'assessment': {
            'responses': {},
            'current_item_index': 0,
            'completed': False
        },
        'results': None,
        'selected_categories': [],
        'chat_history': []
    }
    user_ref.set(user_data)
    return user_data


def get_user(uid):
    """Get user document, create if doesn't exist."""
    user_ref = get_user_ref(uid)
    doc = user_ref.get()

    if doc.exists:
        return doc.to_dict()
    return None


def get_or_create_user(uid, email, name):
    """Get existing user or create new one."""
    user = get_user(uid)
    if user is None:
        user = create_user(uid, email, name)
    return user


def update_user_profile(uid, goals=None, learning_duration=None, ui_language=None):
    """Update user profile fields."""
    user_ref = get_user_ref(uid)
    updates = {'updated_at': firestore.SERVER_TIMESTAMP}

    if goals is not None:
        updates['profile.goals'] = goals
    if learning_duration is not None:
        updates['profile.learning_duration'] = learning_duration
    if ui_language is not None:
        updates['profile.ui_language'] = ui_language

    user_ref.update(updates)


def update_assessment_response(uid, item_id, response, current_index):
    """Update a single assessment response."""
    user_ref = get_user_ref(uid)
    user_ref.update({
        f'assessment.responses.{item_id}': response,
        'assessment.current_item_index': current_index,
        'updated_at': firestore.SERVER_TIMESTAMP
    })


def get_assessment_state(uid):
    """Get current assessment state for user."""
    user = get_user(uid)
    if user:
        return user.get('assessment', {
            'responses': {},
            'current_item_index': 0,
            'completed': False
        })
    return None


def reset_assessment(uid):
    """Reset user's assessment progress."""
    user_ref = get_user_ref(uid)
    user_ref.update({
        'assessment': {
            'responses': {},
            'current_item_index': 0,
            'completed': False
        },
        'results': None,
        'updated_at': firestore.SERVER_TIMESTAMP
    })


def save_assessment_results(uid, results):
    """Save assessment results after completion."""
    user_ref = get_user_ref(uid)
    user_ref.update({
        'assessment.completed': True,
        'assessment.completed_at': firestore.SERVER_TIMESTAMP,
        'results': results,
        'updated_at': firestore.SERVER_TIMESTAMP
    })


def get_assessment_results(uid):
    """Get user's assessment results."""
    user = get_user(uid)
    if user:
        return user.get('results')
    return None


def update_selected_categories(uid, categories):
    """Update user's selected practice categories."""
    user_ref = get_user_ref(uid)
    user_ref.update({
        'selected_categories': categories,
        'updated_at': firestore.SERVER_TIMESTAMP
    })


def get_chat_history(uid, limit=20):
    """Get user's recent chat history."""
    user = get_user(uid)
    if user:
        history = user.get('chat_history', [])
        return history[-limit:] if len(history) > limit else history
    return []


def append_chat_message(uid, role, content):
    """Append a message to chat history."""
    user_ref = get_user_ref(uid)
    user_ref.update({
        'chat_history': firestore.ArrayUnion([{
            'role': role,
            'content': content,
            'timestamp': datetime.utcnow().isoformat()
        }]),
        'updated_at': firestore.SERVER_TIMESTAMP
    })


def save_chat_history(uid, messages):
    """Save full chat history (for bulk updates)."""
    user_ref = get_user_ref(uid)
    # Add timestamps to messages if not present
    timestamped_messages = []
    for msg in messages:
        if 'timestamp' not in msg:
            msg_copy = msg.copy()
            msg_copy['timestamp'] = datetime.utcnow().isoformat()
            timestamped_messages.append(msg_copy)
        else:
            timestamped_messages.append(msg)

    user_ref.update({
        'chat_history': timestamped_messages,
        'updated_at': firestore.SERVER_TIMESTAMP
    })


def clear_chat_history(uid):
    """Clear user's chat history."""
    user_ref = get_user_ref(uid)
    user_ref.update({
        'chat_history': [],
        'updated_at': firestore.SERVER_TIMESTAMP
    })


def get_user_profile_context(uid):
    """Get user profile data for AI context."""
    user = get_user(uid)
    if user:
        return {
            'goals': user.get('profile', {}).get('goals', []),
            'learning_duration': user.get('profile', {}).get('learning_duration', 0),
            'results': user.get('results'),
            'selected_categories': user.get('selected_categories', [])
        }
    return None
