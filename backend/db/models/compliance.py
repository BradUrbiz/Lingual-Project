"""Compliance + privacy models: student compliance records, the append-only
consent/disclosure event stream, guardian packets, and the deletion workflow.
"""

from __future__ import annotations

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    Text,
    TIMESTAMP,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import mapped_column

from backend.db.base import Base, created_at, legacy_id, updated_at, uuid_pk

_ARRAY_EMPTY = text("'{}'")
_JSONB_OBJ = text("'{}'::jsonb")


class StudentComplianceRecord(Base):
    __tablename__ = 'student_compliance_records'

    id = uuid_pk()
    legacy_firestore_id = legacy_id()
    org_id = mapped_column(
        UUID(as_uuid=True), ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False
    )
    student_firebase_uid = mapped_column(Text, nullable=False)
    is_minor = mapped_column(Boolean, nullable=False, server_default=text('false'))
    guardian_consent_status = mapped_column(
        Text, nullable=False, server_default=text("'unknown'")
    )
    voice_consent_status = mapped_column(Text, nullable=False, server_default=text("'unknown'"))
    text_allowed = mapped_column(Boolean, nullable=False, server_default=text('true'))
    voice_allowed = mapped_column(Boolean, nullable=False, server_default=text('false'))
    retention_policy_id = mapped_column(
        Text, nullable=False, server_default=text("'standard_school'")
    )
    school_agreement_version = mapped_column(Text)
    last_verified_at = mapped_column(TIMESTAMP(timezone=True))
    created_at = created_at()
    updated_at = updated_at()

    __table_args__ = (
        CheckConstraint(
            "guardian_consent_status in ('unknown', 'granted', 'revoked', 'not_required')",
            name='guardian_consent_status',
        ),
        CheckConstraint(
            "voice_consent_status in ('unknown', 'granted', 'revoked')",
            name='voice_consent_status',
        ),
        UniqueConstraint(
            'org_id', 'student_firebase_uid', name='student_compliance_records_org_student_uq'
        ),
    )


class ConsentEvent(Base):
    __tablename__ = 'consent_events'

    # Append-heavy -> time-ordered uuidv7 for index locality.
    id = uuid_pk('uuidv7()')
    legacy_firestore_id = legacy_id()
    org_id = mapped_column(
        UUID(as_uuid=True), ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False
    )
    student_firebase_uid = mapped_column(Text)
    scope_type = mapped_column(Text, nullable=False)
    scope_id = mapped_column(Text, nullable=False)
    event_type = mapped_column(Text, nullable=False)
    actor_type = mapped_column(Text, nullable=False)
    actor_id = mapped_column(Text, nullable=False)
    evidence_ref = mapped_column(Text)
    payload = mapped_column(JSONB, nullable=False, server_default=_JSONB_OBJ)
    created_at = created_at()

    __table_args__ = (
        CheckConstraint("scope_type in ('student', 'class', 'org')", name='scope_type'),
        Index(
            'consent_events_org_student_created_idx',
            'org_id',
            'student_firebase_uid',
            text('created_at desc'),
        ),
        Index(
            'consent_events_scope_idx',
            'org_id',
            'scope_type',
            'scope_id',
            text('created_at desc'),
        ),
    )


