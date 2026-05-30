"""LTI 1.3 models: durable platform registrations and launch sessions.

Live Firestore collections today (not PyLTI1p3 session files). The JWKS private
key stays in Secret Manager; transient OIDC state stays in the Flask session.
"""

from __future__ import annotations

from sqlalchemy import (
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


class LtiPlatform(Base):
    __tablename__ = 'lti_platforms'

    id = uuid_pk()
    legacy_firestore_id = legacy_id()
    org_id = mapped_column(
        UUID(as_uuid=True), ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False
    )
    issuer = mapped_column(Text, nullable=False)
    client_id = mapped_column(Text, nullable=False)
    deployment_id = mapped_column(Text, nullable=False)
    auth_login_url = mapped_column(Text, nullable=False)
    auth_token_url = mapped_column(Text, nullable=False)
    key_set_url = mapped_column(Text, nullable=False)
    created_at = created_at()
    updated_at = updated_at()

    __table_args__ = (
        UniqueConstraint(
            'issuer', 'client_id', 'deployment_id', name='lti_platforms_issuer_client_deploy_uq'
        ),
        Index('lti_platforms_org_idx', 'org_id'),
    )


class LtiSession(Base):
    __tablename__ = 'lti_sessions'

    id = uuid_pk()
    legacy_firestore_id = legacy_id()
    platform_id = mapped_column(
        UUID(as_uuid=True), ForeignKey('lti_platforms.id', ondelete='CASCADE'), nullable=False
    )
    user_firebase_uid = mapped_column(Text, nullable=False)
    canvas_user_id = mapped_column(Text)
    canvas_course_id = mapped_column(Text)
    roles = mapped_column(ARRAY(Text), nullable=False, server_default=text("'{}'"))
    access_token = mapped_column(Text)
    token_expires_at = mapped_column(TIMESTAMP(timezone=True))
    created_at = created_at()
    updated_at = updated_at()

    __table_args__ = (
        Index('lti_sessions_user_idx', 'user_firebase_uid', text('created_at desc')),
        Index('lti_sessions_platform_course_idx', 'platform_id', 'canvas_course_id'),
    )
