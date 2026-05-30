"""Tenancy and roster models: organizations, memberships, classes,
class_teachers, class_join_codes, enrollments.

Faithful to docs/school-integration/POSTGRES_SCHEMA.md. `organizations.school_admin_uids`
is intentionally absent (derived from memberships, not stored).
"""

from __future__ import annotations

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKey,
    Index,
    Text,
    TIMESTAMP,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import mapped_column

from backend.db.base import Base, created_at, legacy_id, updated_at, uuid_pk

_ARRAY_EMPTY = text("'{}'")


class Organization(Base):
    __tablename__ = 'organizations'

    id = uuid_pk()
    legacy_firestore_id = legacy_id()
    name = mapped_column(Text, nullable=False)
    name_lower = mapped_column(Text, nullable=False)
    type = mapped_column(Text, nullable=False, server_default=text("'school'"))
    status = mapped_column(Text, nullable=False, server_default=text("'active'"))
    pilot_stage = mapped_column(Text)
    lms_capabilities = mapped_column(ARRAY(Text), nullable=False, server_default=_ARRAY_EMPTY)
    default_modality_policy = mapped_column(Text, nullable=False, server_default=text("'hybrid'"))
    default_retention_policy = mapped_column(
        Text, nullable=False, server_default=text("'standard_school'")
    )
    school_type = mapped_column(Text)
    country = mapped_column(Text)
    state = mapped_column(Text)
    county = mapped_column(Text)
    city = mapped_column(Text)
    website_url = mapped_column(Text)
    public_or_private = mapped_column(Text)
    grade_size = mapped_column(Text)
    teacher_invite_code = mapped_column(Text)
    teacher_invite_code_active = mapped_column(Boolean, nullable=False, server_default=text('false'))
    teacher_invite_code_generated_at = mapped_column(TIMESTAMP(timezone=True))
    last_activity_at = mapped_column(TIMESTAMP(timezone=True))
    suspended_at = mapped_column(TIMESTAMP(timezone=True))
    suspended_by_firebase_uid = mapped_column(Text)
    suspend_reason = mapped_column(Text)
    suspended_until = mapped_column(TIMESTAMP(timezone=True))
    restored_at = mapped_column(TIMESTAMP(timezone=True))
    restored_by_firebase_uid = mapped_column(Text)
    created_at = created_at()
    updated_at = updated_at()

    __table_args__ = (
        CheckConstraint("type in ('school')", name='type'),
        CheckConstraint("status in ('active', 'suspended', 'archived')", name='status'),
        Index('organizations_status_name_idx', 'status', 'name_lower'),
    )


class Membership(Base):
    __tablename__ = 'memberships'

    id = uuid_pk()
    legacy_firestore_id = legacy_id()
    org_id = mapped_column(
        UUID(as_uuid=True), ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False
    )
    firebase_uid = mapped_column(Text, nullable=False)
    roles = mapped_column(ARRAY(Text), nullable=False, server_default=_ARRAY_EMPTY)
    status = mapped_column(Text, nullable=False, server_default=text("'active'"))
    primary_class_ids = mapped_column(
        ARRAY(UUID(as_uuid=True)), nullable=False, server_default=_ARRAY_EMPTY
    )
    removed_at = mapped_column(TIMESTAMP(timezone=True))
    removed_by_firebase_uid = mapped_column(Text)
    created_at = created_at()
    updated_at = updated_at()

    __table_args__ = (
        CheckConstraint(
            "status in ('active', 'invited', 'inactive', 'removed')", name='status'
        ),
        Index('memberships_uid_status_idx', 'firebase_uid', 'status'),
        Index('memberships_org_status_idx', 'org_id', 'status'),
        Index(
            'memberships_org_uid_active_idx',
            'org_id',
            'firebase_uid',
            unique=True,
            postgresql_where=text("status in ('active', 'invited')"),
        ),
    )


class Class(Base):
    __tablename__ = 'classes'

    id = uuid_pk()
    legacy_firestore_id = legacy_id()
    org_id = mapped_column(
        UUID(as_uuid=True), ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False
    )
    name = mapped_column(Text, nullable=False)
    term = mapped_column(Text)
    subject = mapped_column(Text)
    learning_locale = mapped_column(Text, nullable=False, server_default=text("'ko-KR'"))
    grade_band = mapped_column(Text)
    status = mapped_column(Text, nullable=False, server_default=text("'active'"))
    canvas_course_id = mapped_column(Text)
    created_at = created_at()
    updated_at = updated_at()

    __table_args__ = (
        CheckConstraint("status in ('active', 'inactive', 'archived')", name='status'),
        Index('classes_org_status_updated_idx', 'org_id', 'status', text('updated_at desc')),
    )


class ClassTeacher(Base):
    __tablename__ = 'class_teachers'

    class_id = mapped_column(
        UUID(as_uuid=True), ForeignKey('classes.id', ondelete='CASCADE'), primary_key=True
    )
    membership_id = mapped_column(
        UUID(as_uuid=True), ForeignKey('memberships.id', ondelete='CASCADE'), primary_key=True
    )
    created_at = created_at()

    __table_args__ = (
        Index('class_teachers_membership_idx', 'membership_id', 'class_id'),
    )


class ClassJoinCode(Base):
    __tablename__ = 'class_join_codes'

    id = uuid_pk()
    class_id = mapped_column(
        UUID(as_uuid=True), ForeignKey('classes.id', ondelete='CASCADE'), nullable=False
    )
    code = mapped_column(Text, nullable=False)
    active = mapped_column(Boolean, nullable=False, server_default=text('true'))
    generated_at = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=text('now()')
    )
    deactivated_at = mapped_column(TIMESTAMP(timezone=True))
    created_at = created_at()

    __table_args__ = (
        Index(
            'class_join_codes_active_code_idx',
            'code',
            unique=True,
            postgresql_where=text('active'),
        ),
        Index(
            'class_join_codes_one_active_per_class_idx',
            'class_id',
            unique=True,
            postgresql_where=text('active'),
        ),
    )


class Enrollment(Base):
    __tablename__ = 'enrollments'

    id = uuid_pk()
    legacy_firestore_id = legacy_id()
    class_id = mapped_column(
        UUID(as_uuid=True), ForeignKey('classes.id', ondelete='CASCADE'), nullable=False
    )
    student_firebase_uid = mapped_column(Text, nullable=False)
    student_membership_id = mapped_column(
        UUID(as_uuid=True), ForeignKey('memberships.id', ondelete='SET NULL')
    )
    status = mapped_column(Text, nullable=False, server_default=text("'active'"))
    join_source = mapped_column(Text, nullable=False, server_default=text("'manual'"))
    student_number = mapped_column(Text)
    guardian_contact_required = mapped_column(
        Boolean, nullable=False, server_default=text('false')
    )
    canvas_user_id = mapped_column(Text)
    canvas_email = mapped_column(Text)
    canvas_name = mapped_column(Text)
    created_at = created_at()
    updated_at = updated_at()

    __table_args__ = (
        CheckConstraint("status in ('active', 'inactive', 'removed')", name='status'),
        CheckConstraint(
            "join_source in ('manual', 'invite', 'join_code', 'lti', "
            "'google_classroom', 'canvas_legacy')",
            name='join_source',
        ),
        UniqueConstraint('class_id', 'student_firebase_uid', name='enrollments_class_student_uq'),
        Index(
            'enrollments_student_status_updated_idx',
            'student_firebase_uid',
            'status',
            text('updated_at desc'),
        ),
        Index(
            'enrollments_class_status_updated_idx',
            'class_id',
            'status',
            text('updated_at desc'),
        ),
    )