class GuardianConsentPacket(Base):
    __tablename__ = 'guardian_consent_packets'

    id = uuid_pk()
    legacy_firestore_id = legacy_id()
    org_id = mapped_column(
        UUID(as_uuid=True), ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False
    )
    class_id = mapped_column(
        UUID(as_uuid=True), ForeignKey('classes.id', ondelete='CASCADE'), nullable=False
    )
    student_firebase_uid = mapped_column(Text, nullable=False)
    notice_version = mapped_column(Text, nullable=False)
    consent_scope = mapped_column(Text, nullable=False)
    contact_channel = mapped_column(Text)
    contact_destination_hint = mapped_column(Text)
    delivery_method = mapped_column(Text, nullable=False)
    status = mapped_column(Text, nullable=False)
    token_hash = mapped_column(Text)
    token_last_four = mapped_column(Text)
    response_method = mapped_column(Text)
    evidence_ref = mapped_column(Text)
    reminder_count = mapped_column(Integer, nullable=False, server_default=text('0'))
    expires_at = mapped_column(TIMESTAMP(timezone=True))
    issued_at = mapped_column(TIMESTAMP(timezone=True))
    last_sent_at = mapped_column(TIMESTAMP(timezone=True))
    acted_at = mapped_column(TIMESTAMP(timezone=True))
    created_by_firebase_uid = mapped_column(Text)
    created_at = created_at()
    updated_at = updated_at()

    __table_args__ = (
        CheckConstraint(
            "contact_channel is null or contact_channel in "
            "('email', 'phone', 'paper', 'other')",
            name='contact_channel',
        ),
        CheckConstraint(
            "delivery_method in ('secure_link', 'downloadable_notice')",
            name='delivery_method',
        ),
        CheckConstraint(
            "status in ('draft', 'issued', 'viewed', 'granted', 'revoked', "
            "'expired', 'canceled')",
            name='status',
        ),
        Index(
            'guardian_packets_class_student_updated_idx',
            'class_id',
            'student_firebase_uid',
            text('updated_at desc'),
        ),
    )


class DeletionRequest(Base):
    __tablename__ = 'deletion_requests'

    id = uuid_pk()
    legacy_firestore_id = legacy_id()
    org_id = mapped_column(
        UUID(as_uuid=True), ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False
    )
    scope_type = mapped_column(Text, nullable=False)
    scope_id = mapped_column(Text, nullable=False)
    requested_by_firebase_uid = mapped_column(Text, nullable=False)
    request_reason = mapped_column(Text)
    status = mapped_column(Text, nullable=False, server_default=text("'requested'"))
    approved_by_firebase_uid = mapped_column(Text)
    review_notes = mapped_column(Text)
    target_collections = mapped_column(ARRAY(Text), nullable=False, server_default=_ARRAY_EMPTY)
    target_storage_prefixes = mapped_column(
        ARRAY(Text), nullable=False, server_default=_ARRAY_EMPTY
    )
    execution_summary = mapped_column(JSONB, nullable=False, server_default=_JSONB_OBJ)
    created_at = created_at()
    updated_at = updated_at()
    completed_at = mapped_column(TIMESTAMP(timezone=True))

    __table_args__ = (
        CheckConstraint("scope_type in ('student', 'class', 'org')", name='scope_type'),
        CheckConstraint(
            "status in ('requested', 'approved', 'rejected', 'in_progress', "
            "'completed', 'failed', 'partially_completed')",
            name='status',
        ),
        Index(
            'deletion_requests_org_status_created_idx',
            'org_id',
            'status',
            text('created_at desc'),
        ),
    )


class DeletionExecutionRun(Base):
    __tablename__ = 'deletion_execution_runs'

    id = uuid_pk()
    legacy_firestore_id = legacy_id()
    request_id = mapped_column(
        UUID(as_uuid=True), ForeignKey('deletion_requests.id', ondelete='CASCADE'), nullable=False
    )
    org_id = mapped_column(
        UUID(as_uuid=True), ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False
    )
    scope_type = mapped_column(Text, nullable=False)
    scope_id = mapped_column(Text, nullable=False)
    status = mapped_column(Text, nullable=False, server_default=text("'running'"))
    attempt_number = mapped_column(Integer, nullable=False, server_default=text('1'))
    firestore_counts = mapped_column(JSONB, nullable=False, server_default=_JSONB_OBJ)
    storage_counts = mapped_column(JSONB, nullable=False, server_default=_JSONB_OBJ)
    error_summary = mapped_column(ARRAY(Text), nullable=False, server_default=_ARRAY_EMPTY)
    started_at = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=text('now()')
    )
    finished_at = mapped_column(TIMESTAMP(timezone=True))

    __table_args__ = (
        CheckConstraint("scope_type in ('student', 'class', 'org')", name='scope_type'),
        CheckConstraint(
            "status in ('running', 'completed', 'failed', 'partially_completed')",
            name='status',
        ),
        Index(
            'deletion_runs_request_attempt_idx',
            'request_id',
            'attempt_number',
            unique=True,
        ),
    )
