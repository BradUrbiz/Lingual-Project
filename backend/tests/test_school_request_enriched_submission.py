import unittest
from unittest.mock import MagicMock, patch

import database


class CreateSchoolRequestEnrichedTest(unittest.TestCase):
    @patch('database.get_school_requests_collection')
    def test_legacy_thin_payload_still_works(self, mock_coll):
        doc_ref = MagicMock()
        doc_ref.id = 'req-1'
        mock_coll.return_value.document.return_value = doc_ref

        request_id = database.create_school_request(
            requester_uid='uid-1',
            requester_email='a@b.test',
            requester_name='Ada',
            school_name='SF Friends',
            org_type='school',
        )

        self.assertEqual(request_id, 'req-1')
        payload = doc_ref.set.call_args[0][0]
        self.assertEqual(payload['school_name'], 'SF Friends')
        self.assertEqual(payload['status'], 'pending')
        # Enriched fields are NOT written when omitted.
        self.assertNotIn('location', payload)
        self.assertNotIn('admin_identity', payload)

    @patch('database.get_school_requests_collection')
    def test_enriched_payload_is_merged(self, mock_coll):
        doc_ref = MagicMock()
        doc_ref.id = 'req-2'
        mock_coll.return_value.document.return_value = doc_ref

        enriched = {
            'location': {'country': 'US', 'state': 'CA', 'county': 'San Francisco'},
            'school_type': 'k12',
            'public_private': 'private',
            'grade_size': '50-100',
            'official_email_domains': ['@ssfs.org'],
            'admin_identity': {
                'full_name': 'Ada Lovelace',
                'school_email': 'ada@ssfs.org',
                'role_title': 'Principal',
                'authorization_attestation': {
                    'confirmed_at': '2026-05-18T12:00:00Z',
                    'ip_hash': 'sha256:...',
                    'user_agent': 'Mozilla/5.0',
                },
            },
            'integration': {
                'canvas_url': 'ssfs.instructure.com',
                'canvas_integration_types': ['lti13', 'roster_sync'],
            },
            'curriculum': {
                'grade_ranges': ['g6_8', 'g9_12'],
                'languages_taught': ['es', 'fr'],
                'course_frameworks': ['ap', 'actfl'],
            },
            'pre_invited_teachers': ['t1@ssfs.org', 't2@ssfs.org'],
        }

        database.create_school_request(
            requester_uid='uid-2',
            requester_email='ada@ssfs.org',
            requester_name='Ada',
            school_name='SF Friends',
            org_type='school',
            enriched=enriched,
        )

        payload = doc_ref.set.call_args[0][0]
        self.assertEqual(payload['school_type'], 'k12')
        self.assertEqual(payload['location']['state'], 'CA')
        self.assertEqual(payload['admin_identity']['role_title'], 'Principal')
        self.assertEqual(payload['integration']['canvas_integration_types'],
                         ['lti13', 'roster_sync'])
        self.assertEqual(payload['curriculum']['languages_taught'], ['es', 'fr'])
        self.assertEqual(payload['pre_invited_teachers'],
                         ['t1@ssfs.org', 't2@ssfs.org'])
        # Status default still applies.
        self.assertEqual(payload['status'], 'pending')


from backend.tests.conftest import FakeDbBase, make_test_app, make_test_deps


class FakeSchoolRequestDraftDb(FakeDbBase):
    def __init__(self):
        super().__init__()
        self.drafts = {}              # uid -> draft dict
        self.school_requests = {}     # id -> request dict
        self.next_request_id = 1
        self.created_invites = []     # list of teacher_invitations dicts
        self.lingual_admins = []      # list of {email,name}

    # -- drafts
    def get_school_creation_draft(self, uid):
        return self.drafts.get(uid)

    def upsert_school_creation_draft(self, uid, *, current_step, draft_payload):
        if not (1 <= current_step <= 4):
            raise ValueError(f'current_step out of range: {current_step}')
        if not isinstance(draft_payload, dict):
            raise ValueError('draft_payload must be a dict')
        self.drafts[uid] = {
            'uid': uid,
            'current_step': current_step,
            'draft_payload': draft_payload,
            'updated_at': 'NOW',
        }

    def delete_school_creation_draft(self, uid):
        self.drafts.pop(uid, None)

    # -- requests
    def get_user_school_request(self, uid):
        for req in self.school_requests.values():
            if req.get('requester_uid') == uid:
                return req
        return None

    def get_school_request(self, request_id):
        return self.school_requests.get(request_id)

    def create_school_request(self, *, requester_uid, requester_email, requester_name,
                               school_name, org_type, website_url='',
                               canvas_instance_url='', enriched=None):
        req_id = f'req-{self.next_request_id}'
        self.next_request_id += 1
        req = {
            'id': req_id,
            'requester_uid': requester_uid,
            'requester_email': requester_email,
            'requester_name': requester_name,
            'school_name': school_name,
            'org_type': org_type,
            'website_url': website_url,
            'canvas_instance_url': canvas_instance_url,
            'status': 'pending',
            'reviewed_by_uid': None,
            'reviewed_at': None,
            'rejection_reason': None,
            'rejection_category': None,
            'created_org_id': None,
        }
        if enriched:
            for key in (
                'location', 'school_type', 'public_private', 'grade_size',
                'official_email_domains', 'admin_identity', 'integration',
                'curriculum', 'pre_invited_teachers',
            ):
                if key in enriched:
                    req[key] = enriched[key]
        self.school_requests[req_id] = req
        return req_id

    def cancel_school_request(self, request_id, uid):
        req = self.school_requests.get(request_id)
        if req is None:
            return False
        if req.get('requester_uid') != uid:
            raise PermissionError(f'Request {request_id} not owned by {uid}')
        if req.get('status') != 'pending':
            raise ValueError(f'Request {request_id} is not pending')
        req['status'] = 'cancelled'
        return True

    def get_user_field(self, uid, field):
        user = self.users.get(uid)
        if user:
            return user.get(field)
        return None


