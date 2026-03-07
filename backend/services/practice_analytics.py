from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
import re

from backend.services.assignment_resolver import serialize_assignment

DEFAULT_PROMPT_VERSION = 'assignment_bootstrap.v1'
SESSION_STATUSES = {'active', 'completed', 'abandoned'}
SUPPORTED_EVENT_TYPES = {
    'session.started',
    'session.ended',
    'student.turn',
    'assistant.turn',
    'feedback.recast',
    'feedback.elicitation',
    'feedback.review_item',
    'metric.target_expression_hit',
    'metric.self_correction',
    'task.completed',
}


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _normalize_string(value: Any) -> str:
    if not isinstance(value, str):
        return ''
    return value.strip()


def _timestamp_to_iso(value: Any) -> str | None:
    if value is None:
        return None
    if hasattr(value, 'isoformat'):
        return value.isoformat()
    if hasattr(value, 'seconds'):
        return datetime.fromtimestamp(value.seconds, UTC).isoformat()
    return str(value)


def _coerce_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str) and value.strip().lstrip('-').isdigit():
        return int(value.strip())
    return None


def _count_words(content: str) -> int:
    if not content.strip():
        return 0
    return len(re.findall(r"\b[\w']+\b", content))


def _estimate_speaking_time_seconds(word_count: int) -> int:
    if word_count <= 0:
        return 0
    return max(1, round(word_count / 2.3))


def _count_target_expression_hits(content: str, expressions: list[str]) -> dict[str, int]:
    content_lower = content.lower()
    hits = {}
    for expression in expressions:
        normalized_expression = _normalize_string(expression)
        if not normalized_expression:
            continue
        count = content_lower.count(normalized_expression.lower())
        if count > 0:
            hits[normalized_expression] = count
    return hits


def default_cost_summary() -> dict[str, Any]:
    return {
        'estimated_usd': 0.0,
        'estimated_voice_seconds': 0,
        'estimated_text_turns': 0,
    }


def default_session_summary() -> dict[str, Any]:
    return {
        'total_turns': 0,
        'student_turn_count': 0,
        'assistant_turn_count': 0,
        'total_student_words': 0,
        'average_student_words_per_turn': 0.0,
        'estimated_speaking_time_seconds': 0,
        'target_expression_hits': {},
        'target_expression_total_hits': 0,
        'self_correction_count': 0,
        'task_completion_count': 0,
        'feedback_counts': {
            'recast': 0,
            'elicitation': 0,
            'review_item': 0,
        },
        'ended_reason': None,
    }


def normalize_cost_summary(cost_summary: Any) -> dict[str, Any]:
    normalized = default_cost_summary()
    if isinstance(cost_summary, dict):
        estimated_usd = cost_summary.get('estimated_usd', cost_summary.get('estimatedUsd'))
        estimated_voice_seconds = cost_summary.get(
            'estimated_voice_seconds',
            cost_summary.get('estimatedVoiceSeconds'),
        )
        estimated_text_turns = cost_summary.get(
            'estimated_text_turns',
            cost_summary.get('estimatedTextTurns'),
        )
        if isinstance(estimated_usd, (int, float)):
            normalized['estimated_usd'] = float(estimated_usd)
        if isinstance(estimated_voice_seconds, int):
            normalized['estimated_voice_seconds'] = max(0, estimated_voice_seconds)
        if isinstance(estimated_text_turns, int):
            normalized['estimated_text_turns'] = max(0, estimated_text_turns)
    return normalized


