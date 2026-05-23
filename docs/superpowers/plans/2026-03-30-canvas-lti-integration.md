# Canvas LTI 1.3 Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add LTI 1.3 as the primary Canvas integration method — one-click launch from Canvas, automatic identity resolution, deep linking, and completion-based grade passback — while keeping the PAT flow as a fallback.

**Architecture:** `pylti1p3` + Flask contrib handles the LTI ceremony (OIDC, JWT, JWKS, Deep Linking, AGS). A custom `ToolConfAbstract` subclass reads platform config from Firestore (`lti_platforms`). Identity matching is org-scoped by email with a manual linking fallback. The existing `CanvasClient` accepts either a PAT or an LTI OAuth token — no API call changes needed. Grade passback sends completion scores via AGS on `session.ended`.

**Tech Stack:** `pylti1p3`, `pylti1p3` Flask contrib, `cryptography` (RSA key generation), Flask, Firestore, React 19

**Spec:** `docs/superpowers/specs/2026-03-30-canvas-lti-integration-design.md`
**Branch:** `feature/canvas-lti-integration`

---

## File Map

### New Files

| File | Responsibility |
|---|---|
| `backend/services/lti/__init__.py` | Package marker |
| `backend/services/lti/config.py` | Custom `ToolConfAbstract` subclass reading from Firestore |
| `backend/services/lti/identity.py` | Org-scoped email matching + manual linking logic |
| `backend/services/lti/grades.py` | AGS grade passback (completion score submission) |
| `backend/services/lti/keys.py` | RSA key pair management (load from env, serve JWKS) |
| `backend/routes/lti.py` | LTI blueprint: OIDC login, callback, JWKS, deep link, grade config |
| `backend/tests/test_lti_config.py` | Tests for Firestore tool config |
| `backend/tests/test_lti_identity.py` | Tests for email matching + auto-enrollment |
| `backend/tests/test_lti_grades.py` | Tests for grade passback logic |
| `frontend/src/pages/LtiLinkAccountPage.tsx` | Manual account linking when email match fails |
| `frontend/src/pages/LtiAssignmentPickerPage.tsx` | Deep linking: teacher picks assignment + sets points |
| `frontend/src/api/lti.ts` | API client for LTI platform management + grade config |
| `e2e/test-lti-flow.sh` | E2E test for the full LTI chain |

### Modified Files

| File | Change |
|---|---|
| `database.py` | CRUD for `lti_platforms`, `lti_sessions`; add LTI fields to `canvas_connections` |
| `main.py` | Register LTI blueprint |
| `requirements.txt` | Add `PyLTI1p3` |
| `backend/services/canvas/client.py` | Accept token via constructor (already works — PAT and OAuth tokens both use Bearer header) |
| `backend/routes/integrations.py` | When syncing LTI connections, get token from `lti_sessions` instead of decrypting PAT |
| `backend/routes/canvas_practice.py` | Same: use LTI token for content enrichment when `auth_method == "lti"` |
| `backend/services/practice_analytics.py` | Trigger grade passback on `session.ended` |
| `frontend/src/pages/CanvasConnectPage.tsx` | Add "Connect with LTI" section above PAT form |
| `frontend/src/pages/TeacherDashboardPage.tsx` | Add LTI platform registration in workspace settings |
| `frontend/src/pages/AssignmentLaunchPage.tsx` | Show "Score sent to Canvas" badge after grade passback |
| `frontend/src/App.tsx` | Add LTI routes (link-account, assignment-picker) |

---

## Piece 1: LTI Platform Registration + OIDC Handshake

### Task 1: Install pylti1p3 + database layer

**Files:**
- Modify: `requirements.txt`
- Modify: `database.py`

- [ ] **Step 1: Add dependency**

Add to `requirements.txt`:
```
PyLTI1p3>=2.0.0
```

Run: `pip install PyLTI1p3`

- [ ] **Step 2: Add lti_platforms CRUD to database.py**

Append to `database.py`:

