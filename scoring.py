"""
Scoring module for Korean Speaking Diagnostic Assessment.
Implements heuristic scorers for text responses and aggregation logic.
"""

import re
import json
from typing import Dict, List, Any, Optional


def load_assessment_data(filepath: str = "data/assessment_v1.json") -> dict:
    """Load assessment configuration from JSON file."""
    with open(filepath, "r", encoding="utf-8") as f:
        return json.load(f)


# =============================================================================
# MCQ Scoring
# =============================================================================

def score_mcq_single(response: str, scoring_rules: List[dict]) -> float:
    """
    Score a single-choice MCQ based on scoring rules.

    Args:
        response: The selected option ID (e.g., "3")
        scoring_rules: List of scoring rules from the item definition

    Returns:
        Score between 0.0 and 1.0
    """
    for rule in scoring_rules:
        condition = rule.get("condition", {})

        # Check for exact match
        if "selected_option_id" in condition:
            if response == condition["selected_option_id"]:
                return rule["score"]

        # Check for any selection (profile questions)
        if "selected_option_id_any" in condition:
            if condition["selected_option_id_any"] and response:
                return rule["score"]

        # Check for multiple valid options
        if "selected_option_id_in" in condition:
            if response in condition["selected_option_id_in"]:
                return rule["score"]

    return 0.0


# =============================================================================
# Text Heuristic Scorers
# =============================================================================

def count_sentences(text: str) -> int:
    """Count sentences based on Korean sentence endings."""
    endings = re.findall(r'[.?!。]', text)
    return max(len(endings), 1) if text.strip() else 0


def heuristic_self_intro_v1(text: str, params: dict) -> float:
    """
    Score self-introduction text.
    Checks for: sentence count, basic verbs, topic/hobby words.
    """
    if not text.strip():
        return 0.0

    weights = params.get("weights", {})
    lexicons = params.get("lexicons", {})
    min_sentences = params.get("min_sentences", 2)

    score = 0.0

    # Sentence count score
    sentence_count = count_sentences(text)
    if sentence_count >= min_sentences:
        score += weights.get("sentences", 0.3)
    elif sentence_count >= 1:
        score += weights.get("sentences", 0.3) * 0.5

    # Basic verbs score
    basic_verbs = lexicons.get("basic_verbs", [])
    verb_matches = sum(1 for verb in basic_verbs if verb in text)
    if verb_matches >= 2:
        score += weights.get("basic_verbs", 0.3)
    elif verb_matches >= 1:
        score += weights.get("basic_verbs", 0.3) * 0.5

    # Topic/hobby words score
    topic_words = lexicons.get("topic_or_hobby", [])
    topic_matches = sum(1 for word in topic_words if word in text)
    if topic_matches >= 2:
        score += weights.get("topic_or_hobby", 0.2)
    elif topic_matches >= 1:
        score += weights.get("topic_or_hobby", 0.2) * 0.5

    # Bonus for longer, more complete responses
    if len(text) > 50 and sentence_count >= min_sentences:
        score += 0.2

    return min(score, 1.0)


def heuristic_past_routine_v1(text: str, params: dict) -> float:
    """
    Score past routine description text.
    Checks for: sentence count, past tense usage, content words.
    """
    if not text.strip():
        return 0.0

    weights = params.get("weights", {})
    patterns = params.get("patterns", {})
    lexicons = params.get("lexicons", {})
    min_sentences = params.get("min_sentences", 2)

    score = 0.0

    # Sentence count score
    sentence_count = count_sentences(text)
    if sentence_count >= min_sentences:
        score += weights.get("sentences", 0.3)
    elif sentence_count >= 1:
        score += weights.get("sentences", 0.3) * 0.5

    # Past tense usage score
    past_tense_regex = patterns.get("past_tense_regex", "(았|었|했)")
    past_matches = len(re.findall(past_tense_regex, text))
    if past_matches >= 2:
        score += weights.get("past_tense", 0.4)
    elif past_matches >= 1:
        score += weights.get("past_tense", 0.4) * 0.6

    # Content words score
    content_words = lexicons.get("content_words", [])
    min_content = lexicons.get("min_content_word_count", 3)
    content_matches = sum(1 for word in content_words if word in text)
    if content_matches >= min_content:
        score += weights.get("content_words", 0.3)
    elif content_matches >= 1:
        score += weights.get("content_words", 0.3) * (content_matches / min_content)

    return min(score, 1.0)