def normalize_session_summary(summary: Any) -> dict[str, Any]:
    normalized = default_session_summary()
    if isinstance(summary, dict):
        total_turns = summary.get('total_turns', summary.get('totalTurns'))
        student_turn_count = summary.get('student_turn_count', summary.get('studentTurnCount'))
        assistant_turn_count = summary.get('assistant_turn_count', summary.get('assistantTurnCount'))
        total_student_words = summary.get('total_student_words', summary.get('totalStudentWords'))
        average_student_words_per_turn = summary.get(
            'average_student_words_per_turn',
            summary.get('averageStudentWordsPerTurn'),
        )
        estimated_speaking_time_seconds = summary.get(
            'estimated_speaking_time_seconds',
            summary.get('estimatedSpeakingTimeSeconds'),
        )
        target_expression_hits = summary.get('target_expression_hits', summary.get('targetExpressionHits'))
        target_expression_total_hits = summary.get(
            'target_expression_total_hits',
            summary.get('targetExpressionTotalHits'),
        )
        self_correction_count = summary.get('self_correction_count', summary.get('selfCorrectionCount'))
        task_completion_count = summary.get('task_completion_count', summary.get('taskCompletionCount'))
        feedback_counts = summary.get('feedback_counts', summary.get('feedbackCounts'))
        ended_reason = summary.get('ended_reason', summary.get('endedReason'))

        if isinstance(total_turns, int):
            normalized['total_turns'] = max(0, total_turns)
        if isinstance(student_turn_count, int):
            normalized['student_turn_count'] = max(0, student_turn_count)
        if isinstance(assistant_turn_count, int):
            normalized['assistant_turn_count'] = max(0, assistant_turn_count)
        if isinstance(total_student_words, int):
            normalized['total_student_words'] = max(0, total_student_words)
        if isinstance(average_student_words_per_turn, (int, float)):
            normalized['average_student_words_per_turn'] = float(average_student_words_per_turn)
        if isinstance(estimated_speaking_time_seconds, int):
            normalized['estimated_speaking_time_seconds'] = max(0, estimated_speaking_time_seconds)
        if isinstance(target_expression_hits, dict):
            normalized['target_expression_hits'] = {
                _normalize_string(key): max(0, _coerce_int(value) or 0)
                for key, value in target_expression_hits.items()
                if _normalize_string(key)
            }
        if isinstance(target_expression_total_hits, int):
            normalized['target_expression_total_hits'] = max(0, target_expression_total_hits)
        if isinstance(self_correction_count, int):
            normalized['self_correction_count'] = max(0, self_correction_count)
        if isinstance(task_completion_count, int):
            normalized['task_completion_count'] = max(0, task_completion_count)
        if isinstance(feedback_counts, dict):
            normalized['feedback_counts'] = {
                'recast': max(0, _coerce_int(feedback_counts.get('recast')) or 0),
                'elicitation': max(0, _coerce_int(feedback_counts.get('elicitation')) or 0),
                'review_item': max(0, _coerce_int(feedback_counts.get('review_item', feedback_counts.get('reviewItem'))) or 0),
            }
        if isinstance(ended_reason, str) and ended_reason.strip():
            normalized['ended_reason'] = ended_reason.strip()

    if normalized['student_turn_count'] > 0:
        normalized['average_student_words_per_turn'] = round(
            normalized['total_student_words'] / normalized['student_turn_count'],
            2,
        )
    else:
        normalized['average_student_words_per_turn'] = 0.0

    if normalized['target_expression_total_hits'] <= 0:
        normalized['target_expression_total_hits'] = sum(normalized['target_expression_hits'].values())

    return normalized


def serialize_cost_summary(cost_summary: Any) -> dict[str, Any]:
    normalized = normalize_cost_summary(cost_summary)
    return {
        'estimatedUsd': normalized['estimated_usd'],
        'estimatedVoiceSeconds': normalized['estimated_voice_seconds'],
        'estimatedTextTurns': normalized['estimated_text_turns'],
    }


def serialize_session_summary(summary: Any) -> dict[str, Any]:
    normalized = normalize_session_summary(summary)
    return {
        'totalTurns': normalized['total_turns'],
        'studentTurnCount': normalized['student_turn_count'],
        'assistantTurnCount': normalized['assistant_turn_count'],
        'totalStudentWords': normalized['total_student_words'],
        'averageStudentWordsPerTurn': normalized['average_student_words_per_turn'],
        'estimatedSpeakingTimeSeconds': normalized['estimated_speaking_time_seconds'],
        'targetExpressionHits': normalized['target_expression_hits'],
        'targetExpressionTotalHits': normalized['target_expression_total_hits'],
        'selfCorrectionCount': normalized['self_correction_count'],
        'taskCompletionCount': normalized['task_completion_count'],
        'feedbackCounts': {
            'recast': normalized['feedback_counts']['recast'],
            'elicitation': normalized['feedback_counts']['elicitation'],
            'reviewItem': normalized['feedback_counts']['review_item'],
        },
        'endedReason': normalized['ended_reason'],
    }