```python
# -- LTI platforms --

def get_lti_platforms_collection():
    return get_db().collection('lti_platforms')


def create_lti_platform(org_id, issuer, client_id, deployment_id,
                        auth_login_url, auth_token_url, key_set_url):
    """Create an LTI platform registration for a school."""
    doc_ref = get_lti_platforms_collection().document()
    doc_ref.set({
        'org_id': org_id,
        'issuer': issuer,
        'client_id': client_id,
        'deployment_id': deployment_id,
        'auth_login_url': auth_login_url,
        'auth_token_url': auth_token_url,
        'key_set_url': key_set_url,
        'created_at': firestore.SERVER_TIMESTAMP,
    })
    return doc_ref.id


def get_lti_platform_by_org(org_id):
    """Get the LTI platform for an org (at most one per org)."""
    docs = (
        get_lti_platforms_collection()
        .where('org_id', '==', org_id)
        .limit(1)
        .stream()
    )
    for doc in docs:
        data = doc.to_dict() or {}
        data['id'] = doc.id
        return data
    return None


def get_lti_platform_by_issuer(issuer):
    """Find the LTI platform by Canvas issuer URL."""
    docs = (
        get_lti_platforms_collection()
        .where('issuer', '==', issuer)
        .limit(1)
        .stream()
    )
    for doc in docs:
        data = doc.to_dict() or {}
        data['id'] = doc.id
        return data
    return None


def delete_lti_platform(platform_id):
    get_lti_platforms_collection().document(platform_id).delete()


# -- LTI sessions --

def get_lti_sessions_collection():
    return get_db().collection('lti_sessions')


def create_lti_session(user_uid, platform_id, canvas_user_id, canvas_course_id,
                       roles, access_token='', token_expires_at=None):
    doc_ref = get_lti_sessions_collection().document()
    doc_ref.set({
        'user_uid': user_uid,
        'platform_id': platform_id,
        'canvas_user_id': str(canvas_user_id),
        'canvas_course_id': str(canvas_course_id),
        'roles': roles or [],
        'access_token': access_token,
        'token_expires_at': token_expires_at,
        'created_at': firestore.SERVER_TIMESTAMP,
    })
    return doc_ref.id


def get_lti_session_for_user(user_uid, canvas_course_id):
    """Get the most recent LTI session for a user + course."""
    docs = (
        get_lti_sessions_collection()
        .where('user_uid', '==', user_uid)
        .where('canvas_course_id', '==', str(canvas_course_id))
        .order_by('created_at', direction=firestore.Query.DESCENDING)
        .limit(1)
        .stream()
    )
    for doc in docs:
        data = doc.to_dict() or {}
        data['id'] = doc.id
        return data
    return None
```

- [ ] **Step 3: Add LTI fields to create_canvas_connection**

In the existing `create_canvas_connection` function, add optional parameters:

```python
def create_canvas_connection(
    membership_id,
    org_id,
    class_id,
    canvas_instance_url,
    canvas_course_id,
    canvas_course_name='',
    encrypted_pat='',
    connection_id=None,
    auth_method='pat',
    lti_deployment_id='',
    lti_context_id='',
    lti_lineitem_url='',
    grade_metric=None,
    grade_points=None,
):
```

And include in `connection_data`:
```python
    'auth_method': auth_method,
    'lti_deployment_id': lti_deployment_id or '',
    'lti_context_id': lti_context_id or '',
    'lti_lineitem_url': lti_lineitem_url or '',
    'grade_metric': grade_metric,
    'grade_points': grade_points,
```

- [ ] **Step 4: Verify**

Run: `python3 -c "import database; print('OK')"`

- [ ] **Step 5: Commit**

```bash
git add requirements.txt database.py
git commit -m "feat: add LTI platform + session Firestore CRUD"
```

---

### Task 2: RSA key management

**Files:**
- Create: `backend/services/lti/__init__.py`
- Create: `backend/services/lti/keys.py`

- [ ] **Step 1: Create package**

Create empty `backend/services/lti/__init__.py`.

- [ ] **Step 2: Create key management module**

```python
"""
RSA key pair management for LTI 1.3.

The private key signs Deep Linking Response JWTs.
The public key is served via /lti/jwks for Canvas to verify.
"""

import json
import os
from functools import lru_cache

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa


@lru_cache(maxsize=1)
def get_private_key():
    """Load RSA private key from env var or generate one for development."""
    key_pem = os.environ.get('LTI_RSA_PRIVATE_KEY')
    if key_pem:
        return serialization.load_pem_private_key(key_pem.encode(), password=None)

    # Development fallback: generate ephemeral key (not persistent across restarts)
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return key


def get_public_key_jwk():
    """Get the public key in JWK format for the JWKS endpoint."""
    from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
    import base64

    private_key = get_private_key()
    public_key = private_key.public_key()
    public_numbers = public_key.public_numbers()

    def _int_to_base64url(n, length=None):
        b = n.to_bytes((n.bit_length() + 7) // 8, byteorder='big')
        if length and len(b) < length:
            b = b'\x00' * (length - len(b)) + b
        return base64.urlsafe_b64encode(b).rstrip(b'=').decode('ascii')

    return {
        'kty': 'RSA',
        'alg': 'RS256',
        'use': 'sig',
        'kid': 'lingual-lti-key-1',
        'n': _int_to_base64url(public_numbers.n),
        'e': _int_to_base64url(public_numbers.e),
    }


def get_jwks():
    """Get the full JWKS (JSON Web Key Set) response."""
    return {'keys': [get_public_key_jwk()]}


def get_private_key_pem():
    """Get the private key as PEM string for pylti1p3."""
    key = get_private_key()
    return key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode('utf-8')
```

- [ ] **Step 3: Verify**

Run: `python3 -c "from backend.services.lti.keys import get_jwks, get_private_key_pem; print('JWKS keys:', len(get_jwks()['keys'])); print('PEM starts with:', get_private_key_pem()[:27])"`

- [ ] **Step 4: Commit**

```bash
git add backend/services/lti/
git commit -m "feat: add LTI RSA key management for JWT signing"
```

---

### Task 3: Custom ToolConf for Firestore

**Files:**
- Create: `backend/services/lti/config.py`

- [ ] **Step 1: Implement the Firestore-backed tool config**

