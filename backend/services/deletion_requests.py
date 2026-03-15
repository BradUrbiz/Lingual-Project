from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from backend.services.compliance import create_consent_event

SUPPORTED_SCOPE_TYPES = {"student", "class", "org"}

VALID_REQUEST_STATUSES = {
    "requested", "approved", "rejected",
    "in_progress", "completed", "failed", "partially_completed",
}

VALID_RUN_STATUSES = {"running", "completed", "failed", "partially_completed"}

TERMINAL_REQUEST_STATUSES = {"rejected", "completed", "failed", "partially_completed"}

# Approval matrix: who can request and approve per scope type.
# Requesters are checked at the route level; approval requires school_admin.
SCOPE_ALLOWED_REQUESTERS = {
    "student": {"teacher", "school_admin"},
    "class": {"teacher", "school_admin"},
    "org": {"school_admin"},
}

# Collections targeted by each scope type (frozen scope rules from TECH_SPEC).
STUDENT_SCOPE_COLLECTIONS = [
    "practice_sessions",
    "learning_events",
    "student_compliance_records",
    "consent_events",
    "guardian_consent_packets",
]

CLASS_SCOPE_COLLECTIONS = [
    "practice_sessions",
    "learning_events",
]

ORG_SCOPE_COLLECTIONS = [
    "practice_sessions",
    "learning_events",
    "student_compliance_records",
    "consent_events",
    "guardian_consent_packets",
    "classes",
    "enrollments",
    "memberships",
    "curriculum_mappings",
    "assignments",
]


class DeletionRequestError(Exception):
    """Base error for deletion request operations."""


class DeletionRequestNotFoundError(DeletionRequestError):
    """Raised when a deletion request cannot be found."""


class DeletionRequestStateError(DeletionRequestError):
    """Raised when an action is invalid for the current request state."""


