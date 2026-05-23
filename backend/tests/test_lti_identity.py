"""
Unit tests for LTI identity matching and auto-enrollment.
"""

from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from backend.services.lti.identity import auto_enroll_student, match_lti_user
from backend.tests.conftest import FakeDbBase, make_membership, make_user


# ---------------------------------------------------------------------------
# Fake DB with LTI + email lookup support
# ---------------------------------------------------------------------------

class FakeLtiIdentityDb(FakeDbBase):
    """FakeDbBase extended with LTI platform and email lookup methods."""

    def __init__(self):
        super().__init__()
        self.lti_platforms: dict[str, dict] = {}
        self._membership_refs: dict[str, MagicMock] = {}
        self._enrollment_refs: dict[str, MagicMock] = {}

    # -- LTI platform methods --

    def get_lti_platform_by_issuer(self, issuer: str):
        for p in self.lti_platforms.values():
            if p.get('issuer') == issuer:
                return dict(p)
        return None

    def get_lti_platform_by_issuer_and_client_id(self, issuer: str, client_id: str):
        for p in self.lti_platforms.values():
            if p.get('issuer') == issuer and p.get('client_id') == client_id:
                return dict(p)
        return None

    def get_lti_platform_by_issuer_client_deployment(self, issuer: str, client_id: str, deployment_id: str):
        for p in self.lti_platforms.values():
            if (
                p.get('issuer') == issuer
                and p.get('client_id') == client_id
                and p.get('deployment_id') == deployment_id
            ):
                return dict(p)
        return None

    def get_lti_platform_by_org(self, org_id: str):
        for p in self.lti_platforms.values():
            if p.get('org_id') == org_id:
                return dict(p)
        return None

    # -- User email lookup --

    def get_user_by_email(self, email: str):
        for u in self.users.values():
            if u.get('email') == email:
                return dict(u)
        return None

    def get_user_by_lti_identity(self, issuer: str, canvas_user_id: str, client_id: str = ''):
        key = f'{issuer}|{client_id}|{canvas_user_id}'
        for u in self.users.values():
            if key in u.get('lti_identity_keys', []):
                return dict(u)
        return None

    # -- Memberships by user (matching the real database pattern) --

    def get_user_memberships(self, uid: str):
        results = []
        for m in self.memberships.values():
            if m.get('uid') == uid and m.get('status') in {'active', 'invited'}:
                org = self.organizations.get(m.get('orgId', '')) or {}
                results.append({
                    'id': m['id'],
                    'orgId': m.get('orgId', ''),
                    'orgName': org.get('name', ''),
                    'roles': m.get('roles', []),
                    'status': m.get('status', 'active'),
                })
        return results

    # -- Ref stubs for auto_enroll_student (persistent mocks) --

    def get_membership_ref(self, membership_id: str):
        if membership_id not in self._membership_refs:
            self._membership_refs[membership_id] = MagicMock()
        return self._membership_refs[membership_id]

    def get_enrollment_ref(self, enrollment_id: str):
        if enrollment_id not in self._enrollment_refs:
            self._enrollment_refs[enrollment_id] = MagicMock()
        return self._enrollment_refs[enrollment_id]


# ---------------------------------------------------------------------------
# Sample data
# ---------------------------------------------------------------------------

SAMPLE_PLATFORM = {
    'id': 'plat-1',
    'org_id': 'org-1',
    'issuer': 'https://canvas.example.edu',
    'client_id': '10000000001',
    'deployment_id': '1',
}


# ---------------------------------------------------------------------------
# Tests for match_lti_user
# ---------------------------------------------------------------------------

