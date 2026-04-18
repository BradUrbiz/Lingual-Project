# Pilot Canvas Content Migration — Phase 2+3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the sample-curriculum-package code path entirely so Canvas-connected content becomes the single source for AI tutor practice material on `pilot/launch-v1`.

**Architecture:** The backend already has a "canvas-generated" assignment path (`backend/routes/canvas_practice.py` + `backend/services/assignment_resolver.py:_resolve_canvas_generated_bootstrap`) that fetches Canvas page/assignment bodies, runs a GPT-based scenario generator, and stores the result on a `curriculum_mappings` row with `package_id='canvas-generated'`. This plan collapses that dual-path system onto the Canvas-generated path alone, moves the scenario fields directly onto the `assignments` doc (eliminating `curriculum_mappings` as a concept), rewrites the teacher assignment builder UI to use a Canvas-item picker, and deletes the sample curriculum package loader + pedagogy engine.

**Tech Stack:** Python 3.12 / Flask / Firestore / React 19 / TypeScript / Vitest / unittest.

**Phase-to-commit mapping:** Three commits on `pilot/launch-v1`, each leaving a working state.

- **Commit A (backend fields):** Move scenario fields onto `assignments`, refactor `canvas_practice_create` to write to the assignment directly, update the bootstrap path to read from the assignment. Keep `curriculum_mappings` writes in a compatibility shim so existing assignments still resolve. Tests green.
- **Commit B (frontend rewrite):** Replace `TeacherAssignmentBuilderPage` Quick+Advanced with a Canvas-first flow. Delete curriculum browsing routes. Drop curriculum API clients.
- **Commit C (cleanup):** Delete `backend/services/pedagogy/`, delete curriculum-mapping endpoints and DB helpers, delete sample package data and loader, delete curriculum override in `chat.py`, update docs.

---

## File Structure

**Files to create:**
- `backend/tests/test_canvas_practice.py` — covers `/canvas-practice/generate` + `/canvas-practice/create` end-to-end with fake Canvas + fake OpenAI clients.
- `backend/tests/test_assignment_direct_fields.py` — covers the new assignment fields and the bootstrap path reading them.

**Files to modify:**
- `backend/routes/canvas_practice.py` — stop creating `curriculum_mappings`; write scenario fields directly to the `assignments` doc.
- `backend/routes/curriculum_admin.py` — `POST /api/teacher/classes/<id>/assignments` accepts new direct fields; `mappingId` becomes optional (deprecated) and then removed in Commit C.
- `backend/services/assignment_resolver.py` — `_resolve_canvas_generated_bootstrap` reads scenario from the assignment, not from a mapping. Remove the curriculum-package resolver entirely in Commit C.
- `database.py` — `create_assignment` accepts `instructions`, `canvas_module_item_ref`, `objectives`, `target_expressions`, `focus_grammar`, `generated_scenario`. Remove curriculum-mapping CRUD in Commit C.
- `backend/routes/chat.py` — remove the `/api/chat/realtime/session` curriculum override branch (lines 305-336) in Commit C.
- `main.py` — remove `build_curriculum_system_prompt`, `load_sample_curriculum_package`, `get_curriculum_practice_context`, and their route_deps wiring in Commit C.
- `frontend/src/pages/TeacherAssignmentBuilderPage.tsx` — full rewrite: Quick Assign = Canvas item picker + title + instructions. Advanced = adds objectives + target expressions + focus grammar as editable chip lists.
- `frontend/src/pages/CanvasPracticeBuilderPage.tsx` — determine routing status, merge into the rewrite or delete.
- `frontend/src/api/assignments.ts` — drop `createCurriculumMapping`, `getCurriculumMappings`, `getTeacherCurriculumPackages`. Update `createAssignment` payload type.
- `frontend/src/App.tsx` — remove `/app/curriculum` and `/app/curriculum/:moduleId` routes + lazy imports.
- `frontend/src/types/assignment.ts` — update `AssignmentDTO`, `AssignmentCreateInput`; drop `CurriculumMappingDTO`.
- `frontend/src/types/curriculum.ts` — delete file in Commit C.
- `docs/school-integration/TECH_SPEC.md` — remove curriculum_mappings / pedagogy sections; update assignment data model.
- `docs/school-integration/TASKS.md` — mark curriculum-package items complete/removed; add Canvas-primary tasks.
- `docs/school-integration/LIMITATIONS.md` — resolve #16 when Commit C lands.

**Files to delete (Commit C):**
- `backend/services/pedagogy/` (directory — 4 files: `task_template.py`, `curriculum_templates.py`, `scaffold_ladder.py`, `feedback_mode.py`, and any others).
- `frontend/src/pages/AppCurriculumPage.tsx`
- `frontend/src/pages/AppCurriculumModulePage.tsx`
- `frontend/src/types/curriculum.ts`
- Sample package JSON files under `data/` (verify path during execution).
- `backend/services/assignment_resolver.py:resolve_assignment_bootstrap` (the curriculum-package function — keep `_resolve_canvas_generated_bootstrap`).

---

# Commit A — Backend: scenario fields move to the assignment doc

Goal: After this commit, `canvas_practice_create` writes the scenario directly onto `assignments/{id}` with new fields (`instructions`, `canvas_module_item_ref`, `objectives`, `target_expressions`, `focus_grammar`, `generated_scenario`). The student launch path reads them from the assignment. Tests green. `curriculum_mappings` collection still exists, still gets written to by the old code paths (nothing deleted yet).

### Task A1: Extend `create_assignment` to accept direct scenario fields

**Files:**
- Modify: `database.py:818` (`create_assignment` signature)
- Test: `backend/tests/test_assignment_direct_fields.py` (create)

**Rationale:** Currently `create_assignment` takes `mapping_id` as the only content-source field. We add the Canvas-sourced fields so a future assignment can carry its scenario without requiring a mapping row.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_assignment_direct_fields.py
import unittest
from backend.tests.conftest import FakeDbBase

