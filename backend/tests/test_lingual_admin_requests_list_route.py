"""Route tests for GET /api/lingual-admin/requests (Plan 5 Task 14).

Confirms the list endpoint:
- returns the items list with camelCased fields,
- threads status/schoolType/country/sort query params to the DB layer,
- rejects invalid sort values with 400,
- gates non-lingual-admin callers with 403,
- serializes a full Firestore row (nested dicts + datetimes) correctly
  through the shared `_serialize_request` helper.
"""
import unittest
from datetime import UTC, datetime

from backend.tests.conftest import FakeDbBase, make_test_deps, make_test_app


_FULL_ROW_CREATED_AT = datetime(2026, 5, 1, 12, 0, 0, tzinfo=UTC)
_FULL_ROW_REVIEWED_AT = datetime(2026, 5, 2, 12, 0, 0, tzinfo=UTC)


def _full_row_fixture():
    """A school-request row that exercises every serialization branch.

    Nested dicts (admin_identity / integration / curriculum / location),
    datetimes (created_at / reviewed_at), and the pre_invited_teachers
    list are all populated so the test can assert the serializer flattens
    them to camelCase + ISO strings.
    """
    return {
        'id': 'r2',
        'school_name': 'Riverside Prep',
        'org_type': 'school',
        'school_type': 'high',
        'public_private': 'public',
        'grade_size': '200-500',
        'website_url': 'https://riverside.example',
        'canvas_instance_url': 'https://canvas.riverside.example',
        'status': 'pending',
        'created_at': _FULL_ROW_CREATED_AT,
        'reviewed_at': _FULL_ROW_REVIEWED_AT,
        'requester_uid': 'user-1',
        'requester_email': 'user@riverside.example',
        'requester_name': 'Jamie Rivers',
        'official_email_domains': ['riverside.example'],
        'location': {'country': 'US', 'state': 'CA', 'county': 'Marin'},
        'admin_identity': {
            'full_name': 'Jamie Rivers',
            'school_email': 'jamie@riverside.example',
            'role_title': 'Principal',
            'authorization_attestation': {
                'confirmed_at': '2026-05-01T11:59:00+00:00',
                'ip_hash': 'sha256:abc',
                'user_agent': 'Mozilla/5.0',
            },
        },
        'integration': {
            'canvas_url': 'https://canvas.riverside.example',
            'canvas_integration_types': ['lti'],
        },
        'curriculum': {
            'grade_ranges': ['9-12'],
            'languages_taught': ['es', 'fr'],
            'course_frameworks': ['ap'],
        },
        'pre_invited_teachers': ['t1@riverside.example', 't2@riverside.example'],
    }


class FakeRequestsDb(FakeDbBase):
    def __init__(self, *, rows=None, next_cursor=None):
        super().__init__()
        # Default to the original minimal row so existing tests pass; the
        # full-row test injects its own rows via the constructor.
        self._rows = rows if rows is not None else [
            {'id': 'r1', 'school_name': 'Sunset', 'status': 'pending'},
        ]
        self._next_cursor = next_cursor

    def resolve_user_school_context(self, uid, preferred_active_membership_id=None):
        return {'lingual_admin': uid == 'admin-uid'}

    def list_school_requests(self, *, status_filter=None, school_type=None,
                             country=None, requested_after=None,
                             requested_before=None, sort='requested_at_desc',
                             limit=50, cursor=None):
        # Mirror the production-side guard so route-level error handling
        # (400 on bad sort) is exercised end-to-end in tests.
        from database import ALLOWED_REQUEST_SORTS
        if sort not in ALLOWED_REQUEST_SORTS:
            raise ValueError(f'Invalid sort {sort!r}')
        self.last_kwargs = dict(
            status_filter=status_filter, school_type=school_type,
            country=country, requested_after=requested_after,
            requested_before=requested_before, sort=sort,
            limit=limit, cursor=cursor,
        )
        return {'items': [dict(r) for r in self._rows], 'next_cursor': self._next_cursor}