class TestMatchLtiUser(unittest.TestCase):
    """Tests for the match_lti_user function."""

    def setUp(self):
        self.db = FakeLtiIdentityDb()
        self.db.lti_platforms['plat-1'] = dict(SAMPLE_PLATFORM)

        # Create org
        self.db.organizations['org-1'] = {
            'id': 'org-1',
            'name': 'Test School',
            'type': 'school',
            'status': 'active',
        }

        # Create user
        self.db.users['teacher-1'] = make_user(
            uid='teacher-1',
            name='Jane Teacher',
            email='jane@example.edu',
        )

        # Create membership
        self.db.memberships['mem-t1'] = make_membership(
            membership_id='mem-t1',
            org_id='org-1',
            uid='teacher-1',
            roles=['teacher'],
        )

    def test_matches_by_email_in_org(self):
        """Returns correct user info when email matches a user in the org."""
        result = match_lti_user(
            self.db,
            issuer='https://canvas.example.edu',
            email='jane@example.edu',
            canvas_user_id='canvas-123',
            roles=['http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor'],
        )
        self.assertIsNotNone(result)
        self.assertEqual(result['uid'], 'teacher-1')
        self.assertEqual(result['org_id'], 'org-1')
        self.assertEqual(result['membership_id'], 'mem-t1')
        self.assertEqual(result['platform_id'], 'plat-1')
        self.assertEqual(result['role'], 'teacher')

    def test_returns_none_when_email_not_found(self):
        """Returns None when no user with that email exists."""
        result = match_lti_user(
            self.db,
            issuer='https://canvas.example.edu',
            email='unknown@example.edu',
            canvas_user_id='canvas-999',
            roles=[],
        )
        self.assertIsNone(result)

    def test_returns_none_when_no_platform(self):
        """Returns None when the issuer is unknown."""
        result = match_lti_user(
            self.db,
            issuer='https://unknown.example.edu',
            email='jane@example.edu',
            canvas_user_id='canvas-123',
            roles=[],
        )
        self.assertIsNone(result)

    def test_instructor_role_detected(self):
        """Role containing 'Instructor' maps to teacher."""
        result = match_lti_user(
            self.db,
            issuer='https://canvas.example.edu',
            email='jane@example.edu',
            canvas_user_id='canvas-123',
            roles=['http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor'],
        )
        self.assertIsNotNone(result)
        self.assertEqual(result['role'], 'teacher')

    def test_student_role_detected(self):
        """Learner role maps to student."""
        # Create student user + membership
        self.db.users['stu-1'] = make_user(uid='stu-1', name='Sam Student', email='sam@example.edu')
        self.db.memberships['mem-s1'] = make_membership(
            membership_id='mem-s1', org_id='org-1', uid='stu-1', roles=['student'],
        )

        result = match_lti_user(
            self.db,
            issuer='https://canvas.example.edu',
            email='sam@example.edu',
            canvas_user_id='canvas-456',
            roles=['http://purl.imsglobal.org/vocab/lis/v2/membership#Learner'],
        )
        self.assertIsNotNone(result)
        self.assertEqual(result['role'], 'student')

    def test_matches_by_lti_identity_when_canvas_email_differs(self):
        """Manual account links survive later launches where Canvas email differs."""
        self.db.users['teacher-1']['lti_identity_keys'] = [
            'https://canvas.example.edu|10000000001|canvas-linked-123'
        ]
        self.db.users['teacher-1']['lti_identities'] = [{
            'issuer': 'https://canvas.example.edu',
            'client_id': '10000000001',
            'canvas_user_id': 'canvas-linked-123',
            'email': 'old-canvas-email@example.edu',
            'platform_id': 'plat-1',
        }]

        result = match_lti_user(
            self.db,
            issuer='https://canvas.example.edu',
            client_id='10000000001',
            email='new-canvas-email@example.edu',
            canvas_user_id='canvas-linked-123',
            roles=['http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor'],
        )

        self.assertIsNotNone(result)
        self.assertEqual(result['uid'], 'teacher-1')
        self.assertEqual(result['membership_id'], 'mem-t1')
        self.assertEqual(result['platform_id'], 'plat-1')

    def test_client_id_disambiguates_same_canvas_issuer_across_orgs(self):
        """Shared Canvas issuers must resolve to the client-specific Lingual org."""
        self.db.lti_platforms['plat-2'] = {
            'id': 'plat-2',
            'org_id': 'org-2',
            'issuer': 'https://canvas.example.edu',
            'client_id': '20000000002',
            'deployment_id': '2',
        }
        self.db.organizations['org-2'] = {
            'id': 'org-2',
            'name': 'Second School',
            'type': 'school',
            'status': 'active',
        }
        self.db.users['teacher-2'] = make_user(
            uid='teacher-2',
            name='Terry Teacher',
            email='terry@example.edu',
        )
        self.db.memberships['mem-t2'] = make_membership(
            membership_id='mem-t2',
            org_id='org-2',
            uid='teacher-2',
            roles=['teacher'],
        )

        result = match_lti_user(
            self.db,
            issuer='https://canvas.example.edu',
            client_id='20000000002',
            email='terry@example.edu',
            canvas_user_id='canvas-222',
            roles=['http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor'],
        )

        self.assertIsNotNone(result)
        self.assertEqual(result['uid'], 'teacher-2')
        self.assertEqual(result['org_id'], 'org-2')
        self.assertEqual(result['platform_id'], 'plat-2')