class CreateAssignmentDirectFieldsTest(unittest.TestCase):
    def setUp(self):
        self.db = FakeDbBase()

    def test_create_assignment_persists_direct_scenario_fields(self):
        assignment_id = self.db.create_assignment(
            org_id="org-1",
            class_id="class-1",
            mapping_id=None,
            title="Sample",
            description="",
            status="draft",
            task_type="decision_making",
            success_criteria=[],
            created_by_uid="uid-1",
            instructions="Practice ordering food in Spanish.",
            canvas_module_item_ref={"connection_id": "c1", "canvas_module_id": "m1", "item_id": "i1"},
            objectives=["Order a dish", "Ask for the bill"],
            target_expressions=["Me gustaria", "La cuenta por favor"],
            focus_grammar=["conditional 'gustaria'"],
            generated_scenario="You are a waiter at a Madrid tapas bar...",
        )
        doc = self.db.get_assignment(assignment_id)
        self.assertEqual(doc["instructions"], "Practice ordering food in Spanish.")
        self.assertEqual(doc["canvas_module_item_ref"]["item_id"], "i1")
        self.assertEqual(doc["objectives"], ["Order a dish", "Ask for the bill"])
        self.assertEqual(doc["target_expressions"], ["Me gustaria", "La cuenta por favor"])
        self.assertEqual(doc["focus_grammar"], ["conditional 'gustaria'"])
        self.assertTrue(doc["generated_scenario"].startswith("You are a waiter"))

    def test_create_assignment_default_fields_empty(self):
        assignment_id = self.db.create_assignment(
            org_id="org-1", class_id="class-1", mapping_id=None,
            title="Minimal", description="", status="draft",
            task_type="decision_making", success_criteria=[], created_by_uid="uid-1",
        )
        doc = self.db.get_assignment(assignment_id)
        self.assertEqual(doc.get("instructions", ""), "")
        self.assertEqual(doc.get("objectives", []), [])
        self.assertEqual(doc.get("target_expressions", []), [])
        self.assertEqual(doc.get("focus_grammar", []), [])
        self.assertIsNone(doc.get("canvas_module_item_ref"))
        self.assertEqual(doc.get("generated_scenario", ""), "")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest backend.tests.test_assignment_direct_fields -v`
Expected: FAIL — `create_assignment` TypeError on unexpected keyword arguments.

- [ ] **Step 3: Add fields to `database.create_assignment`**

Open `database.py` at the `create_assignment` definition. Extend the signature (keyword args with defaults), add the fields to the doc payload. Schema comment at top of file should be updated too.

```python
def create_assignment(
    org_id,
    class_id,
    mapping_id=None,
    title='',
    description='',
    status='draft',
    release_at='',
    due_at='',
    modality_override=None,
    max_attempts=None,
    task_type='decision_making',
    success_criteria=None,
    created_by_uid='',
    canvas_module_item_id='',
    instructions='',
    canvas_module_item_ref=None,
    objectives=None,
    target_expressions=None,
    focus_grammar=None,
    generated_scenario='',
):
    assignment_id = get_assignments_collection().document().id
    data = {
        'id': assignment_id,
        'org_id': org_id,
        'class_id': class_id,
        'mapping_id': mapping_id,
        'title': title,
        'description': description,
        'status': status,
        'release_at': release_at,
        'due_at': due_at,
        'modality_override': modality_override or {'mode': 'hybrid', 'text_fallback_enabled': True, 'voice_minutes_cap': None},
        'max_attempts': max_attempts,
        'task_type': task_type,
        'success_criteria': list(success_criteria or []),
        'created_by_uid': created_by_uid,
        'canvas_module_item_id': canvas_module_item_id or '',
        # New direct scenario fields — preferred over curriculum_mappings path.
        'instructions': instructions,
        'canvas_module_item_ref': canvas_module_item_ref,
        'objectives': list(objectives or []),
        'target_expressions': list(target_expressions or []),
        'focus_grammar': list(focus_grammar or []),
        'generated_scenario': generated_scenario,
        'created_at': firestore.SERVER_TIMESTAMP,
        'updated_at': firestore.SERVER_TIMESTAMP,
    }
    get_assignments_collection().document(assignment_id).set(data)
    return assignment_id
```

- [ ] **Step 4: Mirror in FakeDbBase**

Open `backend/tests/conftest.py` and update the `FakeDbBase.create_assignment` method to accept and persist the same new kwargs.

```python
# In backend/tests/conftest.py, inside FakeDbBase:
def create_assignment(
    self,
    org_id,
    class_id,
    mapping_id=None,
    title='',
    description='',
    status='draft',
    release_at='',
    due_at='',
    modality_override=None,
    max_attempts=None,
    task_type='decision_making',
    success_criteria=None,
    created_by_uid='',
    canvas_module_item_id='',
    instructions='',
    canvas_module_item_ref=None,
    objectives=None,
    target_expressions=None,
    focus_grammar=None,
    generated_scenario='',
):
    assignment_id = f"asg-{len(self.assignments)+1}"
    doc = {
        'id': assignment_id, 'org_id': org_id, 'class_id': class_id,
        'mapping_id': mapping_id, 'title': title, 'description': description,
        'status': status, 'release_at': release_at, 'due_at': due_at,
        'modality_override': modality_override or {'mode': 'hybrid', 'text_fallback_enabled': True, 'voice_minutes_cap': None},
        'max_attempts': max_attempts, 'task_type': task_type,
        'success_criteria': list(success_criteria or []),
        'created_by_uid': created_by_uid,
        'canvas_module_item_id': canvas_module_item_id or '',
        'instructions': instructions,
        'canvas_module_item_ref': canvas_module_item_ref,
        'objectives': list(objectives or []),
        'target_expressions': list(target_expressions or []),
        'focus_grammar': list(focus_grammar or []),
        'generated_scenario': generated_scenario,
    }
    self.assignments[assignment_id] = doc
    return assignment_id
```

- [ ] **Step 5: Run test to verify it passes**

Run: `python3 -m unittest backend.tests.test_assignment_direct_fields -v`
Expected: PASS (both tests).

- [ ] **Step 6: Run full backend test suite to confirm no regressions**

Run: `python3 -m unittest backend.tests.test_curriculum_admin_routes backend.tests.test_realtime_chat backend.tests.test_school_foundation_routes backend.tests.test_admin_routes backend.tests.test_curriculum_admin_api backend.tests.test_assignment_resolver backend.tests.test_assignment_direct_fields`
Expected: OK, 96+ tests pass.

- [ ] **Step 7: Commit**

```bash
git add database.py backend/tests/conftest.py backend/tests/test_assignment_direct_fields.py
git commit -m "feat(assignments): add direct scenario fields on assignment doc

Precursor to Canvas-content migration. Adds instructions,
canvas_module_item_ref, objectives, target_expressions, focus_grammar,
generated_scenario to create_assignment and FakeDbBase. Existing
mapping_id path still works; these fields are additive."
```

---

### Task A2: Refactor `canvas_practice_create` to write scenario onto assignment

**Files:**
- Modify: `backend/routes/canvas_practice.py:127-214`
- Create/extend: `backend/tests/test_canvas_practice.py`

**Rationale:** The endpoint currently creates a `curriculum_mapping` then an `assignment` pointing to it. We want a single Firestore write: the assignment doc with all fields inline. The mapping write stays for one commit as a compatibility write (Commit C removes it).

- [ ] **Step 1: Write failing integration test**

```python
# backend/tests/test_canvas_practice.py
import unittest
from unittest.mock import patch, MagicMock
from backend.tests.conftest import FakeDbBase
from backend.routes.canvas_practice import create_canvas_practice_blueprint
from backend.route_deps import RouteDeps
from flask import Flask

