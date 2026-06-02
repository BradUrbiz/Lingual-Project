"""Tier 1 (no DB): analytics dual-write flag gating + wiring (Slice A: assignments).

Verifies the fail-open shadow is OFF unless DUAL_WRITE_ASSIGNMENTS=1, and that when
ON it routes through the shared `_run` harness to the idempotent upsert. The engine
+ Session are stubbed so no Postgres is needed.
"""

import os
import unittest
from unittest import mock

from backend.db import dual_write_analytics as da


def _provider_that_explodes():
    """A sql_engine provider that fails if the shadow ever touches it — proves the
    flag-OFF path returns BEFORE resolving the engine."""
    def _boom():
        raise AssertionError('engine must not be resolved when the flag is OFF')
    return _boom


class TestAssignmentDualWriteGating(unittest.TestCase):
    def setUp(self):
        os.environ.pop('DUAL_WRITE_ASSIGNMENTS', None)
        self.addCleanup(lambda: os.environ.pop('DUAL_WRITE_ASSIGNMENTS', None))

    def test_create_is_noop_when_flag_off(self):
        # No exception => the provider was never called => returned before _run.
        da.shadow_create_assignment(
            _provider_that_explodes(), assignment_id='asg-1', assignment_data={'title': 'X'})

    def test_canvas_link_is_noop_when_flag_off(self):
        da.shadow_update_assignment_canvas_link(
            _provider_that_explodes(), assignment_id='asg-1', canvas_module_item_id='cmi-1')

    def test_create_routes_through_run_to_upsert_when_on(self):
        os.environ['DUAL_WRITE_ASSIGNMENTS'] = '1'
        captured = {}

        def fake_run(engine, op_name, fn):
            captured['op_name'] = op_name
            fn('SESSION')  # drive the op so the upsert wiring is exercised

        with mock.patch.object(da, '_run', fake_run), \
                mock.patch('backend.db.repository.backfill.upsert_assignment') as upsert:
            da.shadow_create_assignment(
                lambda: object(), assignment_id='asg-7',
                assignment_data={'title': 'Cafe', 'org_id': 'org-1', 'class_id': 'cls-1'})

        self.assertEqual(captured['op_name'], 'create_assignment')
        upsert.assert_called_once()
        # the doc passed to the upsert carries the Firestore id as 'id'
        passed_doc = upsert.call_args.args[1]
        self.assertEqual(passed_doc['id'], 'asg-7')
        self.assertEqual(passed_doc['title'], 'Cafe')

    def test_canvas_link_targets_item_id_column_when_on(self):
        os.environ['DUAL_WRITE_ASSIGNMENTS'] = '1'
        executed = {}

        class _Sess:
            def execute(self, stmt):
                executed['stmt'] = stmt

        def fake_run(engine, op_name, fn):
            executed['op_name'] = op_name
            fn(_Sess())

        with mock.patch.object(da, '_run', fake_run):
            da.shadow_update_assignment_canvas_link(
                lambda: object(), assignment_id='asg-1', canvas_module_item_id='cmi-9')

        self.assertEqual(executed['op_name'], 'update_assignment_canvas_link')
        self.assertIn('stmt', executed)   # a targeted UPDATE was issued


if __name__ == '__main__':
    unittest.main()
