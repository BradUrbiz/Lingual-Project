#!/usr/bin/env python3
"""Filter NCES CCD + MD nonpublic snapshots into teacher_dmv.csv anchor rows.

Each output row represents one school. Teacher-specific columns stay empty;
those get populated in the next stage (subagent extraction over faculty pages).

Inputs (relative to repo root, all gitignored under docs/sales/raw/):
  ccd_sch_029_2425_w_0a_051425.csv  NCES Common Core of Data (2024-25 prelim)
  md_private_schools.html           MSDE nonpublic-school list snapshot

Output:
  docs/sales/teacher_dmv.csv

Run from repo root:
  python3 docs/sales/scripts/process_nces.py
"""
import csv
import html
import re
import sys
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
RAW = REPO_ROOT / "docs" / "sales" / "raw"
OUT = REPO_ROOT / "docs" / "sales" / "teacher_dmv.csv"

CCD_FILE = RAW / "ccd_sch_029_2425_w_0a_051425.csv"
MD_HTML = RAW / "md_private_schools.html"

DMV_STATES = {"MD", "VA", "DC"}

HEADER = [
    "state", "district", "county", "school_name", "school_level", "school_type",
    "nces_school_type", "school_url", "teacher_first_name", "teacher_last_name",
    "teacher_email", "teacher_role", "language", "department_chair_name",
    "department_chair_email", "source_url", "collected_date", "email_verified",
    "personalization_hook", "linkedin_url", "outreach_status",
    "last_contacted_date", "sequence_step", "demo_booked", "demo_completed",
    "tried_with_class", "referred_admin", "lingual_org_id", "unsubscribed", "notes",
]

DROP_NCES_TYPES = {"Special Education School"}

EMPTY = {k: "" for k in HEADER}


def _county_from_lea(lea_name: str, state: str) -> str:
    if state == "DC":
        return "District of Columbia"
    if not lea_name:
        return ""
    name = lea_name.strip()
    m = re.match(r"^(.+?)\s+County\b", name, re.IGNORECASE)
    if m:
        return f"{m.group(1).strip()} County"
    m = re.match(r"^(.+?)\s+City\b", name, re.IGNORECASE)
    if m:
        return f"{m.group(1).strip()} City"
    m = re.match(r"^(.+?)\s+Co\.?\s+Public", name, re.IGNORECASE)
    if m:
        return f"{m.group(1).strip()} County"
    m = re.match(r"^City\s+of\s+(.+?)\s+Public", name, re.IGNORECASE)
    if m:
        return f"{m.group(1).strip()} City"
    return ""