class CanvasPracticeCreateTest(unittest.TestCase):
    def setUp(self):
        self.db = FakeDbBase()
        # Seed class + canvas content
        self.db.classes["class-1"] = {
            "id": "class-1", "org_id": "org-1", "name": "Spanish",
            "learning_locale": "es-ES", "subject": "Spanish",
            "teacher_membership_ids": ["mem-1"],
        }
        self.db.canvas_course_content["cc-1"] = {
            "id": "cc-1", "class_id": "class-1", "connection_id": "conn-1",
            "item_title": "La familia", "item_type": "Page", "item_id": "page-1",
            "canvas_module_id": "mod-1", "canvas_module_name": "Unit 1",
        }
        # Minimal RouteDeps mock — real version requires Firebase
        self.deps = MagicMock(spec=RouteDeps)
        self.deps.db = self.db
        self.deps.login_required = lambda f: f
        self.deps.get_current_user_uid = lambda: "uid-1"
        context = MagicMock()
        context.active_organization_id = "org-1"
        context.active_membership_id = "mem-1"
        context.has_role = lambda role: False
        context.require_any_role = lambda roles: None
        self.deps.get_school_request_context = lambda: context

        self.app = Flask(__name__)
        self.app.register_blueprint(create_canvas_practice_blueprint(self.deps))
        self.client = self.app.test_client()

    def test_create_writes_scenario_fields_onto_assignment(self):
        resp = self.client.post(
            "/api/teacher/classes/class-1/canvas-practice/create",
            json={
                "canvasContentId": "cc-1",
                "canvasModuleItemId": "page-1",
                "title": "Family introductions",
                "description": "Practice introducing your family.",
                "scenario": "You meet a new classmate. Tell them about your family.",
                "taskType": "information_gap",
                "targetExpressions": ["Mi familia es...", "Mi hermano se llama..."],
                "focusGrammar": ["possessive adjectives"],
                "successCriteria": ["Name at least 3 family members"],
                "teacherNotes": "Great for Week 1",
                "status": "published",
            },
        )
        self.assertEqual(resp.status_code, 201)
        data = resp.get_json()
        self.assertTrue(data["success"])
        asg = self.db.assignments[data["assignmentId"]]
        self.assertEqual(asg["title"], "Family introductions")
        self.assertEqual(asg["status"], "published")
        self.assertEqual(asg["target_expressions"], ["Mi familia es...", "Mi hermano se llama..."])
        self.assertEqual(asg["focus_grammar"], ["possessive adjectives"])
        self.assertEqual(asg["success_criteria"], ["Name at least 3 family members"])
        self.assertTrue(asg["generated_scenario"].startswith("You meet"))
        self.assertEqual(asg["canvas_module_item_ref"], {
            "connection_id": "conn-1",
            "canvas_module_id": "mod-1",
            "item_id": "page-1",
        })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest backend.tests.test_canvas_practice -v`
Expected: FAIL — current code writes to `curriculum_mappings`, not to the assignment's new fields.

- [ ] **Step 3: Refactor `canvas_practice_create`**

Replace the body of `canvas_practice_create` in `backend/routes/canvas_practice.py` so the assignment doc carries the scenario fields directly. Keep the mapping write as a temporary compat shim (remove in Commit C).

```python
@bp.route('/api/teacher/classes/<class_id>/canvas-practice/create', methods=['POST'])
@deps.login_required
def canvas_practice_create(class_id):
    try:
        ctx, class_record = _require_teacher_for_class(class_id)
    except (PermissionError, SchoolContextPermissionError, LookupError) as exc:
        return jsonify({'success': False, 'error': str(exc)}), 403

    data = request.get_json() or {}

    canvas_content_id = data.get('canvasContentId', '').strip()
    canvas_module_item_id = data.get('canvasModuleItemId', '').strip()
    title = data.get('title', '').strip()
    scenario = data.get('scenario', '').strip()
    task_type = data.get('taskType', 'information_gap')
    instructions = data.get('instructions', '').strip() or data.get('description', '').strip()

    if not canvas_content_id or not title or not scenario:
        return jsonify({'success': False, 'error': 'canvasContentId, title, and scenario are required'}), 400
    if task_type not in VALID_TASK_TYPES:
        return jsonify({'success': False, 'error': f'Invalid taskType. Must be one of: {", ".join(VALID_TASK_TYPES)}'}), 400

    content_item = deps.db.get_canvas_course_content(canvas_content_id)
    if not content_item:
        return jsonify({'success': False, 'error': 'Canvas content item not found'}), 404

    org_id = class_record.get('org_id', '')
    teacher_uid = deps.get_current_user_uid()

    canvas_ref = {
        'connection_id': content_item.get('connection_id', ''),
        'canvas_module_id': content_item.get('canvas_module_id', ''),
        'item_id': canvas_module_item_id or content_item.get('item_id', ''),
    }

    try:
        status = data.get('status', 'draft')
        if status not in ('draft', 'published'):
            status = 'draft'

        assignment_id = deps.db.create_assignment(
            org_id=org_id,
            class_id=class_id,
            mapping_id=None,
            title=title,
            description=data.get('description', ''),
            status=status,
            task_type=task_type,
            success_criteria=data.get('successCriteria', []),
            created_by_uid=teacher_uid,
            canvas_module_item_id=canvas_module_item_id or '',
            instructions=instructions,
            canvas_module_item_ref=canvas_ref,
            objectives=data.get('objectives', []),
            target_expressions=data.get('targetExpressions', []),
            focus_grammar=data.get('focusGrammar', []),
            generated_scenario=scenario,
        )

        if canvas_module_item_id:
            deps.db.link_assignment_to_canvas_item(
                assignment_id, canvas_content_id, canvas_module_item_id,
            )

        return jsonify({
            'success': True,
            'assignmentId': assignment_id,
            'status': status,
        }), 201
    except Exception as exc:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(exc)}), 500
```

- [ ] **Step 4: Ensure FakeDbBase has `get_canvas_course_content` and `link_assignment_to_canvas_item`**

Open `backend/tests/conftest.py`. If either helper is missing on `FakeDbBase`, add minimal implementations:

```python
# In FakeDbBase.__init__:
self.canvas_course_content = {}  # if not present

def get_canvas_course_content(self, content_id):
    return dict(self.canvas_course_content.get(content_id) or {}) or None

def link_assignment_to_canvas_item(self, assignment_id, content_id, canvas_module_item_id):
    asg = self.assignments.get(assignment_id)
    if asg is not None:
        asg['canvas_module_item_id'] = canvas_module_item_id
```

- [ ] **Step 5: Run the new test to verify it passes**

Run: `python3 -m unittest backend.tests.test_canvas_practice -v`
Expected: PASS.

- [ ] **Step 6: Run full backend test suite**

Run: `python3 -m unittest backend.tests.test_curriculum_admin_routes backend.tests.test_realtime_chat backend.tests.test_school_foundation_routes backend.tests.test_admin_routes backend.tests.test_curriculum_admin_api backend.tests.test_assignment_resolver backend.tests.test_assignment_direct_fields backend.tests.test_canvas_practice`
Expected: OK. If any test fails, inspect — some tests may assume `canvas_practice_create` writes a mapping and need updating.

- [ ] **Step 7: Commit**

```bash
git add backend/routes/canvas_practice.py backend/tests/test_canvas_practice.py backend/tests/conftest.py
git commit -m "refactor(canvas-practice): write scenario fields onto assignment doc