# ---------------------------------------------------------------------------
# Tests for auto_enroll_student
# ---------------------------------------------------------------------------

class TestAutoEnrollStudent(unittest.TestCase):
    """Tests for the auto_enroll_student function."""

    def setUp(self):
        self.db = FakeLtiIdentityDb()
        self.db.organizations['org-1'] = {
            'id': 'org-1',
            'name': 'Test School',
            'type': 'school',
            'status': 'active',
        }
        self.db.users['stu-1'] = make_user(uid='stu-1', name='Sam Student', email='sam@example.edu')

    @patch('backend.services.lti.identity._firestore')
    def test_creates_membership_and_enrollment(self, mock_firestore):
        """Creates both a new membership and enrollment from scratch."""
        mock_firestore.ArrayUnion = MagicMock(return_value=['class-1'])
        mock_firestore.SERVER_TIMESTAMP = 'TIMESTAMP'

        enrollment_id = auto_enroll_student(
            self.db,
            uid='stu-1',
            org_id='org-1',
            class_id='class-1',
        )

        self.assertIsNotNone(enrollment_id)
        # Verify enrollment was created
        enrollment = self.db.get_student_class_enrollment('class-1', 'stu-1')
        self.assertIsNotNone(enrollment)
        self.assertEqual(enrollment['status'], 'active')
        self.assertEqual(enrollment['join_source'], 'lti')

    @patch('backend.services.lti.identity._firestore')
    def test_reactivates_inactive_enrollment(self, mock_firestore):
        """Reactivates an existing inactive enrollment."""
        mock_firestore.ArrayUnion = MagicMock(return_value=['class-1'])
        mock_firestore.SERVER_TIMESTAMP = 'TIMESTAMP'

        # Pre-create an inactive enrollment and membership
        self.db.memberships['org-1_stu-1'] = make_membership(
            membership_id='org-1_stu-1',
            org_id='org-1',
            uid='stu-1',
            roles=['student'],
            primary_class_ids=['class-1'],
        )
        self.db.create_enrollment(
            class_id='class-1',
            student_uid='stu-1',
            student_membership_id='org-1_stu-1',
            join_source='join_code',
            status='inactive',
        )

        # Verify enrollment is inactive
        enrollment_before = self.db.get_student_class_enrollment('class-1', 'stu-1')
        self.assertEqual(enrollment_before['status'], 'inactive')

        enrollment_id = auto_enroll_student(
            self.db,
            uid='stu-1',
            org_id='org-1',
            class_id='class-1',
        )

        self.assertIsNotNone(enrollment_id)
        # The enrollment_ref.update should have been called to reactivate
        self.db.get_enrollment_ref(enrollment_id).update.assert_called_once()


if __name__ == '__main__':
    unittest.main()