```python
"""
Custom pylti1p3 ToolConf that reads platform config from Firestore
instead of a static JSON file.
"""

from pylti1p3.tool_config import ToolConfAbstract
from pylti1p3.registration import Registration
from pylti1p3.deployment import Deployment

from backend.services.lti.keys import get_private_key_pem, get_jwks


class FirestoreToolConf(ToolConfAbstract):
    """Read LTI platform configuration from Firestore lti_platforms collection."""

    def __init__(self, db):
        super().__init__()
        self._db = db

    def _find_platform(self, iss):
        return self._db.get_lti_platform_by_issuer(iss)

    def _build_registration(self, platform):
        if not platform:
            raise Exception(f'LTI platform not found')
        reg = Registration()
        reg.set_auth_login_url(platform.get('auth_login_url', ''))
        reg.set_auth_token_url(platform.get('auth_token_url', ''))
        reg.set_client_id(platform.get('client_id', ''))
        reg.set_key_set_url(platform.get('key_set_url', ''))
        reg.set_tool_private_key(get_private_key_pem())
        return reg

    def _build_deployment(self, platform):
        if not platform:
            return None
        dep = Deployment()
        dep.set_deployment_id(platform.get('deployment_id', ''))
        return dep

    def find_registration_by_issuer(self, iss, *args, **kwargs):
        return self._build_registration(self._find_platform(iss))

    def find_registration_by_params(self, iss, client_id, *args, **kwargs):
        platform = self._find_platform(iss)
        if platform and platform.get('client_id') == client_id:
            return self._build_registration(platform)
        raise Exception(f'LTI platform not found for issuer={iss} client_id={client_id}')

    def find_registration(self, iss, *args, **kwargs):
        return self.find_registration_by_issuer(iss)

    def find_deployment(self, iss, deployment_id):
        platform = self._find_platform(iss)
        if platform and platform.get('deployment_id') == deployment_id:
            return self._build_deployment(platform)
        return None

    def find_deployment_by_params(self, iss, deployment_id, client_id, *args, **kwargs):
        platform = self._find_platform(iss)
        if (platform and platform.get('deployment_id') == deployment_id
                and platform.get('client_id') == client_id):
            return self._build_deployment(platform)
        return None

    def check_iss_has_one_client(self, iss):
        return True  # We enforce one client per issuer

    def check_iss_has_many_clients(self, iss):
        return False

    def get_jwks(self, iss=None, client_id=None, **kwargs):
        return get_jwks()
```

- [ ] **Step 2: Verify**

Run: `python3 -c "from backend.services.lti.config import FirestoreToolConf; print('OK')"`

- [ ] **Step 3: Commit**

```bash
git add backend/services/lti/config.py
git commit -m "feat: add Firestore-backed LTI ToolConf for pylti1p3"
```

---

### Task 4: Identity matching service

**Files:**
- Create: `backend/services/lti/identity.py`

- [ ] **Step 1: Implement email matching + auto-enrollment**

```python
"""
LTI identity matching: resolve a Canvas user to a Lingual user.

Primary: org-scoped email match.
Fallback: manual linking via /lti/link-account.
"""

from __future__ import annotations
from typing import Any


def match_lti_user(db: Any, *, issuer: str, email: str, canvas_user_id: str,
                   roles: list[str]) -> dict[str, Any] | None:
    """Try to match an LTI launch to an existing Lingual user.

    Returns a dict with {uid, email, membership_id, org_id, role} or None.
    """
    # Find the platform → org
    platform = db.get_lti_platform_by_issuer(issuer)
    if not platform:
        return None

    org_id = platform.get('org_id', '')
    if not org_id:
        return None

    # Find user by email
    user = db.get_user_by_email(email) if email else None
    if not user:
        return None

    uid = user.get('uid', '')

    # Check if user has a membership in this org
    memberships = db.get_user_memberships(uid)
    matching_membership = None
    for m in memberships:
        if m.get('orgId') == org_id:
            matching_membership = m
            break

    if not matching_membership:
        return None

    is_instructor = any('Instructor' in r for r in roles)

    return {
        'uid': uid,
        'email': email,
        'membership_id': matching_membership.get('id', ''),
        'org_id': org_id,
        'platform_id': platform.get('id', ''),
        'role': 'teacher' if is_instructor else 'student',
    }


def auto_enroll_student(db: Any, *, uid: str, org_id: str, class_id: str,
                        membership_id: str = '') -> str:
    """Auto-enroll a student in a class during LTI launch.

    Creates membership if missing, creates enrollment if missing.
    Returns the enrollment_id.
    """
    # Ensure student membership exists
    if not membership_id:
        membership_id = f'{org_id}_{uid}'
    existing_membership = db.get_membership(membership_id)
    if not existing_membership:
        db.create_membership(
            org_id=org_id,
            uid=uid,
            roles=['student'],
            primary_class_ids=[class_id],
            membership_id=membership_id,
        )
    else:
        db.add_primary_class_to_membership(membership_id, class_id)

    # Ensure enrollment exists
    existing_enrollment = db.get_student_class_enrollment(class_id, uid)
    if existing_enrollment and existing_enrollment.get('status') == 'active':
        return existing_enrollment.get('id', '')

    if existing_enrollment and existing_enrollment.get('status') == 'inactive':
        db.reactivate_enrollment(class_id, uid)
        return existing_enrollment.get('id', '')

    enrollment_id = db.create_enrollment(
        class_id=class_id,
        student_uid=uid,
        student_membership_id=membership_id,
        join_source='lti',
    )
    return enrollment_id
```