canvas_practice_create no longer creates a curriculum_mapping row
(that path is being removed in Commit C). The scenario, target
expressions, focus grammar, objectives, and Canvas ref all land
directly on the assignment document. Adds an end-to-end test for
the create endpoint."
```

---

### Task A3: Teach `_resolve_canvas_generated_bootstrap` to read from the assignment

**Files:**
- Modify: `backend/services/assignment_resolver.py:529-652` (the `_resolve_canvas_generated_bootstrap` function)
- Test: `backend/tests/test_assignment_resolver.py` (add a new test case)

**Rationale:** The canvas-generated resolver currently reads `generated_scenario`, `target_expressions`, `focus_grammar` from the *mapping*. After A2, those fields live on the *assignment*. The resolver must prefer the assignment fields, falling back to the mapping fields only if the assignment fields are empty (for old data).

- [ ] **Step 1: Write the failing test**

```python
# Add to backend/tests/test_assignment_resolver.py
def test_canvas_generated_bootstrap_reads_scenario_from_assignment(self):
    # Seed a class + canvas connection + Canvas-generated assignment WITHOUT
    # any curriculum_mapping row. Verify the bootstrap succeeds and returns
    # the scenario from the assignment fields.
    self.db.classes["c1"] = {
        "id": "c1", "org_id": "o1", "name": "Spanish",
        "learning_locale": "es-ES", "subject": "Spanish",
        "teacher_membership_ids": ["m1"],
        "status": "active",
    }
    # Student enrolled
    self.db.enrollments["c1_u1"] = {
        "id": "c1_u1", "class_id": "c1", "student_uid": "u1",
        "status": "active", "join_source": "join_code",
    }
    asg_id = self.db.create_assignment(
        org_id="o1", class_id="c1", mapping_id=None,
        title="Canvas test", description="", status="published",
        task_type="decision_making", success_criteria=[], created_by_uid="uid-t",
        instructions="Talk about your family.",
        generated_scenario="You meet a new classmate. Tell them about your family.",
        target_expressions=["Mi familia", "Tengo hermanos"],
        focus_grammar=["possessive adjectives"],
        canvas_module_item_ref={"connection_id": "cn1", "canvas_module_id": "mo1", "item_id": "it1"},
    )
    bootstrap = resolve_assignment_bootstrap_for_user(
        deps=self.deps, uid="u1", context=self.context,
        assignment_id=asg_id, ui_language="en",
    )
    self.assertEqual(bootstrap["class"]["learningLocale"], "es-ES")
    self.assertIn("Mi familia", bootstrap.get("systemPromptPreview", ""))
    self.assertIn("You meet a new classmate", bootstrap.get("systemPromptPreview", ""))
    self.assertIn("possessive adjectives", bootstrap.get("systemPromptPreview", ""))
    # Locale enforcement rule from Phase 1 must still be in place
    self.assertIn("Respond ONLY in Spanish", bootstrap.get("systemPromptPreview", ""))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest backend.tests.test_assignment_resolver -v`
Expected: FAIL — either `NoneType` error because mapping is `None`, or missing scenario text because resolver reads only mapping.

- [ ] **Step 3: Make `_resolve_canvas_generated_bootstrap` read assignment fields with mapping fallback**

In `backend/services/assignment_resolver.py`, locate `_resolve_canvas_generated_bootstrap` (around line 529). Change the scenario/expression/grammar reads from `mapping.get(...)` to prefer `assignment.get(...)` with a fallback to `mapping` for old rows. Around line 544-546:

```python
# Prefer direct fields on the assignment; fall back to the legacy mapping
# for pre-migration rows. Commit C removes the mapping fallback entirely.
scenario = (
    assignment.get("generated_scenario")
    or (mapping.get("generated_scenario") if mapping else "")
    or ""
)
target_expressions = _normalize_string_list(
    assignment.get("target_expressions")
    or (mapping.get("target_expressions") if mapping else [])
)
focus_grammar = _normalize_string_list(
    assignment.get("focus_grammar")
    or (mapping.get("focus_grammar") if mapping else [])
)
```

- [ ] **Step 4: Adjust the dispatcher**

Also at the top of `resolve_assignment_bootstrap` (or wherever the decision between curriculum-package and canvas-generated paths is made), change the "pick canvas-generated path" condition from "mapping.package_id == 'canvas-generated'" to **also** accept "assignment has no mapping_id but has generated_scenario set." This lets the new A2 path succeed without any mapping row.

Search `backend/services/assignment_resolver.py` for `canvas-generated` (should be around line 362-400). The dispatcher should look like:

```python
def resolve_assignment_bootstrap(deps, assignment, class_record, ui_language='en'):
    mapping_id = assignment.get("mapping_id")
    direct_scenario = assignment.get("generated_scenario")

    if direct_scenario and not mapping_id:
        # New Canvas-first path — all fields live on the assignment.
        return _resolve_canvas_generated_bootstrap(
            deps=deps, assignment=assignment, mapping=None,
            class_record=class_record, ui_language=ui_language,
        )

    mapping = deps.db.get_curriculum_mapping(mapping_id) if mapping_id else None
    if mapping and mapping.get("package_id") == "canvas-generated":
        return _resolve_canvas_generated_bootstrap(
            deps=deps, assignment=assignment, mapping=mapping,
            class_record=class_record, ui_language=ui_language,
        )

    # Curriculum-package path — removed in Commit C.
    return _resolve_curriculum_package_bootstrap(...)
```

(If the existing dispatcher structure is different, preserve the old behavior and just add the `direct_scenario` check as the first condition.)

- [ ] **Step 5: Run the new test**

Run: `python3 -m unittest backend.tests.test_assignment_resolver -v`
Expected: PASS including the new case, plus the existing enrolled/published cases still pass.

- [ ] **Step 6: Run full suite**

Run: `python3 -m unittest backend.tests.test_curriculum_admin_routes backend.tests.test_realtime_chat backend.tests.test_school_foundation_routes backend.tests.test_admin_routes backend.tests.test_curriculum_admin_api backend.tests.test_assignment_resolver backend.tests.test_assignment_direct_fields backend.tests.test_canvas_practice`
Expected: OK.

- [ ] **Step 7: Commit**

```bash
git add backend/services/assignment_resolver.py backend/tests/test_assignment_resolver.py
git commit -m "feat(resolver): read Canvas-generated scenario from assignment doc

The assignment resolver now prefers direct fields
(generated_scenario, target_expressions, focus_grammar) on the
assignment document over the legacy curriculum_mappings fallback.
Assignments created by the new canvas-practice flow no longer need
a curriculum_mappings row at all."
```

---

# Commit B — Frontend: Canvas-first assignment builder

Goal: Rewrite `TeacherAssignmentBuilderPage` so both Quick Assign and Advanced use the canvas-practice generate + create endpoints. Delete the `/app/curriculum` routes (dead after Commit C, but safe to remove now — they're student-facing curriculum browsing that the pilot doesn't need).

### Task B1: Audit CanvasPracticeBuilderPage

**Files:**
- Read: `frontend/src/pages/CanvasPracticeBuilderPage.tsx`
- Read: `frontend/src/api/canvasPractice.ts`
- Read: `frontend/src/App.tsx` (check if `CanvasPracticeBuilderPage` is routed)

- [ ] **Step 1: Read all three files and determine whether `CanvasPracticeBuilderPage` already implements the UX we want**

This task has no code changes. Outcome options:

- **If `CanvasPracticeBuilderPage` is already reachable and matches the intended UX (Canvas item picker → generate suggestions → edit → publish):** we route the existing "Build assignments" button on the dashboard to it, rename to `TeacherAssignmentBuilderPage`, and delete the old builder.
- **If it's a standalone experiment not yet routed:** we merge its logic into a rewrite of `TeacherAssignmentBuilderPage`.
- **If it's incomplete or abandoned:** we delete it and write the new builder from scratch based on `canvasPractice.ts` as the API layer.

Record the decision before proceeding. Reference the relevant lines of `CanvasPracticeBuilderPage.tsx` in the commit message.

- [ ] **Step 2: Commit the decision as a note**

If no code changes are needed yet, skip the commit.

---

### Task B2: Rewrite TeacherAssignmentBuilderPage Quick Assign to use canvas-practice

**Files:**
- Modify: `frontend/src/pages/TeacherAssignmentBuilderPage.tsx` (full rewrite of the Quick Assign section)
- Modify: `frontend/src/api/canvasPractice.ts` (verify shape)
- Test: `frontend/src/pages/TeacherAssignmentBuilderPage.test.tsx` (rewrite)

**Spec — Quick Assign UX after this change:**

1. Top of page: class header (unchanged from today), showing class name, locale, counts.
2. "Quick assign" card replaces the current module/situation dropdowns with:
   - A **Canvas item picker** (dropdown or searchable list populated by `GET /api/teacher/classes/<class_id>/canvas/content` — verify exact endpoint by reading `frontend/src/api/canvas.ts`). Each option shows module name + item title + item type badge.
   - A disabled "Generate practice from this item" button that enables once an item is selected.
3. On click, call `POST /api/teacher/classes/<class_id>/canvas-practice/generate` with `{canvasContentId}`. Show a spinner until the suggestions come back.
4. Render suggestions in editable form fields:
   - Title (pre-filled from `suggestedTitle`)
   - Description (pre-filled from `suggestedDescription`)
   - Scenario (pre-filled from `scenario`, shown as multi-line textarea)
   - Target expressions (chip list, pre-filled from `targetExpressions`, addable/removable)
   - Focus grammar (chip list, pre-filled)
   - Success criteria (chip list, pre-filled)
   - Task type dropdown (pre-selected from `taskType`)
5. "Publish assignment" button calls `POST /api/teacher/classes/<class_id>/canvas-practice/create` with all fields + `status: 'published'`. "Save as draft" button calls the same with `status: 'draft'`.
6. On success, refresh the "Your assignments" list and show a toast.

- [ ] **Step 1: Read the current file to understand the styling / layout patterns**

```bash
wc -l frontend/src/pages/TeacherAssignmentBuilderPage.tsx
# Likely ~1500 lines. Read it into context with Read tool.
```

- [ ] **Step 2: Read the existing Canvas API client**

```bash
# Verify the endpoint for listing canvas content items for a class.
# Look for: list_canvas_content / GET /api/teacher/.../canvas/content
```

- [ ] **Step 3: Extend `frontend/src/api/canvasPractice.ts` with typed client functions**

Verify these functions exist; add if missing. Exact shape:

```typescript
// frontend/src/api/canvasPractice.ts
import { api } from './client';

