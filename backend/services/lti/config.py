"""
Firestore-backed ToolConf for pylti1p3.

Resolves LTI platform registrations and deployments from the
``lti_platforms`` Firestore collection instead of a static JSON file.
"""

import typing as t

from pylti1p3.deployment import Deployment
from pylti1p3.registration import Registration
from pylti1p3.tool_config import ToolConfAbstract

from backend.services.lti.keys import get_jwks as _get_jwks
from backend.services.lti.keys import get_private_key_pem


class FirestoreToolConf(ToolConfAbstract):
    """pylti1p3 ToolConf that reads platform registrations from Firestore."""

    def __init__(self, db):
        """
        Args:
            db: The ``database`` module (or any object exposing
                ``get_lti_platform_by_issuer``).
        """
        super().__init__()
        self._db = db

    # ── Registration lookup ───────────────────────────────────────────

    def _build_registration(self, platform: dict) -> Registration:
        """Build a pylti1p3 Registration from a Firestore platform doc."""
        reg = Registration()
        reg.set_auth_login_url(platform['auth_login_url'])
        reg.set_auth_token_url(platform['auth_token_url'])
        reg.set_client_id(platform['client_id'])
        reg.set_key_set_url(platform['key_set_url'])
        reg.set_issuer(platform['issuer'])
        reg.set_tool_private_key(get_private_key_pem())
        return reg

    def find_registration_by_issuer(
        self, iss: str, *args, **kwargs
    ) -> t.Optional[Registration]:
        platform = self._db.get_lti_platform_by_issuer(iss)
        if not platform:
            return None
        return self._build_registration(platform)

    def find_registration_by_params(
        self, iss: str, client_id: str, *args, **kwargs
    ) -> t.Optional[Registration]:
        platform = self._db.get_lti_platform_by_issuer(iss)
        if not platform:
            return None
        if platform.get('client_id') != client_id:
            return None
        return self._build_registration(platform)

    # find_registration is inherited from ToolConfAbstract and delegates
    # to find_registration_by_issuer.

    # ── Deployment lookup ─────────────────────────────────────────────

    def _build_deployment(self, platform: dict, deployment_id: str) -> t.Optional[Deployment]:
        """Build a Deployment if the requested deployment_id matches."""
        if platform.get('deployment_id') != deployment_id:
            return None
        dep = Deployment()
        dep.set_deployment_id(deployment_id)
        return dep

    def find_deployment(
        self, iss: str, deployment_id: str
    ) -> t.Optional[Deployment]:
        platform = self._db.get_lti_platform_by_issuer(iss)
        if not platform:
            return None
        return self._build_deployment(platform, deployment_id)

    def find_deployment_by_params(
        self, iss: str, deployment_id: str, client_id: str, *args, **kwargs
    ) -> t.Optional[Deployment]:
        platform = self._db.get_lti_platform_by_issuer(iss)
        if not platform:
            return None
        if platform.get('client_id') != client_id:
            return None
        return self._build_deployment(platform, deployment_id)

    # ── Issuer relation helpers ───────────────────────────────────────

    def check_iss_has_one_client(self, iss: str) -> bool:
        """We enforce one client per issuer."""
        return True

    def check_iss_has_many_clients(self, iss: str) -> bool:
        return False

    # ── JWKS ──────────────────────────────────────────────────────────

    def get_jwks(
        self,
        iss: t.Optional[str] = None,
        client_id: t.Optional[str] = None,
        **kwargs,
    ):
        """Return the tool's JWKS (public key set)."""
        return _get_jwks()
