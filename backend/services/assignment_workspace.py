from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from backend.services.practice_analytics import serialize_practice_session


def _timestamp_to_iso(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    if hasattr(value, 'isoformat'):
        return value.isoformat()
    if hasattr(value, 'seconds'):
        return datetime.fromtimestamp(value.seconds, UTC).isoformat()
    return str(value)


def _timestamp_sort_key(value: Any) -> tuple[int, float]:
    iso_value = _timestamp_to_iso(value)
    if not iso_value:
        return (0, 0.0)

    normalized = iso_value.replace('Z', '+00:00')
    try:
        parsed = datetime.fromisoformat(normalized)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=UTC)
        return (1, parsed.timestamp())
    except ValueError:
        return (0, 0.0)


def build_student_assignment_workspace(
    bootstrap: dict[str, Any],
    session_records: list[dict[str, Any]],
    *,
    db: Any,
    uid: str,
) -> dict[str, Any]:
    threads_by_chat: dict[str, list[dict[str, Any]]] = {}
    latest_active_attempt: dict[str, Any] | None = None

    for session_record in session_records:
        session_dto = serialize_practice_session(session_record)
        if not isinstance(session_dto, dict):
            continue
        chat_id = session_dto.get('chatId')
        if not isinstance(chat_id, str) or not chat_id.strip():
            continue
        chat_id = chat_id.strip()
        session_dto['chatId'] = chat_id
        threads_by_chat.setdefault(chat_id, []).append(session_dto)

        if session_dto.get('status') == 'active':
            if latest_active_attempt is None or _timestamp_sort_key(session_dto.get('startedAt')) > _timestamp_sort_key(
                latest_active_attempt.get('startedAt')
            ):
                latest_active_attempt = session_dto

    threads: list[dict[str, Any]] = []
    for chat_id, attempts in threads_by_chat.items():
        attempts.sort(key=lambda attempt: _timestamp_sort_key(attempt.get('startedAt')), reverse=True)
        latest_attempt = attempts[0] if attempts else None
        chat_detail = db.get_chat_session(uid, chat_id) if hasattr(db, 'get_chat_session') else None
        chat_messages = chat_detail.get('messages') if isinstance(chat_detail, dict) else []
        updated_at = (
            chat_detail.get('updated_at') if isinstance(chat_detail, dict) else None
        ) or (
            latest_attempt.get('startedAt') if isinstance(latest_attempt, dict) else None
        )
        threads.append({
            'chatId': chat_id,
            'title': (
                chat_detail.get('title')
                if isinstance(chat_detail, dict) and isinstance(chat_detail.get('title'), str) and chat_detail.get('title').strip()
                else 'Assignment thread'
            ),
            'updatedAt': updated_at,
            'messageCount': len(chat_messages) if isinstance(chat_messages, list) else 0,
            'hasActiveAttempt': any(attempt.get('status') == 'active' for attempt in attempts),
            'latestPracticeSession': latest_attempt,
            'attempts': attempts,
        })

    threads.sort(key=lambda thread: _timestamp_sort_key(thread.get('updatedAt')), reverse=True)
    selected_chat_id = (
        latest_active_attempt.get('chatId')
        if isinstance(latest_active_attempt, dict)
        else (threads[0].get('chatId') if threads else None)
    )

    return {
        'bootstrap': bootstrap,
        'selectedChatId': selected_chat_id,
        'latestActivePracticeSessionId': latest_active_attempt.get('id') if isinstance(latest_active_attempt, dict) else None,
        'threads': threads,
    }