export interface CanvasPracticeGenerateInput {
  canvasContentId: string;
}

export interface CanvasPracticeSuggestions {
  scenario: string;
  targetExpressions: string[];
  focusGrammar: string[];
  successCriteria: string[];
  taskType: 'information_gap' | 'opinion_gap' | 'decision_making';
  suggestedTitle: string;
  suggestedDescription: string;
  teacherNotes: string;
}

export interface CanvasPracticeGenerateOutput {
  canvasItem: { id: string; title: string; type: string; moduleName: string; canvasItemId: string };
  suggestions: CanvasPracticeSuggestions;
}

export const generateCanvasPractice = async (
  classId: string,
  input: CanvasPracticeGenerateInput,
): Promise<CanvasPracticeGenerateOutput> => {
  const { data } = await api.post(`/teacher/classes/${classId}/canvas-practice/generate`, input);
  if (!data.success) throw new Error(data.error || 'Generation failed');
  return { canvasItem: data.canvasItem, suggestions: data.suggestions };
};

export interface CanvasPracticeCreateInput {
  canvasContentId: string;
  canvasModuleItemId: string;
  title: string;
  description: string;
  scenario: string;
  taskType: string;
  targetExpressions: string[];
  focusGrammar: string[];
  successCriteria: string[];
  teacherNotes?: string;
  status: 'draft' | 'published';
  instructions?: string;
  objectives?: string[];
}

export interface CanvasPracticeCreateOutput {
  assignmentId: string;
  status: string;
}

export const createCanvasPracticeAssignment = async (
  classId: string,
  input: CanvasPracticeCreateInput,
): Promise<CanvasPracticeCreateOutput> => {
  const { data } = await api.post(`/teacher/classes/${classId}/canvas-practice/create`, input);
  if (!data.success) throw new Error(data.error || 'Create failed');
  return { assignmentId: data.assignmentId, status: data.status };
};
```

- [ ] **Step 4: Write the failing component test**

```typescript
// frontend/src/pages/TeacherAssignmentBuilderPage.test.tsx — add case
it('generates, edits, and publishes a Canvas-based assignment', async () => {
  // Mock /canvas-practice/generate and /canvas-practice/create
  // Assert: no curriculum-mapping API calls.
  // Simulate: pick Canvas item -> click Generate -> edit title -> Publish.
  // Verify: createCanvasPracticeAssignment called with expected payload.
});
```

Full test body to fit existing patterns in the file — reference the existing "mocks @/api/assignments" scaffolding at the top of the file.

- [ ] **Step 5: Run test to verify it fails**

Run: `cd frontend && npm run test -- --run src/pages/TeacherAssignmentBuilderPage.test.tsx`
Expected: FAIL — current page has no Canvas item picker.

- [ ] **Step 6: Rewrite the Quick Assign section of `TeacherAssignmentBuilderPage.tsx`**

Full-file rewrite guidance. Preserve:
- Header region (class name, counts, locale badge).
- "Advanced" tab scaffold (expanded in B3a/B3b).
- "Your assignments" list and its existing analytics/preview actions.

Replace:
- The module/situation dropdowns and their data loading.
- The `handleQuickSubmit` / `handleSubmit` flows that call `createAssignment` + `createCurriculumMapping`.

With:
- `canvasItems` state loaded from the existing canvas content endpoint on mount.
- `selectedCanvasItemId`, `suggestions`, `isGenerating`, `isPublishing` states.
- Generate handler calls `generateCanvasPractice`.
- Publish handler calls `createCanvasPracticeAssignment`.
- Stop importing `createAssignment`, `createCurriculumMapping`, `getCurriculumMappings`, `getTeacherCurriculumPackages`.

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd frontend && npm run test -- --run src/pages/TeacherAssignmentBuilderPage.test.tsx`
Expected: PASS.

- [ ] **Step 8: Run full frontend test suite**

