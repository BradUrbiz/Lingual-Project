import unittest
from unittest.mock import MagicMock, patch

from backend.services.canvas.client import (
    CanvasAuthError,
    CanvasClient,
    CanvasForbiddenError,
    CanvasNotFoundError,
    CanvasRateLimitError,
)


def _mock_response(status_code=200, json_data=None, headers=None):
    resp = MagicMock()
    resp.status_code = status_code
    resp.json.return_value = json_data or {}
    resp.headers = headers or {}
    resp.raise_for_status = MagicMock()
    if status_code >= 400:
        from requests.exceptions import HTTPError
        resp.raise_for_status.side_effect = HTTPError(response=resp)
    return resp


class CanvasClientInitTest(unittest.TestCase):
    def test_normalizes_trailing_slash(self):
        client = CanvasClient('https://school.instructure.com/', 'pat123')
        self.assertEqual(client.base_url, 'https://school.instructure.com')

    def test_normalizes_no_trailing_slash(self):
        client = CanvasClient('https://school.instructure.com', 'pat123')
        self.assertEqual(client.base_url, 'https://school.instructure.com')


class GetUserTest(unittest.TestCase):
    @patch('backend.services.canvas.client.requests.get')
    def test_get_user_success(self, mock_get):
        mock_get.return_value = _mock_response(200, {
            'id': 1, 'name': 'Test Teacher', 'email': 'teacher@school.edu',
        })
        client = CanvasClient('https://school.instructure.com', 'pat123')
        user = client.get_user()
        self.assertEqual(user['name'], 'Test Teacher')
        mock_get.assert_called_once()
        call_args = mock_get.call_args
        self.assertIn('/api/v1/users/self', call_args[0][0])
        self.assertIn('Authorization', call_args[1]['headers'])

    @patch('backend.services.canvas.client.requests.get')
    def test_get_user_401_raises_auth_error(self, mock_get):
        mock_get.return_value = _mock_response(401)
        client = CanvasClient('https://school.instructure.com', 'bad_pat')
        with self.assertRaises(CanvasAuthError):
            client.get_user()

    @patch('backend.services.canvas.client.requests.get')
    def test_get_user_403_raises_forbidden(self, mock_get):
        mock_get.return_value = _mock_response(403)
        client = CanvasClient('https://school.instructure.com', 'pat123')
        with self.assertRaises(CanvasForbiddenError):
            client.get_user()


class PaginationTest(unittest.TestCase):
    @patch('backend.services.canvas.client.requests.get')
    def test_follows_link_header_pagination(self, mock_get):
        page1 = _mock_response(200, [{'id': 1}], {
            'Link': '<https://school.instructure.com/api/v1/courses?page=2>; rel="next"',
        })
        page2 = _mock_response(200, [{'id': 2}], {})
        mock_get.side_effect = [page1, page2]

        client = CanvasClient('https://school.instructure.com', 'pat123')
        courses = client.get_courses()
        self.assertEqual(len(courses), 2)
        self.assertEqual(mock_get.call_count, 2)

    @patch('backend.services.canvas.client.requests.get')
    def test_single_page_no_link_header(self, mock_get):
        mock_get.return_value = _mock_response(200, [{'id': 1}, {'id': 2}])
        client = CanvasClient('https://school.instructure.com', 'pat123')
        courses = client.get_courses()
        self.assertEqual(len(courses), 2)
        self.assertEqual(mock_get.call_count, 1)


class ErrorHandlingTest(unittest.TestCase):
    @patch('backend.services.canvas.client.requests.get')
    def test_404_raises_not_found(self, mock_get):
        mock_get.return_value = _mock_response(404)
        client = CanvasClient('https://school.instructure.com', 'pat123')
        with self.assertRaises(CanvasNotFoundError):
            client.get_course('99999')

    @patch('backend.services.canvas.client.requests.get')
    def test_429_raises_rate_limit(self, mock_get):
        mock_get.return_value = _mock_response(429)
        client = CanvasClient('https://school.instructure.com', 'pat123')
        with self.assertRaises(CanvasRateLimitError):
            client.get_courses()


class GetModulesTest(unittest.TestCase):
    @patch('backend.services.canvas.client.requests.get')
    def test_get_modules(self, mock_get):
        mock_get.return_value = _mock_response(200, [
            {'id': 10, 'name': 'Week 1', 'position': 1},
            {'id': 11, 'name': 'Week 2', 'position': 2},
        ])
        client = CanvasClient('https://school.instructure.com', 'pat123')
        modules = client.get_modules('12345')
        self.assertEqual(len(modules), 2)
        call_url = mock_get.call_args[0][0]
        self.assertIn('/api/v1/courses/12345/modules', call_url)


class GetModuleItemsTest(unittest.TestCase):
    @patch('backend.services.canvas.client.requests.get')
    def test_get_module_items(self, mock_get):
        mock_get.return_value = _mock_response(200, [
            {'id': 100, 'title': 'Assignment 1', 'type': 'Assignment', 'position': 1},
        ])
        client = CanvasClient('https://school.instructure.com', 'pat123')
        items = client.get_module_items('12345', '10')
        self.assertEqual(len(items), 1)
        call_url = mock_get.call_args[0][0]
        self.assertIn('/api/v1/courses/12345/modules/10/items', call_url)


class GetStudentsTest(unittest.TestCase):
    @patch('backend.services.canvas.client.requests.get')
    def test_get_students(self, mock_get):
        mock_get.return_value = _mock_response(200, [
            {'id': 50, 'name': 'Alice', 'email': 'alice@school.edu', 'sis_user_id': 'SIS001'},
        ])
        client = CanvasClient('https://school.instructure.com', 'pat123')
        students = client.get_students('12345')
        self.assertEqual(len(students), 1)
        self.assertEqual(students[0]['name'], 'Alice')
        call_url = mock_get.call_args[0][0]
        self.assertIn('/api/v1/courses/12345/users', call_url)


if __name__ == '__main__':
    unittest.main()