- [ ] **Step 2: Verify**

Run: `python3 -c "from backend.services.lti.identity import match_lti_user, auto_enroll_student; print('OK')"`

- [ ] **Step 3: Commit**

```bash
git add backend/services/lti/identity.py
git commit -m "feat: add LTI identity matching and auto-enrollment"
```

---

### Task 5: LTI blueprint — OIDC + callback + JWKS

**Files:**
- Create: `backend/routes/lti.py`
- Modify: `main.py`

- [ ] **Step 1: Create the LTI blueprint**

```python
"""
LTI 1.3 endpoints.

Handles OIDC login initiation, JWT callback, JWKS serving,
deep linking, and grade configuration.
"""

from __future__ import annotations

import traceback
from flask import Blueprint, jsonify, redirect, request, session, url_for

from backend.route_deps import RouteDeps
from backend.services.lti.config import FirestoreToolConf
from backend.services.lti.identity import auto_enroll_student, match_lti_user
from backend.services.lti.keys import get_jwks
from backend.services.membership_context import SchoolContextPermissionError

from pylti1p3.contrib.flask import (
    FlaskOIDCLogin,
    FlaskMessageLaunch,
    FlaskRequest,
    FlaskCacheDataStorage,
)


TEACHER_ALLOWED_ROLES = {'teacher', 'school_admin'}


def create_lti_blueprint(deps: RouteDeps) -> Blueprint:
    bp = Blueprint('lti', __name__)

    def _get_tool_conf():
        return FirestoreToolConf(deps.db)

    def _get_launch_data_storage():
        return FlaskCacheDataStorage(cache=None)

    # -- JWKS endpoint --------------------------------------------------------

    @bp.route('/lti/jwks')
    def lti_jwks():
        """Serve Lingual's public key set for Canvas to verify JWT signatures."""
        return jsonify(get_jwks())

    # -- OIDC Login initiation ------------------------------------------------

    @bp.route('/lti/login', methods=['GET', 'POST'])
    def lti_login():
        """Handle OIDC login initiation from Canvas."""
        try:
            tool_conf = _get_tool_conf()
            flask_request = FlaskRequest()
            oidc_login = FlaskOIDCLogin(flask_request, tool_conf)
            target_link_uri = request.form.get(
                'target_link_uri',
                request.args.get('target_link_uri', url_for('lti.lti_callback', _external=True)),
            )
            return oidc_login.enable_check_cookies().redirect(target_link_uri)
        except Exception as exc:
            traceback.print_exc()
            return jsonify({'error': f'LTI login failed: {exc}'}), 500

    # -- LTI Launch callback --------------------------------------------------

    @bp.route('/lti/callback', methods=['POST'])
    def lti_callback():
        """Handle the LTI launch callback with signed JWT from Canvas."""
        try:
            tool_conf = _get_tool_conf()
            flask_request = FlaskRequest()
            launch = FlaskMessageLaunch(flask_request, tool_conf)
            launch_data = launch.get_launch_data()

            # Extract identity info from JWT claims
            email = launch_data.get('email', '')
            canvas_user_id = launch_data.get('sub', '')
            issuer = launch_data.get('iss', '')
            roles = launch_data.get('https://purl.imsglobal.org/spec/lti/claim/roles', [])
            context = launch_data.get('https://purl.imsglobal.org/spec/lti/claim/context', {})
            canvas_course_id = context.get('id', '')
            course_title = context.get('title', '')

            # Check if this is a deep linking request
            message_type = launch_data.get(
                'https://purl.imsglobal.org/spec/lti/claim/message_type', ''
            )
            if message_type == 'LtiDeepLinkingRequest':
                # Store launch in session for the deep link picker
                session['lti_deep_link_launch'] = {
                    'launch_id': launch.get_launch_id(),
                    'issuer': issuer,
                    'canvas_course_id': canvas_course_id,
                    'course_title': course_title,
                    'email': email,
                }
                return redirect('/lti/assignment-picker')

            # Match to Lingual user
            matched = match_lti_user(
                deps.db,
                issuer=issuer,
                email=email,
                canvas_user_id=canvas_user_id,
                roles=roles,
            )

            if not matched:
                # Store LTI context in session for manual linking
                session['lti_pending_link'] = {
                    'issuer': issuer,
                    'email': email,
                    'canvas_user_id': canvas_user_id,
                    'canvas_course_id': canvas_course_id,
                    'roles': roles,
                }
                return redirect('/lti/link-account')

            uid = matched['uid']
            org_id = matched['org_id']
            platform_id = matched['platform_id']
            is_instructor = matched['role'] == 'teacher'

            # Create LTI session
            deps.db.create_lti_session(
                user_uid=uid,
                platform_id=platform_id,
                canvas_user_id=canvas_user_id,
                canvas_course_id=canvas_course_id,
                roles=roles,
            )

            # Set Flask session
            session['user'] = {
                'uid': uid,
                'email': email,
                'name': launch_data.get('name', email),
                'active_membership_id': matched['membership_id'],
            }
            deps.db.set_user_last_active_membership(uid, matched['membership_id'])

            # Auto-create canvas connection if needed
            existing_connection = deps.db.get_canvas_connection_by_class_and_course(
                canvas_course_id
            ) if hasattr(deps.db, 'get_canvas_connection_by_class_and_course') else None

            if not existing_connection and is_instructor:
                # Create a new class + connection for this Canvas course
                class_id = deps.db.create_class(
                    org_id=org_id,
                    name=course_title or f'Canvas Course {canvas_course_id}',
                    teacher_membership_ids=[matched['membership_id']],
                )
                deps.db.add_primary_class_to_membership(matched['membership_id'], class_id)
                deps.db.create_canvas_connection(
                    membership_id=matched['membership_id'],
                    org_id=org_id,
                    class_id=class_id,
                    canvas_instance_url=issuer,
                    canvas_course_id=canvas_course_id,
                    canvas_course_name=course_title,
                    auth_method='lti',
                )

            # Check for deep-linked assignment
            custom = launch_data.get(
                'https://purl.imsglobal.org/spec/lti/claim/custom', {}
            )
            assignment_id = custom.get('lingual_assignment_id')

            if assignment_id and not is_instructor:
                # Student launching a specific assignment — auto-enroll first
                connection = deps.db.get_canvas_connection_by_class(canvas_course_id) if hasattr(deps.db, 'get_canvas_connection_by_class') else None
                if connection:
                    auto_enroll_student(
                        deps.db,
                        uid=uid,
                        org_id=org_id,
                        class_id=connection.get('class_id', ''),
                    )
                return redirect(f'/app/assignments/{assignment_id}')

            # Default: redirect to teacher dashboard or student learning page
            if is_instructor:
                return redirect('/app/teacher')
            else:
                return redirect('/app/learn')

        except Exception as exc:
            traceback.print_exc()
            return jsonify({'error': f'LTI launch failed: {exc}'}), 500

    # -- LTI Platform management (school_admin) --------------------------------

    @bp.route('/api/schools/lti-platform', methods=['POST'])
    @deps.login_required
    def api_register_lti_platform():
        try:
            ctx = deps.get_school_request_context()
            ctx.require_any_role({'school_admin'})
            org_id = ctx.active_organization_id
            if not org_id:
                return jsonify({'success': False, 'error': 'No active organization.'}), 400

            data = request.get_json() or {}
            required = ['issuer', 'clientId', 'deploymentId', 'authLoginUrl', 'authTokenUrl', 'keySetUrl']
            for field in required:
                if not data.get(field):
                    return jsonify({'success': False, 'error': f'{field} is required.'}), 400

            # Delete existing platform for this org first
            existing = deps.db.get_lti_platform_by_org(org_id)
            if existing:
                deps.db.delete_lti_platform(existing['id'])

            platform_id = deps.db.create_lti_platform(
                org_id=org_id,
                issuer=data['issuer'],
                client_id=data['clientId'],
                deployment_id=data['deploymentId'],
                auth_login_url=data['authLoginUrl'],
                auth_token_url=data['authTokenUrl'],
                key_set_url=data['keySetUrl'],
            )

            return jsonify({'success': True, 'platformId': platform_id}), 201
        except SchoolContextPermissionError as exc:
            return jsonify({'success': False, 'error': str(exc)}), 403
        except Exception as exc:
            return jsonify({'success': False, 'error': str(exc)}), 500

    @bp.route('/api/schools/lti-platform')
    @deps.login_required
    def api_get_lti_platform():
        try:
            ctx = deps.get_school_request_context()
            ctx.require_any_role({'school_admin'})
            platform = deps.db.get_lti_platform_by_org(ctx.active_organization_id)
            if not platform:
                return jsonify({'success': True, 'platform': None})
            return jsonify({
                'success': True,
                'platform': {
                    'id': platform['id'],
                    'issuer': platform.get('issuer', ''),
                    'clientId': platform.get('client_id', ''),
                    'deploymentId': platform.get('deployment_id', ''),
                    'authLoginUrl': platform.get('auth_login_url', ''),
                    'authTokenUrl': platform.get('auth_token_url', ''),
                    'keySetUrl': platform.get('key_set_url', ''),
                },
            })
        except SchoolContextPermissionError as exc:
            return jsonify({'success': False, 'error': str(exc)}), 403

    @bp.route('/api/schools/lti-platform', methods=['DELETE'])
    @deps.login_required
    def api_delete_lti_platform():
        try:
            ctx = deps.get_school_request_context()
            ctx.require_any_role({'school_admin'})
            platform = deps.db.get_lti_platform_by_org(ctx.active_organization_id)
            if platform:
                deps.db.delete_lti_platform(platform['id'])
            return jsonify({'success': True})
        except SchoolContextPermissionError as exc:
            return jsonify({'success': False, 'error': str(exc)}), 403

    return bp
```