def heuristic_professor_polite_rewrite_v1(text: str, params: dict) -> float:
    """
    Score polite rewrite for professor context.
    Checks for: professor address, apology, polite endings, request content.
    Penalizes casual speech patterns.
    """
    if not text.strip():
        return 0.0

    weights = params.get("weights", {})
    lexicons = params.get("lexicons", {})
    patterns = params.get("patterns", {})

    score = 0.0

    # Professor address
    professor_terms = lexicons.get("professor_terms", ["교수님"])
    if any(term in text for term in professor_terms):
        score += weights.get("address_professor", 0.2)

    # Apology terms
    apology_terms = lexicons.get("apology_terms", ["죄송", "실례"])
    if any(term in text for term in apology_terms):
        score += weights.get("apology", 0.2)

    # Polite endings
    polite_regex = patterns.get("polite_endings_regex", "(요|습니다)")
    if re.search(polite_regex, text):
        score += weights.get("polite_endings", 0.4)

    # Request content preserved
    request_keywords = lexicons.get("request_keywords", [])
    if sum(1 for kw in request_keywords if kw in text) >= 2:
        score += weights.get("request_content", 0.2)

    # Penalty for casual endings
    casual_regex = patterns.get("casual_endings_regex", "(어\\?|어\\.|했어|냈어|돼\\?)")
    if re.search(casual_regex, text):
        score += weights.get("penalty_casual", -0.3)

    return max(0.0, min(score, 1.0))


# =============================================================================
# Audio Scoring (Placeholder - requires ASR integration)
# =============================================================================

def asr_pron_wordlist_v1(audio_transcript: Optional[str], params: dict) -> float:
    """
    Score pronunciation for word list reading.

    Note: In production, this would use ASR to get transcript and compute
    Phoneme Error Rate (PER) against target words.

    For now, returns a placeholder score based on transcript similarity.
    """
    if not audio_transcript:
        return 0.5  # Default score if no ASR available

    target_words = params.get("target_words", [])
    thresholds = params.get("thresholds", {})

    # Simple word matching heuristic (placeholder for real ASR)
    matches = sum(1 for word in target_words if word in audio_transcript)
    match_ratio = matches / len(target_words) if target_words else 0

    if match_ratio >= 0.85:
        return 1.0
    elif match_ratio >= 0.7:
        return 0.7
    elif match_ratio >= 0.5:
        return 0.4
    else:
        return 0.2


def asr_pron_sentence_v1(audio_transcript: Optional[str], params: dict) -> float:
    """
    Score pronunciation for sentence reading.

    Note: In production, this would compute Word Error Rate (WER).
    Placeholder implementation for now.
    """
    if not audio_transcript:
        return 0.5  # Default score if no ASR available

    target_sentences = params.get("target_sentences", [])

    # Simple character overlap heuristic (placeholder)
    total_chars = sum(len(s.replace(" ", "")) for s in target_sentences)
    transcript_clean = audio_transcript.replace(" ", "")

    overlap = sum(1 for c in transcript_clean if any(c in s for s in target_sentences))
    overlap_ratio = overlap / total_chars if total_chars else 0

    if overlap_ratio >= 0.85:
        return 1.0
    elif overlap_ratio >= 0.7:
        return 0.7
    elif overlap_ratio >= 0.5:
        return 0.4
    else:
        return 0.2


# =============================================================================
# Score Dispatcher
# =============================================================================

SCORING_METHODS = {
    "heuristic_self_intro_v1": heuristic_self_intro_v1,
    "heuristic_past_routine_v1": heuristic_past_routine_v1,
    "heuristic_professor_polite_rewrite_v1": heuristic_professor_polite_rewrite_v1,
    "asr_pron_wordlist_v1": asr_pron_wordlist_v1,
    "asr_pron_sentence_v1": asr_pron_sentence_v1,
}


def score_item(item: dict, response: Any) -> float:
    """
    Score a single assessment item based on its type and scoring config.

    Args:
        item: Item definition from assessment JSON
        response: User's response (string for MCQ/text, transcript for audio)

    Returns:
        Score between 0.0 and 1.0
    """
    scoring = item.get("scoring", {})
    response_type = scoring.get("response_type")

    if response_type == "single_choice":
        rules = scoring.get("rules", [])
        return score_mcq_single(response, rules)

    elif response_type == "text":
        method_name = scoring.get("method")
        params = scoring.get("params", {})
        method = SCORING_METHODS.get(method_name)
        if method:
            return method(response, params)
        return 0.0

    elif response_type == "audio":
        method_name = scoring.get("method")
        params = scoring.get("params", {})
        method = SCORING_METHODS.get(method_name)
        if method:
            return method(response, params)
        return 0.5  # Default for audio without ASR

    return 0.0


# =============================================================================
# Aggregation
# =============================================================================