class SchoolRequestDraftRouteTest(unittest.TestCase):
    def setUp(self):
        self.db = FakeSchoolRequestDraftDb()
        self.db.users['uid-1'] = {
            'uid': 'uid-1',
            'name': 'Ada',
            'email': 'a@b.test',
            'profile': {'display_name': 'Ada'},
        }
        self.deps = make_test_deps(db=self.db)
        from backend.routes.school_requests import create_school_requests_blueprint
        bp = create_school_requests_blueprint(self.deps)
        self.app = make_test_app(bp)
        self.app.config['TESTING'] = True
        self.client = self.app.test_client()

    def _login(self, uid):
        with self.client.session_transaction() as s:
            s['user'] = {'uid': uid, 'email': f'{uid}@test.com'}

    def test_returns_null_when_no_draft(self):
        self._login('uid-1')
        resp = self.client.get('/api/school-requests/draft')
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        self.assertTrue(body['success'])
        self.assertIsNone(body['draft'])

    def test_returns_existing_draft(self):
        self.db.drafts['uid-1'] = {
            'uid': 'uid-1',
            'current_step': 2,
            'draft_payload': {'school_name': 'SF Friends'},
            'updated_at': 'NOW',
        }
        self._login('uid-1')
        resp = self.client.get('/api/school-requests/draft')
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        self.assertEqual(body['draft']['currentStep'], 2)
        self.assertEqual(body['draft']['draftPayload']['school_name'], 'SF Friends')


class SchoolRequestDraftSaveTest(SchoolRequestDraftRouteTest):
    def test_patch_creates_draft(self):
        self._login('uid-1')
        resp = self.client.patch('/api/school-requests/draft', json={
            'currentStep': 1,
            'draftPayload': {'school_name': 'SF Friends'},
        })
        self.assertEqual(resp.status_code, 200, resp.get_json())
        self.assertEqual(self.db.drafts['uid-1']['current_step'], 1)
        self.assertEqual(
            self.db.drafts['uid-1']['draft_payload']['school_name'],
            'SF Friends',
        )

    def test_patch_overwrites_existing_draft(self):
        self.db.drafts['uid-1'] = {
            'uid': 'uid-1',
            'current_step': 1,
            'draft_payload': {'school_name': 'old'},
            'updated_at': 'NOW',
        }
        self._login('uid-1')
        resp = self.client.patch('/api/school-requests/draft', json={
            'currentStep': 2,
            'draftPayload': {'school_name': 'new', 'website_url': 'sf.org'},
        })
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(self.db.drafts['uid-1']['current_step'], 2)
        self.assertEqual(self.db.drafts['uid-1']['draft_payload']['school_name'], 'new')

    def test_patch_rejects_invalid_step(self):
        self._login('uid-1')
        resp = self.client.patch('/api/school-requests/draft', json={
            'currentStep': 9,
            'draftPayload': {},
        })
        self.assertEqual(resp.status_code, 400)
        self.assertIn('currentStep', resp.get_json()['error'])

    def test_patch_rejects_non_dict_payload(self):
        self._login('uid-1')
        resp = self.client.patch('/api/school-requests/draft', json={
            'currentStep': 1,
            'draftPayload': 'oops',
        })
        self.assertEqual(resp.status_code, 400)

    def test_patch_requires_auth(self):
        resp = self.client.patch('/api/school-requests/draft', json={
            'currentStep': 1, 'draftPayload': {},
        })
        self.assertIn(resp.status_code, (401, 302))


if __name__ == '__main__':
    unittest.main()
