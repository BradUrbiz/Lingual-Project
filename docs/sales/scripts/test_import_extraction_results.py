#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from import_extraction_results import import_results  # noqa: E402


class ImportExtractionResultsTests(unittest.TestCase):
    def test_rejects_email_without_extracted_provenance(self):
        payload = {
            "results": [
                {
                    "school_name": "Example High",
                    "state": "VA",
                    "district": "Example Public Schools",
                    "county": "Example County",
                    "school_url": "https://example.edu",
                    "extraction_status": "success",
                    "teachers": [
                        {
                            "first_name": "Jane",
                            "last_name": "Doe",
                            "email": "jane.doe@example.edu",
                            "email_source": "",
                            "languages": ["Spanish"],
                        }
                    ],
                }
            ]
        }

        summary = import_results(payload)

        self.assertEqual(summary["valid"], 0)
        self.assertEqual(summary["invalid"], 1)
        self.assertIn("email requires", summary["errors"][0]["errors"][0])

    def test_writes_normalized_school_file_when_result_is_valid(self):
        payload = {
            "results": [
                {
                    "school_name": "Example High",
                    "state": "VA",
                    "district": "Example Public Schools",
                    "county": "Example County",
                    "school_url": "https://example.edu",
                    "extraction_status": "names_only",
                    "extraction_notes": "Official directory showed names only.",
                    "faculty_page_url": "https://example.edu/staff",
                    "teachers": [
                        {
                            "first_name": "Jane",
                            "last_name": "Doe",
                            "email": "",
                            "email_source": "",
                            "role": "teacher",
                            "languages": ["Spanish"],
                            "personalization_hook": "",
                        }
                    ],
                }
            ]
        }
        with tempfile.TemporaryDirectory() as td:
            out = Path(td)
            summary = import_results(payload, out, write=True)
            written = out / "VA-example-public-schools-example-high.json"

            self.assertEqual(summary["written"], 1)
            self.assertTrue(written.exists())
            data = json.loads(written.read_text(encoding="utf-8"))

        self.assertEqual(data["teachers"][0]["first_name"], "Jane")
        self.assertEqual(data["teachers"][0]["email_source"], "")

    def test_normalizes_empty_teacher_languages_to_unspecified(self):
        payload = {
            "results": [
                {
                    "school_name": "Example High",
                    "state": "VA",
                    "district": "Example Public Schools",
                    "county": "Example County",
                    "school_url": "https://example.edu",
                    "extraction_status": "names_only",
                    "teachers": [
                        {
                            "first_name": "Jane",
                            "last_name": "Doe",
                            "email": "",
                            "email_source": "",
                            "role": "World Languages teacher",
                            "languages": [],
                        }
                    ],
                }
            ]
        }
        with tempfile.TemporaryDirectory() as td:
            out = Path(td)
            summary = import_results(payload, out, write=True)
            data = json.loads(
                (out / "VA-example-public-schools-example-high.json").read_text()
            )

        self.assertEqual(summary["written"], 1)
        self.assertEqual(data["teachers"][0]["languages"], ["unspecified"])

    def test_keeps_legacy_path_for_same_district(self):
        payload = {
            "results": [
                {
                    "school_name": "Example High",
                    "state": "VA",
                    "district": "Example Public Schools",
                    "county": "Example County",
                    "school_url": "https://example.edu",
                    "extraction_status": "failed",
                    "teachers": [],
                }
            ]
        }
        with tempfile.TemporaryDirectory() as td:
            out = Path(td)
            legacy = out / "VA-example-high.json"
            legacy.write_text(
                json.dumps(
                    {
                        "school_name": "Example High",
                        "state": "VA",
                        "district": "Example Public Schools",
                        "county": "Example County",
                        "school_url": "https://example.edu",
                        "extraction_status": "failed",
                        "teachers": [],
                    }
                ),
                encoding="utf-8",
            )
            summary = import_results(payload, out, write=True)
            legacy_exists = legacy.exists()

        self.assertEqual(summary["written"], 1)
        self.assertTrue(legacy_exists)

    def test_uses_district_path_when_legacy_path_is_other_district(self):
        payload = {
            "results": [
                {
                    "school_name": "Example High",
                    "state": "VA",
                    "district": "Second Public Schools",
                    "county": "Second County",
                    "school_url": "https://second.example.edu",
                    "extraction_status": "failed",
                    "teachers": [],
                }
            ]
        }
        with tempfile.TemporaryDirectory() as td:
            out = Path(td)
            (out / "VA-example-high.json").write_text(
                json.dumps(
                    {
                        "school_name": "Example High",
                        "state": "VA",
                        "district": "First Public Schools",
                        "county": "First County",
                        "school_url": "https://first.example.edu",
                        "extraction_status": "failed",
                        "teachers": [],
                    }
                ),
                encoding="utf-8",
            )
            summary = import_results(payload, out, write=True)
            district_path = out / "VA-second-public-schools-example-high.json"

            self.assertEqual(summary["written"], 1)
            self.assertTrue(district_path.exists())


if __name__ == "__main__":
    unittest.main()