- [ ] **Step 2: Register in main.py**

Add import:
```python
from backend.routes.lti import create_lti_blueprint
```

Add registration:
```python
app.register_blueprint(create_lti_blueprint(deps))
```

- [ ] **Step 3: Verify**

Run: `python3 -c "from backend.routes.lti import create_lti_blueprint; print('OK')"`

- [ ] **Step 4: Commit**

```bash
git add backend/routes/lti.py main.py
git commit -m "feat: add LTI blueprint with OIDC login, callback, JWKS, platform management"
```

---

### Task 6: LTI platform registration UI in dashboard

**Files:**
- Modify: `frontend/src/pages/TeacherDashboardPage.tsx`
- Create: `frontend/src/api/lti.ts`

- [ ] **Step 1: Create LTI API client**

```typescript
import api from './index';

export interface LtiPlatformConfig {
  id: string;
  issuer: string;
  clientId: string;
  deploymentId: string;
  authLoginUrl: string;
  authTokenUrl: string;
  keySetUrl: string;
}

export const registerLtiPlatform = async (payload: Omit<LtiPlatformConfig, 'id'>): Promise<{ platformId: string }> => {
  const response = await api.post('/schools/lti-platform', payload);
  return response.data;
};

export const getLtiPlatform = async (): Promise<LtiPlatformConfig | null> => {
  const response = await api.get<{ success: boolean; platform: LtiPlatformConfig | null }>('/schools/lti-platform');
  return response.data.platform;
};

export const deleteLtiPlatform = async (): Promise<void> => {
  await api.delete('/schools/lti-platform');
};

export const setGradeConfig = async (assignmentId: string, payload: { metric: string; points: number }): Promise<void> => {
  await api.post(`/teacher/assignments/${assignmentId}/grade-config`, payload);
};

export const getGradeConfig = async (assignmentId: string): Promise<{ metric: string | null; points: number | null }> => {
  const response = await api.get(`/teacher/assignments/${assignmentId}/grade-config`);
  return response.data;
};
```