Run: `cd frontend && npm run test -- --run`
Expected: All passing (or only failures related to removed curriculum routes — acceptable if they reference routes we're deleting in B4).

- [ ] **Step 9: Commit**

```bash
git add frontend/src/pages/TeacherAssignmentBuilderPage.tsx \
        frontend/src/pages/TeacherAssignmentBuilderPage.test.tsx \
        frontend/src/api/canvasPractice.ts
git commit -m "refactor(teacher-builder): Quick Assign uses canvas-practice flow

Replaces the module/situation curriculum-package picker with a Canvas
item picker. Teacher picks a Canvas page or assignment, AI suggests a
speaking scenario + target expressions, teacher reviews and publishes.
The old createAssignment+createCurriculumMapping path is no longer
reachable from Quick Assign."
```

---

### Task B3a: Add Advanced mode — Canvas-structured objectives editor

**Status note:** This is the subset of Advanced mode that actually shipped on the branch. It keeps Advanced on the Canvas-generated path and adds editable objectives. The original B3 text over-reached by also describing a non-Canvas path; that remaining scope is tracked explicitly in B3b below.

**Files:**
- Modify: `frontend/src/pages/TeacherAssignmentBuilderPage.tsx` (Advanced tab)

**Spec:** Advanced mode starts from the same Canvas item picker and generates the same way. After suggestions arrive, Advanced adds:
- Objectives chip list (editable, starts from `suggestions.objectives || []`).

For the pilot branch at this stage, this is still a thin layer on top of Quick Assign. Non-Canvas authoring is intentionally deferred to B3b.

- [ ] **Step 1: Write failing test**

```typescript
// frontend/src/pages/TeacherAssignmentBuilderPage.test.tsx — add case
it('advanced mode adds editable objectives beyond Quick Assign', async () => {
  // Switch to Advanced, pick item, generate, assert objectives field rendered,
  // add an objective, publish, assert payload contains objectives.
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test -- --run src/pages/TeacherAssignmentBuilderPage.test.tsx`
Expected: FAIL — no objectives UI yet.

- [ ] **Step 3: Extend the Advanced tab**

Add an Objectives chip list field (same pattern as Target Expressions). Thread into the `createCanvasPracticeAssignment` payload via the `objectives` prop.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test -- --run src/pages/TeacherAssignmentBuilderPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/TeacherAssignmentBuilderPage.tsx \
        frontend/src/pages/TeacherAssignmentBuilderPage.test.tsx
git commit -m "feat(teacher-builder): Advanced mode adds editable objectives

Advanced mode shares the Canvas-generate flow with Quick Assign and
adds an editable objectives chip list. Per Q2=c (hybrid: thin Quick,
structured Advanced)."
```

---

### Task B3b: Follow-up — non-Canvas Advanced authoring

**Why this exists:** The product requirement is broader than the shipped Canvas-only Advanced subset. Teachers need to create assignments from two non-Canvas entry points as well:
- **AI-assisted source mode:** teacher pastes a source packet such as key vocabulary, rubric notes, lesson context, or a custom teacher prompt; Lingual generates a draft assignment from that text.
- **Manual authoring mode:** teacher writes the assignment directly, with minimum required fields `title + instructions + scenario + taskType`.

**Decision:** Quick Assign remains Canvas-only. Advanced becomes the mixed authoring surface with three entry modes:
- `Canvas item`
- `AI-assisted source`
- `Manual authoring`

**Recommended API direction (focused follow-up, not a full rewrite):**
- Add a new content-agnostic draft-generation endpoint:
  - `POST /api/teacher/classes/<class_id>/assignment-drafts/generate`
  - Request body: `{ sourceText: string }`
  - Response shape: same draft fields used by Canvas generate (`suggestedTitle`, `suggestedDescription`, `scenario`, `targetExpressions`, `focusGrammar`, `successCriteria`, `taskType`, optional `objectives`, `teacherNotes`)
- Broaden the generic assignment create endpoint so it can create direct-field assignments without `mappingId`:
  - `POST /api/teacher/classes/<class_id>/assignments`
  - Accepts direct scenario fields for non-Canvas assignments: `title`, `description`, `instructions`, `generatedScenario`, `objectives`, `targetExpressions`, `focusGrammar`, `successCriteria`, `taskType`, and optional `teacherNotes`
- Keep `POST /canvas-practice/create` for Canvas-linked assignments only.

**Files:**
- Modify: `backend/routes/curriculum_admin.py` — allow direct-field assignment creation without `mappingId`
- Create or modify: backend route for source-text draft generation (preferred: add to `backend/routes/canvas_practice.py` only if renamed/generalized; otherwise create a small teacher assignment drafts route)
- Modify: `database.py` — verify generic assignment create path persists all direct fields needed by non-Canvas assignments
- Modify: `frontend/src/pages/TeacherAssignmentBuilderPage.tsx` — Advanced mode picker + AI-assisted source form + manual authoring form
- Modify: `frontend/src/api/assignments.ts` and/or add a dedicated draft-generation client
- Modify: `frontend/src/pages/TeacherAssignmentBuilderPage.test.tsx`
- Update: `docs/school-integration/LIMITATIONS.md` if this remains deferred after Commit C

**B3b Spec:**

1. **Advanced mode entry selector**
   - Three mutually exclusive entry modes:
     - `Canvas item`
     - `AI-assisted source`
     - `Manual authoring`
   - Default selection: `Canvas item`

2. **AI-assisted source mode**
   - Required input: one large `sourceText` textarea
   - Helper copy should explicitly allow vocabulary lists, rubric notes, lesson context, and custom prompts
   - Generate button is disabled until `sourceText.trim()` is non-empty
   - Generate response hydrates the same editable review form used by Canvas mode
   - No Canvas item is attached to the final assignment

3. **Manual authoring mode**
   - Minimum required fields:
     - `title`
     - `instructions`
     - `scenario`
     - `taskType`
   - Optional structured fields:
     - `objectives`
     - `targetExpressions`
     - `focusGrammar`
     - `successCriteria`
     - `teacherNotes`
   - No generate step required

4. **Review/create behavior**
   - All three Advanced modes end in the same editable assignment form surface
   - `Canvas item` mode can keep using the Canvas-specific create route
   - `AI-assisted source` and `Manual authoring` create via the generic assignment create route with direct fields only
   - The assignments list refreshes on success, same as B2/B3a

- [ ] **Step 1: Add failing backend test for direct non-Canvas assignment creation**

```python
# Add to backend/tests/test_curriculum_admin_routes.py or the fuller API suite
def test_teacher_can_create_direct_field_assignment_without_mapping(self):
    response = self.client.post(
        f"/api/teacher/classes/{self.class_id}/assignments",
        json={
            "title": "Restaurant role-play",
            "description": "Practice polite ordering.",
            "instructions": "Use the target phrases naturally.",
            "generatedScenario": "You are ordering dinner at a busy restaurant.",
            "taskType": "information_gap",
            "targetExpressions": ["Quisiera...", "La cuenta, por favor"],
            "focusGrammar": ["conditional politeness"],
            "successCriteria": ["Order two items and ask one follow-up question"],
            "teacherNotes": "Push for full-sentence responses.",
            "status": "draft",
        },
    )
    self.assertEqual(response.status_code, 201)
```

- [ ] **Step 2: Add failing backend test for AI-assisted source draft generation**

```python
def test_generate_assignment_draft_from_source_text(self):
    response = self.client.post(
        f"/api/teacher/classes/{self.class_id}/assignment-drafts/generate",
        json={
            "sourceText": "Key vocabulary: reservar, mesa, camarero. Rubric note: students should ask for clarification politely.",
        },
    )
    self.assertEqual(response.status_code, 200)
    payload = response.get_json()
    self.assertTrue(payload["success"])
    self.assertIn("scenario", payload["suggestions"])
```

- [ ] **Step 3: Add failing frontend tests for the two non-Canvas Advanced paths**

```typescript
it('Advanced AI-assisted mode generates a draft from pasted source text', async () => {
  // Switch to Advanced -> AI-assisted source -> paste source text -> generate
  // -> assert review form is hydrated -> save draft via generic assignment create.
})

it('Advanced manual mode creates an assignment without Canvas selection', async () => {
  // Switch to Advanced -> Manual authoring -> fill title/instructions/scenario/task type
  // -> save draft -> assert generic assignment create payload omits Canvas refs.
})
```

- [ ] **Step 4: Implement backend support**
  - Add the new source-text draft generation route
  - Make generic assignment creation accept direct-field assignments without `mappingId`
  - Keep teacher auth and class org checks identical to the existing assignment routes

- [ ] **Step 5: Implement frontend Advanced mode selector + forms**
  - Preserve Quick Assign as Canvas-only
  - Add the `Canvas item` / `AI-assisted source` / `Manual authoring` selector only in Advanced
  - Reuse the existing review form instead of inventing a second editing surface

- [ ] **Step 6: Run focused tests**

```bash
python3 -m unittest backend.tests.test_curriculum_admin_routes backend.tests.test_curriculum_admin_api -v
cd frontend && npm run test -- --run src/pages/TeacherAssignmentBuilderPage.test.tsx
```

- [ ] **Step 7: Commit**

```bash
git add backend/routes/curriculum_admin.py backend/routes/*.py database.py \
        frontend/src/pages/TeacherAssignmentBuilderPage.tsx \
        frontend/src/pages/TeacherAssignmentBuilderPage.test.tsx \
        frontend/src/api/assignments.ts
git commit -m "feat(teacher-builder): add non-Canvas advanced authoring follow-up

Adds Advanced follow-up modes for:
- AI-assisted source generation from pasted teacher materials
- Manual authoring without Canvas linkage

Quick Assign remains Canvas-only. Advanced is now the mixed authoring
surface for both Canvas and non-Canvas assignments."
```

---

### Task B4: Remove `/app/curriculum` routes and AppCurriculumPage/AppCurriculumModulePage

**Files:**
- Modify: `frontend/src/App.tsx` (remove two routes + two lazy imports)
- Delete: `frontend/src/pages/AppCurriculumPage.tsx`, `frontend/src/pages/AppCurriculumModulePage.tsx`, and their test files if any.

- [ ] **Step 1: Search for any callers of the two routes / two pages outside of App.tsx**

Run: `grep -rn "AppCurriculumPage\|AppCurriculumModulePage\|/app/curriculum" frontend/src`
Expected: only `App.tsx` and the two page files themselves. If other callers exist, resolve them first.

- [ ] **Step 2: Delete the two route entries and imports in App.tsx**

Remove lines 24-25 (lazy imports) and 90-91 (route elements).

- [ ] **Step 3: Delete the two page files**

```bash
rm frontend/src/pages/AppCurriculumPage.tsx
rm frontend/src/pages/AppCurriculumModulePage.tsx
```

Also delete any test files for them.

- [ ] **Step 4: Run lint and build**

```bash
cd frontend && npm run lint && npm run build
```

Expected: no errors. If any remaining code references these pages, fix it.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.tsx
git rm frontend/src/pages/AppCurriculumPage.tsx frontend/src/pages/AppCurriculumModulePage.tsx
# plus any test files
git commit -m "chore(frontend): remove /app/curriculum routes and pages

Curriculum-package browsing was a dead-end in the pilot — students
discover assignments via /app/learn, not by browsing packages. Part
of the Canvas-content migration."
```

---

# Commit C — Backend cleanup: delete pedagogy + curriculum_mappings

Goal: With Canvas-practice as the only path, delete the sample-package code surface entirely. After this commit: no `curriculum_mappings` collection writes, no `pedagogy/` directory, no sample package data, no curriculum override in chat.

### Task C1: Delete `backend/services/pedagogy/`

**Files:**
- Delete: `backend/services/pedagogy/` directory (entire).

- [ ] **Step 1: Find every caller of anything in `backend/services/pedagogy/`**

Run: `grep -rn "from backend.services.pedagogy" backend/ main.py`
List callers. Expected callers: `assignment_resolver.py`, possibly `curriculum_admin.py`, possibly test files.

- [ ] **Step 2: In each caller, remove the import and any call site**

For each import line found:
- Delete the import.
- Delete the call site(s) that used it.
- Wherever the call site result was used (e.g., an extra dict inserted into the bootstrap response), remove that too — the value was feeding the deleted curriculum-package path.

- [ ] **Step 3: Delete the directory**

```bash
rm -rf backend/services/pedagogy/
```

- [ ] **Step 4: Run backend tests**

Run: `python3 -m unittest discover backend/tests`
Expected: OK. If anything fails, inspect — likely a test fixture still imports from pedagogy and needs deletion.

- [ ] **Step 5: Commit**

```bash
git rm -r backend/services/pedagogy/
# plus any other modified files
git commit -m "chore(backend): delete pedagogy engine

The pedagogy engine served the curriculum-package code path. After
the Canvas-practice migration, all content comes from Canvas pages
and the GPT scenario generator, neither of which use the pedagogy
template system. Resolves LIMITATIONS.md #16."
```

---

### Task C2: Delete curriculum_mappings CRUD and endpoints

**Files:**
- Modify: `database.py` — delete `create_curriculum_mapping`, `get_curriculum_mapping`, `list_curriculum_mappings`, `update_curriculum_mapping`, `delete_curriculum_mapping`, `get_curriculum_mapping_ref`, `get_curriculum_mappings_collection`.
- Modify: `backend/routes/curriculum_admin.py` — delete all `@bp.route('/api/teacher/classes/<class_id>/curriculum/mappings', ...)` endpoints (keep `POST /assignments`, `POST /student/assignments/<id>/bootstrap`, `POST .../practice-sessions`, `POST .../events`).
- Modify: `backend/routes/curriculum_admin.py:api_create_assignment` — remove `mappingId` required field; `mapping_id` is no longer passed to `create_assignment` from this endpoint.
- Modify: `backend/services/assignment_resolver.py` — remove the curriculum-package resolver branch; the dispatcher only calls `_resolve_canvas_generated_bootstrap`.
- Modify: `frontend/src/api/assignments.ts` — drop `createCurriculumMapping`, `getCurriculumMappings`, `getTeacherCurriculumPackages`, and the `mappingId` field on `AssignmentCreateInput`.
- Modify: `frontend/src/types/assignment.ts` — drop `CurriculumMappingDTO`, update `AssignmentDTO` to expose `instructions`, `generatedScenario`, etc.
- Delete: `frontend/src/types/curriculum.ts`

- [ ] **Step 1: Find every caller of `create_curriculum_mapping` / `get_curriculum_mapping`**

Run: `grep -rn "create_curriculum_mapping\|get_curriculum_mapping\|curriculum_mappings" backend/ main.py`
Remove each call site, including in tests. Any test that asserts mapping existence must be rewritten to assert assignment fields instead.

- [ ] **Step 2: Update `api_create_assignment`**

In `backend/routes/curriculum_admin.py`, the `POST /api/teacher/classes/<class_id>/assignments` endpoint currently requires `mappingId`. Remove that requirement; the endpoint should now accept direct scenario fields — OR — redirect new assignment creation to the canvas-practice endpoint. **Decision for this task:** keep both endpoints for now but make `mappingId` optional on the generic create endpoint, and document in the route that canvas-practice is preferred. In practice, after Commit B, the frontend never calls this generic endpoint for Canvas-based assignments.

- [ ] **Step 3: Delete the mapping-specific endpoints**

Remove `POST /api/teacher/classes/<class_id>/curriculum/mappings` and `GET /api/teacher/classes/<class_id>/curriculum/mappings` entirely from `backend/routes/curriculum_admin.py`.

- [ ] **Step 4: Remove the curriculum-package branch from `assignment_resolver.py`**

Delete the `_resolve_curriculum_package_bootstrap` function (or whatever it's named — it's the function called when `mapping.package_id != 'canvas-generated'`). Update the dispatcher to only call `_resolve_canvas_generated_bootstrap`. Add a clear error response when an assignment has a `mapping_id` but no direct scenario and no canvas-generated mapping.

- [ ] **Step 5: Remove curriculum-mapping helpers from `database.py`**

Delete `create_curriculum_mapping`, `get_curriculum_mapping`, `list_curriculum_mappings`, `update_curriculum_mapping`, `delete_curriculum_mapping`, `get_curriculum_mapping_ref`, `get_curriculum_mappings_collection`. Search for any other helpers referencing `curriculum_mappings` and remove.

- [ ] **Step 6: Update frontend API**

In `frontend/src/api/assignments.ts`, remove `createCurriculumMapping`, `getCurriculumMappings`, `getTeacherCurriculumPackages`. Update `AssignmentCreateInput` to remove `mappingId` and add the new optional fields (`instructions`, `generatedScenario`, `objectives`, `targetExpressions`, `focusGrammar`, `canvasModuleItemRef`). `AssignmentDTO` should expose the same fields.

- [ ] **Step 7: Delete the curriculum type file**

```bash
git rm frontend/src/types/curriculum.ts
```

- [ ] **Step 8: Run full test suite**

```bash
python3 -m unittest discover backend/tests
cd frontend && npm run lint && npm run build && npm run test -- --run
```

Expected: OK across the board. Fix any remaining type errors or broken tests inline.

- [ ] **Step 9: Commit**

```bash
# Stage all modifications and deletions
git add -u
git add backend/routes/curriculum_admin.py database.py backend/services/assignment_resolver.py \
        frontend/src/api/assignments.ts frontend/src/types/assignment.ts
git rm frontend/src/types/curriculum.ts
git commit -m "chore(cleanup): remove curriculum_mappings CRUD and package resolver

curriculum_mappings is no longer written or read anywhere. All
scenario fields live on the assignment document. Removes the
/api/teacher/classes/<id>/curriculum/mappings endpoints, the
_resolve_curriculum_package_bootstrap path in the assignment
resolver, and the database CRUD helpers. Completes the Canvas-
content migration."
```

---

### Task C3: Delete sample curriculum package loader and chat.py curriculum override

**Files:**
- Modify: `main.py` — remove `build_curriculum_system_prompt` (no remaining callers after Commit B + C2), `load_sample_curriculum_package`, `get_curriculum_practice_context`, and their `RouteDeps` wiring.
- Modify: `backend/routes/chat.py:305-336` — remove the `if practice.get('mode') == 'curriculum'` branch entirely; free-practice chat only takes the locale from the user profile.
- Delete: sample package data files under `data/` (verify during execution which files).
- Modify: `backend/route_deps.py` — remove `build_curriculum_system_prompt`, `load_sample_curriculum_package`, `get_curriculum_practice_context` from `RouteDeps`.

- [ ] **Step 1: Search for remaining callers**

Run:
```
grep -rn "build_curriculum_system_prompt\|load_sample_curriculum_package\|get_curriculum_practice_context" backend/ main.py frontend/
```

Expected: only `main.py`, `route_deps.py`, `chat.py`, and test fakes. Zero callers from the assignment flow (we removed them in earlier tasks).

- [ ] **Step 2: Remove the chat.py curriculum override**

In `backend/routes/chat.py` around lines 295-341, delete the `if practice.get('mode') == 'curriculum':` branch. Leave only the else branch (free-practice with user profile locale).

- [ ] **Step 3: Remove the `main.py` functions and their wiring**

Delete `build_curriculum_system_prompt`, `load_sample_curriculum_package`, `get_curriculum_practice_context`, `get_curriculum_tutor_role`, `format_support_target_lines`, and their helpers. Also remove the corresponding entries from the `RouteDeps(...)` constructor call in `main.py`.

- [ ] **Step 4: Remove RouteDeps fields**

In `backend/route_deps.py`, remove the three fields from the `RouteDeps` dataclass/class.

- [ ] **Step 5: Delete sample package data**

Run: `find data/ -name '*curriculum*' -o -name '*package*' -o -name '*ap_french*'`
Delete each file that's a sample curriculum package. Confirm path structure before deletion.

- [ ] **Step 6: Update test fakes**

Search for `build_curriculum_system_prompt` in `backend/tests/`. Each occurrence is a test fake lambda — delete those lambdas and the `RouteDeps` keyword they were setting.

- [ ] **Step 7: Run full backend + frontend test suite**

```bash
python3 -m unittest discover backend/tests
cd frontend && npm run lint && npm run build && npm run test -- --run
```

Expected: OK.

- [ ] **Step 8: Update docs**

Open `docs/school-integration/TECH_SPEC.md` and search for any mention of `curriculum_mappings`, sample packages, or the pedagogy engine. Remove or rewrite those sections to describe the Canvas-first data model.

Open `docs/school-integration/TASKS.md` and mark curriculum-package tasks deleted/completed.

Open `docs/school-integration/LIMITATIONS.md` and resolve entry #16 — update the status from "planned" to "resolved 2026-04-17 via Commit C of the Canvas content migration."

- [ ] **Step 9: Commit**

```bash
git add main.py backend/routes/chat.py backend/route_deps.py \
        docs/school-integration/TECH_SPEC.md docs/school-integration/TASKS.md \
        docs/school-integration/LIMITATIONS.md
# plus deleted sample package files
git add -u
git commit -m "chore(cleanup): remove sample curriculum package loader and chat.py override

Completes the Canvas-content migration. Deletes:
- main.py curriculum helpers (build_curriculum_system_prompt,
  load_sample_curriculum_package, get_curriculum_practice_context).
- chat.py curriculum override branch (/api/chat/realtime/session
  no longer accepts curriculumId/moduleId/situationId).
- Sample curriculum package data files.
- Corresponding RouteDeps wiring.

Updates TECH_SPEC, TASKS, and LIMITATIONS to match the shipped
Canvas-first data model."
```

---

# Post-migration verification (manual smoke test)

After Commit C lands, run the same smoke test from OBS-17 end-to-end to prove the migration works:

1. Start backend + frontend dev servers.
2. Log in as `hello@gmail.com` / `tbvmfla12` (teacher on AP Spanish Testing).
3. Navigate to `/app/teacher/classes/felNDvGCZVBgiYn4Q8IW/assignments` (Build assignments).
4. Quick Assign: pick a Canvas item from the picker (the AP Spanish Testing class already has synced modules like Zoom Info, Resources, Course Orientation).
5. Click "Generate practice from this item." Verify the suggestions card renders with a Spanish scenario, Spanish target expressions, and Spanish suggested title.
6. Click Publish. Verify the success alert and that a new assignment appears in "Your assignments."
7. Sign out, sign in as `example@gmail.com` / `tbvmflazla17` (student, already enrolled in the class).
8. Navigate to `/app/learn`. Verify the new assignment card is visible.
9. Launch the assignment. Verify `AssignmentLaunchPage` shows `instructions` and links to the Canvas source item (if attached).
10. Start text practice. Send a Spanish turn. Verify the AI responds in Spanish, referencing the Canvas-derived scenario (e.g., mentioning the course topic, not a French AP theme).
11. Inspect Firestore: confirm the new assignment has `generated_scenario`, `target_expressions`, `focus_grammar` directly on the doc and `mapping_id = None`.

If all eleven steps pass, the migration is complete.

---

# Self-Review

**Spec coverage:** Phase 2 (delete curriculum_mappings, Q3=a) covered by Tasks A1–A3 + B2 + C1–C3. Phase 3 (Canvas content as AI source) covered by reusing existing canvas-practice code (verified in discovery) + Task A3 (resolver reads from assignment) + Task B2 (UI picker). Q2=c (Quick Assign thin, Advanced structured) is partially covered by B2 + B3a; B3b tracks the remaining non-Canvas Advanced authoring modes. Q1=a (class locale) already shipped in Phase 1 (commit 70f52a3).

**Placeholder scan:** A few steps reference "follow existing styling patterns" or "the existing dispatcher structure" — these are reasonable for a file-level rewrite where inlining 500+ lines of code into the plan would reduce readability. In those cases the task spec names the exact file path and the exact behavior change, so the executor can read the existing code at execution time. No `TODO`, `implement later`, or unresolved ambiguity in the task descriptions.

**Type consistency:** New fields (`instructions`, `canvas_module_item_ref`, `objectives`, `target_expressions`, `focus_grammar`, `generated_scenario`) used identically across `database.py`, `FakeDbBase`, `canvas_practice.py`, `assignment_resolver.py`, and the frontend API types. Task B2's `CanvasPracticeCreateInput` uses camelCase (`targetExpressions`), Task A2's request handling maps camelCase → snake_case at the route boundary (`data.get('targetExpressions', [])`), and storage is snake_case — consistent with the rest of the codebase.

**Known unknowns:**
- Task B1's CanvasPracticeBuilderPage audit is genuinely discovery — I didn't want to prejudge the outcome. It's labeled clearly as an audit, not a code task.
- The exact Canvas content listing endpoint (`GET /api/teacher/classes/<id>/canvas/content` or similar) is referenced from memory in B2 Step 2; the executor must verify the path.
