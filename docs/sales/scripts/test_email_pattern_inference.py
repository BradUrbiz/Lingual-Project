#!/usr/bin/env python3
"""Tests for the local Phase A email-pattern inference workflow."""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from apply_pattern_inference import apply_inference  # noqa: E402
from build_district_email_patterns import derive_patterns  # noqa: E402


class EmailPatternInferenceTests(unittest.TestCase):
    def test_derives_dominant_pattern_from_observed_extracted_emails(self):
        with tempfile.TemporaryDirectory() as td:
            extracted = Path(td)
            (extracted / "school-a.json").write_text(
                json.dumps(
                    {
                        "school_name": "A High",
                        "district": "Example Public Schools",
                        "teachers": [
                            {
                                "first_name": "Ana Maria",
                                "last_name": "Vazquez-Gil",
                                "email": "anamaria.vazquezgil@example.edu",
                                "email_source": "extracted",
                            },
                            {
                                "first_name": "Bo",
                                "last_name": "Ng",
                                "email": "bo.ng@example.edu",
                                "email_source": "extracted",
                            },
                            {
                                "first_name": "Hidden",
                                "last_name": "Teacher",
                                "email": "",
                                "email_source": "",
                            },
                        ],
                    }
                ),
                encoding="utf-8",
            )

            patterns = derive_patterns(extracted, min_support=2)

        entry = patterns["Example Public Schools"]
        self.assertEqual(entry["pattern"], "{first}.{last}@example.edu")
        self.assertEqual(entry["domain"], "example.edu")
        self.assertEqual(entry["supporting_emails"], 2)
        self.assertEqual(entry["matched_emails"], 2)

    def test_applies_pattern_to_names_only_teachers_without_claiming_extraction(self):
        with tempfile.TemporaryDirectory() as td:
            extracted = Path(td) / "extracted"
            extracted.mkdir()
            patterns_path = Path(td) / "patterns.json"
            patterns_path.write_text(
                json.dumps(
                    {
                        "Example Public Schools": {
                            "pattern": "{first[0]}{last}@example.edu",
                            "domain": "example.edu",
                            "confidence": "high",
                        }
                    }
                ),
                encoding="utf-8",
            )
            school_path = extracted / "school-b.json"
            school_path.write_text(
                json.dumps(
                    {
                        "school_name": "B High",
                        "district": "Example Public Schools",
                        "extraction_status": "names_only",
                        "teachers": [
                            {
                                "first_name": "Jane",
                                "last_name": "Doe",
                                "email": "",
                                "email_source": "",
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )

            summary = apply_inference(extracted, patterns_path, write=True)
            updated = json.loads(school_path.read_text(encoding="utf-8"))

        teacher = updated["teachers"][0]
        self.assertEqual(summary["teachers_inferred"], 1)
        self.assertEqual(teacher["email"], "jdoe@example.edu")
        self.assertEqual(teacher["email_source"], "inferred_pattern")
        self.assertEqual(teacher["pattern_confidence"], "high")
        self.assertEqual(teacher["email_verified"], "N")


if __name__ == "__main__":
    unittest.main()