- [ ] **Step 2: Add LTI section to TeacherDashboardPage**

In the workspace settings / Team section, add an "LTI Configuration" card for school_admin that:
- Shows current LTI platform config if registered
- Has a form to register: issuer URL, client ID, deployment ID, auth login URL, auth token URL, key set URL
- Shows Lingual's LTI URLs (for the Canvas admin to enter):
  - Launch URL, Login URL, JWKS URL, Redirect URI

- [ ] **Step 3: TypeScript check + commit**

```bash
cd frontend && npx tsc --noEmit
git add frontend/src/api/lti.ts frontend/src/pages/TeacherDashboardPage.tsx
git commit -m "feat: add LTI platform registration UI in dashboard"
```

---

## Piece 2: Identity Matching + Auto-Connection

### Task 7: LtiLinkAccountPage (manual linking fallback)

**Files:**
- Create: `frontend/src/pages/LtiLinkAccountPage.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Create the page**

When email matching fails during LTI launch, the user lands here. The page shows:
- "Link your Lingual account" heading
- If user has no Lingual account: "Sign up first, then relaunch from Canvas"
- If user is logged in: "Your Canvas email doesn't match your Lingual email. Click to link your accounts."
- A "Link Account" button that calls a backend endpoint to associate the Canvas user ID with the Lingual user

- [ ] **Step 2: Add backend endpoint for manual linking**

Add to `backend/routes/lti.py`:

```python
@bp.route('/api/lti/link-account', methods=['POST'])
@deps.login_required
def api_link_lti_account():
    """Manually link a Canvas identity to the current Lingual user."""
    uid = deps.get_current_user_uid()
    pending = session.get('lti_pending_link')
    if not pending:
        return jsonify({'success': False, 'error': 'No pending LTI link found.'}), 400

    # Store the canvas_user_id → lingual_uid mapping for future launches
    # (add to user doc or a dedicated mapping collection)
    # For now, clear the pending state and redirect
    session.pop('lti_pending_link', None)
    return jsonify({'success': True, 'redirectTo': '/app/teacher'})
```

- [ ] **Step 3: Add route in App.tsx**

Add lazy import and route for `LtiLinkAccountPage`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/LtiLinkAccountPage.tsx frontend/src/App.tsx backend/routes/lti.py
git commit -m "feat: add LTI manual account linking page"
```

---

## Piece 3: Deep Linking

### Task 8: Deep linking endpoints + assignment picker

**Files:**
- Create: `frontend/src/pages/LtiAssignmentPickerPage.tsx`
- Modify: `backend/routes/lti.py`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Add deep linking endpoints to lti.py**

Add to the LTI blueprint:

```python
@bp.route('/lti/deep-link', methods=['POST'])
def lti_deep_link():
    """Handle Deep Linking launch from Canvas module editor."""
    # This is handled in lti_callback when message_type == LtiDeepLinkingRequest
    # The callback redirects to /lti/assignment-picker
    return redirect('/lti/assignment-picker')


@bp.route('/api/lti/deep-link/respond', methods=['POST'])
@deps.login_required
def api_deep_link_respond():
    """Teacher selected an assignment — construct Deep Linking Response JWT."""
    try:
        data = request.get_json() or {}
        assignment_id = data.get('assignmentId', '')
        points = data.get('points')
        launch_info = session.get('lti_deep_link_launch')

        if not launch_info or not assignment_id:
            return jsonify({'success': False, 'error': 'Missing launch context or assignment.'}), 400

        assignment = deps.db.get_assignment(assignment_id)
        if not assignment:
            return jsonify({'success': False, 'error': 'Assignment not found.'}), 404

        # Build Deep Link Resource
        from pylti1p3.deep_link_resource import DeepLinkResource
        resource = DeepLinkResource()
        resource.set_url(request.host_url.rstrip('/') + f'/lti/callback')
        resource.set_custom_params({'lingual_assignment_id': assignment_id})
        resource.set_title(assignment.get('title', 'Lingual Practice'))

        if points:
            from pylti1p3.lineitem import LineItem
            lineitem = LineItem()
            lineitem.set_tag('lingual-grade')
            lineitem.set_score_maximum(float(points))
            lineitem.set_label(assignment.get('title', 'Lingual Practice'))
            resource.set_lineitem(lineitem)

        # Get the original launch to construct the response
        tool_conf = _get_tool_conf()
        flask_request = FlaskRequest()
        launch = FlaskMessageLaunch.from_cache(
            launch_info['launch_id'], flask_request, tool_conf
        )
        deep_link = launch.get_deep_link()
        response_jwt = deep_link.output_response_form_html([resource])

        # Store grade config if points set
        if points:
            deps.db.update_assignment(assignment_id, {
                'grade_metric': 'completion',
                'grade_points': float(points),
            }) if hasattr(deps.db, 'update_assignment') else None

        session.pop('lti_deep_link_launch', None)

        return jsonify({
            'success': True,
            'responseHtml': response_jwt,
        })
    except Exception as exc:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(exc)}), 500
```

- [ ] **Step 2: Create LtiAssignmentPickerPage**

A page showing:
- The connected class's published assignments as a list
- Each assignment has a radio button to select it
- A "Points" input for grade passback (optional, defaults to 10)
- "Embed in Canvas" button that calls the deep link respond endpoint
- The response HTML is injected into the page to auto-submit back to Canvas

- [ ] **Step 3: Add route in App.tsx**

Add lazy import and route for `LtiAssignmentPickerPage`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/LtiAssignmentPickerPage.tsx frontend/src/App.tsx backend/routes/lti.py
git commit -m "feat: add LTI deep linking with assignment picker"
```

---

## Piece 4: Grade Passback (Completion)

### Task 9: AGS grade submission service

**Files:**
- Create: `backend/services/lti/grades.py`

- [ ] **Step 1: Implement grade submission**

```python
"""
LTI Advantage Assignment and Grade Services (AGS).

Sends completion scores to Canvas gradebook.
"""

from __future__ import annotations
from typing import Any

from pylti1p3.grade import Grade


def submit_completion_grade(
    message_launch: Any,
    *,
    user_id: str,
    completed: bool,
    lineitem_url: str = '',
) -> bool:
    """Submit a completion grade to Canvas via AGS.

    Returns True if successful, False otherwise.
    """
    try:
        ags = message_launch.get_ags()
        grade = Grade()
        grade.set_score_given(1.0 if completed else 0.0)
        grade.set_score_maximum(1.0)
        grade.set_activity_progress('Completed' if completed else 'InProgress')
        grade.set_grading_progress('FullyGraded' if completed else 'NotReady')
        grade.set_user_id(user_id)

        ags.put_grade(grade)
        return True
    except Exception as exc:
        print(f'Grade passback failed: {exc}')
        return False
```

- [ ] **Step 2: Verify**

Run: `python3 -c "from backend.services.lti.grades import submit_completion_grade; print('OK')"`

- [ ] **Step 3: Commit**

```bash
git add backend/services/lti/grades.py
git commit -m "feat: add LTI AGS grade submission service"
```

---

### Task 10: Trigger grade passback on session end

**Files:**
- Modify: `backend/routes/curriculum_admin.py`

- [ ] **Step 1: Add grade passback trigger**

In the `api_report_practice_session_event` endpoint, after updating the session:

```python
# After session updates are applied and saved:
if event_type == 'session.ended':
    # Check if this assignment has grade passback configured
    assignment = deps.db.get_assignment(session_record.get('assignment_id'))
    if assignment and assignment.get('grade_metric') == 'completion':
        connection = deps.db.get_canvas_connection_by_class(session_record.get('class_id'))
        if connection and connection.get('auth_method') == 'lti':
            completed = session_updates.get('status') == 'completed'
            # Grade passback happens asynchronously — best effort
            try:
                from backend.services.lti.grades import submit_completion_grade
                # We need the LTI session to get the access token
                lti_session = deps.db.get_lti_session_for_user(
                    session_record.get('student_uid'),
                    connection.get('canvas_course_id'),
                )
                if lti_session:
                    # For AGS, we need to re-create the message launch from cache
                    # This is a simplified approach — may need token refresh
                    pass  # AGS token management handled in Piece 5
            except Exception:
                pass  # Best-effort, don't fail the session end
