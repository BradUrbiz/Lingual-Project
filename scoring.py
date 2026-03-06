"""
Scoring module for ACTFL-aligned assessment.
Implements heuristic scorers for text responses and aggregation logic.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional


DEFAULT_ASSESSMENT_PATHS = (
    Path("data/assessment_v1.json"),
    Path("Curriculum Data/assessment_v1.json"),
)


def load_assessment_data(filepath: str = "data/assessment_v1.json") -> dict:
    """Load assessment configuration from JSON file with fallback paths."""
    requested = Path(filepath)
    candidate_paths = [requested] + [path for path in DEFAULT_ASSESSMENT_PATHS if path != requested]

    for path in candidate_paths:
        if path.exists():
            with path.open("r", encoding="utf-8") as file:
                return json.load(file)

    searched_paths = ", ".join(str(path) for path in candidate_paths)
    raise FileNotFoundError(f"Assessment configuration not found. Searched: {searched_paths}")


# =============================================================================
# MCQ Scoring
# =============================================================================

def score_mcq_single(response: str, scoring_rules: List[dict]) -> float:
    """Score a single-choice MCQ based on scoring rules."""
    for rule in scoring_rules:
        condition = rule.get("condition", {})

        # Exact match
        if "selected_option_id" in condition and response == condition["selected_option_id"]:
            return float(rule.get("score", 0.0))

        # Any selection present
        if condition.get("selected_option_id_any") and response:
            return float(rule.get("score", 0.0))

        # Match any option in list
        valid_options = condition.get("selected_option_id_in")
        if isinstance(valid_options, list) and response in valid_options:
            return float(rule.get("score", 0.0))

    return 0.0


# =============================================================================
# Text Heuristic Scorers
# =============================================================================

def count_sentences(text: str) -> int:
    """Count rough sentence boundaries across common punctuation systems."""
    endings = re.findall(r"[.!?。？！]", text)
    return max(len(endings), 1) if text.strip() else 0


def heuristic_self_intro_v1(text: str, params: dict) -> float:
    """Korean-focused self-introduction scorer kept for backward compatibility."""
    if not text.strip():
        return 0.0

    weights = params.get("weights", {})
    lexicons = params.get("lexicons", {})
    min_sentences = params.get("min_sentences", 2)

    score = 0.0

    sentence_count = count_sentences(text)
    if sentence_count >= min_sentences:
        score += weights.get("sentences", 0.3)
    elif sentence_count >= 1:
        score += weights.get("sentences", 0.3) * 0.5

    basic_verbs = lexicons.get("basic_verbs", [])
    verb_matches = sum(1 for verb in basic_verbs if verb in text)
    if verb_matches >= 2:
        score += weights.get("basic_verbs", 0.3)
    elif verb_matches >= 1:
        score += weights.get("basic_verbs", 0.3) * 0.5

    topic_words = lexicons.get("topic_or_hobby", [])
    topic_matches = sum(1 for word in topic_words if word in text)
    if topic_matches >= 2:
        score += weights.get("topic_or_hobby", 0.2)
    elif topic_matches >= 1:
        score += weights.get("topic_or_hobby", 0.2) * 0.5

    if len(text) > 50 and sentence_count >= min_sentences:
        score += 0.2

    return min(score, 1.0)


def heuristic_past_routine_v1(text: str, params: dict) -> float:
    """Korean-focused past routine scorer kept for backward compatibility."""
    if not text.strip():
        return 0.0

    weights = params.get("weights", {})
    patterns = params.get("patterns", {})
    lexicons = params.get("lexicons", {})
    min_sentences = params.get("min_sentences", 2)

    score = 0.0

    sentence_count = count_sentences(text)
    if sentence_count >= min_sentences:
        score += weights.get("sentences", 0.3)
    elif sentence_count >= 1:
        score += weights.get("sentences", 0.3) * 0.5

    past_tense_regex = patterns.get("past_tense_regex", r"(았|었|했)")
    past_matches = len(re.findall(past_tense_regex, text))
    if past_matches >= 2:
        score += weights.get("past_tense", 0.4)
    elif past_matches >= 1:
        score += weights.get("past_tense", 0.4) * 0.6

    content_words = lexicons.get("content_words", [])
    min_content = max(int(lexicons.get("min_content_word_count", 3)), 1)
    content_matches = sum(1 for word in content_words if word in text)
    if content_matches >= min_content:
        score += weights.get("content_words", 0.3)
    elif content_matches >= 1:
        score += weights.get("content_words", 0.3) * (content_matches / min_content)

    return min(score, 1.0)


def heuristic_professor_polite_rewrite_v1(text: str, params: dict) -> float:
    """Korean-focused polite rewrite scorer kept for backward compatibility."""
    if not text.strip():
        return 0.0

    weights = params.get("weights", {})
    lexicons = params.get("lexicons", {})
    patterns = params.get("patterns", {})

    score = 0.0

    professor_terms = lexicons.get("professor_terms", ["교수님"])
    if any(term in text for term in professor_terms):
        score += weights.get("address_professor", 0.2)

    apology_terms = lexicons.get("apology_terms", ["죄송", "실례"])
    if any(term in text for term in apology_terms):
        score += weights.get("apology", 0.2)

    polite_regex = patterns.get("polite_endings_regex", r"(요|습니다)")
    if re.search(polite_regex, text):
        score += weights.get("polite_endings", 0.4)

    request_keywords = lexicons.get("request_keywords", [])
    if sum(1 for keyword in request_keywords if keyword in text) >= 2:
        score += weights.get("request_content", 0.2)

    casual_regex = patterns.get("casual_endings_regex", r"(어\?|어\.|했어|냈어|돼\?)")
    if re.search(casual_regex, text):
        score += weights.get("penalty_casual", -0.3)

    return max(0.0, min(score, 1.0))


def heuristic_can_do_reflection_v1(text: str, params: dict) -> float:
    """
    Language-agnostic reflection scorer for ACTFL-style self-description prompts.

    Signals:
    - minimum length
    - sentence completeness
    - basic discourse connector usage
    """
    if not text.strip():
        return 0.0

    min_words = max(int(params.get("min_words", 25)), 1)
    min_sentences = max(int(params.get("min_sentences", 2)), 1)
    weights = params.get(
        "weights",
        {
            "length": 0.45,
            "sentences": 0.35,
            "connectors": 0.20,
        },
    )

    connector_terms = params.get(
        "connector_terms",
        [
            "and",
            "but",
            "because",
            "so",
            "then",
            "also",
            "however",
            "그리고",
            "하지만",
            "그래서",
            "porque",
            "pero",
            "entonces",
            "y",
            "et",
            "mais",
            "parce que",
            "donc",
        ],
    )

    score = 0.0
    word_count = len(re.findall(r"\S+", text))
    sentence_count = count_sentences(text)
    normalized = text.lower()

    # Length signal
    if word_count >= min_words:
        score += weights.get("length", 0.45)
    else:
        score += weights.get("length", 0.45) * (word_count / min_words)

    # Sentence completeness signal
    if sentence_count >= min_sentences:
        score += weights.get("sentences", 0.35)
    else:
        score += weights.get("sentences", 0.35) * (sentence_count / min_sentences)

    # Basic discourse signal
    connector_matches = sum(1 for term in connector_terms if term in normalized)
    if connector_matches >= 2:
        score += weights.get("connectors", 0.20)
    elif connector_matches >= 1:
        score += weights.get("connectors", 0.20) * 0.6

    return max(0.0, min(score, 1.0))


# =============================================================================
# Audio Scoring (Placeholder - requires ASR integration)
# =============================================================================

def asr_pron_wordlist_v1(audio_transcript: Optional[str], params: dict) -> float:
    """Placeholder pronunciation scorer for word-list reading."""
    if not audio_transcript:
        return 0.5

    target_words = params.get("target_words", [])
    matches = sum(1 for word in target_words if word in audio_transcript)
    match_ratio = matches / len(target_words) if target_words else 0.0

    if match_ratio >= 0.85:
        return 1.0
    if match_ratio >= 0.70:
        return 0.7
    if match_ratio >= 0.50:
        return 0.4
    return 0.2


def asr_pron_sentence_v1(audio_transcript: Optional[str], params: dict) -> float:
    """Placeholder pronunciation scorer for sentence reading."""
    if not audio_transcript:
        return 0.5

    target_sentences = params.get("target_sentences", [])
    total_chars = sum(len(sentence.replace(" ", "")) for sentence in target_sentences)
    transcript_clean = audio_transcript.replace(" ", "")

    overlap = sum(1 for char in transcript_clean if any(char in sentence for sentence in target_sentences))
    overlap_ratio = overlap / total_chars if total_chars else 0.0

    if overlap_ratio >= 0.85:
        return 1.0
    if overlap_ratio >= 0.70:
        return 0.7
    if overlap_ratio >= 0.50:
        return 0.4
    return 0.2


# =============================================================================
# Score Dispatcher
# =============================================================================

SCORING_METHODS = {
    "heuristic_self_intro_v1": heuristic_self_intro_v1,
    "heuristic_past_routine_v1": heuristic_past_routine_v1,
    "heuristic_professor_polite_rewrite_v1": heuristic_professor_polite_rewrite_v1,
    "heuristic_can_do_reflection_v1": heuristic_can_do_reflection_v1,
    "asr_pron_wordlist_v1": asr_pron_wordlist_v1,
    "asr_pron_sentence_v1": asr_pron_sentence_v1,
}


def score_item(item: dict, response: Any) -> float:
    """Score a single assessment item based on its scoring config."""
    scoring = item.get("scoring", {})
    response_type = scoring.get("response_type")

    if response_type == "single_choice":
        rules = scoring.get("rules", [])
        return score_mcq_single(str(response), rules)

    if response_type == "text":
        method_name = scoring.get("method")
        params = scoring.get("params", {})
        method = SCORING_METHODS.get(method_name)
        if method:
            return method(str(response), params)
        return 0.0

    if response_type == "audio":
        method_name = scoring.get("method")
        params = scoring.get("params", {})
        method = SCORING_METHODS.get(method_name)
        if method:
            return method(response, params)
        return 0.5

    return 0.0


# =============================================================================
# Aggregation
# =============================================================================

def compute_domain_scores(
    items: List[dict],
    responses: Dict[str, Any],
    domains: List[str],
) -> Dict[str, float]:
    """Compute weighted average scores for each domain (0.0 to 1.0)."""
    domain_scores = {domain: {"weighted_sum": 0.0, "weight_total": 0.0} for domain in domains}

    for item in items:
        item_id = item["id"]
        response = responses.get(item_id, "")
        item_score = score_item(item, response)

        for domain, weight in item.get("domains", {}).items():
            if domain in domain_scores and weight > 0:
                domain_scores[domain]["weighted_sum"] += item_score * weight
                domain_scores[domain]["weight_total"] += weight

    result: Dict[str, float] = {}
    for domain in domains:
        weight_total = domain_scores[domain]["weight_total"]
        if weight_total > 0:
            result[domain] = domain_scores[domain]["weighted_sum"] / weight_total
        else:
            result[domain] = 0.0

    return result


def score_to_band(score: float, bands: List[dict]) -> int:
    """Convert a raw score into the configured band value."""
    for band_def in bands:
        min_score = float(band_def.get("min_score", 0.0))
        max_score = float(band_def.get("max_score", 1.0))
        if min_score <= score <= max_score:
            return int(band_def.get("band", 0))
    return 0


ACTFL_LEVEL_DESCRIPTIONS = {
    0: {
        "level": "Novice Low",
        "description_en": "Can communicate with isolated words and memorized expressions in highly predictable contexts.",
        "description_ko": "매우 예측 가능한 상황에서 단어와 암기 표현 중심으로 의사소통할 수 있습니다.",
    },
    1: {
        "level": "Novice Mid",
        "description_en": "Can handle simple, practiced exchanges using words and short phrases.",
        "description_ko": "짧은 구나 문장을 활용해 연습된 주제에서 기본적인 상호작용이 가능합니다.",
    },
    2: {
        "level": "Novice High",
        "description_en": "Can create short sentences on familiar topics but with limited consistency.",
        "description_ko": "익숙한 주제에서 짧은 문장을 만들 수 있으나 일관성은 제한적입니다.",
    },
    3: {
        "level": "Intermediate Low",
        "description_en": "Can manage simple conversations and ask/answer basic questions in everyday situations.",
        "description_ko": "일상 상황에서 기본 질문과 답변 중심의 간단한 대화를 수행할 수 있습니다.",
    },
    4: {
        "level": "Intermediate Mid",
        "description_en": "Can sustain straightforward conversations and narrate in connected sentences on familiar topics.",
        "description_ko": "익숙한 주제에서 연결된 문장으로 대화를 이어가고 간단히 설명할 수 있습니다.",
    },
    5: {
        "level": "Intermediate High",
        "description_en": "Can handle uncomplicated tasks and begin discussing less familiar topics with support.",
        "description_ko": "비교적 단순한 과제를 자립적으로 수행하고, 덜 익숙한 주제도 보조가 있으면 다룰 수 있습니다.",
    },
    6: {
        "level": "Advanced Low",
        "description_en": "Can narrate and describe in major time frames with paragraph-length language on concrete topics.",
        "description_ko": "구체적 주제에서 주요 시제를 사용해 단락 길이로 서술과 묘사가 가능합니다.",
    },
    7: {
        "level": "Advanced Mid",
        "description_en": "Can participate effectively in most informal and some formal conversations with good control.",
        "description_ko": "대부분의 비격식 상황과 일부 격식 상황에서 비교적 안정적으로 의사소통할 수 있습니다.",
    },
    8: {
        "level": "Advanced High",
        "description_en": "Can discuss a broad range of topics and support opinions with extended discourse.",
        "description_ko": "다양한 주제를 길게 설명하고 의견을 뒷받침하는 담화를 구성할 수 있습니다.",
    },
    9: {
        "level": "Superior",
        "description_en": "Can discuss abstract issues and support hypotheses with structured, precise language.",
        "description_ko": "추상적 이슈를 논리적으로 다루고 가설을 근거와 함께 제시할 수 있습니다.",
    },
    10: {
        "level": "Distinguished",
        "description_en": "Can use language strategically and persuasively across complex professional and academic contexts.",
        "description_ko": "복합적인 학술·전문 맥락에서 전략적이고 설득력 있게 언어를 구사할 수 있습니다.",
    },
}


# Backward compatibility alias for existing imports/usages.
SKLC_LEVEL_DESCRIPTIONS = ACTFL_LEVEL_DESCRIPTIONS


def get_actfl_description(stage: int, lang: str = "en") -> dict:
    """Get ACTFL level description for a normalized stage index (0-10)."""
    clamped_stage = max(0, min(int(stage), 10))
    description = ACTFL_LEVEL_DESCRIPTIONS.get(clamped_stage, ACTFL_LEVEL_DESCRIPTIONS[0])
    language_key = f"description_{lang}"
    return {
        "level": description["level"],
        "description": description.get(language_key, description["description_en"]),
    }


def get_sklc_description(stage: int, lang: str = "en") -> dict:
    """Backward-compatible alias now returning ACTFL descriptors."""
    return get_actfl_description(stage, lang)


def resolve_actfl_profile(global_raw_score: float, configured_levels: List[dict] | None = None) -> dict:
    """Resolve ACTFL profile from raw global score (0.0 to 1.0)."""
    score = max(0.0, min(float(global_raw_score), 1.0))

    if isinstance(configured_levels, list):
        for level_def in configured_levels:
            min_score = float(level_def.get("min_score", 0.0))
            max_score = float(level_def.get("max_score", 1.0))
            if min_score <= score <= max_score:
                return {
                    "code": level_def.get("code", "novice_low"),
                    "level": level_def.get("label", "Novice Low"),
                    "description_en": level_def.get(
                        "description_en",
                        "Can communicate with isolated words and memorized expressions.",
                    ),
                    "description_ko": level_def.get(
                        "description_ko",
                        "단어와 암기 표현 중심으로 의사소통할 수 있습니다.",
                    ),
                }

    fallback_stage = max(0, min(round(score * 10), 10))
    fallback = ACTFL_LEVEL_DESCRIPTIONS[fallback_stage]
    return {
        "code": fallback["level"].lower().replace(" ", "_"),
        "level": fallback["level"],
        "description_en": fallback["description_en"],
        "description_ko": fallback["description_ko"],
    }


def compute_results(assessment_data: dict, responses: Dict[str, Any]) -> dict:
    """Compute assessment results including ACTFL-aligned proficiency outputs."""
    items = assessment_data.get("items", [])
    domains = assessment_data.get("domains", [])
    aggregation = assessment_data.get("aggregation", {})
    bands_config = aggregation.get("banding", {}).get("bands", [])

    domain_raw_scores = compute_domain_scores(items, responses, domains)

    domain_bands = {
        domain: score_to_band(score, bands_config)
        for domain, score in domain_raw_scores.items()
    }

    global_config = aggregation.get("global_stage", {})
    included_domains = global_config.get("included_domains", domains)

    included_bands = [domain_bands[domain] for domain in included_domains if domain in domain_bands]
    included_raw_scores = [
        domain_raw_scores[domain] for domain in included_domains if domain in domain_raw_scores
    ]

    if included_bands:
        avg_band = sum(included_bands) / len(included_bands)
        global_stage = round(avg_band)
        global_stage = max(
            int(global_config.get("min_stage", 0)),
            min(global_stage, int(global_config.get("max_stage", 10))),
        )
    else:
        global_stage = 0

    if included_raw_scores:
        global_raw_score = sum(included_raw_scores) / len(included_raw_scores)
    else:
        global_raw_score = 0.0

    configured_actfl_levels = aggregation.get("actfl_levels", [])
    proficiency_profile = resolve_actfl_profile(global_raw_score, configured_actfl_levels)

    band_scale = max((int(band.get("band", 0)) for band in bands_config), default=10)
    framework = assessment_data.get("framework", "ACTFL")

    return {
        "framework": framework,
        "band_scale": band_scale,
        "domain_raw_scores": domain_raw_scores,
        "domain_bands": domain_bands,
        "global_raw_score": round(global_raw_score, 4),
        "global_stage": global_stage,
        "proficiency_level_code": proficiency_profile["code"],
        "proficiency_level": proficiency_profile["level"],
        "proficiency_description_en": proficiency_profile["description_en"],
        "proficiency_description_ko": proficiency_profile["description_ko"],
        # Convenience aliases for ACTFL-specific naming.
        "actfl_level": proficiency_profile["level"],
        "actfl_description_en": proficiency_profile["description_en"],
        "actfl_description_ko": proficiency_profile["description_ko"],
    }
