"""Route tests for GET /api/lingual-admin/requests/<id> (Plan 5 Task 15).

Confirms the detail endpoint:
- returns the full request payload through the shared `_serialize_request`
  helper (camelCased top-level fields + nested admin_identity / integration
  / curriculum dicts),
- returns 404 for unknown request IDs,
- gates non-lingual-admin callers with 403.

Reuses Plan 3's `_serialize_request` (imported at the top of
`lingual_admin.py` since Task 14 fix) so the list and detail responses
stay structurally identical for a given row.
"""
import unittest
from datetime import UTC, datetime

from backend.tests.conftest import FakeDbBase, make_test_deps, make_test_app


_DETAIL_CREATED_AT = datetime(2026, 5, 1, 12, 0, 0, tzinfo=UTC)


def _detail_row_fixture():
    """A full school-request row populated for the detail endpoint.

    The nested-dict key names match what `_serialize_request` consumes
    (admin_identity.authorization_attestation, integration.canvas_url,
    integration.canvas_integration_types, curriculum.grade_ranges, etc.),
    so the test asserts on the *real* shape the wizard payload takes.
    """
    return {
        'id': 'r1',
        'school_name': 'Sunset HS',
        'org_type': 'school',
        'school_type': 'high',
        'public_private': 'public',
        'grade_size': '200-500',
        'requester_uid': 'u1',
        'requester_email': 'kim@sunset.edu',
        'requester_name': 'Kim',
        'status': 'pending',
        'website_url': 'https://sunset.edu',
        'canvas_instance_url': 'https://sunset.instructure.com',
        'official_email_domains': ['sunset.edu'],
        'created_at': _DETAIL_CREATED_AT,
        'location': {'country': 'US', 'state': 'CA', 'county': 'SF'},
        'admin_identity': {
            'full_name': 'Kim Principal',
            'school_email': 'kim@sunset.edu',
            'role_title': 'Principal',
            'authorization_attestation': {
                'confirmed_at': '2026-05-01T11:59:00+00:00',
                'ip_hash': 'sha256:xyz',
                'user_agent': 'Mozilla/5.0',
            },
        },
        'integration': {
            'canvas_url': 'https://sunset.instructure.com',
            'canvas_integration_types': ['lti', 'pat'],
        },
        'curriculum': {
            'grade_ranges': ['9-12'],
            'languages_taught': ['es', 'fr'],
            'course_frameworks': ['ap'],
        },
        'pre_invited_teachers': ['a@sunset.edu', 'b@sunset.edu'],
    }


class FakeRequestDetailDb(FakeDbBase):
    def __init__(self):
        super().__init__()
        self._row = _detail_row_fixture()

    def resolve_user_school_context(self, uid, preferred_active_membership_id=None):
        return {'lingual_admin': uid == 'admin-uid'}

    def get_school_request(self, request_id):
        if request_id == self._row['id']:
            return dict(self._row)
        return None


class RequestDetailRouteTests(unittest.TestCase):
    def setUp(self):
        from backend.routes.lingual_admin import create_lingual_admin_blueprint
        self.db = FakeRequestDetailDb()
        self.deps = make_test_deps(db=self.db)
        self.app = make_test_app(
            self.deps,
            extra_blueprints=[create_lingual_admin_blueprint(self.deps)],
        )
        self.client = self.app.test_client()
        with self.client.session_transaction() as sess:
            sess['user'] = {'uid': 'admin-uid'}

    def test_returns_full_payload_camelcased(self):
        """The detail endpoint returns the complete wizard payload with
        every nested dict camelCased exactly the way the list endpoint
        does — same `_serialize_request` codepath."""
        resp = self.client.get('/api/lingual-admin/requests/r1')
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()

        # Top-level camelCase + datetime → ISO string.
        self.assertEqual(data['id'], 'r1')
        self.assertEqual(data['schoolName'], 'Sunset HS')
        self.assertEqual(data['orgType'], 'school')
        self.assertEqual(data['schoolType'], 'high')
        self.assertEqual(data['publicPrivate'], 'public')
        self.assertEqual(data['gradeSize'], '200-500')
        self.assertEqual(data['requesterEmail'], 'kim@sunset.edu')
        self.assertEqual(data['requesterName'], 'Kim')
        self.assertEqual(data['websiteUrl'], 'https://sunset.edu')
        self.assertEqual(
            data['canvasInstanceUrl'], 'https://sunset.instructure.com'
        )
        self.assertEqual(data['officialEmailDomains'], ['sunset.edu'])
        self.assertEqual(data['createdAt'], _DETAIL_CREATED_AT.isoformat())

        # Location passes through untouched (already snake-case-free).
        self.assertEqual(
            data['location'], {'country': 'US', 'state': 'CA', 'county': 'SF'}
        )

        # admin_identity → adminIdentity with nested authorizationAttestation.
        self.assertEqual(data['adminIdentity']['fullName'], 'Kim Principal')
        self.assertEqual(data['adminIdentity']['schoolEmail'], 'kim@sunset.edu')
        self.assertEqual(data['adminIdentity']['roleTitle'], 'Principal')
        att = data['adminIdentity']['authorizationAttestation']
        self.assertEqual(att['confirmedAt'], '2026-05-01T11:59:00+00:00')
        self.assertEqual(att['ipHash'], 'sha256:xyz')
        self.assertEqual(att['userAgent'], 'Mozilla/5.0')

        # Integration camelCased — note `canvasUrl` / `canvasIntegrationTypes`,
        # not `lms` / `instanceUrl` (those keys don't exist in the serializer).
        self.assertEqual(
            data['integration']['canvasUrl'], 'https://sunset.instructure.com'
        )
        self.assertEqual(
            data['integration']['canvasIntegrationTypes'], ['lti', 'pat']
        )

        # Curriculum camelCased — `gradeRanges` / `languagesTaught` /
        # `courseFrameworks` (not `language` / `levels`).
        self.assertEqual(data['curriculum']['gradeRanges'], ['9-12'])
        self.assertEqual(data['curriculum']['languagesTaught'], ['es', 'fr'])
        self.assertEqual(data['curriculum']['courseFrameworks'], ['ap'])

        # Pre-invited teacher list survives as-is.
        self.assertEqual(
            data['preInvitedTeachers'], ['a@sunset.edu', 'b@sunset.edu']
        )

        # No snake_case keys leak.
        self.assertNotIn('school_name', data)
        self.assertNotIn('admin_identity', data)
        self.assertNotIn('pre_invited_teachers', data)

    def test_unknown_id_is_404(self):
        resp = self.client.get('/api/lingual-admin/requests/nope')
        self.assertEqual(resp.status_code, 404)
        self.assertEqual(resp.get_json(), {'error': 'not_found'})

    def test_non_admin_is_403(self):
        with self.client.session_transaction() as sess:
            sess['user'] = {'uid': 'someone-else'}
        resp = self.client.get('/api/lingual-admin/requests/r1')
        self.assertEqual(resp.status_code, 403)


if __name__ == '__main__':
    unittest.main()
