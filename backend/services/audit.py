"""Lingual admin audit logger.

Writes to the `lingual_admin_audit/` Firestore collection. Failures are
swallowed and logged so audit never blocks the business response.
"""
from __future__ import annotations

import enum
import logging
from typing import Callable

from firebase_admin import firestore as fb_firestore

logger = logging.getLogger(__name__)


class AuditAction(str, enum.Enum):
    REQUEST_APPROVED = 'request_approved'
    REQUEST_DECLINED = 'request_declined'
    ORG_SUSPENDED = 'org_suspended'
    ORG_RESTORED = 'org_restored'
    ORG_METADATA_EDITED = 'org_metadata_edited'
    ORG_VIEWED_DETAIL = 'org_viewed_detail'
    MEMBERSHIP_REMOVED = 'membership_removed'


class AuditLogger:
    """Writes audit rows. Two modes:

    - `log(...)`: fail-soft write for VIEW audits (`org_viewed_detail` etc).
      A failed write does not raise — caller is unaware.
    - `build_audit_doc(...)`: returns the doc dict WITHOUT writing. State-
      transition helpers (`database.suspend_organization`, etc) accept the
      result as `audit_entry=` and commit it atomically in a Firestore batch
      with the business write.

    Inject via RouteDeps so tests can swap it.
    """

    def __init__(self, collection_factory: Callable[[], object] | None = None):
        if collection_factory is None:
            import database
            self._collection_factory = database.get_lingual_admin_audit_collection
        else:
            self._collection_factory = collection_factory

    @staticmethod
    def build_audit_doc(
        *,
        actor_uid: str,
        action: AuditAction | str,
        target_type: str,
        target_id: str,
        target_org_id: str | None,
        metadata: dict,
        ip_hash: str,
        user_agent: str,
    ) -> dict:
        """Build a well-formed audit doc without writing.

        Used by state-transition DB helpers to batch the audit write
        atomically with the business write.
        """
        action_value = action.value if isinstance(action, AuditAction) else action
        return {
            'actor_uid': actor_uid,
            'action': action_value,
            'target': {'type': target_type, 'id': target_id},
            'target_org_id': target_org_id,
            'metadata': metadata,
            'ip_hash': ip_hash,
            'user_agent': user_agent,
            'created_at': fb_firestore.SERVER_TIMESTAMP,
        }

    def log(
        self,
        *,
        actor_uid: str,
        action: AuditAction | str,
        target_type: str,
        target_id: str,
        target_org_id: str | None,
        metadata: dict,
        ip_hash: str,
        user_agent: str,
    ) -> str | None:
        """Fail-soft write — for view audits only.

        State-transition routes MUST NOT call this; they pass
        `audit_entry=` to the DB helper instead so the audit row commits
        atomically with the state change.

        Returns the doc id, or None on failure.
        """
        doc = self.build_audit_doc(
            actor_uid=actor_uid, action=action,
            target_type=target_type, target_id=target_id,
            target_org_id=target_org_id, metadata=metadata,
            ip_hash=ip_hash, user_agent=user_agent,
        )
        try:
            _, ref = self._collection_factory().add(doc)
            return ref.id
        except Exception as exc:  # noqa: BLE001
            logger.warning('[audit] write failed: %s', exc)
            return None
