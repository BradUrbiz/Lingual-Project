#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

from jsonschema import Draft202012Validator


@dataclass(frozen=True)
class Issue:
    level: str  # "error" | "warning"
    message: str


def _load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def _fmt_path(path_parts: Iterable[Any]) -> str:
    parts: list[str] = []
    for part in path_parts:
        if isinstance(part, int):
            parts.append(f"[{part}]")
        else:
            parts.append(str(part) if not parts else f".{part}")
    return "".join(parts) or "$"


def _index_by_id(items: list[dict[str, Any]], kind: str, issues: list[Issue]) -> dict[str, dict[str, Any]]:
    index: dict[str, dict[str, Any]] = {}
    for i, item in enumerate(items):
        item_id = item.get("id")
        if not isinstance(item_id, str) or not item_id:
            issues.append(Issue("error", f"{kind}[{i}] missing valid id"))
            continue
        if item_id in index:
            issues.append(Issue("error", f"Duplicate {kind}.id: {item_id}"))
            continue
        index[item_id] = item
    return index


def _validate_schema(package: dict[str, Any], schema: dict[str, Any]) -> list[Issue]:
    issues: list[Issue] = []
    validator = Draft202012Validator(schema)
    errors = sorted(validator.iter_errors(package), key=lambda e: list(e.path))
    for err in errors:
        issues.append(Issue("error", f"Schema: {_fmt_path(err.path)}: {err.message}"))
    return issues


