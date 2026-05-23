from dataclasses import dataclass


@dataclass
class SyncResult:
    entries_upserted: int = 0
    entries_removed: int = 0
    total_canvas_students: int = 0

    def to_dict(self) -> dict:
        return {
            'entries_upserted': self.entries_upserted,
            'entries_removed': self.entries_removed,
            'total_canvas_students': self.total_canvas_students,
        }


def reconcile_canvas_roster_entries(*, db, class_id: str, connection_id: str,
                                    canvas_students: list[dict]) -> SyncResult:
    """Reconcile Canvas roster with canvas_roster_entries/.

    Contract: this function writes to canvas_roster_entries/ ONLY. It does
    not read or write enrollments/, memberships/, or users/. Enrollments
    are produced exclusively by explicit student action (join code) or by
    LTI deep-link launch — Canvas PAT sync is advisory only.

    - Each Canvas student → upsert canvas_roster_entries/{class_id}__{canvas_user_id}.
    - Each existing entry in the DB whose canvas_user_id is NOT in the
      current Canvas payload → delete.
    """
    result = SyncResult(total_canvas_students=len(canvas_students))

    canvas_ids_in_payload = {str(s['id']) for s in canvas_students}

    for student in canvas_students:
        canvas_user_id = str(student['id'])
        email = (student.get('email') or '').lower().strip()
        canvas_name = (student.get('name') or student.get('sortable_name') or '').strip()
        db.upsert_canvas_roster_entry(
            class_id=class_id,
            connection_id=connection_id,
            canvas_user_id=canvas_user_id,
            canvas_email=email,
            canvas_name=canvas_name,
        )
        result.entries_upserted += 1

    for existing in db.list_canvas_roster_entries(class_id):
        if str(existing.get('canvas_user_id', '')) not in canvas_ids_in_payload:
            db.delete_canvas_roster_entry(class_id, str(existing['canvas_user_id']))
            result.entries_removed += 1

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
    """Full roster sync: fetch Canvas students, reconcile canvas_roster_entries."""
    class_id = connection['class_id']
    canvas_course_id = connection['canvas_course_id']
    connection_id = connection.get('id') or connection.get('connection_id') or ''
    canvas_students = canvas_client.get_students(canvas_course_id)
    return reconcile_canvas_roster_entries(
        db=db,
        class_id=class_id,
        connection_id=connection_id,
        canvas_students=canvas_students,
    )


def sync_course_content(*, db, connection: dict, canvas_client) -> int:
    """Full course content sync: fetch modules + items, replace content records.

    UNCHANGED by the roster-decouple plan. Course content is still synced
    on every sync call; only the roster half moves to canvas_roster_entries.
    """
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
