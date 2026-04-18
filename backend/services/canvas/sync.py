from dataclasses import dataclass, field

from backend.services.compliance import auto_grant_voice_consent_for_pilot


@dataclass
class SyncResult:
    matched: int = 0
    unmatched: int = 0
    deactivated: int = 0
    created: int = 0
    unchanged: int = 0

    def to_dict(self) -> dict:
        return {
            'matched': self.matched,
            'unmatched': self.unmatched,
            'deactivated': self.deactivated,
            'created': self.created,
            'unchanged': self.unchanged,
        }


def reconcile_enrollments(*, db, class_id: str, org_id: str,
                          canvas_students: list[dict]) -> SyncResult:
    """Reconcile Canvas roster with Lingual enrollments.

    Rules:
    - Match Canvas students to Lingual users by email first.
    - Unmatched students become pending_sync enrollments.
    - Canvas-sourced enrollments for students no longer in Canvas are
      deactivated (or deleted if still pending_sync).
    - Manual/join-code enrollments are never touched.
    """
    result = SyncResult()

    # Build a set of Canvas user IDs present in this sync.
    canvas_ids = {str(s['id']) for s in canvas_students}

    # Get all current enrollments for this class (any status).
    existing = db.list_class_enrollments(class_id, status=None)
    existing_by_canvas_id: dict[str, dict] = {}
    existing_by_uid: dict[str, dict] = {}
    for e in existing:
        cuid = e.get('canvas_user_id', '')
        if cuid:
            existing_by_canvas_id[cuid] = e
        uid = e.get('student_uid', '')
        if uid:
            existing_by_uid[uid] = e

    # Process each Canvas student.
    for student in canvas_students:
        canvas_user_id = str(student['id'])
        email = (student.get('email') or '').lower().strip()
        canvas_name = (student.get('name') or student.get('sortable_name') or '').strip()

        # Skip if already enrolled via this Canvas user ID.
        if canvas_user_id in existing_by_canvas_id:
            existing_enrollment = existing_by_canvas_id[canvas_user_id]
            if existing_enrollment.get('status') in ('active', 'pending_sync'):
                result.matched += 1 if existing_enrollment.get('student_uid') else 0
                result.unmatched += 1 if not existing_enrollment.get('student_uid') else 0
                result.unchanged += 1
                continue

        # Try to match by email.
        lingual_user = db.get_user_by_email(email) if email else None

        if lingual_user:
            uid = lingual_user['uid']
            # Check if already enrolled by uid.
            if uid in existing_by_uid and existing_by_uid[uid].get('status') == 'active':
                result.matched += 1
                result.unchanged += 1
                continue

            # Ensure student membership exists.
            membership_id = f'{org_id}_{uid}'
            if not db.get_membership(membership_id):
                db.create_membership(
                    org_id=org_id, uid=uid, roles=['student'],
                    primary_class_ids=[class_id], membership_id=membership_id,
                )
            else:
                db.add_primary_class_to_membership(membership_id, class_id)

            db.create_enrollment(
                class_id=class_id, student_uid=uid,
                student_membership_id=membership_id,
                status='active', join_source='canvas',
                canvas_user_id=canvas_user_id, canvas_email=email,
                canvas_name=canvas_name,
                enrollment_id=f'{class_id}_{uid}',
            )
            # Pilot: auto-grant voice + guardian consent on enrollment.
            auto_grant_voice_consent_for_pilot(db, org_id=org_id, student_uid=uid)
            result.matched += 1
            result.created += 1
        else:
            # Unmatched — create pending_sync enrollment.
            enrollment_id = f'{class_id}__{canvas_user_id}'
            db.create_enrollment(
                class_id=class_id, student_uid='',
                status='pending_sync', join_source='canvas',
                canvas_user_id=canvas_user_id, canvas_email=email,
                canvas_name=canvas_name,
                enrollment_id=enrollment_id,
            )
            result.unmatched += 1
            result.created += 1

    # Deactivate Canvas-sourced enrollments for students removed from Canvas.
    for e in existing:
        if e.get('join_source') != 'canvas':
            continue
        cuid = e.get('canvas_user_id', '')
        if not cuid or cuid in canvas_ids:
            continue
        if e.get('status') not in ('active', 'pending_sync'):
            continue
        if e.get('status') == 'pending_sync':
            db.delete_enrollment(e['id'])
        else:
            db.deactivate_canvas_enrollment(e['id'])
        result.deactivated += 1

    return result


def flatten_course_content(connection_id: str, class_id: str,
                           modules: list[dict],
                           items_by_module: dict[int, list[dict]]) -> list[dict]:
    """Flatten Canvas modules and their items into a list of content records."""
    flat: list[dict] = []
    for module in modules:
        module_id = module['id']
        module_items = items_by_module.get(module_id, [])
        for item in module_items:
            content_details = item.get('content_details') or {}
            flat.append({
                'connection_id': connection_id,
                'class_id': class_id,
                'canvas_module_id': str(module_id),
                'canvas_module_name': module.get('name', ''),
                'canvas_module_position': module.get('position', 0),
                'item_id': str(item.get('id', '')),
                'item_title': item.get('title', ''),
                'item_type': item.get('type', ''),
                'item_position': item.get('position', 0),
                'item_html_url': item.get('html_url', ''),
                'due_at': content_details.get('due_at'),
                'points_possible': content_details.get('points_possible'),
            })
    return flat


def sync_roster(*, db, connection: dict, canvas_client) -> SyncResult:
    """Full roster sync: fetch Canvas students, reconcile enrollments."""
    class_id = connection['class_id']
    org_id = connection['org_id']
    canvas_course_id = connection['canvas_course_id']
    canvas_students = canvas_client.get_students(canvas_course_id)
    return reconcile_enrollments(
        db=db, class_id=class_id, org_id=org_id,
        canvas_students=canvas_students,
    )


def sync_course_content(*, db, connection: dict, canvas_client) -> int:
    """Full course content sync: fetch modules + items, replace content records."""
    canvas_course_id = connection['canvas_course_id']
    modules = canvas_client.get_modules(canvas_course_id)
    items_by_module: dict[int, list[dict]] = {}
    for module in modules:
        items_by_module[module['id']] = canvas_client.get_module_items(
            canvas_course_id, str(module['id']),
        )
    flat = flatten_course_content(
        connection['id'], connection['class_id'], modules, items_by_module,
    )
    db.replace_canvas_course_content_for_connection(
        connection['id'], connection['class_id'], flat,
    )
    return len(flat)
