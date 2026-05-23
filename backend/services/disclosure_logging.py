from datetime import datetime, timezone, timedelta

from database import get_db


def log_disclosure_if_new(org_id, actor_uid, actor_role, student_uid, event_type, payload):
    """Log a disclosure event if one hasn't already been logged today for this actor+student+type combo.

    Deduplicates on (actor_uid, student_uid, event_type) per calendar day (UTC).
    """
    now = datetime.now(timezone.utc)
    start_of_day = now.replace(hour=0, minute=0, second=0, microsecond=0)
    start_of_next_day = start_of_day + timedelta(days=1)

    db = get_db()

    try:
        existing = (
            db.collection('consent_events')
            .where('actor_id', '==', actor_uid)
            .where('student_uid', '==', student_uid)
            .where('event_type', '==', event_type)
            .where('created_at', '>=', start_of_day)
            .where('created_at', '<', start_of_next_day)
            .limit(1)
            .get()
        )
        if len(list(existing)) > 0:
            return  # Already logged today
    except Exception as exc:
        # Missing composite index or other query failure — don't block the caller.
        # Disclosure logging is compliance infrastructure that must not break reads.
        print(f'[disclosure_logging] dedupe query failed (continuing with write): {exc}')

    db.collection('consent_events').add({
        'org_id': org_id,
        'student_uid': student_uid,
        'scope_type': 'student',
        'scope_id': student_uid,
        'event_type': event_type,
        'actor_type': actor_role,
        'actor_id': actor_uid,
        'evidence_ref': None,
        'payload': payload,
        'created_at': now,
    })