def build_practice_session_payload(
    bootstrap: dict[str, Any],
    *,
    student_uid: str,
    chat_id: str = '',
    ui_language: str = 'en',
) -> dict[str, Any]:
    classroom = bootstrap.get('class', {}) if isinstance(bootstrap, dict) else {}
    launch = bootstrap.get('launch', {}) if isinstance(bootstrap, dict) else {}
    modality = launch.get('modality', {}) if isinstance(launch, dict) else {}
    now = _utc_now()

    return {
        'org_id': classroom.get('orgId'),
        'class_id': classroom.get('id'),
        'assignment_id': (bootstrap.get('assignment') or {}).get('id'),
        'student_uid': student_uid,
        'mapping_snapshot': bootstrap.get('mapping') or {},
        'assignment_snapshot': bootstrap.get('assignment') or {},
        'curriculum_snapshot': bootstrap.get('curriculum') or {},
        'modality': modality.get('mode', 'hybrid'),
        'voice_enabled': bool(launch.get('voiceAllowed')),
        'text_enabled': bool(launch.get('textAllowed')),
        'status': 'active',
        'started_at': now,
        'ended_at': None,
        'prompt_version': DEFAULT_PROMPT_VERSION,
        'transcript_ref': {'chat_id': chat_id} if chat_id else {},
        'cost_summary': default_cost_summary(),
        'session_summary': default_session_summary(),
        'teacher_preview': bool(bootstrap.get('teacherPreview')),
        'ui_language': ui_language,
        'created_at': now,
        'updated_at': now,
    }


def build_learning_event_payload(
    session_record: dict[str, Any],
    *,
    event_type: str,
    turn_index: int | None = None,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        'org_id': session_record.get('org_id'),
        'class_id': session_record.get('class_id'),
        'assignment_id': session_record.get('assignment_id'),
        'session_id': session_record.get('id'),
        'student_uid': session_record.get('student_uid'),
        'event_type': event_type,
        'turn_index': turn_index,
        'payload': payload or {},
        'created_at': _utc_now(),
    }


