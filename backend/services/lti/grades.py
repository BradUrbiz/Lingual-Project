"""
LTI Advantage Assignment and Grade Services (AGS).
Sends completion scores to Canvas gradebook.
"""
from __future__ import annotations
from typing import Any

from pylti1p3.grade import Grade


def submit_completion_grade(message_launch: Any, *, user_id: str, completed: bool) -> bool:
    """Submit a completion grade (1.0 or 0.0) to Canvas via AGS.
    Returns True if successful, False otherwise.
    """
    try:
        ags = message_launch.get_ags()
        grade = Grade()
        grade.set_score_given(1.0 if completed else 0.0)
        grade.set_score_maximum(1.0)
        grade.set_activity_progress('Completed' if completed else 'InProgress')
        grade.set_grading_progress('FullyGraded' if completed else 'NotReady')
        grade.set_user_id(user_id)
        ags.put_grade(grade)
        return True
    except Exception as exc:
        print(f'LTI grade passback failed: {exc}')
        return False
