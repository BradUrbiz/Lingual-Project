#!/usr/bin/env python3
"""Pick 30 pilot schools across categories and dump batches JSON for subagents."""
import csv
import json
import random
from pathlib import Path

random.seed(42)
REPO = Path(__file__).resolve().parents[3]
CSV = REPO / "docs" / "sales" / "teacher_dmv.csv"
OUT_DIR = REPO / "docs" / "sales" / "extracted"
OUT_DIR.mkdir(exist_ok=True)

with open(CSV) as f:
    rows = [r for r in csv.DictReader(f) if r["school_url"]]

mcps = [r for r in rows if r["district"] == "Montgomery County Public Schools"]
aps = [r for r in rows if "Arlington" in r["district"]]
dcps = [r for r in rows if r["district"] == "District of Columbia Public Schools"]
fcps = [r for r in rows if r["district"] == "Fairfax County Public Schools"]
md_indep = [r for r in rows if r["school_type"] == "independent"]
other_va = [r for r in rows if r["state"] == "VA"
            and r["district"] not in ("Arlington County Public Schools",
                                       "Arlington Public Schools",
                                       "Fairfax County Public Schools")]
charters = [r for r in rows if r["school_type"] == "charter"]

print(f"pool sizes: MCPS={len(mcps)} APS={len(aps)} DCPS={len(dcps)} "
      f"FCPS={len(fcps)} MD-indep={len(md_indep)} other-VA={len(other_va)} charter={len(charters)}")
print()

def pick(pool, n):
    return random.sample(pool, min(n, len(pool)))

batches = {
    "mcps": pick(mcps, 6),
    "aps_other_va": pick(aps, 5) + pick(other_va, 5),
    "dcps_charter": pick(dcps, 4) + pick(charters, 2),
    "md_independent": pick(md_indep, 3),
    "fcps_playwright": pick(fcps, 5),
}

cols = ("state", "district", "county", "school_name", "school_url", "nces_school_type")
serializable = {k: [{c: r[c] for c in cols} for r in v] for k, v in batches.items()}

for name, schools in batches.items():
    print(f"=== {name} ({len(schools)} schools) ===")
    for r in schools:
        url = r["school_url"][:60]
        print(f"  {r['state']} | {r['school_name'][:42]:42} | {url}")
    print()

with open(OUT_DIR / "_pilot_batches.json", "w") as f:
    json.dump(serializable, f, indent=2)
print(f"Saved -> {OUT_DIR / '_pilot_batches.json'}")