def serialize_practice_session(session_record: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(session_record, dict):
        return None

    transcript_ref = session_record.get('transcript_ref', {}) if isinstance(session_record, dict) else {}
    return {
        'id': session_record.get('id'),
        'orgId': session_record.get('org_id'),
        'classId': session_record.get('class_id'),
        'assignmentId': session_record.get('assignment_id'),
        'studentUid': session_record.get('student_uid'),
        'chatId': transcript_ref.get('chat_id'),
        'status': session_record.get('status', 'active'),
        'modality': session_record.get('modality', 'hybrid'),
        'voiceEnabled': bool(session_record.get('voice_enabled')),
        'textEnabled': bool(session_record.get('text_enabled')),
        'startedAt': _timestamp_to_iso(session_record.get('started_at')),
        'endedAt': _timestamp_to_iso(session_record.get('ended_at')),
        'promptVersion': session_record.get('prompt_version', DEFAULT_PROMPT_VERSION),
        'sessionSummary': serialize_session_summary(session_record.get('session_summary')),
        'costSummary': serialize_cost_summary(session_record.get('cost_summary')),
        'teacherPreview': bool(session_record.get('teacher_preview')),
    }


def apply_learning_event_to_session(
    session_record: dict[str, Any],
    *,
    event_type: str,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload = payload if isinstance(payload, dict) else {}
    summary = normalize_session_summary(session_record.get('session_summary'))
    cost_summary = normalize_cost_summary(session_record.get('cost_summary'))
    now = _utc_now()

    if event_type == 'student.turn':
        content = _normalize_string(payload.get('content'))
        word_count = _coerce_int(payload.get('wordCount'))
        if word_count is None:
            word_count = _count_words(content)
        speaking_time_seconds = _coerce_int(payload.get('estimatedSpeakingTimeSeconds'))
        if speaking_time_seconds is None:
            speaking_time_seconds = _estimate_speaking_time_seconds(word_count)

        summary['student_turn_count'] += 1
        summary['total_turns'] += 1
        summary['total_student_words'] += word_count
        summary['estimated_speaking_time_seconds'] += speaking_time_seconds

        target_expressions = (session_record.get('mapping_snapshot') or {}).get('targetExpressions', [])
        expression_hits = _count_target_expression_hits(content, target_expressions if isinstance(target_expressions, list) else [])
        for expression, count in expression_hits.items():
            summary['target_expression_hits'][expression] = summary['target_expression_hits'].get(expression, 0) + count
            summary['target_expression_total_hits'] += count

        if session_record.get('voice_enabled'):
            cost_summary['estimated_voice_seconds'] += speaking_time_seconds
        else:
            cost_summary['estimated_text_turns'] += 1

    elif event_type == 'assistant.turn':
        summary['assistant_turn_count'] += 1
        summary['total_turns'] += 1
        cost_summary['estimated_text_turns'] += 1

    elif event_type == 'feedback.recast':
        summary['feedback_counts']['recast'] += 1
    elif event_type == 'feedback.elicitation':
        summary['feedback_counts']['elicitation'] += 1
    elif event_type == 'feedback.review_item':
        summary['feedback_counts']['review_item'] += 1
    elif event_type == 'metric.target_expression_hit':
        expression = _normalize_string(payload.get('expression'))
        count = _coerce_int(payload.get('count')) or 1
        if expression:
            summary['target_expression_hits'][expression] = summary['target_expression_hits'].get(expression, 0) + count
            summary['target_expression_total_hits'] += count
    elif event_type == 'metric.self_correction':
        summary['self_correction_count'] += _coerce_int(payload.get('count')) or 1
    elif event_type == 'task.completed':
        summary['task_completion_count'] += _coerce_int(payload.get('count')) or 1

    updates: dict[str, Any] = {
        'session_summary': normalize_session_summary(summary),
        'cost_summary': normalize_cost_summary(cost_summary),
        'updated_at': now,
    }

    if event_type == 'session.ended':
        requested_status = _normalize_string(payload.get('status')) or 'completed'
        ended_status = requested_status if requested_status in SESSION_STATUSES else 'completed'
        updates['status'] = ended_status
        updates['ended_at'] = now
        updates['session_summary']['ended_reason'] = _normalize_string(payload.get('reason')) or 'ended'

    return updates


def build_assignment_analytics_payload(
    assignment: dict[str, Any],
    sessions: list[dict[str, Any]],
) -> dict[str, Any]:
    unique_student_ids = {
        session.get('student_uid')
        for session in sessions
        if isinstance(session.get('student_uid'), str) and session.get('student_uid')
    }

    total_student_turns = 0
    total_assistant_turns = 0
    total_student_words = 0
    estimated_speaking_time_seconds = 0
    target_expression_hits: dict[str, int] = {}

    completed_session_count = 0
    active_session_count = 0

    for session in sessions:
        status = session.get('status', 'active')
        if status == 'completed':
            completed_session_count += 1
        elif status == 'active':
            active_session_count += 1

        summary = normalize_session_summary(session.get('session_summary'))
        total_student_turns += summary['student_turn_count']
        total_assistant_turns += summary['assistant_turn_count']
        total_student_words += summary['total_student_words']
        estimated_speaking_time_seconds += summary['estimated_speaking_time_seconds']
        for expression, count in summary['target_expression_hits'].items():
            target_expression_hits[expression] = target_expression_hits.get(expression, 0) + count

    average_student_words_per_turn = round(
        total_student_words / total_student_turns,
        2,
    ) if total_student_turns > 0 else 0.0

    recent_sessions = sorted(
        sessions,
        key=lambda session: _timestamp_to_iso(session.get('started_at')) or '',
        reverse=True,
    )[:10]

    return {
        'assignment': serialize_assignment(assignment),
        'summary': {
            'sessionCount': len(sessions),
            'completedSessionCount': completed_session_count,
            'activeSessionCount': active_session_count,
            'uniqueStudentCount': len(unique_student_ids),
            'totalStudentTurns': total_student_turns,
            'totalAssistantTurns': total_assistant_turns,
            'totalStudentWords': total_student_words,
            'averageStudentWordsPerTurn': average_student_words_per_turn,
            'estimatedSpeakingTimeSeconds': estimated_speaking_time_seconds,
            'targetExpressionHits': target_expression_hits,
            'targetExpressionTotalHits': sum(target_expression_hits.values()),
        },
        'recentSessions': [
            session_dto
            for session in recent_sessions
            if (session_dto := serialize_practice_session(session))
        ],
        'limitations': [
            'Speaking time is currently estimated from transcript length rather than raw audio timing.',
            'Feedback and rubric analytics are still partial until richer learning event types are emitted.',
        ],
    }
