"""Regression: school request submission must denormalize location.country
to the top-level `country` field so the Plan 5 country filter matches.

Before this fix, Plan 3 wizard submissions stored only `location.country`
(nested). The Lingual admin Requests page filters via
`list_school_requests(country=...)` which queries the top-level `country`
field. Result: every wizard submission produced a row that was invisible
to the country filter — the spec'd Requests-page filter behavior never
actually worked against real Plan 3 data.

This is denormalization at the DB write boundary
(`_build_school_request_payload`) so any caller benefits without needing
to know the layout. `_serialize_request` exposes the same denormalized
field on the wire so the FE list rows can render country directly.
"""
from __future__ import annotations

import unittest

import database


class BuildSchoolRequestPayloadCountryDenormTests(unittest.TestCase):
    def test_country_denormalized_from_location(self):
        payload = database._build_school_request_payload(
            'u1', 'u@x.com', 'U', 'Alpha High', 'school',
            enriched={
                'location': {'country': 'US', 'state': 'CA', 'county': 'San Mateo'},
                'school_type': 'k12',
                'public_private': 'public',
                'grade_size': '100-200',
            },
        )
        # Top-level country must be set so the L3349 filter query matches.
        self.assertEqual(payload.get('country'), 'US')
        # The nested location stays intact for the rich detail-panel surface.
        self.assertEqual(payload.get('location'), {
            'country': 'US', 'state': 'CA', 'county': 'San Mateo',
        })

    def test_no_location_means_no_top_level_country(self):
        # Defensive: if a caller omits location entirely (e.g. a Plan 3
        # legacy submission), don't fabricate a top-level country.
        payload = database._build_school_request_payload(
            'u1', 'u@x.com', 'U', 'Alpha High', 'school',
            enriched={'school_type': 'k12', 'public_private': 'public',
                      'grade_size': '100-200'},
        )
        self.assertNotIn('country', payload)

    def test_empty_country_in_location_does_not_denormalize(self):
        # Won't happen via the validator (which requires country) but the
        # DB helper must be defensive against malformed callers.
        payload = database._build_school_request_payload(
            'u1', 'u@x.com', 'U', 'Alpha High', 'school',
            enriched={'location': {'country': '', 'state': 'CA'}},
        )
        self.assertNotIn('country', payload)


if __name__ == '__main__':
    unittest.main()