def compute_domain_scores(
    items: List[dict],
    responses: Dict[str, Any],
    domains: List[str]
) -> Dict[str, float]:
    """
    Compute weighted average scores for each domain.

    Args:
        items: List of item definitions
        responses: Dict mapping item_id -> user response
        domains: List of domain names

    Returns:
        Dict mapping domain -> raw score (0.0 to 1.0)
    """
    domain_scores = {d: {"weighted_sum": 0.0, "weight_total": 0.0} for d in domains}

    for item in items:
        item_id = item["id"]
        response = responses.get(item_id, "")

        # Get item score
        item_score = score_item(item, response)

        # Distribute to domains based on weights
        item_domains = item.get("domains", {})
        for domain, weight in item_domains.items():
            if domain in domain_scores and weight > 0:
                domain_scores[domain]["weighted_sum"] += item_score * weight
                domain_scores[domain]["weight_total"] += weight

    # Compute averages
    result = {}
    for domain in domains:
        total = domain_scores[domain]["weight_total"]
        if total > 0:
            result[domain] = domain_scores[domain]["weighted_sum"] / total
        else:
            result[domain] = 0.0

    return result


def score_to_band(score: float, bands: List[dict]) -> int:
    """Convert a raw score to a band (0-5) based on thresholds."""
    for band_def in bands:
        if band_def["min_score"] <= score <= band_def["max_score"]:
            return band_def["band"]
    return 0


def compute_results(
    assessment_data: dict,
    responses: Dict[str, Any]
) -> dict:
    """
    Compute full assessment results including domain bands and global stage.

    Args:
        assessment_data: Full assessment configuration
        responses: Dict mapping item_id -> user response

    Returns:
        Results dict with domain_raw_scores, domain_bands, and global_stage
    """
    items = assessment_data.get("items", [])
    domains = assessment_data.get("domains", [])
    aggregation = assessment_data.get("aggregation", {})
    bands_config = aggregation.get("banding", {}).get("bands", [])

    # Compute raw domain scores
    domain_raw_scores = compute_domain_scores(items, responses, domains)

    # Convert to bands
    domain_bands = {
        domain: score_to_band(score, bands_config)
        for domain, score in domain_raw_scores.items()
    }

    # Compute global stage (average of domain bands, rounded)
    global_config = aggregation.get("global_stage", {})
    included_domains = global_config.get("included_domains", domains)

    included_bands = [domain_bands[d] for d in included_domains if d in domain_bands]
    if included_bands:
        avg_band = sum(included_bands) / len(included_bands)
        global_stage = round(avg_band)
        global_stage = max(
            global_config.get("min_stage", 0),
            min(global_stage, global_config.get("max_stage", 5))
        )
    else:
        global_stage = 0

    return {
        "domain_raw_scores": domain_raw_scores,
        "domain_bands": domain_bands,
        "global_stage": global_stage
    }


# =============================================================================
# SKLC Level Mapping
# =============================================================================

SKLC_LEVEL_DESCRIPTIONS = {
    0: {
        "level": "Pre-SKLC",
        "description_en": "Very limited Korean ability. Can recognize some words but cannot form sentences.",
        "description_ko": "아주 제한적인 한국어 능력. 일부 단어는 알지만 문장을 만들 수 없음."
    },
    1: {
        "level": "SKLC Level 1",
        "description_en": "Can handle very basic greetings and self-introduction. Understands simple phrases.",
        "description_ko": "아주 기본적인 인사와 자기소개 가능. 간단한 표현 이해."
    },
    2: {
        "level": "SKLC Level 2",
        "description_en": "Can have simple everyday conversations. Uses basic grammar and common vocabulary.",
        "description_ko": "간단한 일상 대화 가능. 기본 문법과 일반적인 어휘 사용."
    },
    3: {
        "level": "SKLC Level 3",
        "description_en": "Can discuss familiar topics with some detail. Understands and uses various sentence patterns.",
        "description_ko": "익숙한 주제에 대해 어느 정도 자세히 말할 수 있음. 다양한 문장 패턴 이해 및 사용."
    },
    4: {
        "level": "SKLC Level 4",
        "description_en": "Can communicate effectively in most situations. Good control of grammar and appropriate speech levels.",
        "description_ko": "대부분의 상황에서 효과적으로 의사소통 가능. 문법과 적절한 말투를 잘 조절함."
    },
    5: {
        "level": "SKLC Level 5",
        "description_en": "Near-native fluency. Can handle complex topics and formal/informal contexts with ease.",
        "description_ko": "거의 원어민 수준의 유창함. 복잡한 주제와 공식/비공식 상황을 쉽게 다룸."
    }
}


def get_sklc_description(stage: int, lang: str = "en") -> dict:
    """Get SKLC level description for a given stage."""
    desc = SKLC_LEVEL_DESCRIPTIONS.get(stage, SKLC_LEVEL_DESCRIPTIONS[0])
    return {
        "level": desc["level"],
        "description": desc[f"description_{lang}"] if f"description_{lang}" in desc else desc["description_en"]
    }