def process_ccd():
    rows = []
    skipped = Counter()
    with open(CCD_FILE, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for r in reader:
            state = (r.get("ST") or "").strip()
            if state not in DMV_STATES:
                continue
            if (r.get("SY_STATUS_TEXT") or "").strip() != "Open":
                skipped["closed"] += 1
                continue
            offers_hs = any(
                (r.get(f"G_{g}_OFFERED") or "").strip() == "Yes"
                for g in (9, 10, 11, 12)
            )
            if not offers_hs:
                skipped["non_hs"] += 1
                continue
            nces_type = (r.get("SCH_TYPE_TEXT") or "").strip()
            if nces_type in DROP_NCES_TYPES:
                skipped["special_ed"] += 1
                continue
            lea = (r.get("LEA_NAME") or "").strip()
            county = _county_from_lea(lea, state)
            if not county:
                skipped["no_county"] += 1
                continue
            is_charter = (r.get("CHARTER_TEXT") or "").strip() == "Yes"
            row = dict(EMPTY)
            row.update({
                "state": state,
                "district": lea,
                "county": county,
                "school_name": (r.get("SCH_NAME") or "").strip(),
                "school_level": "HS",
                "school_type": "charter" if is_charter else "public",
                "nces_school_type": nces_type,
                "school_url": (r.get("WEBSITE") or "").strip(),
                "source_url": "NCES CCD 2024-25 preliminary",
                "outreach_status": "not_started",
                "sequence_step": "0",
                "demo_booked": "N",
                "demo_completed": "N",
                "tried_with_class": "N",
                "referred_admin": "N",
                "unsubscribed": "N",
                "notes": (
                    f"NCES ID {r.get('NCESSCH', '').strip()}; "
                    f"phone {r.get('PHONE', '').strip()}; "
                    f"city {r.get('LCITY', '').strip()} {r.get('LZIP', '').strip()}"
                ),
            })
            rows.append(row)
    print(
        f"CCD: emitted {len(rows)} HS schools "
        f"(skipped {dict(skipped)})",
        file=sys.stderr,
    )
    return rows


class _MDTableParser(HTMLParser):
    def __init__(self, target_id: str):
        super().__init__()
        self.target_id = target_id
        self.in_table = False
        self.in_row = False
        self.in_cell = False
        self.in_bold = False
        self.current_row = []
        self.cell_text = []
        self.bold_text = []
        self.rows = []

    def handle_starttag(self, tag, attrs):
        d = dict(attrs)
        if tag == "table" and d.get("id") == self.target_id:
            self.in_table = True
        elif tag == "tr" and self.in_table:
            self.in_row = True
            self.current_row = []
        elif tag == "td" and self.in_row:
            self.in_cell = True
            self.cell_text = []
            self.bold_text = []
        elif tag == "b" and self.in_cell:
            self.in_bold = True

    def handle_endtag(self, tag):
        if tag == "table" and self.in_table:
            self.in_table = False
        elif tag == "tr" and self.in_row:
            if self.current_row:
                self.rows.append(self.current_row)
            self.in_row = False
        elif tag == "td" and self.in_cell:
            full = " ".join(t.strip() for t in self.cell_text if t.strip())
            bold = " ".join(t.strip() for t in self.bold_text if t.strip())
            self.current_row.append({"text": full, "bold": bold})
            self.in_cell = False
        elif tag == "b" and self.in_bold:
            self.in_bold = False

    def handle_data(self, data):
        if self.in_cell:
            self.cell_text.append(data)
            if self.in_bold:
                self.bold_text.append(data)


def _md_offers_hs(grade_text: str) -> bool:
    g = grade_text.lower()
    if "secondary school" in g or "high school" in g:
        return True
    for m in re.finditer(r"grades?\s+\d+\s+through\s+(\d+)", g):
        if int(m.group(1)) >= 9:
            return True
    return False


def process_md_private():
    if not MD_HTML.exists():
        print("MD HTML snapshot missing; skipping private schools", file=sys.stderr)
        return []
    parser = _MDTableParser("TotalPrivateSchoolListTable")
    parser.feed(MD_HTML.read_text(encoding="utf-8"))

    rows = []
    skipped_non_hs = 0
    for cells in parser.rows:
        if len(cells) < 5:
            continue
        name = html.unescape(cells[1]["bold"]).strip()
        if not name:
            continue
        grade_text = html.unescape(cells[1]["text"]).strip()
        # Strip the bolded name out of the grade text
        grade_only = grade_text.replace(name, "", 1).strip()
        if not _md_offers_hs(grade_only):
            skipped_non_hs += 1
            continue
        county = html.unescape(cells[2]["text"]).strip()
        if county and not re.search(r"\b(County|City)\b", county, re.IGNORECASE):
            county = f"{county} County"
        address = re.sub(r"\s+", " ", html.unescape(cells[3]["text"])).strip()
        phone = html.unescape(cells[4]["text"]).strip()

        row = dict(EMPTY)
        row.update({
            "state": "MD",
            "district": "independent",
            "county": county,
            "school_name": name,
            "school_level": "HS",
            "school_type": "independent",
            "nces_school_type": "Nonpublic",
            "school_url": "",
            "source_url": "MSDE NSAB approved nonpublic list",
            "outreach_status": "not_started",
            "sequence_step": "0",
            "demo_booked": "N",
            "demo_completed": "N",
            "tried_with_class": "N",
            "referred_admin": "N",
            "unsubscribed": "N",
            "notes": f"phone {phone}; address {address}; grades \"{grade_only}\"",
        })
        rows.append(row)
    print(
        f"MD nonpublic: emitted {len(rows)} HS-offering schools "
        f"(skipped {skipped_non_hs} non-HS)",
        file=sys.stderr,
    )
    return rows


def main():
    rows = process_ccd() + process_md_private()
    with open(OUT, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=HEADER)
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {len(rows)} school rows to {OUT}", file=sys.stderr)


if __name__ == "__main__":
    main()
