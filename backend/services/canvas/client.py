import re

import requests


class CanvasApiError(Exception):
    """Base error for Canvas API failures."""

    def __init__(self, message='', status_code=None):
        super().__init__(message)
        self.status_code = status_code


class CanvasAuthError(CanvasApiError):
    pass


class CanvasForbiddenError(CanvasApiError):
    pass


class CanvasNotFoundError(CanvasApiError):
    pass


class CanvasRateLimitError(CanvasApiError):
    pass


_LINK_NEXT_RE = re.compile(r'<([^>]+)>;\s*rel="next"')


class CanvasClient:
    """Thin REST client for the Canvas LMS API using a Personal Access Token."""

    def __init__(self, instance_url: str, pat: str, timeout: int = 30):
        self.base_url = instance_url.rstrip('/')
        self._headers = {'Authorization': f'Bearer {pat}'}
        self._timeout = timeout

    # -- public endpoints --------------------------------------------------

    def get_user(self) -> dict:
        return self._get(f'{self.base_url}/api/v1/users/self')

    def get_courses(self) -> list[dict]:
        return self._get_paginated(
            f'{self.base_url}/api/v1/courses',
            params={'enrollment_type': 'teacher', 'per_page': '50'},
        )

    def get_course(self, course_id: str) -> dict:
        return self._get(f'{self.base_url}/api/v1/courses/{course_id}')

    def get_modules(self, course_id: str) -> list[dict]:
        return self._get_paginated(
            f'{self.base_url}/api/v1/courses/{course_id}/modules',
            params={'per_page': '50'},
        )

    def get_module_items(self, course_id: str, module_id: str) -> list[dict]:
        return self._get_paginated(
            f'{self.base_url}/api/v1/courses/{course_id}/modules/{module_id}/items',
            params={'per_page': '50'},
        )

    def get_students(self, course_id: str) -> list[dict]:
        return self._get_paginated(
            f'{self.base_url}/api/v1/courses/{course_id}/users',
            params={'enrollment_type[]': 'student', 'per_page': '50'},
        )

    # -- internals ---------------------------------------------------------

    def _get(self, url: str, params: dict | None = None) -> dict:
        resp = requests.get(
            url, headers=self._headers, params=params, timeout=self._timeout,
        )
        self._raise_for_status(resp)
        return resp.json()

    def _get_paginated(self, url: str, params: dict | None = None) -> list[dict]:
        results: list[dict] = []
        resp = requests.get(
            url, headers=self._headers, params=params, timeout=self._timeout,
        )
        self._raise_for_status(resp)
        results.extend(resp.json())

        while True:
            next_url = self._parse_next_link(resp.headers.get('Link', ''))
            if not next_url:
                break
            resp = requests.get(
                next_url, headers=self._headers, timeout=self._timeout,
            )
            self._raise_for_status(resp)
            results.extend(resp.json())

        return results

    @staticmethod
    def _raise_for_status(resp: requests.Response) -> None:
        if resp.status_code == 401:
            raise CanvasAuthError('Invalid or expired PAT', 401)
        if resp.status_code == 403:
            raise CanvasForbiddenError('Insufficient permissions', 403)
        if resp.status_code == 404:
            raise CanvasNotFoundError('Resource not found', 404)
        if resp.status_code == 429:
            raise CanvasRateLimitError('Rate limited by Canvas', 429)
        resp.raise_for_status()

    @staticmethod
    def _parse_next_link(link_header: str) -> str | None:
        match = _LINK_NEXT_RE.search(link_header)
        return match.group(1) if match else None
