"""Practice + learning-event models. Both are append-heavy -> uuidv7 PKs."""

from __future__ import annotations

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    Text,
    TIMESTAMP,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import mapped_column

from backend.db.base import Base, created_at, legacy_id, updated_at, uuid_pk

_JSONB_OBJ = text("'{}'::jsonb")


class PracticeSession(Base):
    __tablename__ = 'practice_sessions'

    id = uuid_pk('uuidv7()')
    legacy_firestore_id = legacy_id()
    org_id = mapped_column(
        UUID(as_uuid=True), ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False
    )
    class_id = mapped_column(
        UUID(as_uuid=True), ForeignKey('classes.id', ondelete='CASCADE'), nullable=False
    )
    assignment_id = mapped_column(
        UUID(as_uuid=True), ForeignKey('assignments.id', ondelete='CASCADE'), nullable=False
    )
    student_firebase_uid = mapped_column(Text, nullable=False)
    mapping_snapshot = mapped_column(JSONB, nullable=False, server_default=_JSONB_OBJ)
    assignment_snapshot = mapped_column(JSONB, nullable=False, server_default=_JSONB_OBJ)
    curriculum_snapshot = mapped_column(JSONB, nullable=False, server_default=_JSONB_OBJ)
    pedagogy_snapshot = mapped_column(JSONB, nullable=False, server_default=_JSONB_OBJ)
    class_snapshot = mapped_column(JSONB, nullable=False, server_default=_JSONB_OBJ)
    modality = mapped_column(Text, nullable=False, server_default=text("'hybrid'"))
    voice_enabled = mapped_column(Boolean, nullable=False, server_default=text('false'))
    text_enabled = mapped_column(Boolean, nullable=False, server_default=text('true'))
    status = mapped_column(Text, nullable=False, server_default=text("'active'"))
    started_at = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=text('now()')
    )
    ended_at = mapped_column(TIMESTAMP(timezone=True))
    prompt_version = mapped_column(Text)
    system_prompt_preview = mapped_column(Text)
    transcript_ref = mapped_column(JSONB, nullable=False, server_default=_JSONB_OBJ)
    cost_summary = mapped_column(JSONB, nullable=False, server_default=_JSONB_OBJ)
    session_summary = mapped_column(JSONB, nullable=False, server_default=_JSONB_OBJ)
    analysis_state = mapped_column(JSONB, nullable=False, server_default=_JSONB_OBJ)
    teacher_preview = mapped_column(Boolean, nullable=False, server_default=text('false'))
    ui_language = mapped_column(Text, nullable=False, server_default=text("'en'"))
    org_status_when_created = mapped_column(Text)
    created_at = created_at()
    updated_at = updated_at()

    __table_args__ = (
        CheckConstraint(
            "status in ('active', 'completed', 'abandoned')", name='status'
        ),
        Index(
            'practice_sessions_assignment_student_started_idx',
            'assignment_id',
            'student_firebase_uid',
            text('started_at desc'),
        ),
        Index('practice_sessions_class_started_idx', 'class_id', text('started_at desc')),
    )


class LearningEvent(Base):
    __tablename__ = 'learning_events'

    id = uuid_pk('uuidv7()')
    legacy_firestore_id = legacy_id()
    org_id = mapped_column(
        UUID(as_uuid=True), ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False
    )
    class_id = mapped_column(
        UUID(as_uuid=True), ForeignKey('classes.id', ondelete='CASCADE'), nullable=False
    )
    assignment_id = mapped_column(
        UUID(as_uuid=True), ForeignKey('assignments.id', ondelete='CASCADE'), nullable=False
    )
    session_id = mapped_column(
        UUID(as_uuid=True), ForeignKey('practice_sessions.id', ondelete='CASCADE'), nullable=False
    )
    student_firebase_uid = mapped_column(Text, nullable=False)
    event_type = mapped_column(Text, nullable=False)
    turn_index = mapped_column(Integer)
    payload = mapped_column(JSONB, nullable=False, server_default=_JSONB_OBJ)
    created_at = created_at()

    __table_args__ = (
        Index('learning_events_session_created_idx', 'session_id', 'created_at'),
        Index(
            'learning_events_assignment_type_created_idx',
            'assignment_id',
            'event_type',
            'created_at',
        ),
        Index(
            'learning_events_class_student_created_idx',
            'class_id',
            'student_firebase_uid',
            'created_at',
        ),
    )
