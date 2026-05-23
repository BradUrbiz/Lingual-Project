#!/usr/bin/env python3
"""Build extraction batches for Path B (full extraction at scale).

Splits all URL-having anchor rows into ~24 batches:
  - 23 non-FCPS batches (use WebFetch)
  - 1 FCPS batch (use playwright-cli skill)

Run from repo root:
  python3 docs/sales/scripts/make_extraction_batches.py
"""
from __future__ import annotations

import csv
import json
import math
import random
from pathlib import Path

random.seed(42)
REPO = Path(__file__).resolve().parents[3]
CSV_PATH = REPO / "docs" / "sales" / "teacher_dmv.csv"
OUT = REPO / "docs" / "sales" / "extracted" / "_extraction_batches.json"

COLUMNS = ("state", "district", "county", "school_name",
           "school_url", "school_type", "nces_school_type")

with open(CSV_PATH, newline="", encoding="utf-8") as f:
    rows = list(csv.DictReader(f))

# Anchor rows with URL and no teacher data yet
ready = [r for r in rows if r["school_url"] and not r["teacher_first_name"]]
fcps = [r for r in ready if r["district"] == "Fairfax County Public Schools"]
non_fcps = [r for r in ready if r["district"] != "Fairfax County Public Schools"]

random.shuffle(non_fcps)

def slim(r):
    return {c: r[c] for c in COLUMNS}

N_BATCHES_NON_FCPS = 23
chunk_size = math.ceil(len(non_fcps) / N_BATCHES_NON_FCPS)

batches: dict[str, list[dict]] = {}
for i in range(N_BATCHES_NON_FCPS):
    chunk = non_fcps[i * chunk_size : (i + 1) * chunk_size]
    if chunk:
        batches[f"extraction_{i+1:02d}"] = [slim(r) for r in chunk]

batches["extraction_fcps"] = [slim(r) for r in fcps]

OUT.write_text(json.dumps(batches, indent=2))

print(f"Total ready-for-extraction schools: {len(ready)}")
print(f"  non-FCPS: {len(non_fcps)} across {N_BATCHES_NON_FCPS} batches "
      f"(~{chunk_size}/batch)")
print(f"  FCPS:     {len(fcps)} in 1 batch")
print()
print(f"Wrote {OUT}")
print()
print("Batch sizes:")
for k in sorted(batches):
    print(f"  {k}: {len(batches[k])} schools")