def _normalize_string(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip()


def _timestamp_to_iso(value: Any) -> str | None:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if hasattr(value, "seconds"):
        return datetime.fromtimestamp(value.seconds, UTC).isoformat()
    return str(value)


def _target_collections_for_scope(scope_type: str) -> list[str]:
    if scope_type == "student":
        return list(STUDENT_SCOPE_COLLECTIONS)
    if scope_type == "class":
        return list(CLASS_SCOPE_COLLECTIONS)
    if scope_type == "org":
        return list(ORG_SCOPE_COLLECTIONS)
    return []


def validate_scope(scope_type: str, scope_id: str) -> None:
    if scope_type not in SUPPORTED_SCOPE_TYPES:
        raise DeletionRequestError(f"Invalid scope_type: {scope_type}")
    if not scope_id:
        raise DeletionRequestError("scope_id is required.")


def validate_requester_role(scope_type: str, roles: set[str] | tuple[str, ...]) -> None:
    allowed = SCOPE_ALLOWED_REQUESTERS.get(scope_type, set())
    role_set = set(roles)
    if not role_set & allowed:
        raise DeletionRequestError(
            f"Role(s) {role_set} cannot request deletion for scope '{scope_type}'."
        )


def serialize_deletion_request(request: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": request.get("id"),
        "orgId": request.get("org_id"),
        "scopeType": request.get("scope_type"),
        "scopeId": request.get("scope_id"),
        "requestedByUid": request.get("requested_by_uid"),
        "requestReason": request.get("request_reason", ""),
        "status": request.get("status"),
        "approvedByUid": request.get("approved_by_uid", ""),
        "reviewNotes": request.get("review_notes", ""),
        "targetCollections": request.get("target_collections", []),
        "targetStoragePrefixes": request.get("target_storage_prefixes", []),
        "executionSummary": request.get("execution_summary", {}),
        "createdAt": _timestamp_to_iso(request.get("created_at")),
        "updatedAt": _timestamp_to_iso(request.get("updated_at")),
        "completedAt": _timestamp_to_iso(request.get("completed_at")),
    }


def serialize_deletion_execution_run(run: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": run.get("id"),
        "requestId": run.get("request_id"),
        "orgId": run.get("org_id"),
        "scopeType": run.get("scope_type"),
        "scopeId": run.get("scope_id"),
        "status": run.get("status"),
        "attemptNumber": run.get("attempt_number", 1),
        "firestoreCounts": run.get("firestore_counts", {}),
        "storageCounts": run.get("storage_counts", {}),
        "errorSummary": run.get("error_summary", []),
        "startedAt": _timestamp_to_iso(run.get("started_at")),
        "finishedAt": _timestamp_to_iso(run.get("finished_at")),
    }


# ---- Request lifecycle ----

def create_deletion_request(
    deps: Any,
    *,
    org_id: str,
    scope_type: str,
    scope_id: str,
    requested_by_uid: str,
    request_reason: str = "",
    actor_roles: set[str] | tuple[str, ...] = (),
) -> dict[str, Any]:
    scope_type = _normalize_string(scope_type).lower()
    scope_id = _normalize_string(scope_id)
    validate_scope(scope_type, scope_id)
    validate_requester_role(scope_type, actor_roles)

    request_id = deps.db.create_deletion_request(
        org_id=org_id,
        scope_type=scope_type,
        scope_id=scope_id,
        requested_by_uid=requested_by_uid,
        request_reason=_normalize_string(request_reason),
    )
    request = deps.db.get_deletion_request(request_id)

    create_consent_event(
        deps,
        org_id=org_id,
        student_uid=scope_id if scope_type == "student" else "",
        scope_type=scope_type,
        scope_id=scope_id,
        event_type="deletion.requested",
        actor_type="school_admin" if "school_admin" in set(actor_roles) else "teacher",
        actor_id=requested_by_uid,
        payload={
            "requestId": request_id,
            "scopeType": scope_type,
            "scopeId": scope_id,
            "reason": _normalize_string(request_reason),
        },
    )
    return request


def approve_deletion_request(
    deps: Any,
    *,
    request_id: str,
    approved_by_uid: str,
    review_notes: str = "",
) -> dict[str, Any]:
    request = _get_request_or_raise(deps, request_id)
    if request.get("status") != "requested":
        raise DeletionRequestStateError(
            f"Cannot approve a request in '{request.get('status')}' state."
        )
    scope_type = request.get("scope_type", "")
    target_collections = _target_collections_for_scope(scope_type)

    deps.db.update_deletion_request(request_id, {
        "status": "approved",
        "approved_by_uid": approved_by_uid,
        "review_notes": _normalize_string(review_notes),
        "target_collections": target_collections,
    })
    request = deps.db.get_deletion_request(request_id)

    create_consent_event(
        deps,
        org_id=request.get("org_id", ""),
        student_uid=request.get("scope_id") if scope_type == "student" else "",
        scope_type=scope_type,
        scope_id=request.get("scope_id", ""),
        event_type="deletion.approved",
        actor_type="school_admin",
        actor_id=approved_by_uid,
        payload={"requestId": request_id, "reviewNotes": _normalize_string(review_notes)},
    )
    return request


def reject_deletion_request(
    deps: Any,
    *,
    request_id: str,
    rejected_by_uid: str,
    review_notes: str = "",
) -> dict[str, Any]:
    request = _get_request_or_raise(deps, request_id)
    if request.get("status") != "requested":
        raise DeletionRequestStateError(
            f"Cannot reject a request in '{request.get('status')}' state."
        )

    deps.db.update_deletion_request(request_id, {
        "status": "rejected",
        "approved_by_uid": "",
        "review_notes": _normalize_string(review_notes),
    })
    request = deps.db.get_deletion_request(request_id)

    scope_type = request.get("scope_type", "")
    create_consent_event(
        deps,
        org_id=request.get("org_id", ""),
        student_uid=request.get("scope_id") if scope_type == "student" else "",
        scope_type=scope_type,
        scope_id=request.get("scope_id", ""),
        event_type="deletion.rejected",
        actor_type="school_admin",
        actor_id=rejected_by_uid,
        payload={"requestId": request_id, "reviewNotes": _normalize_string(review_notes)},
    )
    return request


def get_deletion_request_detail(
    deps: Any,
    *,
    request_id: str,
) -> dict[str, Any]:
    request = _get_request_or_raise(deps, request_id)
    runs = deps.db.list_deletion_execution_runs(request_id)
    request["runs"] = runs
    return request


def list_org_deletion_requests(
    deps: Any,
    *,
    org_id: str,
    status_filter: list[str] | None = None,
) -> list[dict[str, Any]]:
    return deps.db.list_deletion_requests(org_id, status_filter=status_filter)


# ---- Execution ----

def execute_deletion(
    deps: Any,
    *,
    request_id: str,
    executor_uid: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Execute a deletion request. Returns (updated_request, execution_run)."""
    request = _get_request_or_raise(deps, request_id)
    status = request.get("status", "")
    if status not in {"approved", "failed", "partially_completed"}:
        raise DeletionRequestStateError(
            f"Cannot execute a request in '{status}' state. Must be approved, failed, or partially_completed."
        )

    org_id = request.get("org_id", "")
    scope_type = request.get("scope_type", "")
    scope_id = request.get("scope_id", "")

    # Determine attempt number from prior runs
    prior_runs = deps.db.list_deletion_execution_runs(request_id)
    attempt_number = len(prior_runs) + 1

    # Mark request as in_progress
    deps.db.update_deletion_request(request_id, {"status": "in_progress"})

    # Create execution run
    run_id = deps.db.create_deletion_execution_run(
        request_id=request_id,
        org_id=org_id,
        scope_type=scope_type,
        scope_id=scope_id,
        attempt_number=attempt_number,
    )

    create_consent_event(
        deps,
        org_id=org_id,
        student_uid=scope_id if scope_type == "student" else "",
        scope_type=scope_type,
        scope_id=scope_id,
        event_type="deletion.execution_started",
        actor_type="school_admin",
        actor_id=executor_uid,
        payload={"requestId": request_id, "runId": run_id, "attemptNumber": attempt_number},
    )

    # Perform the actual deletion
    firestore_counts, storage_counts, errors = _perform_deletion(
        deps,
        org_id=org_id,
        scope_type=scope_type,
        scope_id=scope_id,
    )

    # Determine run outcome
    if errors:
        if firestore_counts["deleted"] > 0 or storage_counts["deleted"] > 0:
            run_status = "partially_completed"
        else:
            run_status = "failed"
    else:
        run_status = "completed"

    # Finalize execution run
    deps.db.update_deletion_execution_run(run_id, {
        "status": run_status,
        "firestore_counts": firestore_counts,
        "storage_counts": storage_counts,
        "error_summary": errors,
        "finished_at": datetime.now(UTC),
    })

    # Update request status and execution summary
    request_status = run_status if run_status != "running" else "in_progress"
    request_updates: dict[str, Any] = {
        "status": request_status,
        "execution_summary": {
            "lastRunId": run_id,
            "lastRunStatus": run_status,
            "firestoreCounts": firestore_counts,
            "storageCounts": storage_counts,
            "errorCount": len(errors),
        },
    }
    if run_status == "completed":
        request_updates["completed_at"] = datetime.now(UTC)

    deps.db.update_deletion_request(request_id, request_updates)

    event_type = f"deletion.execution_{run_status}"
    create_consent_event(
        deps,
        org_id=org_id,
        student_uid=scope_id if scope_type == "student" else "",
        scope_type=scope_type,
        scope_id=scope_id,
        event_type=event_type,
        actor_type="school_admin",
        actor_id=executor_uid,
        payload={
            "requestId": request_id,
            "runId": run_id,
            "firestoreCounts": firestore_counts,
            "storageCounts": storage_counts,
            "errorCount": len(errors),
        },
    )

    run = deps.db.get_deletion_execution_run(run_id)
    request = deps.db.get_deletion_request(request_id)
    return request, run


# ---- Internal helpers ----

def _get_request_or_raise(deps: Any, request_id: str) -> dict[str, Any]:
    request = deps.db.get_deletion_request(request_id)
    if not request:
        raise DeletionRequestNotFoundError("Deletion request not found.")
    return request


def _perform_deletion(
    deps: Any,
    *,
    org_id: str,
    scope_type: str,
    scope_id: str,
) -> tuple[dict[str, Any], dict[str, Any], list[str]]:
    """
    Perform Firestore document deletion for the given scope.

    Returns (firestore_counts, storage_counts, errors).
    Storage deletion is a placeholder for now (no raw audio storage yet).
    """
    firestore_counts: dict[str, Any] = {
        "targeted": 0,
        "deleted": 0,
        "failed": 0,
        "by_collection": {},
    }
    storage_counts: dict[str, Any] = {"targeted": 0, "deleted": 0, "failed": 0}
    errors: list[str] = []

    target_collections = _target_collections_for_scope(scope_type)

    for collection_name in target_collections:
        try:
            targeted, deleted, failed, col_errors = _delete_collection_docs(
                deps,
                collection_name=collection_name,
                org_id=org_id,
                scope_type=scope_type,
                scope_id=scope_id,
            )
            firestore_counts["targeted"] += targeted
            firestore_counts["deleted"] += deleted
            firestore_counts["failed"] += failed
            firestore_counts["by_collection"][collection_name] = {
                "targeted": targeted,
                "deleted": deleted,
                "failed": failed,
            }
            errors.extend(col_errors)
        except Exception as exc:
            errors.append(f"{collection_name}: {exc}")
            firestore_counts["by_collection"][collection_name] = {
                "targeted": 0,
                "deleted": 0,
                "failed": 0,
                "error": str(exc),
            }

    return firestore_counts, storage_counts, errors


def _delete_collection_docs(
    deps: Any,
    *,
    collection_name: str,
    org_id: str,
    scope_type: str,
    scope_id: str,
) -> tuple[int, int, int, list[str]]:
    """Delete docs from a collection matching the scope. Returns (targeted, deleted, failed, errors)."""
    db = deps.db
    collection_ref = db.get_db().collection(collection_name)

    # Build query based on scope
    if scope_type == "student":
        query = collection_ref.where("org_id", "==", org_id).where("student_uid", "==", scope_id)
    elif scope_type == "class":
        query = collection_ref.where("class_id", "==", scope_id)
    elif scope_type == "org":
        query = collection_ref.where("org_id", "==", org_id)
    else:
        return 0, 0, 0, [f"Unknown scope_type: {scope_type}"]

    # Special case: student_compliance_records uses composite doc IDs
    if collection_name == "student_compliance_records" and scope_type == "student":
        doc_id = f"{org_id}_{scope_id}"
        doc_ref = collection_ref.document(doc_id)
        doc = doc_ref.get()
        if doc.exists:
            try:
                doc_ref.delete()
                return 1, 1, 0, []
            except Exception as exc:
                return 1, 0, 1, [f"student_compliance_records/{doc_id}: {exc}"]
        return 0, 0, 0, []

    # For memberships in org scope, skip deletion of non-student memberships
    # (we only delete the org data, not the admin/teacher identity links)
    # Actually for org scope we delete all memberships since the whole org is going away

    docs = list(query.stream())
    targeted = len(docs)
    deleted = 0
    failed = 0
    errors: list[str] = []

    for doc in docs:
        try:
            doc.reference.delete()
            deleted += 1
        except Exception as exc:
            failed += 1
            errors.append(f"{collection_name}/{doc.id}: {exc}")

    return targeted, deleted, failed, errors
