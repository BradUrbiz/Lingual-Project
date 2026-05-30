"""Canvas integration models: connections, synced course content, roster mirror.

canvas_roster_entries is a Canvas-truth mirror only; it grants no access by
itself (the 2026-04-21 roster-decouple invariant).
"""

from __future__ import annotations

from sqlalchemy import (
    ForeignKey,
    Index,
    Integer,
    Numeric,
    Text,
    TIMESTAMP,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import mapped_column

from backend.db.base import Base, created_at, legacy_id, updated_at, uuid_pk


class CanvasConnection(Base):
    __tablename__ = 'canvas_connections'

    id = uuid_pk()
    legacy_firestore_id = legacy_id()
    membership_id = mapped_column(
        UUID(as_uuid=True), ForeignKey('memberships.id', ondelete='SET NULL')
    )
    org_id = mapped_column(
        UUID(as_uuid=True), ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False
    )
    class_id = mapped_column(
        UUID(as_uuid=True), ForeignKey('classes.id', ondelete='CASCADE'), nullable=False
    )
    canvas_instance_url = mapped_column(Text, nullable=False)
    canvas_course_id = mapped_column(Text, nullable=False)
    canvas_course_name = mapped_column(Text)
    encrypted_pat = mapped_column(Text)
    auth_method = mapped_column(Text, nullable=False, server_default=text("'pat'"))
    lti_deployment_id = mapped_column(Text)
    lti_context_id = mapped_column(Text)
    lti_lineitem_url = mapped_column(Text)
    grade_metric = mapped_column(Text)
    grade_points = mapped_column(Numeric)
    last_synced_at = mapped_column(TIMESTAMP(timezone=True))
    sync_status = mapped_column(Text, nullable=False, server_default=text("'idle'"))
    created_at = created_at()
    updated_at = updated_at()

    __table_args__ = (
        UniqueConstraint('class_id', name='canvas_connections_class_uq'),
    )


class CanvasCourseContent(Base):
    __tablename__ = 'canvas_course_content'

    id = uuid_pk()
    legacy_firestore_id = legacy_id()
    connection_id = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('canvas_connections.id', ondelete='CASCADE'),
        nullable=False,
    )
    class_id = mapped_column(
        UUID(as_uuid=True), ForeignKey('classes.id', ondelete='CASCADE'), nullable=False
    )
    canvas_module_id = mapped_column(Text)
    canvas_module_name = mapped_column(Text)
    canvas_module_position = mapped_column(Integer, nullable=False, server_default=text('0'))
    item_id = mapped_column(Text)
    item_title = mapped_column(Text)
    item_type = mapped_column(Text)
    item_position = mapped_column(Integer, nullable=False, server_default=text('0'))
    item_html_url = mapped_column(Text)
    due_at = mapped_column(TIMESTAMP(timezone=True))
    points_possible = mapped_column(Numeric)
    linked_assignment_id = mapped_column(
        UUID(as_uuid=True), ForeignKey('assignments.id', ondelete='SET NULL')
    )
    updated_at = updated_at()

    __table_args__ = (
        Index(
            'canvas_course_content_class_order_idx',
            'class_id',
            'canvas_module_position',
            'item_position',
        ),
    )


class CanvasRosterEntry(Base):
    __tablename__ = 'canvas_roster_entries'

    id = uuid_pk()
    legacy_firestore_id = legacy_id()
    class_id = mapped_column(
        UUID(as_uuid=True), ForeignKey('classes.id', ondelete='CASCADE'), nullable=False
    )
    connection_id = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('canvas_connections.id', ondelete='CASCADE'),
        nullable=False,
    )
    canvas_user_id = mapped_column(Text, nullable=False)
    canvas_email = mapped_column(Text)
    canvas_name = mapped_column(Text)
    synced_at = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=text('now()')
    )
    created_at = created_at()

    __table_args__ = (
        UniqueConstraint('class_id', 'canvas_user_id', name='canvas_roster_entries_class_user_uq'),
        Index('canvas_roster_entries_class_email_idx', 'class_id', 'canvas_email'),
    )
