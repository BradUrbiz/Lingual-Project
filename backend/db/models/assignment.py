"""Assignment model (the AI-ready prompt fields live directly on the row)."""

from __future__ import annotations

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    Text,
    TIMESTAMP,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import mapped_column

from backend.db.base import Base, created_at, legacy_id, updated_at, uuid_pk

_ARRAY_EMPTY = text("'{}'")


class Assignment(Base):
    __tablename__ = 'assignments'

    id = uuid_pk()
    legacy_firestore_id = legacy_id()
    org_id = mapped_column(
        UUID(as_uuid=True), ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False
    )
    class_id = mapped_column(
        UUID(as_uuid=True), ForeignKey('classes.id', ondelete='CASCADE'), nullable=False
    )
    title = mapped_column(Text, nullable=False)
    description = mapped_column(Text, nullable=False, server_default=text("''"))
    status = mapped_column(Text, nullable=False, server_default=text("'draft'"))
    release_at = mapped_column(TIMESTAMP(timezone=True))
    due_at = mapped_column(TIMESTAMP(timezone=True))
    modality_override = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    max_attempts = mapped_column(Integer)
    task_type = mapped_column(Text, nullable=False, server_default=text("'decision_making'"))
    success_criteria = mapped_column(ARRAY(Text), nullable=False, server_default=_ARRAY_EMPTY)
    created_by_firebase_uid = mapped_column(Text, nullable=False)
    instructions = mapped_column(Text, nullable=False, server_default=text("''"))
    generated_scenario = mapped_column(Text, nullable=False, server_default=text("''"))
    objectives = mapped_column(ARRAY(Text), nullable=False, server_default=_ARRAY_EMPTY)
    target_expressions = mapped_column(ARRAY(Text), nullable=False, server_default=_ARRAY_EMPTY)
    target_vocabulary = mapped_column(ARRAY(Text), nullable=False, server_default=_ARRAY_EMPTY)
    focus_grammar = mapped_column(ARRAY(Text), nullable=False, server_default=_ARRAY_EMPTY)
    teacher_notes = mapped_column(Text, nullable=False, server_default=text("''"))
    student_instructions = mapped_column(Text, nullable=False, server_default=text("''"))
    target_language_intensity = mapped_column(
        Text, nullable=False, server_default=text("'balanced'")
    )
    # Nullable, NO server default (Firestore stores a map or None).
    canvas_module_item_ref = mapped_column(JSONB)
    canvas_module_item_id = mapped_column(Text)
    created_at = created_at()
    updated_at = updated_at()

    __table_args__ = (
        CheckConstraint(
            "status in ('draft', 'published', 'archived')", name='status'
        ),
        CheckConstraint(
            "task_type in ('information_gap', 'opinion_gap', 'decision_making', "
            "'custom_prompt')",
            name='task_type',
        ),
        CheckConstraint(
            "target_language_intensity in ('english_first', 'english_led', "
            "'balanced', 'target_led', 'target_only')",
            name='target_language_intensity',
        ),
        Index('assignments_class_status_due_idx', 'class_id', 'status', 'due_at'),
        Index('assignments_org_created_idx', 'org_id', text('created_at desc')),
    )
