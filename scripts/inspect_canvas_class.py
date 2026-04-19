"""One-shot read-only inspector for a Lingual class + its Canvas course.

Usage:
    python3 scripts/inspect_canvas_class.py "Advanced Spanish"

Looks up classes whose name contains the search string (case-insensitive),
prints the Lingual class record, decrypts the linked Canvas PAT, and
fetches Canvas course / module / assignment metadata so a human can
eye-ball the actual proficiency level.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv

load_dotenv()

import firebase_admin  # noqa: E402
from firebase_admin import credentials  # noqa: E402

if not firebase_admin._apps:
    cred_path = os.environ.get('GOOGLE_APPLICATION_CREDENTIALS')
    if cred_path:
        firebase_admin.initialize_app(credentials.Certificate(cred_path))
    else:
        firebase_admin.initialize_app(options={
            'projectId': os.environ.get('GOOGLE_CLOUD_PROJECT', 'lingu-480600'),
        })

import database  # noqa: E402  imports must follow load_dotenv + sys.path
from backend.services.canvas.client import CanvasClient  # noqa: E402
from backend.services.canvas.encryption import decrypt_pat, mask_pat  # noqa: E402


def find_classes(search: str) -> list[dict]:
    db = database.get_db()
    needle = search.lower()
    matches: list[dict] = []
    for snap in db.collection('classes').stream():
        record = snap.to_dict() or {}
        record['_id'] = snap.id
        name = (record.get('name') or '').lower()
        if needle in name:
            matches.append(record)
    return matches


def print_lingual_class(record: dict) -> None:
    print(f"\n=== Lingual class: {record.get('name')} ({record['_id']}) ===")
    for key in ('org_id', 'subject', 'learning_locale', 'term',
                'status', 'teacher_membership_ids'):
        print(f"  {key}: {record.get(key)!r}")


def print_canvas_course(client: CanvasClient, course_id: str) -> None:
    course = client.get_course(course_id)
    print(f"\n--- Canvas course {course_id} ---")
    for key in ('name', 'course_code', 'workflow_state', 'start_at',
                'end_at', 'public_description', 'default_view'):
        print(f"  {key}: {course.get(key)!r}")

    modules = client.get_modules(course_id)
    print(f"\n  Modules ({len(modules)}):")
    for module in modules:
        print(f"    [{module.get('id')}] {module.get('name')!r}")
        items = client.get_module_items(course_id, str(module.get('id')))
        for item in items[:8]:
            print(f"        - {item.get('type')}: {item.get('title')!r}")
        if len(items) > 8:
            print(f"        ...and {len(items) - 8} more")


def main() -> int:
    if len(sys.argv) < 2:
        print('usage: python3 scripts/inspect_canvas_class.py "<class name search>"')
        return 2
    search = sys.argv[1]
    classes = find_classes(search)
    if not classes:
        print(f'No classes match: {search!r}')
        return 1

    for record in classes:
        print_lingual_class(record)
        connection = database.get_canvas_connection_by_class(record['_id'])
        if not connection:
            print('  (no Canvas connection)')
            continue
        instance_url = connection.get('canvas_instance_url') or ''
        course_id = connection.get('canvas_course_id') or ''
        encrypted = connection.get('encrypted_pat') or ''
        print(f"  canvas_instance_url: {instance_url!r}")
        print(f"  canvas_course_id: {course_id!r}")
        if not (instance_url and course_id and encrypted):
            print('  (incomplete Canvas connection)')
            continue
        raw_pat = decrypt_pat(encrypted)
        print(f"  pat: {mask_pat(raw_pat)}")
        client = CanvasClient(instance_url, raw_pat)
        try:
            print_canvas_course(client, course_id)
        except Exception as exc:  # surface API errors instead of crashing
            print(f"  Canvas API error: {exc}")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