class RequestsListRouteTests(unittest.TestCase):
    def setUp(self):
        from backend.routes.lingual_admin import create_lingual_admin_blueprint
        self.db = FakeRequestsDb()
        self.deps = make_test_deps(db=self.db)
        self.app = make_test_app(
            self.deps,
            extra_blueprints=[create_lingual_admin_blueprint(self.deps)],
        )
        self.client = self.app.test_client()
        with self.client.session_transaction() as sess:
            sess['user'] = {'uid': 'admin-uid'}

    def test_default_returns_items(self):
        resp = self.client.get('/api/lingual-admin/requests')
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(len(data['items']), 1)
        self.assertEqual(data['items'][0]['schoolName'], 'Sunset')

    def test_passes_filters_to_db(self):
        resp = self.client.get(
            '/api/lingual-admin/requests'
            '?status=pending&schoolType=high&country=US&sort=name'
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(self.db.last_kwargs['status_filter'], 'pending')
        self.assertEqual(self.db.last_kwargs['school_type'], 'high')
        self.assertEqual(self.db.last_kwargs['country'], 'US')
        self.assertEqual(self.db.last_kwargs['sort'], 'name')

    def test_cursor_input_is_snakeized_and_forwarded_to_db(self):
        import json

        cursor_param = json.dumps({
            'leadingValue': _FULL_ROW_CREATED_AT.isoformat(),
            'id': 'r100',
        })
        resp = self.client.get(
            '/api/lingual-admin/requests',
            query_string={'cursor': cursor_param},
        )

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(
            self.db.last_kwargs['cursor'],
            {'leading_value': _FULL_ROW_CREATED_AT, 'id': 'r100'},
        )

    def test_invalid_cursor_400(self):
        resp = self.client.get('/api/lingual-admin/requests?cursor=not-json')
        self.assertEqual(resp.status_code, 400)

    def test_next_cursor_is_camelcased_and_iso_serialized(self):
        from backend.routes.lingual_admin import create_lingual_admin_blueprint

        db = FakeRequestsDb(
            next_cursor={'leading_value': _FULL_ROW_CREATED_AT, 'id': 'r100'},
        )
        deps = make_test_deps(db=db)
        app = make_test_app(
            deps,
            extra_blueprints=[create_lingual_admin_blueprint(deps)],
        )
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['user'] = {'uid': 'admin-uid'}

        resp = client.get('/api/lingual-admin/requests')

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.get_json()['nextCursor'], {
            'leadingValue': _FULL_ROW_CREATED_AT.isoformat(),
            'id': 'r100',
        })

    def test_invalid_sort_rejected(self):
        resp = self.client.get('/api/lingual-admin/requests?sort=banana')
        self.assertEqual(resp.status_code, 400)

    def test_non_admin_is_403(self):
        with self.client.session_transaction() as sess:
            sess['user'] = {'uid': 'someone'}
        resp = self.client.get('/api/lingual-admin/requests')
        self.assertEqual(resp.status_code, 403)

    def test_serializes_full_row_shape(self):
        """A row carrying nested dicts and datetime fields round-trips
        through the shared `_serialize_request` helper: top-level
        datetimes become ISO strings, nested dicts become camelCased
        objects, and `pre_invited_teachers` survives as a list. Catches
        regressions where the lingual-admin route stops reusing the
        Plan 3 serializer and drifts back to a partial renamer (the
        original `_camel_request_row` shipped with that bug)."""
        from backend.routes.lingual_admin import create_lingual_admin_blueprint
        full_db = FakeRequestsDb(rows=[_full_row_fixture()])
        deps = make_test_deps(db=full_db)
        app = make_test_app(
            deps,
            extra_blueprints=[create_lingual_admin_blueprint(deps)],
        )
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['user'] = {'uid': 'admin-uid'}

        resp = client.get('/api/lingual-admin/requests')
        self.assertEqual(resp.status_code, 200)
        item = resp.get_json()['items'][0]

        # Datetimes serialized to ISO strings (not raw datetime objects).
        self.assertIsInstance(item['createdAt'], str)
        self.assertEqual(item['createdAt'], _FULL_ROW_CREATED_AT.isoformat())
        self.assertIsInstance(item['reviewedAt'], str)
        self.assertEqual(item['reviewedAt'], _FULL_ROW_REVIEWED_AT.isoformat())

        # Nested admin_identity flattened to camelCase keys.
        self.assertEqual(item['adminIdentity']['fullName'], 'Jamie Rivers')
        self.assertEqual(
            item['adminIdentity']['schoolEmail'], 'jamie@riverside.example'
        )
        self.assertEqual(item['adminIdentity']['roleTitle'], 'Principal')
        # Nested-of-nested attestation block is camelCased too.
        att = item['adminIdentity']['authorizationAttestation']
        self.assertEqual(att['confirmedAt'], '2026-05-01T11:59:00+00:00')
        self.assertEqual(att['ipHash'], 'sha256:abc')
        self.assertEqual(att['userAgent'], 'Mozilla/5.0')

        # Other top-level camelCased fields land cleanly.
        self.assertEqual(item['schoolName'], 'Riverside Prep')
        self.assertEqual(item['schoolType'], 'high')
        self.assertEqual(item['publicPrivate'], 'public')
        self.assertEqual(item['gradeSize'], '200-500')
        self.assertEqual(item['officialEmailDomains'], ['riverside.example'])

        # pre_invited_teachers survives as a list with the same emails.
        self.assertEqual(
            item['preInvitedTeachers'],
            ['t1@riverside.example', 't2@riverside.example'],
        )

        # Integration / curriculum nested dicts also camelCased.
        self.assertEqual(item['integration']['canvasIntegrationTypes'], ['lti'])
        self.assertEqual(item['curriculum']['gradeRanges'], ['9-12'])
        self.assertEqual(item['curriculum']['languagesTaught'], ['es', 'fr'])

        # No snake_case keys leaked into the response.
        self.assertNotIn('school_name', item)
        self.assertNotIn('admin_identity', item)
        self.assertNotIn('pre_invited_teachers', item)


if __name__ == '__main__':
    unittest.main()