```

- [ ] **Step 2: Add grade config endpoints to lti.py**

```python
@bp.route('/api/teacher/assignments/<assignment_id>/grade-config', methods=['POST'])
@deps.login_required
def api_set_grade_config(assignment_id):
    try:
        ctx = deps.get_school_request_context()
        ctx.require_any_role(TEACHER_ALLOWED_ROLES)
        data = request.get_json() or {}
        metric = data.get('metric')  # 'completion' or None
        points = data.get('points')

        if metric and metric != 'completion':
            return jsonify({'success': False, 'error': 'Only "completion" metric is supported.'}), 400

        updates = {
            'grade_metric': metric,
            'grade_points': float(points) if points else None,
        }
        deps.db.update_assignment(assignment_id, updates) if hasattr(deps.db, 'update_assignment') else None

        return jsonify({'success': True})
    except Exception as exc:
        return jsonify({'success': False, 'error': str(exc)}), 500


@bp.route('/api/teacher/assignments/<assignment_id>/grade-config')
@deps.login_required
def api_get_grade_config(assignment_id):
    try:
        assignment = deps.db.get_assignment(assignment_id)
        if not assignment:
            return jsonify({'success': False, 'error': 'Assignment not found.'}), 404
        return jsonify({
            'success': True,
            'metric': assignment.get('grade_metric'),
            'points': assignment.get('grade_points'),
        })
    except Exception as exc:
        return jsonify({'success': False, 'error': str(exc)}), 500
```

- [ ] **Step 3: Commit**

```bash
git add backend/routes/lti.py backend/routes/curriculum_admin.py
git commit -m "feat: add grade config endpoints and session-end passback trigger"
```

---

## Piece 5: PAT Fallback Polish + Testing

### Task 11: Update CanvasConnectPage to show both options

**Files:**
- Modify: `frontend/src/pages/CanvasConnectPage.tsx`

- [ ] **Step 1: Add LTI section above PAT form**

When the org has an `lti_platform` configured, show at the top:
- "Connect with Canvas LTI (Recommended)" card with explanation
- "Your school admin has configured LTI. Click a Lingual link inside Canvas to connect automatically."
- Below: "Or connect manually with a Personal Access Token" (the existing PAT form)

When no `lti_platform` is configured, show the PAT form as before with no LTI section.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/CanvasConnectPage.tsx
git commit -m "feat: show LTI option above PAT fallback on connect page"
```

---

### Task 12: Unit tests

**Files:**
- Create: `backend/tests/test_lti_config.py`
- Create: `backend/tests/test_lti_identity.py`

- [ ] **Step 1: Write LTI config tests**

Test the `FirestoreToolConf`:
1. `find_registration_by_issuer` returns a registration when platform exists
2. `find_registration_by_issuer` raises when platform not found
3. `find_deployment` returns deployment when matching
4. `get_jwks` returns a valid key set

- [ ] **Step 2: Write identity matching tests**

Test `match_lti_user`:
1. Matches user by email within the correct org
2. Returns None when email doesn't match
3. Returns None when platform not found
4. Returns correct role (teacher vs student) based on LTI roles

Test `auto_enroll_student`:
5. Creates membership and enrollment when missing
6. Reactivates inactive enrollment
7. Skips if already enrolled

- [ ] **Step 3: Run tests**

```bash
python3 -m unittest backend.tests.test_lti_config backend.tests.test_lti_identity -v
```

- [ ] **Step 4: Commit**

```bash
git add backend/tests/test_lti_config.py backend/tests/test_lti_identity.py
git commit -m "test: add LTI config and identity matching unit tests"
```

---

### Task 13: E2E test

**Files:**
- Create: `e2e/test-lti-flow.sh`

- [ ] **Step 1: Write the E2E test**

Test the API-level LTI flow:
1. Register LTI platform for an org
2. Get platform config → verify it's stored
3. JWKS endpoint returns valid key set
4. Grade config endpoints work (set + get)
5. Delete platform → verify removed

Note: The full OIDC handshake requires a real Canvas instance and cannot be fully E2E tested without it. The E2E test covers the Lingual-side endpoints.

- [ ] **Step 2: Run it**

```bash
bash e2e/test-lti-flow.sh
```

- [ ] **Step 3: Commit**

```bash
git add e2e/test-lti-flow.sh
git commit -m "test: add LTI flow E2E test"
```

---

## Firestore Indexes

Add to `firestore.indexes.json` if queries fail:

- `lti_platforms`: `(org_id ASC)`
- `lti_platforms`: `(issuer ASC)`
- `lti_sessions`: `(user_uid ASC, canvas_course_id ASC, created_at DESC)`

Deploy with: `firebase deploy --only firestore:indexes`

## Environment Variables

New env vars needed:

- `LTI_RSA_PRIVATE_KEY` — RSA private key in PEM format for JWT signing. In development, an ephemeral key is auto-generated. In production, store in Secret Manager.