def _validate_references(package: dict[str, Any]) -> list[Issue]:
    issues: list[Issue] = []

    units = package.get("units", [])
    modules = package.get("modules", [])
    objectives = package.get("objectives", [])
    rubrics = package.get("rubrics", [])

    taxonomies = package.get("taxonomies", {}) or {}
    context_tags = set(taxonomies.get("contextTags", []) or [])
    communicative_functions = set(taxonomies.get("communicativeFunctions", []) or [])
    discourse_moves = set(taxonomies.get("discourseMoves", []) or [])
    task_models = set(taxonomies.get("taskModels", []) or [])
    foundation_domains = set(taxonomies.get("foundationDomains", []) or [])

    templates_obj = package.get("templates", {}) or {}
    templates = set(templates_obj.get("activityTemplateIds", []) or [])
    activity_templates = templates_obj.get("activityTemplates", []) or []

    if not isinstance(units, list) or not isinstance(modules, list) or not isinstance(objectives, list) or not isinstance(rubrics, list):
        issues.append(Issue("error", "Top-level lists (units/modules/objectives/rubrics) must be arrays."))
        return issues

    units_by_id = _index_by_id([u for u in units if isinstance(u, dict)], "units", issues)
    modules_by_id = _index_by_id([m for m in modules if isinstance(m, dict)], "modules", issues)
    objectives_by_id = _index_by_id([o for o in objectives if isinstance(o, dict)], "objectives", issues)
    rubrics_by_id = _index_by_id([r for r in rubrics if isinstance(r, dict)], "rubrics", issues)
    activity_templates_by_id = _index_by_id(
        [t for t in activity_templates if isinstance(t, dict)],
        "activityTemplates",
        issues,
    )

    for template_id in templates:
        if template_id not in activity_templates_by_id:
            issues.append(Issue("error", f"Template id {template_id} is listed in templates.activityTemplateIds but has no definition"))
    for template_id in activity_templates_by_id:
        if template_id not in templates:
            issues.append(Issue("error", f"Template definition {template_id} is not listed in templates.activityTemplateIds"))

    # Unit -> modules
    for unit in units:
        if not isinstance(unit, dict):
            continue
        unit_id = unit.get("id")
        module_ids = unit.get("moduleIds", []) or []
        for module_id in module_ids:
            if module_id not in modules_by_id:
                issues.append(Issue("error", f"Unit {unit_id} references missing moduleId {module_id}"))
                continue
            if modules_by_id[module_id].get("unitId") != unit_id:
                issues.append(Issue("error", f"Module {module_id} unitId mismatch (expected {unit_id})"))

    # Module -> objectives and situations
    objective_ids_in_situations: set[str] = set()
    allowed_situation_kinds = {"interpretive_listening", "interpersonal_speaking", "presentational_speaking"}
    expected_situation_prefix = {"interpretive_listening": "L", "interpersonal_speaking": "I", "presentational_speaking": "P"}

    for module in modules:
        if not isinstance(module, dict):
            continue
        module_id = module.get("id")
        unit_id = module.get("unitId")

        if unit_id not in units_by_id:
            issues.append(Issue("error", f"Module {module_id} references missing unitId {unit_id}"))

        module_objective_ids = set(module.get("objectiveIds", []) or [])
        if not (6 <= len(module_objective_ids) <= 10):
            issues.append(Issue("warning", f"Module {module_id} has {len(module_objective_ids)} objectives (expected 6-10)."))

        for objective_id in module_objective_ids:
            if objective_id not in objectives_by_id:
                issues.append(Issue("error", f"Module {module_id} references missing objectiveId {objective_id}"))
                continue
            obj = objectives_by_id[objective_id]
            if obj.get("moduleId") != module_id:
                issues.append(Issue("error", f"Objective {objective_id} moduleId mismatch (expected {module_id})"))
            if obj.get("unitId") != unit_id:
                issues.append(Issue("error", f"Objective {objective_id} unitId mismatch (expected {unit_id})"))

        # SupportTargets should cover the curriculum foundation domains (if declared)
        support_targets = module.get("supportTargets", {}) or {}
        if foundation_domains:
            missing_domains = foundation_domains.difference(set(support_targets.keys()))
            extra_domains = set(support_targets.keys()).difference(foundation_domains)
            if missing_domains:
                issues.append(Issue("error", f"Module {module_id} supportTargets missing: {sorted(missing_domains)}"))
            if extra_domains:
                issues.append(Issue("warning", f"Module {module_id} supportTargets has extra keys: {sorted(extra_domains)}"))

        for domain, targets in support_targets.items():
            if not isinstance(targets, list):
                continue
            seen_target_ids: set[str] = set()
            for t in targets:
                if not isinstance(t, dict):
                    continue
                tid = t.get("id")
                if isinstance(tid, str):
                    if tid in seen_target_ids:
                        issues.append(Issue("error", f"Module {module_id} supportTargets.{domain} has duplicate id {tid}"))
                    seen_target_ids.add(tid)

        situations = module.get("situations", {}) or {}
        if not isinstance(situations, dict):
            issues.append(Issue("error", f"Module {module_id} situations must be an object"))
            continue

        for bucket, items in situations.items():
            if bucket not in allowed_situation_kinds:
                issues.append(Issue("warning", f"Module {module_id} has unexpected situations bucket: {bucket}"))
            for situation in items or []:
                if not isinstance(situation, dict):
                    continue
                situation_id = situation.get("id")
                kind = situation.get("kind")
                if kind is not None and kind != bucket:
                    issues.append(Issue("error", f"Situation {situation_id} kind={kind} but is stored under {bucket}"))

                if isinstance(situation_id, str):
                    suffix = situation_id.split(".")[-1] if "." in situation_id else ""
                    expected_prefix = expected_situation_prefix.get(bucket)
                    if expected_prefix and suffix and not suffix.startswith(expected_prefix):
                        issues.append(Issue("error", f"Situation {situation_id} does not match expected suffix for {bucket}"))

                seed = situation.get("seed", {}) or {}
                for tag in seed.get("contextTags", []) or []:
                    if context_tags and tag not in context_tags:
                        issues.append(Issue("error", f"Situation {situation_id} seed.contextTags contains unknown tag {tag}"))

                for objective_id in situation.get("objectiveIds", []) or []:
                    objective_ids_in_situations.add(objective_id)
                    if objective_id not in objectives_by_id:
                        issues.append(Issue("error", f"Situation {situation_id} references missing objectiveId {objective_id}"))
                        continue
                    if objective_id not in module_objective_ids:
                        issues.append(Issue("error", f"Situation {situation_id} references objectiveId {objective_id} not in module {module_id}"))
                        continue

                    objective_mode = objectives_by_id[objective_id].get("mode")
                    if objective_mode != bucket:
                        issues.append(
                            Issue(
                                "error",
                                f"Situation {situation_id} stored under {bucket} but references objective {objective_id} with mode={objective_mode}",
                            )
                        )

    # Objective -> rubrics/templates/taskModels
    allowed_task_models: dict[str, set[str]] = {
        "interpretive_listening": {
            "ap.interview",
            "ap.instructions",
            "ap.presentation",
            "ap.audio_report_and_article",
            "ap.conversation_and_chart",
        },
        "interpersonal_speaking": {"ap.conversation", "lingual.roleplay", "lingual.free_conversation"},
        "presentational_speaking": {"ap.cultural_presentation", "ap.cultural_comparison", "lingual.roleplay"},
        "support": {"lingual.roleplay"},
    }

    for obj in objectives:
        if not isinstance(obj, dict):
            continue
        objective_id = obj.get("id")
        mode = obj.get("mode")

        mastery = obj.get("mastery", {}) or {}
        rubric_id = mastery.get("rubricId")
        if rubric_id not in rubrics_by_id:
            issues.append(Issue("error", f"Objective {objective_id} references missing rubricId {rubric_id}"))
        else:
            threshold = mastery.get("threshold")
            scale = (rubrics_by_id[rubric_id].get("scale", {}) or {})
            rmin, rmax = scale.get("min"), scale.get("max")
            if isinstance(threshold, int) and isinstance(rmin, int) and isinstance(rmax, int):
                if threshold < rmin or threshold > rmax:
                    issues.append(Issue("error", f"Objective {objective_id} threshold {threshold} outside rubric {rubric_id} scale {rmin}-{rmax}"))

        for tpl in obj.get("templateRefs", []) or []:
            if tpl not in templates:
                issues.append(Issue("error", f"Objective {objective_id} references unknown template {tpl}"))

        for tag in obj.get("contextTags", []) or []:
            if context_tags and tag not in context_tags:
                issues.append(Issue("error", f"Objective {objective_id} contextTags contains unknown tag {tag}"))
        for fn in obj.get("communicativeFunctions", []) or []:
            if communicative_functions and fn not in communicative_functions:
                issues.append(Issue("error", f"Objective {objective_id} communicativeFunctions contains unknown tag {fn}"))
        for mv in obj.get("discourseMoves", []) or []:
            if discourse_moves and mv not in discourse_moves:
                issues.append(Issue("error", f"Objective {objective_id} discourseMoves contains unknown tag {mv}"))
        for dom in obj.get("foundationDomains", []) or []:
            if foundation_domains and dom not in foundation_domains:
                issues.append(Issue("error", f"Objective {objective_id} foundationDomains contains unknown domain {dom}"))

        ev = obj.get("evidenceModel", {}) or {}
        task_model = ev.get("taskModel")
        if task_models and task_model not in task_models:
            issues.append(Issue("error", f"Objective {objective_id} evidenceModel.taskModel unknown: {task_model}"))
        allowed = allowed_task_models.get(mode)
        if allowed is not None and task_model not in allowed:
            issues.append(Issue("error", f"Objective {objective_id} mode={mode} has incompatible taskModel={task_model}"))

    # Coverage: each objective should appear in at least one situation
    for objective_id in objectives_by_id:
        if objective_id not in objective_ids_in_situations:
            issues.append(Issue("warning", f"Objective {objective_id} is not referenced by any situation"))

    # Warn on unused templates
    used_templates: set[str] = set()
    for obj in objectives:
        if not isinstance(obj, dict):
            continue
        used_templates.update(obj.get("templateRefs", []) or [])
    for tpl in templates:
        if tpl not in used_templates:
            issues.append(Issue("warning", f"Unused template: {tpl}"))

    return issues


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate Lingual CurriculumPackageV1 JSON.")
    parser.add_argument("package", type=Path, help="Path to curriculum package JSON.")
    parser.add_argument(
        "--schema",
        type=Path,
        default=Path("data/curriculum/schema.curriculum_package_v1.json"),
        help="Path to JSON Schema.",
    )
    parser.add_argument("--warnings-as-errors", action="store_true", help="Treat warnings as errors.")
    args = parser.parse_args()

    if not args.package.exists():
        print(f"Package file not found: {args.package}", file=sys.stderr)
        return 2
    if not args.schema.exists():
        print(f"Schema file not found: {args.schema}", file=sys.stderr)
        return 2

    try:
        schema = _load_json(args.schema)
        Draft202012Validator.check_schema(schema)
    except Exception as e:
        print(f"Invalid schema: {args.schema}: {e}", file=sys.stderr)
        return 2

    try:
        package = _load_json(args.package)
    except Exception as e:
        print(f"Invalid JSON: {args.package}: {e}", file=sys.stderr)
        return 2

    issues: list[Issue] = []
    issues.extend(_validate_schema(package, schema))
    if not any(i.level == "error" for i in issues):
        issues.extend(_validate_references(package))

    errors = [i for i in issues if i.level == "error"]
    warnings = [i for i in issues if i.level == "warning"]

    for i in errors:
        print(f"ERROR: {i.message}")
    for i in warnings:
        print(f"WARN:  {i.message}")

    if args.warnings_as_errors and warnings:
        return 1
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
