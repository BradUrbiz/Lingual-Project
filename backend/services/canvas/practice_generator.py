"""
AI-powered practice generation from Canvas course content.

Takes Canvas item metadata (title, description, type) and calls GPT to
produce a structured speaking-practice configuration that a teacher can
review and publish as a Lingual assignment.
"""

from __future__ import annotations

import json
import re
from typing import Any

# Locale display names for the AI prompt
_LOCALE_LABELS = {
    "ko-KR": "Korean",
    "fr-FR": "French",
    "es-ES": "Spanish",
    "ru-RU": "Russian",
    "he-IL": "Hebrew",
    "en-US": "English",
}


def generate_canvas_practice(
    openai_client: Any,
    *,
    item_title: str,
    item_type: str,
    item_description: str = "",
    class_learning_locale: str,
    class_name: str,
    class_subject: str,
) -> dict[str, Any]:
    """Call GPT to generate a speaking practice config from Canvas item content.

    Returns a dict with keys: scenario, target_expressions,
    target_vocabulary, focus_grammar, success_criteria, suggested_title,
    suggested_description, teacher_notes.
    """
    target_language = _LOCALE_LABELS.get(class_learning_locale, class_learning_locale)

    system_prompt = f"""You are an expert language pedagogy designer. Your job is to create engaging spoken {target_language} practice activities for students.

Given a Canvas course item (title, type, and optionally its description), design a speaking practice session where students practice {target_language} in a realistic scenario related to the course content.

Return a JSON object with exactly these keys:
- "scenario": A 2-3 sentence immersive scenario description that sets the scene for speaking practice. Write it in English as instructions for the AI tutor.
- "target_expressions": An array of 3-5 key {target_language} expressions/phrases students should practice using.
- "target_vocabulary": An array of 5-8 individual {target_language} vocabulary words students should practice using.
- "focus_grammar": An array of 2-3 grammar points relevant to the scenario.
- "success_criteria": An array of 2-4 success criteria for evaluating the practice.
- "suggested_title": A concise human-friendly title for the assignment.
- "suggested_description": A 1-2 sentence description of what students will practice.
- "teacher_notes": Brief notes for the teacher about pedagogical intent.

Make the practice feel connected to the course topic, not just generic language practice. The scenario should reference concepts from the Canvas item."""

    content_block = f"Title: {item_title}\nType: {item_type}"
    if item_description:
        # Truncate long descriptions to stay within token limits
        desc = item_description[:2000]
        content_block += f"\nDescription/Content:\n{desc}"

    user_prompt = f"""Design a {target_language} speaking practice for this Canvas course item.

Class: {class_name}
Subject: {class_subject}
Target Language: {target_language} ({class_learning_locale})

Canvas Item:
{content_block}

Return only the JSON object."""

    response = openai_client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        response_format={"type": "json_object"},
        temperature=0.7,
    )

    result = response.choices[0].message.content.strip()
    # Strip markdown fences if present
    if result.startswith("```"):
        result = re.sub(r"^```(?:json)?\s*\n?", "", result)
        result = re.sub(r"\n?```\s*$", "", result)

    parsed = json.loads(result)

    # Normalize and validate the response
    return {
        "scenario": str(parsed.get("scenario", "")),
        "target_expressions": _to_string_list(parsed.get("target_expressions", [])),
        "target_vocabulary": _to_string_list(parsed.get("target_vocabulary", [])),
        "focus_grammar": _to_string_list(parsed.get("focus_grammar", [])),
        "success_criteria": _to_string_list(parsed.get("success_criteria", [])),
        "suggested_title": str(parsed.get("suggested_title", f"Practice: {item_title}")),
        "suggested_description": str(parsed.get("suggested_description", "")),
        "teacher_notes": str(parsed.get("teacher_notes", "")),
    }


def _to_string_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(v) for v in value if v]
    return []
