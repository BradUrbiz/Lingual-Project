from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
import logging
import re
import unicodedata

logger = logging.getLogger(__name__)

DEFAULT_PROMPT_VERSION = 'assignment_bootstrap.v1'
SESSION_STATUSES = {'active', 'completed', 'abandoned'}
SUPPORTED_EVENT_TYPES = {
    'session.started',
    'session.ended',
    'student.turn',
    'assistant.turn',
    'feedback.recast',
    'feedback.elicitation',
    'feedback.review_item',
    'metric.target_expression_hit',
    'metric.target_vocabulary_hit',
    'metric.self_correction',
    'metric.communicative_function_signal',
    'metric.discourse_move_signal',
    'metric.context_tag_signal',
    'metric.error_detected',
    'metric.repeated_error',
    'metric.rubric_dimension_signal',
    'task.completed',
}

GENERIC_COMMUNICATIVE_FUNCTION_PATTERNS = {
    'agree_disagree': (r"\bi agree\b", r"\bi disagree\b", r"\bi don't agree\b", r'\bme too\b'),
    'ask_follow_up': (r'\?', r'\bwhat about\b', r'\band you\b'),
    'ask_for_clarification': (
        r'\bcould you repeat\b',
        r'\bcan you repeat\b',
        r'\bwhat do you mean\b',
        r'\bpardon\b',
        r'\bsorry\?\b',
    ),
    'compare': (r'\bmore\b', r'\bless\b', r'\bthan\b', r'\bboth\b', r'\bdifferent\b', r'\bsimilar\b'),
    'describe_people_things': (r'\bis\b', r'\bare\b', r'\bhas\b', r'\bhave\b', r'\blooks\b'),
    'express_opinion': (r'\bi think\b', r'\bin my opinion\b', r'\bi believe\b', r'\bfor me\b'),
    'explain_cause_effect': (r'\bbecause\b', r"\bthat's why\b", r'\bso\b', r'\btherefore\b'),
    'give_examples': (r'\bfor example\b', r'\bfor instance\b', r'\bsuch as\b'),
    'invite': (r"\blet's\b", r'\bwould you like\b', r'\bdo you want to\b'),
    'negotiate_plans': (r'\bshould we\b', r'\bwe could\b', r'\bhow about\b', r"\blet's\b"),
    'repair_misunderstanding': (r'\bi mean\b', r'\bno, sorry\b', r'\bwhat I meant\b'),
    'summarize': (r'\bin summary\b', r'\boverall\b', r'\bbasically\b', r'\bto sum up\b'),
    'support_with_evidence': (r'\bbecause\b', r'\bfor example\b', r'\baccording to\b'),
}

FRENCH_COMMUNICATIVE_FUNCTION_PATTERNS = {
    'agree_disagree': (r"\bje suis d'accord\b", r"\bje ne suis pas d'accord\b", r'\bmoi aussi\b'),
    'ask_follow_up': (r'\?', r'\bet toi\b', r'\bet vous\b', r"\bet qu'?en penses-tu\b", r"\bet qu'?en pensez-vous\b"),
    'ask_for_clarification': (
        r'\btu peux repeter\b',
        r'\bvous pouvez repeter\b',
        r'\bje n\'ai pas compris\b',
        r'\bpardon\b',
        r'\bcomment\b',
    ),
    'compare': (r'\bplus\b', r'\bmoins\b', r'\bque\b', r'\bcomme\b', r'\bsimilaire\b', r'\bdifferent\b'),
    'describe_people_things': (r'\bc\'est\b', r'\bil y a\b', r'\bil est\b', r'\belle est\b', r'\bon dirait\b'),
    'express_opinion': (r'\bje pense\b', r"\bje crois\b", r"\ba mon avis\b", r'\bselon moi\b'),
    'explain_cause_effect': (r'\bparce que\b', r'\bdonc\b', r'\balors\b', r"\bc'?est pourquoi\b"),
    'give_examples': (r'\bpar exemple\b', r"\bcomme\b", r"\bc'?est-a-dire\b"),
    'invite': (r'\bon va\b', r"\bca te dit\b", r"\btu veux\b", r"\bvous voulez\b"),
    'negotiate_plans': (r'\bon pourrait\b', r'\bon devrait\b', r'\bet si on\b', r"\bca te dit\b"),
    'repair_misunderstanding': (r'\bje veux dire\b', r'\benfin\b', r'\bpardon\b', r'\bou plutot\b'),
    'summarize': (r'\ben resume\b', r'\bbref\b', r'\ben gros\b', r'\bpour resumer\b'),
    'support_with_evidence': (r'\bparce que\b', r'\bpar exemple\b', r'\bselon\b', r'\bd\'apres\b'),
}

GENERIC_DISCOURSE_MOVE_PATTERNS = {
    'compare_contrast': (r'\bmore\b', r'\bless\b', r'\bthan\b', r'\bon the other hand\b'),
    'define_terms': (r'\bmeans\b', r'\brefers to\b', r'\bis when\b'),
    'gist_then_details': (r'\bmainly\b', r'\bfirst\b', r'\balso\b'),
    'hedging': (r'\bmaybe\b', r'\bprobably\b', r'\bi think\b', r'\bkind of\b', r'\bsort of\b'),
    'introduction_body_conclusion': (r'\bfirst\b', r'\bsecond\b', r'\bfinally\b', r'\bin conclusion\b'),
    'reason_then_result': (r'\bbecause\b', r'\bso\b', r"\bthat's why\b", r'\btherefore\b'),
    'signposting': (r'\bfirst\b', r'\bnext\b', r'\bfinally\b', r'\bon the one hand\b'),
    'turn_taking': (r'\bwhat about you\b', r'\band you\b', r'\byour turn\b'),
    'self_correction': (r'\bi mean\b', r'\bsorry\b', r'\bor rather\b', r'\bno, wait\b'),
}

FRENCH_DISCOURSE_MOVE_PATTERNS = {
    'compare_contrast': (r'\bplus\b', r'\bmoins\b', r'\bque\b', r"\bd'?un cote\b", r"\bde l'?autre cote\b"),
    'define_terms': (r'\bca veut dire\b', r'\bc\'est quand\b', r'\bon appelle\b'),
    'gist_then_details': (r'\bsurtout\b', r'\bd\'abord\b', r'\bensuite\b', r'\baussi\b'),
    'hedging': (r'\bpeut-etre\b', r'\bje pense\b', r'\bun peu\b', r'\bplutot\b'),
    'introduction_body_conclusion': (r'\bd\'abord\b', r'\bensuite\b', r'\benfin\b', r'\ben conclusion\b'),
    'reason_then_result': (r'\bparce que\b', r'\bdonc\b', r'\balors\b', r"\bc'?est pourquoi\b"),
    'signposting': (r'\bd\'abord\b', r'\bensuite\b', r'\benfin\b', r'\bd\'un cote\b'),
    'turn_taking': (r'\bet toi\b', r'\bet vous\b', r'\ba ton tour\b', r'\ba votre tour\b'),
    'self_correction': (r'\bje veux dire\b', r'\bpardon\b', r'\benfin\b', r'\bou plutot\b'),
}

GENERIC_ASSISTANT_FEEDBACK_PATTERNS = {
    'feedback.elicitation': (
        r'\btry again\b',
        r'\bcan you say that again\b',
        r'\bhow do we say\b',
        r'\bwhat do you mean\b',
        r'\bcould you say that differently\b',
    ),
    'feedback.review_item': (
        r'\blet\'s review\b',
        r'\bremember\b',
        r'\btoday we practiced\b',
        r'\bquick review\b',
    ),
    'feedback.recast': (
        r'\bdid you mean\b',
        r'\byou mean\b',
        r'\byou went\b',
        r'\bshe has\b',
        r'\bthey were\b',
    ),
}

FRENCH_ASSISTANT_FEEDBACK_PATTERNS = {
    'feedback.elicitation': (
        r'\bessaie encore\b',
        r'\btu peux le redire\b',
        r'\bcomment on dit\b',
        r'\btu peux reformuler\b',
    ),
    'feedback.review_item': (
        r'\bon revise\b',
        r'\bsouviens-toi\b',
        r"\baujourd'?hui on a pratique\b",
        r'\bpetit bilan\b',
    ),
    'feedback.recast': (
        r'\btu veux dire\b',
        r'\bon dit plutot\b',
        r'\btu es alle\b',
        r'\belle a\b',
        r'\bils sont\b',
    ),
}

SPANISH_ASSISTANT_FEEDBACK_PATTERNS = {
    'feedback.recast': (
        r'\bpequeno ajuste\b',
        r'\bpequenos ajustes\b',
        r'\bse dice\b',
        r'\bse escribe\b',
        r'\bdecimos\b',
        r'\bmejor usar\b',
        r'\bmejor di\b',
        r'\bquieres decir\b',
        r'\bla forma correcta\b',
    ),
    'feedback.elicitation': (
        r'\bpuedes repetir\b',
        r'\bpuedes decirlo otra vez\b',
        r'\bcomo se dice\b',
        r'\bintentalo\b',
        r'\bintenta otra vez\b',
    ),
    'feedback.review_item': (
        r'\brecuerda\b',
        r'\brepasemos\b',
        r'\bhoy practicamos\b',
        r'\brepaso rapido\b',
    ),
}

GENERIC_CONTEXT_TAG_PATTERNS = {
    'beliefs_values': (
        r'\bvalue\b',
        r'\bvalues\b',
        r'\bbelie(?:f|ve)\b',
        r'\bimportant to me\b',
        r'\btradition\b',
    ),
    'education': (
        r'\bschool\b',
        r'\bclass\b',
        r'\bteacher\b',
        r'\bstud(?:y|ies|ying)\b',
        r'\bhomework\b',
        r'\bexam\b',
    ),
    'family_structures': (
        r'\bfamily\b',
        r'\bmother\b',
        r'\bfather\b',
        r'\bparents?\b',
        r'\bsister\b',
        r'\bbrother\b',
        r'\baunt\b',
        r'\buncle\b',
        r'\bcousin\b',
        r'\bgrand(?:mother|father|ma|pa)\b',
    ),
    'friendship_love': (
        r'\bfriend(?:s)?\b',
        r'\bbest friend\b',
        r'\blove\b',
        r'\brelationship\b',
        r'\bboyfriend\b',
        r'\bgirlfriend\b',
    ),
    'holidays_celebrations': (
        r'\bholiday\b',
        r'\bcelebration\b',
        r'\bbirthday\b',
        r'\bparty\b',
        r'\bfestival\b',
        r'\bchristmas\b',
    ),
    'housing_shelter': (
        r'\bhouse\b',
        r'\bhome\b',
        r'\bapartment\b',
        r'\broom\b',
        r'\bliving room\b',
    ),
    'leisure_sports': (
        r'\bsport(?:s)?\b',
        r'\bgame\b',
        r'\bplay\b',
        r'\bhobby\b',
        r'\bsoccer\b',
        r'\bfootball\b',
        r'\bbasketball\b',
    ),
    'travel': (
        r'\btravel\b',
        r'\btrip\b',
        r'\bvisit\b',
        r'\bvacation\b',
        r'\bplane\b',
        r'\btrain\b',
        r'\bairport\b',
    ),
    'weekend': (
        r'\bweekend\b',
        r'\blast weekend\b',
        r'\bsaturday\b',
        r'\bsunday\b',
    ),
    'narrative': (
        r'\bstory\b',
        r'\bhappened\b',
        r'\bthen\b',
        r'\bafter that\b',
        r'\bbefore that\b',
    ),
}

FRENCH_CONTEXT_TAG_PATTERNS = {
    'beliefs_values': (
        r'\bvaleur(?:s)?\b',
        r'\bcroi(?:s|re|t)\b',
        r'\bcroyance(?:s)?\b',
        r'\bimportant pour moi\b',
        r'\btradition(?:s)?\b',
    ),
    'education': (
        r'\becole\b',
        r'\bclasse\b',
        r'\bprof(?:esseur)?\b',
        r'\betud(?:e|ier|ies)\b',
        r'\bdevoir(?:s)?\b',
        r'\bexamen\b',
    ),
    'family_structures': (
        r'\bfamille\b',
        r'\bmere\b',
        r'\bpere\b',
        r'\bparent(?:s)?\b',
        r'\bsoeur\b',
        r'\bfrere\b',
        r'\btante\b',
        r'\boncle\b',
        r'\bcousin(?:e)?s?\b',
        r'\bgrand(?:e )?mere\b',
        r'\bgrand(?:-|\s)?pere\b',
    ),
    'friendship_love': (
        r'\bami(?:e|es|s)?\b',
        r'\bcopain(?:e|es|s)?\b',
        r'\bamour\b',
        r'\brelation\b',
    ),
    'holidays_celebrations': (
        r'\bfete\b',
        r'\banniversaire\b',
        r'\bcelebration\b',
        r'\bvacances\b',
        r'\bnoel\b',
        r'\bfestival\b',
    ),
    'housing_shelter': (
        r'\bmaison\b',
        r'\bappartement\b',
        r'\bchambre\b',
        r'\bchez moi\b',
        r'\blogement\b',
    ),
    'leisure_sports': (
        r'\bsport(?:s)?\b',
        r'\bloisir(?:s)?\b',
        r'\bjou(?:e|er)\b',
        r'\bmatch\b',
        r'\bfoot\b',
        r'\bbasket\b',
    ),
    'travel': (
        r'\bvoyage\b',
        r'\bpartir\b',
        r'\bvisiter\b',
        r'\bvacances\b',
        r'\bavion\b',
        r'\btrain\b',
        r'\baeroport\b',
    ),
    'weekend': (
        r'\bweek[\s-]?end\b',
        r'\ble week[\s-]?end dernier\b',
        r'\bsamedi\b',
        r'\bdimanche\b',
    ),
    'narrative': (
        r'\bhistoire\b',
        r'\brecit\b',
        r'\braconte(?:r|)\b',
        r'\bensuite\b',
        r'\bapres\b',
        r'\bpuis\b',
    ),
}

ERROR_RULES = (
    {
        'id': 'en.simple_past_mismatch',
        'label': 'Past-time marker with present-tense phrasing',
        'category': 'grammar',
        'locales': ('en',),
        'patterns': (
            r'\byesterday i go\b',
            r'\blast weekend i go\b',
            r'\byesterday she go\b',
        ),
        'focusTags': ('past', 'past tense', 'narrative'),
        'rubricDimensionIds': ('lexical_grammatical_control', 'clarity'),
    },
    {
        'id': 'en.subject_verb_agreement',
        'label': 'Subject-verb agreement',
        'category': 'grammar',
        'locales': ('en',),
        'patterns': (r'\bshe have\b', r'\bhe have\b', r'\bthey was\b', r'\bi goed\b'),
        'focusTags': ('agreement', 'subject-verb', 'grammar'),
        'rubricDimensionIds': ('lexical_grammatical_control', 'clarity'),
    },
    {
        'id': 'fr.past_auxiliary_infinitive',
        'label': 'Passé composé auxiliary followed by infinitive',
        'category': 'grammar',
        'locales': ('fr',),
        'patterns': (
            r"\bj'?ai [a-z]+(?:er|ir|re)\b",
            r'\btu as [a-z]+(?:er|ir|re)\b',
            r'\bil a [a-z]+(?:er|ir|re)\b',
            r'\belle a [a-z]+(?:er|ir|re)\b',
            r'\bon a [a-z]+(?:er|ir|re)\b',
            r'\bnous avons [a-z]+(?:er|ir|re)\b',
            r'\bvous avez [a-z]+(?:er|ir|re)\b',
            r'\bils ont [a-z]+(?:er|ir|re)\b',
            r'\belles ont [a-z]+(?:er|ir|re)\b',
        ),
        'focusTags': ('past', 'past tense', 'passe compose', 'passé composé', 'imparfait'),
        'rubricDimensionIds': ('lexical_grammatical_control',),
    },
    {
        'id': 'fr.past_time_present_form',
        'label': 'Past-time marker with present-tense verb',
        'category': 'grammar',
        'locales': ('fr',),
        'patterns': (
            r"\bhier [^.!?]{0,32}\bje vais\b",
            r"\bhier [^.!?]{0,32}\bon va\b",
            r"\bhier [^.!?]{0,32}\bil va\b",
            r"\bhier [^.!?]{0,32}\belle va\b",
            r"\ble week-end dernier [^.!?]{0,32}\bje vais\b",
        ),
        'focusTags': ('past', 'past tense', 'passe compose', 'passé composé', 'imparfait', 'narrative'),
        'rubricDimensionIds': ('lexical_grammatical_control', 'interaction_management'),
    },
    {
        'id': 'fr.subject_verb_agreement',
        'label': 'French subject-verb agreement',
        'category': 'grammar',
        'locales': ('fr',),
        'patterns': (
            r'\bils est\b',
            r'\belles est\b',
            r'\bnous va\b',
            r'\bvous va\b',
            r'\bje sont\b',
            r'\bon sont\b',
        ),
        'focusTags': ('agreement', 'subject-verb', 'grammar', 'conjugation'),
        'rubricDimensionIds': ('lexical_grammatical_control', 'clarity'),
    },
    {
        'id': 'fr.formal_register_mismatch',
        'label': 'Informal pronouns used in formal register task',
        'category': 'register',
        'locales': ('fr',),
        'patterns': (r'\btu\b', r'\btoi\b', r'\bte\b', r'\bton\b', r'\bta\b', r'\btes\b'),
        'focusTags': ('register', 'formal', 'polite', 'politeness'),
        'rubricDimensionIds': ('sociopragmatics',),
        'requiresFormalRegister': True,
    },
)

INFERRED_ERROR_METADATA = {
    'target_expression.missing': {
        'label': 'Target expression framing',
        'category': 'target_expression',
        'rubricDimensionIds': ['lexical_grammatical_control', 'sociopragmatics'],
    },
    'question_formation.follow_up': {
        'label': 'Question formation / follow-up framing',
        'category': 'interaction',
        'rubricDimensionIds': ['interaction_management', 'lexical_grammatical_control'],
    },
    'register.politeness': {
        'label': 'Register / politeness control',
        'category': 'register',
        'rubricDimensionIds': ['sociopragmatics'],
    },
    'output.elaboration': {
        'label': 'Extended output / elaboration',
        'category': 'interaction',
        'rubricDimensionIds': ['interaction_management'],
    },
    'comprehensibility.precision': {
        'label': 'Clarity / precision',
        'category': 'comprehensibility',
        'rubricDimensionIds': ['comprehensibility', 'clarity'],
    },
    'grammar.focus_target': {
        'label': 'Teacher focus grammar correction',
        'category': 'grammar',
        'rubricDimensionIds': ['lexical_grammatical_control'],
    },
}

RUBRIC_DIMENSION_RULES = {
    'interaction_management': {
        'positiveFunctions': {'ask_follow_up', 'repair_misunderstanding', 'negotiate_plans', 'invite'},
        'positiveMoves': {'turn_taking', 'self_correction'},
        'positiveErrors': set(),
        'penaltyErrors': {'fr.past_time_present_form'},
    },
    'comprehensibility': {
        'positiveFunctions': {'ask_for_clarification', 'summarize'},
        'positiveMoves': {'self_correction', 'signposting'},
        'positiveErrors': set(),
        'penaltyErrors': {'fr.subject_verb_agreement', 'en.subject_verb_agreement'},
    },
    'clarity': {
        'positiveFunctions': {'summarize', 'support_with_evidence'},
        'positiveMoves': {'signposting', 'gist_then_details', 'reason_then_result'},
        'positiveErrors': set(),
        'penaltyErrors': {'fr.subject_verb_agreement', 'en.subject_verb_agreement'},
    },
    'lexical_grammatical_control': {
        'positiveFunctions': {'support_with_evidence', 'give_examples'},
        'positiveMoves': {'self_correction'},
        'positiveErrors': set(),
        'penaltyErrors': {
            'fr.past_auxiliary_infinitive',
            'fr.past_time_present_form',
            'fr.subject_verb_agreement',
            'en.simple_past_mismatch',
            'en.subject_verb_agreement',
        },
    },
    'sociopragmatics': {
        'positiveFunctions': {'invite', 'negotiate_plans', 'agree_disagree'},
        'positiveMoves': {'turn_taking'},
        'positiveErrors': set(),
        'penaltyErrors': {'fr.formal_register_mismatch'},
    },
    'gist': {
        'positiveFunctions': {'summarize'},
        'positiveMoves': {'gist_then_details'},
        'positiveErrors': set(),
        'penaltyErrors': set(),
    },
    'detail': {
        'positiveFunctions': {'give_examples', 'support_with_evidence'},
        'positiveMoves': {'gist_then_details'},
        'positiveErrors': set(),
        'penaltyErrors': set(),
    },
    'inference': {
        'positiveFunctions': {'explain_cause_effect', 'express_opinion'},
        'positiveMoves': {'reason_then_result', 'hedging'},
        'positiveErrors': set(),
        'penaltyErrors': set(),
    },
    'perspective': {
        'positiveFunctions': {'express_opinion', 'agree_disagree'},
        'positiveMoves': {'hedging', 'compare_contrast'},
        'positiveErrors': set(),
        'penaltyErrors': set(),
    },
}


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _normalize_string(value: Any) -> str:
    if not isinstance(value, str):
        return ''
    return value.strip()


def _normalize_string_list(values: Any) -> list[str]:
    if not isinstance(values, list):
        return []
    normalized = []
    seen = set()
    for value in values:
        cleaned = _normalize_string(value)
        if not cleaned or cleaned in seen:
            continue
        normalized.append(cleaned)
        seen.add(cleaned)
    return normalized


def _timestamp_to_iso(value: Any) -> str | None:
    if value is None:
        return None
    if hasattr(value, 'isoformat'):
        return value.isoformat()
    if hasattr(value, 'seconds'):
        return datetime.fromtimestamp(value.seconds, UTC).isoformat()
    return str(value)


def _coerce_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str) and value.strip().lstrip('-').isdigit():
        return int(value.strip())
    return None


def _normalize_count_map(value: Any) -> dict[str, int]:
    if not isinstance(value, dict):
        return {}
    normalized: dict[str, int] = {}
    for key, item_value in value.items():
        normalized_key = _normalize_string(key)
        normalized_value = _coerce_int(item_value)
        if not normalized_key or normalized_value is None or normalized_value <= 0:
            continue
        normalized[normalized_key] = normalized_value
    return normalized


def _normalize_float_map(value: Any) -> dict[str, float]:
    if not isinstance(value, dict):
        return {}
    normalized: dict[str, float] = {}
    for key, item_value in value.items():
        normalized_key = _normalize_string(key)
        if not normalized_key or not isinstance(item_value, (int, float)):
            continue
        normalized[normalized_key] = round(float(item_value), 2)
    return normalized


def _normalize_search_text(content: str) -> str:
    ascii_text = unicodedata.normalize('NFKD', content).encode('ascii', 'ignore').decode('ascii')
    lowered = ascii_text.lower()
    return re.sub(r'\s+', ' ', lowered).strip()


def _normalize_tag(value: Any) -> str:
    return _normalize_search_text(_normalize_string(value))


def _detect_locale_key(locale: Any) -> str:
    normalized = _normalize_string(locale).lower()
    if normalized.startswith('fr'):
        return 'fr'
    if normalized.startswith('es'):
        return 'es'
    return 'en'


def _session_learning_locale(session_record: dict[str, Any]) -> str:
    if not isinstance(session_record, dict):
        return 'en'
    curriculum_snapshot = session_record.get('curriculum_snapshot')
    if isinstance(curriculum_snapshot, dict):
        package = curriculum_snapshot.get('package')
        if isinstance(package, dict):
            locale = _normalize_string(package.get('learningLocale'))
            if locale:
                return locale
    return 'en'


def _count_words(content: str) -> int:
    if not content.strip():
        return 0
    return len(re.findall(r"\b[\w']+\b", content))


def _estimate_speaking_time_seconds(word_count: int) -> int:
    if word_count <= 0:
        return 0
    return max(1, round(word_count / 2.3))


def _count_target_expression_hits(content: str, expressions: list[str]) -> dict[str, int]:
    content_lower = _normalize_search_text(content)
    hits = {}
    for expression in expressions:
        normalized_expression = _normalize_string(expression)
        if not normalized_expression:
            continue
        count = content_lower.count(_normalize_search_text(normalized_expression))
        if count > 0:
            hits[normalized_expression] = count
    return hits


def _find_pattern_matches(search_text: str, patterns: tuple[str, ...]) -> list[str]:
    matches: list[str] = []
    for pattern in patterns:
        for match in re.finditer(pattern, search_text):
            matched = _normalize_string(match.group(0))
            if matched:
                matches.append(matched)
    return matches


def _contains_any_pattern(search_text: str, patterns: tuple[str, ...]) -> bool:
    return bool(_find_pattern_matches(search_text, patterns))


def _catalog_patterns(
    *,
    locale: str,
    generic_catalog: dict[str, tuple[str, ...]],
    french_catalog: dict[str, tuple[str, ...]],
    signal_id: str,
    spanish_catalog: dict[str, tuple[str, ...]] | None = None,
) -> tuple[str, ...]:
    patterns = list(generic_catalog.get(signal_id, ()))
    locale_key = _detect_locale_key(locale)
    if locale_key == 'fr':
        patterns.extend(french_catalog.get(signal_id, ()))
    elif locale_key == 'es' and spanish_catalog is not None:
        patterns.extend(spanish_catalog.get(signal_id, ()))
    return tuple(patterns)


def _detect_signal_matches(
    content: str,
    allowed_ids: list[str],
    *,
    locale: str,
    generic_catalog: dict[str, tuple[str, ...]],
    french_catalog: dict[str, tuple[str, ...]],
    payload_key: str,
) -> list[dict[str, Any]]:
    search_text = _normalize_search_text(content)
    signals: list[dict[str, Any]] = []
    for allowed_id in allowed_ids:
        patterns = _catalog_patterns(
            locale=locale,
            generic_catalog=generic_catalog,
            french_catalog=french_catalog,
            signal_id=allowed_id,
        )
        matches = _find_pattern_matches(search_text, patterns)
        if matches:
            signals.append({
                payload_key: allowed_id,
                'count': len(matches),
                'matchedText': matches[0],
                'matchedTexts': matches[:3],
            })
    return signals


def _detect_communicative_function_signals(content: str, allowed_functions: list[str], *, locale: str) -> list[dict[str, Any]]:
    return _detect_signal_matches(
        content,
        allowed_functions,
        locale=locale,
        generic_catalog=GENERIC_COMMUNICATIVE_FUNCTION_PATTERNS,
        french_catalog=FRENCH_COMMUNICATIVE_FUNCTION_PATTERNS,
        payload_key='functionId',
    )


def _detect_discourse_move_signals(content: str, allowed_moves: list[str], *, locale: str) -> list[dict[str, Any]]:
    return _detect_signal_matches(
        content,
        allowed_moves,
        locale=locale,
        generic_catalog=GENERIC_DISCOURSE_MOVE_PATTERNS,
        french_catalog=FRENCH_DISCOURSE_MOVE_PATTERNS,
        payload_key='moveId',
    )


def _detect_feedback_event_types(content: str, *, locale: str) -> list[dict[str, Any]]:
    detected = []
    search_text = _normalize_search_text(content)
    for event_type in GENERIC_ASSISTANT_FEEDBACK_PATTERNS:
        patterns = _catalog_patterns(
            locale=locale,
            generic_catalog=GENERIC_ASSISTANT_FEEDBACK_PATTERNS,
            french_catalog=FRENCH_ASSISTANT_FEEDBACK_PATTERNS,
            signal_id=event_type,
            spanish_catalog=SPANISH_ASSISTANT_FEEDBACK_PATTERNS,
        )
        matches = _find_pattern_matches(search_text, patterns)
        if matches:
            detected.append({
                'eventType': event_type,
                'count': len(matches),
                'matchedText': matches[0],
            })
    return detected


def _mapping_focus_grammar(session_record: dict[str, Any]) -> list[str]:
    mapping_snapshot = session_record.get('mapping_snapshot', {}) if isinstance(session_record, dict) else {}
    focus_grammar = mapping_snapshot.get('focusGrammar')
    return _normalize_string_list(focus_grammar if isinstance(focus_grammar, list) else [])


def _rule_matches_focus(rule: dict[str, Any], focus_grammar: list[str]) -> bool:
    focus_tags = [_normalize_tag(tag) for tag in rule.get('focusTags', ())]
    if not focus_tags:
        return True
    if not focus_grammar:
        return True
    normalized_focus = [_normalize_tag(item) for item in focus_grammar]
    for focus_value in normalized_focus:
        if any(tag in focus_value or focus_value in tag for tag in focus_tags):
            return True
    return False


def _detect_student_errors(
    content: str,
    *,
    locale: str,
    focus_grammar: list[str],
    register: str = '',
) -> list[dict[str, Any]]:
    locale_key = _detect_locale_key(locale)
    search_text = _normalize_search_text(content)
    detected = []
    for rule in ERROR_RULES:
        if locale_key not in rule.get('locales', ()):
            continue
        if rule.get('requiresFormalRegister') and _normalize_tag(register) != 'formal':
            continue
        if not _rule_matches_focus(rule, focus_grammar):
            continue
        matches = _find_pattern_matches(search_text, tuple(rule.get('patterns', ())))
        if not matches:
            continue
        detected.append({
            'errorId': rule['id'],
            'label': rule['label'],
            'category': rule.get('category', 'grammar'),
            'count': len(matches),
            'rubricDimensionIds': list(rule.get('rubricDimensionIds', ())),
            'matchedText': matches[0],
            'matchedTexts': matches[:3],
        })
    return detected


def _error_rule_metadata(error_id: str) -> dict[str, Any]:
    for rule in ERROR_RULES:
        if rule.get('id') == error_id:
            return {
                'id': rule['id'],
                'label': rule['label'],
                'category': rule.get('category', 'grammar'),
                'rubricDimensionIds': list(rule.get('rubricDimensionIds', ())),
            }
    inferred = INFERRED_ERROR_METADATA.get(error_id)
    if inferred:
        return {
            'id': error_id,
            'label': inferred['label'],
            'category': inferred['category'],
            'rubricDimensionIds': list(inferred.get('rubricDimensionIds', [])),
        }
    return {
        'id': error_id,
        'label': error_id,
        'category': 'grammar',
        'rubricDimensionIds': [],
    }


def default_analysis_state() -> dict[str, Any]:
    return {
        'recent_turns': [],
        'last_student_turn': {
            'content': '',
            'turn_index': None,
        },
        # S2 cross-session recycling snapshot (serialized at session create when
        # PEDAGOGY_ENGINE_RECYCLING is on); None when there is nothing to recycle.
        'coverage': None,
        # S3.1 model-verified post-task coach review (generated lazily on read
        # when PEDAGOGY_ENGINE_COACH_REVIEW is on); None until generated.
        'coach_review': None,
        # S3.2 live between-turn coach chips, appended per gated-in turn when
        # PEDAGOGY_ENGINE_COACH_CHIPS is on; empty list until the first chip.
        'coach_chips': [],
        # S3.3 promote-back: deterministic recurrence counter + guardrail bookkeeping
        # (per-signature counts, last_promoted_turn, promoted_count); {} until first candidate.
        'promote_back_state': {},
        # S3.3 promote-back: durable log of what was promoted into the main channel
        # (for analytics/L7; NEVER re-injected on hydration). Empty until first promotion.
        'promotions': [],
        # S3.4 Ask mode: learner help-usage log (SEPARATE from student production —
        # never mirrored into learning_events). Empty until first Ask.
        'ask_log': [],
    }


def normalize_analysis_state(value: Any) -> dict[str, Any]:
    normalized = default_analysis_state()
    if not isinstance(value, dict):
        return normalized

    last_student_turn = value.get('last_student_turn', value.get('lastStudentTurn'))
    if isinstance(last_student_turn, dict):
        normalized['last_student_turn'] = {
            'content': _normalize_string(last_student_turn.get('content')),
            'turn_index': _coerce_int(last_student_turn.get('turn_index', last_student_turn.get('turnIndex'))),
        }

    recent_turns = value.get('recent_turns', value.get('recentTurns'))
    if isinstance(recent_turns, list):
        collected = []
        for turn in recent_turns[-6:]:
            if not isinstance(turn, dict):
                continue
            role = _normalize_string(turn.get('role'))
            content = _normalize_string(turn.get('content'))
            if role not in {'student', 'assistant'} or not content:
                continue
            collected.append({
                'role': role,
                'content': content,
                'turn_index': _coerce_int(turn.get('turn_index', turn.get('turnIndex'))),
            })
        normalized['recent_turns'] = collected

    coverage = value.get('coverage')
    if isinstance(coverage, dict):
        normalized['coverage'] = coverage

    coach_review = value.get('coach_review', value.get('coachReview'))
    if isinstance(coach_review, dict):
        normalized['coach_review'] = coach_review

    coach_chips = value.get('coach_chips', value.get('coachChips'))
    if isinstance(coach_chips, list):
        normalized['coach_chips'] = coach_chips

    promote_back_state = value.get('promote_back_state', value.get('promoteBackState'))
    if isinstance(promote_back_state, dict):
        normalized['promote_back_state'] = promote_back_state

    promotions = value.get('promotions')
    if isinstance(promotions, list):
        normalized['promotions'] = promotions

    ask_log = value.get('ask_log', value.get('askLog'))
    if isinstance(ask_log, list):
        normalized['ask_log'] = ask_log

    return normalized


def _record_turn_analysis_state(
    analysis_state: dict[str, Any],
    *,
    role: str,
    content: str,
    turn_index: int | None,
) -> dict[str, Any]:
    updated = normalize_analysis_state(analysis_state)
    if not content:
        return updated

    updated['recent_turns'] = [
        *updated['recent_turns'],
        {
            'role': role,
            'content': content,
            'turn_index': turn_index,
        },
    ][-6:]
    if role == 'student':
        updated['last_student_turn'] = {
            'content': content,
            'turn_index': turn_index,
        }
    return updated


def _is_question_like(content: str) -> bool:
    normalized = _normalize_search_text(content)
    if not normalized:
        return False
    if '?' in content:
        return True
    return any(
        normalized.startswith(prefix)
        for prefix in (
            'what ',
            'why ',
            'how ',
            'when ',
            'where ',
            'who ',
            'which ',
            'do ',
            'does ',
            'did ',
            'can ',
            'could ',
            'would ',
            'should ',
            'is ',
            'are ',
            'est ce que ',
            'qu est ce que ',
            'pourquoi ',
            'comment ',
            'quand ',
            'ou ',
            'qui ',
            'quel ',
            'quelle ',
            'tu peux ',
            'vous pouvez ',
        )
    )


def _contains_any_phrase(content: str, phrases: tuple[str, ...]) -> bool:
    normalized = _normalize_search_text(content)
    return any(phrase in normalized for phrase in phrases)


def _contains_politeness_markers(content: str) -> bool:
    return _contains_any_phrase(content, (
        'please',
        'could i',
        'could you',
        'would you',
        'thank you',
        'merci',
        's il vous plait',
        's il te plait',
        'je voudrais',
        'est ce que je peux',
    ))


def _detect_context_tag_signals(content: str, context_tags: list[str], *, locale: str) -> list[dict[str, Any]]:
    search_text = _normalize_search_text(content)
    compact_search_text = re.sub(r'[^a-z0-9]+', '', search_text)
    signals_by_tag: dict[str, dict[str, Any]] = {}
    for context_tag in context_tags:
        normalized_tag = _normalize_tag(context_tag)
        if not normalized_tag:
            continue
        tag_tokens = [token for token in re.split(r'[^a-z0-9]+', normalized_tag) if len(token) >= 3]
        if not tag_tokens:
            continue
        matched = [
            token
            for token in tag_tokens
            if token in search_text or token in compact_search_text
        ]
        if matched:
            signals_by_tag[context_tag] = {
                'contextTag': context_tag,
                'count': len(matched),
                'matchedText': matched[0],
                'matchedTexts': matched[:3],
            }

    for signal in _detect_signal_matches(
        content,
        context_tags,
        locale=locale,
        generic_catalog=GENERIC_CONTEXT_TAG_PATTERNS,
        french_catalog=FRENCH_CONTEXT_TAG_PATTERNS,
        payload_key='contextTag',
    ):
        context_tag = _normalize_string(signal.get('contextTag'))
        if not context_tag:
            continue
        existing = signals_by_tag.get(context_tag)
        if not existing:
            signals_by_tag[context_tag] = signal
            continue
        existing_matches = existing.get('matchedTexts') if isinstance(existing.get('matchedTexts'), list) else []
        new_matches = signal.get('matchedTexts') if isinstance(signal.get('matchedTexts'), list) else []
        merged_matches = []
        for value in [*existing_matches, *new_matches]:
            normalized_value = _normalize_string(value)
            if normalized_value and normalized_value not in merged_matches:
                merged_matches.append(normalized_value)
        existing['count'] = int(existing.get('count') or 0) + int(signal.get('count') or 0)
        existing['matchedTexts'] = merged_matches[:3]
        if not existing.get('matchedText') and merged_matches:
            existing['matchedText'] = merged_matches[0]

    return list(signals_by_tag.values())


def _infer_feedback_errors(
    *,
    student_content: str,
    assistant_content: str,
    locale: str,
    focus_grammar: list[str],
    target_expressions: list[str],
    communicative_functions: list[str],
) -> list[dict[str, Any]]:
    if not student_content or not assistant_content:
        return []

    inferred: list[dict[str, Any]] = []
    student_search = _normalize_search_text(student_content)
    assistant_search = _normalize_search_text(assistant_content)

    for expression in target_expressions:
        normalized_expression = _normalize_search_text(expression)
        if normalized_expression and normalized_expression in assistant_search and normalized_expression not in student_search:
            metadata = INFERRED_ERROR_METADATA['target_expression.missing']
            inferred.append({
                'errorId': 'target_expression.missing',
                'label': f"{metadata['label']}: {expression}",
                'category': metadata['category'],
                'count': 1,
                'rubricDimensionIds': metadata['rubricDimensionIds'],
                'matchedText': expression,
            })

    if 'ask_follow_up' in communicative_functions and _is_question_like(assistant_content) and not _is_question_like(student_content):
        metadata = INFERRED_ERROR_METADATA['question_formation.follow_up']
        inferred.append({
            'errorId': 'question_formation.follow_up',
            'label': metadata['label'],
            'category': metadata['category'],
            'count': 1,
            'rubricDimensionIds': metadata['rubricDimensionIds'],
            'matchedText': assistant_content[:60],
        })

    if _contains_politeness_markers(assistant_content) and not _contains_politeness_markers(student_content):
        metadata = INFERRED_ERROR_METADATA['register.politeness']
        inferred.append({
            'errorId': 'register.politeness',
            'label': metadata['label'],
            'category': metadata['category'],
            'count': 1,
            'rubricDimensionIds': metadata['rubricDimensionIds'],
            'matchedText': assistant_content[:60],
        })

    if _count_words(student_content) <= 3 and _count_words(assistant_content) >= 4:
        metadata = INFERRED_ERROR_METADATA['output.elaboration']
        inferred.append({
            'errorId': 'output.elaboration',
            'label': metadata['label'],
            'category': metadata['category'],
            'count': 1,
            'rubricDimensionIds': metadata['rubricDimensionIds'],
            'matchedText': student_content,
        })

    if not inferred and focus_grammar:
        metadata = INFERRED_ERROR_METADATA['grammar.focus_target']
        inferred.append({
            'errorId': 'grammar.focus_target',
            'label': f"{metadata['label']}: {focus_grammar[0]}",
            'category': metadata['category'],
            'count': 1,
            'rubricDimensionIds': metadata['rubricDimensionIds'],
            'matchedText': focus_grammar[0],
        })
    elif not inferred:
        metadata = INFERRED_ERROR_METADATA['comprehensibility.precision']
        inferred.append({
            'errorId': 'comprehensibility.precision',
            'label': metadata['label'],
            'category': metadata['category'],
            'count': 1,
            'rubricDimensionIds': metadata['rubricDimensionIds'],
            'matchedText': assistant_content[:60],
        })

    deduped: list[dict[str, Any]] = []
    seen = set()
    locale_key = _detect_locale_key(locale)
    for item in inferred:
        error_id = _normalize_string(item.get('errorId'))
        if not error_id or error_id in seen:
            continue
        seen.add(error_id)
        adjusted_dimensions = []
        for dimension_id in _normalize_string_list(item.get('rubricDimensionIds')):
            if locale_key == 'fr' and dimension_id == 'clarity':
                adjusted_dimensions.append('comprehensibility')
            else:
                adjusted_dimensions.append(dimension_id)
        deduped.append({
            **item,
            'rubricDimensionIds': adjusted_dimensions,
        })
    return deduped


def _rubric_dimension_ids(session_record: dict[str, Any]) -> list[str]:
    pedagogy = _pedagogy_snapshot(session_record)
    dimension_ids = _normalize_string_list(pedagogy.get('rubricDimensionIds'))
    if dimension_ids:
        return dimension_ids

    curriculum_snapshot = session_record.get('curriculum_snapshot', {}) if isinstance(session_record, dict) else {}
    rubrics = curriculum_snapshot.get('rubrics', []) if isinstance(curriculum_snapshot, dict) else []
    collected = []
    for rubric in rubrics:
        if not isinstance(rubric, dict):
            continue
        for dimension in rubric.get('dimensions', []):
            if isinstance(dimension, dict):
                dimension_id = _normalize_string(dimension.get('id'))
                if dimension_id and dimension_id not in collected:
                    collected.append(dimension_id)
    return collected


def _compute_rubric_dimension_scores(summary: dict[str, Any], session_record: dict[str, Any]) -> dict[str, float]:
    curriculum_snapshot = session_record.get('curriculum_snapshot', {}) if isinstance(session_record, dict) else {}
    rubrics = curriculum_snapshot.get('rubrics', []) if isinstance(curriculum_snapshot, dict) else []
    rubric_scale = {'min': 0.0, 'max': 4.0}
    if rubrics and isinstance(rubrics[0], dict):
        scale = rubrics[0].get('scale', {})
        if isinstance(scale, dict):
            if isinstance(scale.get('min'), (int, float)):
                rubric_scale['min'] = float(scale.get('min'))
            if isinstance(scale.get('max'), (int, float)):
                rubric_scale['max'] = float(scale.get('max'))

    target_turns = summary['evidence_progress']['min_turns_target'] or 4
    score_range = max(0.0, rubric_scale['max'] - rubric_scale['min'])
    scores: dict[str, float] = {}
    for dimension_id in _rubric_dimension_ids(session_record):
        signal_count = summary['rubric_dimension_signal_counts'].get(dimension_id, 0)
        penalty_count = summary['rubric_dimension_error_counts'].get(dimension_id, 0)
        base_score = 0.0 if summary['student_turn_count'] <= 0 else 1.0

        signal_score = min(1.75, (signal_count / max(1, target_turns)) * 2.0)
        completion_bonus = 0.0
        if dimension_id in {'interaction_management', 'task_completion'} and summary['task_completion_count'] > 0:
            completion_bonus = 0.75
        elif dimension_id in {'lexical_grammatical_control', 'clarity'}:
            completion_bonus = min(0.75, summary['target_expression_total_hits'] * 0.2)
        elif dimension_id in {'comprehensibility', 'sociopragmatics'} and summary['self_correction_count'] > 0:
            completion_bonus = 0.35

        output_bonus = 0.0
        if summary['average_student_words_per_turn'] >= 6:
            output_bonus = 0.5
        elif summary['average_student_words_per_turn'] >= 3:
            output_bonus = 0.25

        repeated_penalty = 1 if penalty_count >= 2 else 0
        penalty = min(2.0, penalty_count * 0.65 + repeated_penalty * 0.4)
        raw_score = rubric_scale['min'] + min(score_range, base_score + signal_score + completion_bonus + output_bonus - penalty)
        scores[dimension_id] = round(max(rubric_scale['min'], min(rubric_scale['max'], raw_score)), 2)

    return scores


def default_cost_summary() -> dict[str, Any]:
    return {
        'estimated_usd': 0.0,
        'estimated_voice_seconds': 0,
        'estimated_text_turns': 0,
    }


def default_session_summary() -> dict[str, Any]:
    return {
        'total_turns': 0,
        'student_turn_count': 0,
        'assistant_turn_count': 0,
        'total_student_words': 0,
        'average_student_words_per_turn': 0.0,
        'estimated_speaking_time_seconds': 0,
        'target_expression_hits': {},
        'target_expression_total_hits': 0,
        'target_vocabulary_hits': {},
        'target_vocabulary_total_hits': 0,
        'self_correction_count': 0,
        'task_completion_count': 0,
        'feedback_counts': {
            'recast': 0,
            'elicitation': 0,
            'review_item': 0,
        },
        'objective_turn_counts': {},
        'foundation_domain_turn_counts': {},
        'rubric_turn_counts': {},
        'error_counts': {},
        'repeated_error_counts': {},
        'communicative_function_signals': {},
        'discourse_move_signals': {},
        'rubric_dimension_signal_counts': {},
        'rubric_dimension_error_counts': {},
        'rubric_dimension_scores': {},
        'task_model': '',
        'evidence_progress': {
            'min_turns_target': None,
            'max_turns_target': None,
            'time_limit_sec': None,
            'max_replays': None,
            'min_turns_reached': False,
        },
        'ended_reason': None,
    }


def normalize_cost_summary(cost_summary: Any) -> dict[str, Any]:
    normalized = default_cost_summary()
    if isinstance(cost_summary, dict):
        estimated_usd = cost_summary.get('estimated_usd', cost_summary.get('estimatedUsd'))
        estimated_voice_seconds = cost_summary.get(
            'estimated_voice_seconds',
            cost_summary.get('estimatedVoiceSeconds'),
        )
        estimated_text_turns = cost_summary.get(
            'estimated_text_turns',
            cost_summary.get('estimatedTextTurns'),
        )
        if isinstance(estimated_usd, (int, float)):
            normalized['estimated_usd'] = float(estimated_usd)
        if isinstance(estimated_voice_seconds, int):
            normalized['estimated_voice_seconds'] = max(0, estimated_voice_seconds)
        if isinstance(estimated_text_turns, int):
            normalized['estimated_text_turns'] = max(0, estimated_text_turns)
    return normalized


def normalize_session_summary(summary: Any) -> dict[str, Any]:
    normalized = default_session_summary()
    if isinstance(summary, dict):
        total_turns = summary.get('total_turns', summary.get('totalTurns'))
        student_turn_count = summary.get('student_turn_count', summary.get('studentTurnCount'))
        assistant_turn_count = summary.get('assistant_turn_count', summary.get('assistantTurnCount'))
        total_student_words = summary.get('total_student_words', summary.get('totalStudentWords'))
        average_student_words_per_turn = summary.get(
            'average_student_words_per_turn',
            summary.get('averageStudentWordsPerTurn'),
        )
        estimated_speaking_time_seconds = summary.get(
            'estimated_speaking_time_seconds',
            summary.get('estimatedSpeakingTimeSeconds'),
        )
        target_expression_hits = summary.get('target_expression_hits', summary.get('targetExpressionHits'))
        target_expression_total_hits = summary.get(
            'target_expression_total_hits',
            summary.get('targetExpressionTotalHits'),
        )
        target_vocabulary_hits = summary.get('target_vocabulary_hits', summary.get('targetVocabularyHits'))
        target_vocabulary_total_hits = summary.get(
            'target_vocabulary_total_hits',
            summary.get('targetVocabularyTotalHits'),
        )
        self_correction_count = summary.get('self_correction_count', summary.get('selfCorrectionCount'))
        task_completion_count = summary.get('task_completion_count', summary.get('taskCompletionCount'))
        feedback_counts = summary.get('feedback_counts', summary.get('feedbackCounts'))
        objective_turn_counts = summary.get('objective_turn_counts', summary.get('objectiveTurnCounts'))
        foundation_domain_turn_counts = summary.get(
            'foundation_domain_turn_counts',
            summary.get('foundationDomainTurnCounts'),
        )
        rubric_turn_counts = summary.get('rubric_turn_counts', summary.get('rubricTurnCounts'))
        error_counts = summary.get('error_counts', summary.get('errorCounts'))
        repeated_error_counts = summary.get('repeated_error_counts', summary.get('repeatedErrorCounts'))
        communicative_function_signals = summary.get(
            'communicative_function_signals',
            summary.get('communicativeFunctionSignals'),
        )
        discourse_move_signals = summary.get(
            'discourse_move_signals',
            summary.get('discourseMoveSignals'),
        )
        rubric_dimension_signal_counts = summary.get(
            'rubric_dimension_signal_counts',
            summary.get('rubricDimensionSignalCounts'),
        )
        rubric_dimension_error_counts = summary.get(
            'rubric_dimension_error_counts',
            summary.get('rubricDimensionErrorCounts'),
        )
        rubric_dimension_scores = summary.get(
            'rubric_dimension_scores',
            summary.get('rubricDimensionScores'),
        )
        task_model = summary.get('task_model', summary.get('taskModel'))
        evidence_progress = summary.get('evidence_progress', summary.get('evidenceProgress'))
        ended_reason = summary.get('ended_reason', summary.get('endedReason'))

        if isinstance(total_turns, int):
            normalized['total_turns'] = max(0, total_turns)
        if isinstance(student_turn_count, int):
            normalized['student_turn_count'] = max(0, student_turn_count)
        if isinstance(assistant_turn_count, int):
            normalized['assistant_turn_count'] = max(0, assistant_turn_count)
        if isinstance(total_student_words, int):
            normalized['total_student_words'] = max(0, total_student_words)
        if isinstance(average_student_words_per_turn, (int, float)):
            normalized['average_student_words_per_turn'] = float(average_student_words_per_turn)
        if isinstance(estimated_speaking_time_seconds, int):
            normalized['estimated_speaking_time_seconds'] = max(0, estimated_speaking_time_seconds)
        normalized['target_expression_hits'] = _normalize_count_map(target_expression_hits)
        if isinstance(target_expression_total_hits, int):
            normalized['target_expression_total_hits'] = max(0, target_expression_total_hits)
        normalized['target_vocabulary_hits'] = _normalize_count_map(target_vocabulary_hits)
        if isinstance(target_vocabulary_total_hits, int):
            normalized['target_vocabulary_total_hits'] = max(0, target_vocabulary_total_hits)
        if isinstance(self_correction_count, int):
            normalized['self_correction_count'] = max(0, self_correction_count)
        if isinstance(task_completion_count, int):
            normalized['task_completion_count'] = max(0, task_completion_count)
        if isinstance(feedback_counts, dict):
            normalized['feedback_counts'] = {
                'recast': max(0, _coerce_int(feedback_counts.get('recast')) or 0),
                'elicitation': max(0, _coerce_int(feedback_counts.get('elicitation')) or 0),
                'review_item': max(0, _coerce_int(feedback_counts.get('review_item', feedback_counts.get('reviewItem'))) or 0),
            }
        normalized['objective_turn_counts'] = _normalize_count_map(objective_turn_counts)
        normalized['foundation_domain_turn_counts'] = _normalize_count_map(foundation_domain_turn_counts)
        normalized['rubric_turn_counts'] = _normalize_count_map(rubric_turn_counts)
        normalized['error_counts'] = _normalize_count_map(error_counts)
        normalized['repeated_error_counts'] = _normalize_count_map(repeated_error_counts)
        normalized['communicative_function_signals'] = _normalize_count_map(communicative_function_signals)
        normalized['discourse_move_signals'] = _normalize_count_map(discourse_move_signals)
        normalized['rubric_dimension_signal_counts'] = _normalize_count_map(rubric_dimension_signal_counts)
        normalized['rubric_dimension_error_counts'] = _normalize_count_map(rubric_dimension_error_counts)
        normalized['rubric_dimension_scores'] = _normalize_float_map(rubric_dimension_scores)
        if isinstance(task_model, str) and task_model.strip():
            normalized['task_model'] = task_model.strip()
        if isinstance(evidence_progress, dict):
            normalized['evidence_progress'] = {
                'min_turns_target': _coerce_int(
                    evidence_progress.get('min_turns_target', evidence_progress.get('minTurnsTarget'))
                ),
                'max_turns_target': _coerce_int(
                    evidence_progress.get('max_turns_target', evidence_progress.get('maxTurnsTarget'))
                ),
                'time_limit_sec': _coerce_int(
                    evidence_progress.get('time_limit_sec', evidence_progress.get('timeLimitSec'))
                ),
                'max_replays': _coerce_int(
                    evidence_progress.get('max_replays', evidence_progress.get('maxReplays'))
                ),
                'min_turns_reached': bool(
                    evidence_progress.get('min_turns_reached', evidence_progress.get('minTurnsReached'))
                ),
            }
        if isinstance(ended_reason, str) and ended_reason.strip():
            normalized['ended_reason'] = ended_reason.strip()

    if normalized['student_turn_count'] > 0:
        normalized['average_student_words_per_turn'] = round(
            normalized['total_student_words'] / normalized['student_turn_count'],
            2,
        )
    else:
        normalized['average_student_words_per_turn'] = 0.0

    if normalized['target_expression_total_hits'] <= 0:
        normalized['target_expression_total_hits'] = sum(normalized['target_expression_hits'].values())
    if normalized['target_vocabulary_total_hits'] <= 0:
        normalized['target_vocabulary_total_hits'] = sum(normalized['target_vocabulary_hits'].values())

    return normalized


def serialize_cost_summary(cost_summary: Any) -> dict[str, Any]:
    normalized = normalize_cost_summary(cost_summary)
    return {
        'estimatedUsd': normalized['estimated_usd'],
        'estimatedVoiceSeconds': normalized['estimated_voice_seconds'],
        'estimatedTextTurns': normalized['estimated_text_turns'],
    }


def serialize_session_summary(summary: Any) -> dict[str, Any]:
    normalized = normalize_session_summary(summary)
    return {
        'totalTurns': normalized['total_turns'],
        'studentTurnCount': normalized['student_turn_count'],
        'assistantTurnCount': normalized['assistant_turn_count'],
        'totalStudentWords': normalized['total_student_words'],
        'averageStudentWordsPerTurn': normalized['average_student_words_per_turn'],
        'estimatedSpeakingTimeSeconds': normalized['estimated_speaking_time_seconds'],
        'targetExpressionHits': normalized['target_expression_hits'],
        'targetExpressionTotalHits': normalized['target_expression_total_hits'],
        'targetVocabularyHits': normalized['target_vocabulary_hits'],
        'targetVocabularyTotalHits': normalized['target_vocabulary_total_hits'],
        'selfCorrectionCount': normalized['self_correction_count'],
        'taskCompletionCount': normalized['task_completion_count'],
        'feedbackCounts': {
            'recast': normalized['feedback_counts']['recast'],
            'elicitation': normalized['feedback_counts']['elicitation'],
            'reviewItem': normalized['feedback_counts']['review_item'],
        },
        'objectiveTurnCounts': normalized['objective_turn_counts'],
        'foundationDomainTurnCounts': normalized['foundation_domain_turn_counts'],
        'rubricTurnCounts': normalized['rubric_turn_counts'],
        'errorCounts': normalized['error_counts'],
        'repeatedErrorCounts': normalized['repeated_error_counts'],
        'communicativeFunctionSignals': normalized['communicative_function_signals'],
        'discourseMoveSignals': normalized['discourse_move_signals'],
        'rubricDimensionSignalCounts': normalized['rubric_dimension_signal_counts'],
        'rubricDimensionErrorCounts': normalized['rubric_dimension_error_counts'],
        'rubricDimensionScores': normalized['rubric_dimension_scores'],
        'taskModel': normalized['task_model'],
        'evidenceProgress': {
            'minTurnsTarget': normalized['evidence_progress']['min_turns_target'],
            'maxTurnsTarget': normalized['evidence_progress']['max_turns_target'],
            'timeLimitSec': normalized['evidence_progress']['time_limit_sec'],
            'maxReplays': normalized['evidence_progress']['max_replays'],
            'minTurnsReached': normalized['evidence_progress']['min_turns_reached'],
        },
        'endedReason': normalized['ended_reason'],
    }


def _pedagogy_snapshot(session_record: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(session_record, dict):
        return {}
    pedagogy = session_record.get('pedagogy_snapshot')
    return pedagogy if isinstance(pedagogy, dict) else {}


def _event_pedagogy_payload(session_record: dict[str, Any]) -> dict[str, Any]:
    pedagogy = _pedagogy_snapshot(session_record)
    curriculum_snapshot = session_record.get('curriculum_snapshot', {}) if isinstance(session_record, dict) else {}
    mapping_snapshot = session_record.get('mapping_snapshot', {}) if isinstance(session_record, dict) else {}
    situation = (curriculum_snapshot.get('situation') or {}) if isinstance(curriculum_snapshot, dict) else {}
    module = (curriculum_snapshot.get('module') or {}) if isinstance(curriculum_snapshot, dict) else {}
    return {
        'moduleId': module.get('id'),
        'situationId': situation.get('id'),
        'learningLocale': _session_learning_locale(session_record),
        'objectiveIds': _normalize_string_list(pedagogy.get('objectiveIds')),
        'taskModel': _normalize_string(pedagogy.get('taskModel')),
        'rubricIds': _normalize_string_list(pedagogy.get('rubricIds')),
        'rubricDimensionIds': _normalize_string_list(pedagogy.get('rubricDimensionIds')),
        'contextTags': _normalize_string_list(pedagogy.get('contextTags')),
        'communicativeFunctions': _normalize_string_list(pedagogy.get('communicativeFunctions')),
        'discourseMoves': _normalize_string_list(pedagogy.get('discourseMoves')),
        'foundationDomains': _normalize_string_list(pedagogy.get('foundationDomains')),
        'templateRefs': _normalize_string_list(pedagogy.get('templateRefs')),
        'targetExpressions': _normalize_string_list(mapping_snapshot.get('targetExpressions')),
        'targetVocabulary': _normalize_string_list(mapping_snapshot.get('targetVocabulary')),
        'evidence': pedagogy.get('evidence', {}) if isinstance(pedagogy.get('evidence'), dict) else {},
    }


def build_practice_session_payload(
    bootstrap: dict[str, Any],
    *,
    student_uid: str,
    chat_id: str = '',
    ui_language: str = 'en',
) -> dict[str, Any]:
    classroom = bootstrap.get('class', {}) if isinstance(bootstrap, dict) else {}
    launch = bootstrap.get('launch', {}) if isinstance(bootstrap, dict) else {}
    modality = launch.get('modality', {}) if isinstance(launch, dict) else {}
    curriculum = bootstrap.get('curriculum', {}) if isinstance(bootstrap, dict) else {}
    now = _utc_now()

    return {
        'org_id': classroom.get('orgId'),
        'class_id': classroom.get('id'),
        'assignment_id': (bootstrap.get('assignment') or {}).get('id'),
        'student_uid': student_uid,
        'mapping_snapshot': bootstrap.get('mapping') or {},
        'assignment_snapshot': bootstrap.get('assignment') or {},
        'curriculum_snapshot': curriculum,
        'pedagogy_snapshot': curriculum.get('pedagogy', {}) if isinstance(curriculum, dict) else {},
        'modality': modality.get('mode', 'hybrid'),
        'voice_enabled': bool(launch.get('voiceAllowed')),
        'text_enabled': bool(launch.get('textAllowed')),
        'status': 'active',
        'started_at': now,
        'ended_at': None,
        'prompt_version': DEFAULT_PROMPT_VERSION,
        'system_prompt_preview': bootstrap.get('systemPromptPreview', ''),
        'class_snapshot': classroom,
        'transcript_ref': {'chat_id': chat_id} if chat_id else {},
        'cost_summary': default_cost_summary(),
        'session_summary': default_session_summary(),
        'analysis_state': default_analysis_state(),
        'teacher_preview': bool(bootstrap.get('teacherPreview')),
        'ui_language': ui_language,
        'created_at': now,
        'updated_at': now,
    }


def build_learning_event_payload(
    session_record: dict[str, Any],
    *,
    event_type: str,
    turn_index: int | None = None,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    normalized_payload = dict(payload or {})
    if 'pedagogy' not in normalized_payload:
        normalized_payload['pedagogy'] = _event_pedagogy_payload(session_record)
    return {
        'org_id': session_record.get('org_id'),
        'class_id': session_record.get('class_id'),
        'assignment_id': session_record.get('assignment_id'),
        'session_id': session_record.get('id'),
        'student_uid': session_record.get('student_uid'),
        'event_type': event_type,
        'turn_index': turn_index,
        'payload': normalized_payload,
        'created_at': _utc_now(),
    }


def serialize_practice_session(session_record: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(session_record, dict):
        return None

    transcript_ref = session_record.get('transcript_ref', {}) if isinstance(session_record, dict) else {}
    return {
        'id': session_record.get('id'),
        'orgId': session_record.get('org_id'),
        'classId': session_record.get('class_id'),
        'assignmentId': session_record.get('assignment_id'),
        'studentUid': session_record.get('student_uid'),
        'chatId': transcript_ref.get('chat_id'),
        'status': session_record.get('status', 'active'),
        'modality': session_record.get('modality', 'hybrid'),
        'voiceEnabled': bool(session_record.get('voice_enabled')),
        'textEnabled': bool(session_record.get('text_enabled')),
        'startedAt': _timestamp_to_iso(session_record.get('started_at')),
        'endedAt': _timestamp_to_iso(session_record.get('ended_at')),
        'promptVersion': session_record.get('prompt_version', DEFAULT_PROMPT_VERSION),
        'sessionSummary': serialize_session_summary(session_record.get('session_summary')),
        'costSummary': serialize_cost_summary(session_record.get('cost_summary')),
        'teacherPreview': bool(session_record.get('teacher_preview')),
    }


def apply_learning_event_to_session(
    session_record: dict[str, Any],
    *,
    event_type: str,
    turn_index: int | None = None,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload = payload if isinstance(payload, dict) else {}
    summary = normalize_session_summary(session_record.get('session_summary'))
    cost_summary = normalize_cost_summary(session_record.get('cost_summary'))
    analysis_state = normalize_analysis_state(session_record.get('analysis_state'))
    pedagogy = _pedagogy_snapshot(session_record)
    locale = _session_learning_locale(session_record)
    now = _utc_now()

    if event_type == 'student.turn':
        content = _normalize_string(payload.get('content'))
        curriculum_snapshot = session_record.get('curriculum_snapshot', {}) if isinstance(session_record, dict) else {}
        situation = curriculum_snapshot.get('situation', {}) if isinstance(curriculum_snapshot, dict) else {}
        situation_seed = situation.get('seed', {}) if isinstance(situation, dict) else {}
        target_register = _normalize_string(situation_seed.get('register'))
        word_count = _coerce_int(payload.get('wordCount'))
        if word_count is None:
            word_count = _count_words(content)
        speaking_time_seconds = _coerce_int(payload.get('estimatedSpeakingTimeSeconds'))
        if speaking_time_seconds is None:
            speaking_time_seconds = _estimate_speaking_time_seconds(word_count)

        summary['student_turn_count'] += 1
        summary['total_turns'] += 1
        summary['total_student_words'] += word_count
        summary['estimated_speaking_time_seconds'] += speaking_time_seconds

        target_expressions = (session_record.get('mapping_snapshot') or {}).get('targetExpressions', [])
        expression_hits = _count_target_expression_hits(content, target_expressions if isinstance(target_expressions, list) else [])
        for expression, count in expression_hits.items():
            summary['target_expression_hits'][expression] = summary['target_expression_hits'].get(expression, 0) + count
            summary['target_expression_total_hits'] += count

        target_vocabulary = (session_record.get('mapping_snapshot') or {}).get('targetVocabulary', [])
        vocabulary_hits = _count_target_expression_hits(content, target_vocabulary if isinstance(target_vocabulary, list) else [])
        for word, count in vocabulary_hits.items():
            summary['target_vocabulary_hits'][word] = summary['target_vocabulary_hits'].get(word, 0) + count
            summary['target_vocabulary_total_hits'] += count

        for objective_id in _normalize_string_list(pedagogy.get('objectiveIds')):
            summary['objective_turn_counts'][objective_id] = summary['objective_turn_counts'].get(objective_id, 0) + 1
        for foundation_domain in _normalize_string_list(pedagogy.get('foundationDomains')):
            summary['foundation_domain_turn_counts'][foundation_domain] = (
                summary['foundation_domain_turn_counts'].get(foundation_domain, 0) + 1
            )
        for rubric_id in _normalize_string_list(pedagogy.get('rubricIds')):
            summary['rubric_turn_counts'][rubric_id] = summary['rubric_turn_counts'].get(rubric_id, 0) + 1

        summary['task_model'] = _normalize_string(pedagogy.get('taskModel'))
        evidence = pedagogy.get('evidence', {}) if isinstance(pedagogy.get('evidence'), dict) else {}
        if isinstance(evidence.get('minTurns'), int):
            summary['evidence_progress']['min_turns_target'] = evidence.get('minTurns')
        if isinstance(evidence.get('maxTurns'), int):
            summary['evidence_progress']['max_turns_target'] = evidence.get('maxTurns')
        if isinstance(evidence.get('timeLimitSec'), int):
            summary['evidence_progress']['time_limit_sec'] = evidence.get('timeLimitSec')
        if isinstance(evidence.get('maxReplays'), int):
            summary['evidence_progress']['max_replays'] = evidence.get('maxReplays')

        function_signals = _detect_communicative_function_signals(
            content,
            _normalize_string_list(pedagogy.get('communicativeFunctions')),
            locale=locale,
        )
        for signal in function_signals:
            function_id = _normalize_string(signal.get('functionId'))
            count = _coerce_int(signal.get('count')) or 1
            if function_id:
                summary['communicative_function_signals'][function_id] = (
                    summary['communicative_function_signals'].get(function_id, 0) + count
                )

        discourse_signals = _detect_discourse_move_signals(
            content,
            _normalize_string_list(pedagogy.get('discourseMoves')),
            locale=locale,
        )
        for signal in discourse_signals:
            move_id = _normalize_string(signal.get('moveId'))
            count = _coerce_int(signal.get('count')) or 1
            if move_id:
                summary['discourse_move_signals'][move_id] = summary['discourse_move_signals'].get(move_id, 0) + count

        self_correction_matches = [
            signal for signal in discourse_signals
            if _normalize_string(signal.get('moveId')) == 'self_correction'
        ]
        if self_correction_matches:
            summary['self_correction_count'] += 1

        errors = _detect_student_errors(
            content,
            locale=locale,
            focus_grammar=_mapping_focus_grammar(session_record),
            register=target_register,
        )
        for error in errors:
            error_id = _normalize_string(error.get('errorId'))
            if not error_id:
                continue
            count = _coerce_int(error.get('count')) or 1
            summary['error_counts'][error_id] = summary['error_counts'].get(error_id, 0) + count
            if summary['error_counts'][error_id] >= 2:
                summary['repeated_error_counts'][error_id] = summary['error_counts'][error_id]
            for dimension_id in _normalize_string_list(error.get('rubricDimensionIds')):
                summary['rubric_dimension_error_counts'][dimension_id] = (
                    summary['rubric_dimension_error_counts'].get(dimension_id, 0) + count
                )

        rubric_dimension_ids = _rubric_dimension_ids(session_record)
        positive_function_ids = {_normalize_string(item.get('functionId')) for item in function_signals}
        positive_move_ids = {_normalize_string(item.get('moveId')) for item in discourse_signals}
        detected_error_ids = {_normalize_string(item.get('errorId')) for item in errors}
        for dimension_id in rubric_dimension_ids:
            rule = RUBRIC_DIMENSION_RULES.get(dimension_id, {})
            positive_signal_count = 0
            if positive_function_ids & set(rule.get('positiveFunctions', set())):
                positive_signal_count += 1
            if positive_move_ids & set(rule.get('positiveMoves', set())):
                positive_signal_count += 1
            if dimension_id in {'comprehensibility', 'clarity'} and word_count >= 4:
                positive_signal_count += 1
            if dimension_id == 'lexical_grammatical_control' and not detected_error_ids:
                positive_signal_count += 1
            if dimension_id == 'sociopragmatics':
                if target_register and target_register != 'formal':
                    positive_signal_count += 1
            if dimension_id == 'interaction_management' and summary['student_turn_count'] >= 2:
                positive_signal_count += 1
            if positive_signal_count > 0:
                summary['rubric_dimension_signal_counts'][dimension_id] = (
                    summary['rubric_dimension_signal_counts'].get(dimension_id, 0) + positive_signal_count
                )

        min_turns_target = summary['evidence_progress']['min_turns_target']
        if (
            isinstance(min_turns_target, int)
            and min_turns_target > 0
            and summary['student_turn_count'] >= min_turns_target
            and not summary['evidence_progress']['min_turns_reached']
        ):
            summary['evidence_progress']['min_turns_reached'] = True
            summary['task_completion_count'] += 1

        if session_record.get('voice_enabled'):
            cost_summary['estimated_voice_seconds'] += speaking_time_seconds
        else:
            cost_summary['estimated_text_turns'] += 1

        analysis_state = _record_turn_analysis_state(
            analysis_state,
            role='student',
            content=content,
            turn_index=turn_index,
        )

    elif event_type == 'assistant.turn':
        content = _normalize_string(payload.get('content'))
        summary['assistant_turn_count'] += 1
        summary['total_turns'] += 1
        cost_summary['estimated_text_turns'] += 1

        feedback_events = _detect_feedback_event_types(content, locale=locale)
        for feedback_event in feedback_events:
            feedback_event_type = _normalize_string(feedback_event.get('eventType'))
            if feedback_event_type == 'feedback.recast':
                summary['feedback_counts']['recast'] += 1
            elif feedback_event_type == 'feedback.elicitation':
                summary['feedback_counts']['elicitation'] += 1
            elif feedback_event_type == 'feedback.review_item':
                summary['feedback_counts']['review_item'] += 1

        student_turn = analysis_state.get('last_student_turn') if isinstance(analysis_state, dict) else {}
        student_content = _normalize_string((student_turn or {}).get('content'))
        if student_content and feedback_events:
            inferred_errors = _infer_feedback_errors(
                student_content=student_content,
                assistant_content=content,
                locale=locale,
                focus_grammar=_mapping_focus_grammar(session_record),
                target_expressions=_normalize_string_list((session_record.get('mapping_snapshot') or {}).get('targetExpressions')),
                communicative_functions=_normalize_string_list(pedagogy.get('communicativeFunctions')),
            )
            for error in inferred_errors:
                error_id = _normalize_string(error.get('errorId'))
                if not error_id:
                    continue
                count = _coerce_int(error.get('count')) or 1
                summary['error_counts'][error_id] = summary['error_counts'].get(error_id, 0) + count
                if summary['error_counts'][error_id] >= 2:
                    summary['repeated_error_counts'][error_id] = summary['error_counts'][error_id]
                for dimension_id in _normalize_string_list(error.get('rubricDimensionIds')):
                    summary['rubric_dimension_error_counts'][dimension_id] = (
                        summary['rubric_dimension_error_counts'].get(dimension_id, 0) + count
                    )

        analysis_state = _record_turn_analysis_state(
            analysis_state,
            role='assistant',
            content=content,
            turn_index=turn_index,
        )

    elif event_type == 'feedback.recast':
        summary['feedback_counts']['recast'] += _coerce_int(payload.get('count')) or 1
    elif event_type == 'feedback.elicitation':
        summary['feedback_counts']['elicitation'] += _coerce_int(payload.get('count')) or 1
    elif event_type == 'feedback.review_item':
        summary['feedback_counts']['review_item'] += _coerce_int(payload.get('count')) or 1
    elif event_type == 'metric.target_expression_hit':
        expression = _normalize_string(payload.get('expression'))
        count = _coerce_int(payload.get('count')) or 1
        if expression:
            summary['target_expression_hits'][expression] = summary['target_expression_hits'].get(expression, 0) + count
            summary['target_expression_total_hits'] += count
    elif event_type == 'metric.target_vocabulary_hit':
        word = _normalize_string(payload.get('word'))
        count = _coerce_int(payload.get('count')) or 1
        if word:
            summary['target_vocabulary_hits'][word] = summary['target_vocabulary_hits'].get(word, 0) + count
            summary['target_vocabulary_total_hits'] += count
    elif event_type == 'metric.self_correction':
        summary['self_correction_count'] += _coerce_int(payload.get('count')) or 1
    elif event_type == 'metric.communicative_function_signal':
        function_id = _normalize_string(payload.get('functionId'))
        count = _coerce_int(payload.get('count')) or 1
        if function_id:
            summary['communicative_function_signals'][function_id] = (
                summary['communicative_function_signals'].get(function_id, 0) + count
            )
    elif event_type == 'metric.discourse_move_signal':
        move_id = _normalize_string(payload.get('moveId'))
        count = _coerce_int(payload.get('count')) or 1
        if move_id:
            summary['discourse_move_signals'][move_id] = summary['discourse_move_signals'].get(move_id, 0) + count
    elif event_type == 'metric.error_detected':
        error_id = _normalize_string(payload.get('errorId'))
        count = _coerce_int(payload.get('count')) or 1
        if error_id:
            summary['error_counts'][error_id] = summary['error_counts'].get(error_id, 0) + count
        for dimension_id in _normalize_string_list(payload.get('rubricDimensionIds')):
            summary['rubric_dimension_error_counts'][dimension_id] = (
                summary['rubric_dimension_error_counts'].get(dimension_id, 0) + count
            )
    elif event_type == 'metric.repeated_error':
        error_id = _normalize_string(payload.get('errorId'))
        count = _coerce_int(payload.get('count')) or 1
        if error_id:
            summary['repeated_error_counts'][error_id] = max(
                summary['repeated_error_counts'].get(error_id, 0),
                count,
            )
    elif event_type == 'metric.rubric_dimension_signal':
        dimension_id = _normalize_string(payload.get('dimensionId'))
        count = _coerce_int(payload.get('count')) or 1
        if dimension_id:
            summary['rubric_dimension_signal_counts'][dimension_id] = (
                summary['rubric_dimension_signal_counts'].get(dimension_id, 0) + count
            )
    elif event_type == 'task.completed':
        summary['task_completion_count'] += _coerce_int(payload.get('count')) or 1
        if payload.get('criterion') == 'min_turns':
            summary['evidence_progress']['min_turns_reached'] = True

    summary['rubric_dimension_scores'] = _compute_rubric_dimension_scores(summary, session_record)

    updates: dict[str, Any] = {
        'session_summary': normalize_session_summary(summary),
        'cost_summary': normalize_cost_summary(cost_summary),
        'analysis_state': analysis_state,
        'updated_at': now,
    }

    if event_type == 'session.ended':
        requested_status = _normalize_string(payload.get('status')) or 'completed'
        ended_status = requested_status if requested_status in SESSION_STATUSES else 'completed'
        updates['status'] = ended_status
        updates['ended_at'] = now
        updates['session_summary']['ended_reason'] = _normalize_string(payload.get('reason')) or 'ended'

    return updates


def build_derived_learning_events(
    session_record: dict[str, Any],
    *,
    event_type: str,
    turn_index: int | None = None,
    payload: dict[str, Any] | None = None,
    updated_session_summary: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    payload = payload if isinstance(payload, dict) else {}
    pedagogy = _pedagogy_snapshot(session_record)
    locale = _session_learning_locale(session_record)
    derived_events = []

    if event_type == 'student.turn':
        content = _normalize_string(payload.get('content'))
        target_expressions = (session_record.get('mapping_snapshot') or {}).get('targetExpressions', [])
        for expression, count in _count_target_expression_hits(content, target_expressions if isinstance(target_expressions, list) else []).items():
            derived_events.append(
                build_learning_event_payload(
                    session_record,
                    event_type='metric.target_expression_hit',
                    turn_index=turn_index,
                    payload={'expression': expression, 'count': count},
                )
            )

        target_vocabulary = (session_record.get('mapping_snapshot') or {}).get('targetVocabulary', [])
        for word, count in _count_target_expression_hits(content, target_vocabulary if isinstance(target_vocabulary, list) else []).items():
            derived_events.append(
                build_learning_event_payload(
                    session_record,
                    event_type='metric.target_vocabulary_hit',
                    turn_index=turn_index,
                    payload={'word': word, 'count': count},
                )
            )

        for signal in _detect_context_tag_signals(
            content,
            _normalize_string_list(pedagogy.get('contextTags')),
            locale=locale,
        ):
            derived_events.append(
                build_learning_event_payload(
                    session_record,
                    event_type='metric.context_tag_signal',
                    turn_index=turn_index,
                    payload=signal,
                )
            )

        function_signals = _detect_communicative_function_signals(
            content,
            _normalize_string_list(pedagogy.get('communicativeFunctions')),
            locale=locale,
        )
        for signal in function_signals:
            derived_events.append(
                build_learning_event_payload(
                    session_record,
                    event_type='metric.communicative_function_signal',
                    turn_index=turn_index,
                    payload=signal,
                )
            )

        discourse_signals = _detect_discourse_move_signals(
            content,
            _normalize_string_list(pedagogy.get('discourseMoves')),
            locale=locale,
        )
        for signal in discourse_signals:
            derived_events.append(
                build_learning_event_payload(
                    session_record,
                    event_type='metric.discourse_move_signal',
                    turn_index=turn_index,
                    payload=signal,
                )
            )

        if any(_normalize_string(signal.get('moveId')) == 'self_correction' for signal in discourse_signals):
            derived_events.append(
                build_learning_event_payload(
                    session_record,
                    event_type='metric.self_correction',
                    turn_index=turn_index,
                    payload={'count': 1},
                )
            )

        curriculum_snapshot = session_record.get('curriculum_snapshot', {}) if isinstance(session_record, dict) else {}
        situation = curriculum_snapshot.get('situation', {}) if isinstance(curriculum_snapshot, dict) else {}
        situation_seed = situation.get('seed', {}) if isinstance(situation, dict) else {}
        target_register = _normalize_string(situation_seed.get('register'))
        errors = _detect_student_errors(
            content,
            locale=locale,
            focus_grammar=_mapping_focus_grammar(session_record),
            register=target_register,
        )
        for error in errors:
            derived_events.append(
                build_learning_event_payload(
                    session_record,
                    event_type='metric.error_detected',
                    turn_index=turn_index,
                    payload=error,
                )
            )
            normalized_summary = normalize_session_summary(updated_session_summary)
            error_id = _normalize_string(error.get('errorId'))
            if error_id and normalized_summary['error_counts'].get(error_id, 0) >= 2:
                derived_events.append(
                    build_learning_event_payload(
                        session_record,
                        event_type='metric.repeated_error',
                        turn_index=turn_index,
                        payload={
                            'errorId': error_id,
                            'count': normalized_summary['error_counts'].get(error_id, 0),
                            'label': error.get('label'),
                            'category': error.get('category'),
                            'rubricDimensionIds': error.get('rubricDimensionIds', []),
                        },
                    )
                )

        rubric_dimension_ids = _rubric_dimension_ids(session_record)
        function_ids = {_normalize_string(item.get('functionId')) for item in function_signals}
        move_ids = {_normalize_string(item.get('moveId')) for item in discourse_signals}
        error_ids = {_normalize_string(item.get('errorId')) for item in errors}
        for dimension_id in rubric_dimension_ids:
            rule = RUBRIC_DIMENSION_RULES.get(dimension_id, {})
            count = 0
            source = 'semantic'
            if function_ids & set(rule.get('positiveFunctions', set())):
                count += 1
            if move_ids & set(rule.get('positiveMoves', set())):
                count += 1
            if dimension_id in {'comprehensibility', 'clarity'} and (_coerce_int(payload.get('wordCount')) or _count_words(content)) >= 4:
                count += 1
                source = 'output_length'
            if dimension_id == 'lexical_grammatical_control' and not error_ids:
                count += 1
            if dimension_id == 'interaction_management' and normalize_session_summary(updated_session_summary)['student_turn_count'] >= 2:
                count += 1
            if count > 0:
                derived_events.append(
                    build_learning_event_payload(
                        session_record,
                        event_type='metric.rubric_dimension_signal',
                        turn_index=turn_index,
                        payload={'dimensionId': dimension_id, 'count': count, 'source': source},
                    )
                )

        normalized_summary = normalize_session_summary(updated_session_summary)
        if normalized_summary['evidence_progress']['min_turns_reached']:
            min_turns_target = normalized_summary['evidence_progress']['min_turns_target']
            if (
                isinstance(min_turns_target, int)
                and normalized_summary['student_turn_count'] == min_turns_target
            ):
                derived_events.append(
                    build_learning_event_payload(
                        session_record,
                        event_type='task.completed',
                        turn_index=turn_index,
                        payload={'criterion': 'min_turns', 'count': 1},
                    )
                )

    elif event_type == 'assistant.turn':
        content = _normalize_string(payload.get('content'))
        feedback_events = _detect_feedback_event_types(content, locale=locale)
        for feedback_event in feedback_events:
            derived_events.append(
                build_learning_event_payload(
                    session_record,
                    event_type=_normalize_string(feedback_event.get('eventType')),
                    turn_index=turn_index,
                    payload=feedback_event,
                )
            )

        analysis_state = normalize_analysis_state(session_record.get('analysis_state'))
        student_turn = analysis_state.get('last_student_turn') if isinstance(analysis_state, dict) else {}
        student_content = _normalize_string((student_turn or {}).get('content'))
        if student_content and feedback_events:
            inferred_errors = _infer_feedback_errors(
                student_content=student_content,
                assistant_content=content,
                locale=locale,
                focus_grammar=_mapping_focus_grammar(session_record),
                target_expressions=_normalize_string_list((session_record.get('mapping_snapshot') or {}).get('targetExpressions')),
                communicative_functions=_normalize_string_list(pedagogy.get('communicativeFunctions')),
            )
            normalized_summary = normalize_session_summary(updated_session_summary)
            for error in inferred_errors:
                derived_events.append(
                    build_learning_event_payload(
                        session_record,
                        event_type='metric.error_detected',
                        turn_index=turn_index,
                        payload=error,
                    )
                )
                error_id = _normalize_string(error.get('errorId'))
                if error_id and normalized_summary['error_counts'].get(error_id, 0) >= 2:
                    derived_events.append(
                        build_learning_event_payload(
                            session_record,
                            event_type='metric.repeated_error',
                            turn_index=turn_index,
                            payload={
                                'errorId': error_id,
                                'count': normalized_summary['error_counts'].get(error_id, 0),
                                'label': error.get('label'),
                                'category': error.get('category'),
                                'rubricDimensionIds': error.get('rubricDimensionIds', []),
                            },
                        )
                    )

    return derived_events


def _sort_count_map(count_map: dict[str, int]) -> list[dict[str, Any]]:
    return [
        {'id': key, 'count': value}
        for key, value in sorted(count_map.items(), key=lambda item: (-item[1], item[0]))
    ]


def _sort_float_map(value_map: dict[str, float]) -> list[dict[str, Any]]:
    return [
        {'id': key, 'score': round(value, 2)}
        for key, value in sorted(value_map.items(), key=lambda item: (-item[1], item[0]))
    ]


def _aggregate_context_tag_counts(learning_events: list[dict[str, Any]] | None) -> dict[str, int]:
    counts: dict[str, int] = {}
    for event in learning_events or []:
        if _normalize_string(event.get('event_type')) != 'metric.context_tag_signal':
            continue
        payload = event.get('payload', {}) if isinstance(event.get('payload'), dict) else {}
        context_tag = _normalize_string(payload.get('contextTag'))
        count = _coerce_int(payload.get('count')) or 1
        if context_tag:
            counts[context_tag] = counts.get(context_tag, 0) + count
    return counts


def _aggregate_error_event_metadata(
    learning_events: list[dict[str, Any]] | None,
) -> tuple[dict[str, dict[str, Any]], dict[str, set[str]]]:
    metadata_by_id: dict[str, dict[str, Any]] = {}
    student_ids_by_error: dict[str, set[str]] = {}

    for event in learning_events or []:
        event_type = _normalize_string(event.get('event_type'))
        if event_type not in {'metric.error_detected', 'metric.repeated_error'}:
            continue
        payload = event.get('payload', {}) if isinstance(event.get('payload'), dict) else {}
        error_id = _normalize_string(payload.get('errorId'))
        if not error_id:
            continue
        metadata_by_id[error_id] = {
            'label': _normalize_string(payload.get('label')) or metadata_by_id.get(error_id, {}).get('label') or _error_rule_metadata(error_id)['label'],
            'category': _normalize_string(payload.get('category')) or metadata_by_id.get(error_id, {}).get('category') or _error_rule_metadata(error_id)['category'],
            'rubricDimensionIds': _normalize_string_list(payload.get('rubricDimensionIds')) or metadata_by_id.get(error_id, {}).get('rubricDimensionIds') or _error_rule_metadata(error_id)['rubricDimensionIds'],
        }
        student_uid = _normalize_string(event.get('student_uid'))
        if student_uid:
            student_ids_by_error.setdefault(error_id, set()).add(student_uid)

    return metadata_by_id, student_ids_by_error


def build_assignment_coverage_input(
    sessions: list[dict[str, Any]] | None,
    learning_events: list[dict[str, Any]] | None,
    target_surfaces: list[str],
) -> dict[str, Any]:
    """Aggregate one student's prior evidence for an assignment into plain counts.

    Pure: callers fetch ``sessions`` + ``learning_events`` first. Hit counts come
    from each session's normalized summary (already per-surface); error counts
    come from error/repeated-error events grouped by label.
    """
    hit_counts: dict[str, int] = {surface: 0 for surface in target_surfaces}
    prior_session_count = 0
    for session in sessions or []:
        prior_session_count += 1
        summary = normalize_session_summary(session.get('session_summary'))
        for source in ('target_expression_hits', 'target_vocabulary_hits'):
            for surface, count in (summary.get(source) or {}).items():
                if surface in hit_counts:
                    hit_counts[surface] += int(count)

    error_counts: dict[str, int] = {}
    for event in learning_events or []:
        if _normalize_string(event.get('event_type')) not in {'metric.error_detected', 'metric.repeated_error'}:
            continue
        payload = event.get('payload', {}) if isinstance(event.get('payload'), dict) else {}
        label = _normalize_string(payload.get('label')) or _normalize_string(payload.get('errorId'))
        if label:
            error_counts[label] = error_counts.get(label, 0) + (_coerce_int(payload.get('count')) or 1)

    return {
        'hit_counts': hit_counts,
        'error_counts': error_counts,
        'prior_session_count': prior_session_count,
    }


def compute_assignment_coverage_state(
    db: Any,
    bootstrap: Any,
    uid: Any,
    assignment_id: Any,
    *,
    current_session_id: Any = None,
):
    """S2 cross-session recycling state for one student+assignment, or ``None``.

    Single source of truth for the gated + fail-open + current-session-excluded
    coverage compute shared by the chat routes (which thread the returned
    ``CoverageState`` into the prompt) and the session-create snapshot path
    (which serializes it into ``analysis_state['coverage']``). Keeping both on one
    helper means their safety behavior cannot diverge.

    Returns ``None`` (and does ZERO extra reads) unless the recycling flag is on.

    ``current_session_id`` is the practice session that is *currently in flight*
    (the one the SPA already created before chat/realtime runs). It is excluded
    from the prior-evidence aggregation so a student's FIRST session counts zero
    prior sessions — "first session = no-op, prior evidence only". When ``None``
    (no current session known), nothing is excluded.

    The read + compute is fail-open: any failure (malformed bootstrap, reader/DB
    error, compute error) degrades to ``None`` so the prompt renders correctly
    without a recycling section and the route that previously succeeded never
    breaks.
    """
    # Lazy import keeps this seam off the module import surface so the engine's
    # plan/routing/coverage import boundary stays untouched when the flag is off.
    from backend.services.pedagogy.integration import recycling_enabled

    # Flag gate stays OUTSIDE the try: flag-off must do ZERO reads, and there is
    # nothing here that can fail. Only the enrichment below is fail-open.
    if not recycling_enabled():
        return None

    try:
        if not (bootstrap and uid and assignment_id):
            return None

        mapping = bootstrap.get('mapping') if isinstance(bootstrap, dict) else None
        if not isinstance(mapping, dict):
            return None
        targets = [
            *_normalize_string_list(mapping.get('targetExpressions')),
            *_normalize_string_list(mapping.get('targetVocabulary')),
        ]
        if not targets:
            return None

        from backend.services.pedagogy.coverage import compute_coverage_state

        all_sessions = db.list_student_assignment_practice_sessions(assignment_id, uid) or []
        # Exclude the in-flight session: it already exists by the time chat/realtime
        # runs, but it is NOT prior evidence. Match on the 'id' field both the PG and
        # Firestore readers stamp onto each session record.
        if current_session_id:
            prior_sessions = [
                s
                for s in all_sessions
                if not (isinstance(s, dict) and s.get('id') == current_session_id)
            ]
        else:
            prior_sessions = all_sessions
        prior_events = [
            e
            for e in (db.list_assignment_learning_events(assignment_id) or [])
            if isinstance(e, dict) and e.get('student_uid') == uid
        ]
        cov_input = build_assignment_coverage_input(prior_sessions, prior_events, targets)
        return compute_coverage_state(targets, **cov_input)
    except Exception:
        logger.exception(
            'recycling coverage computation failed; degrading to no recycling '
            '(assignment_id=%s)',
            assignment_id,
        )
        return None


def _rubric_thresholds(curriculum: dict[str, Any]) -> dict[str, float]:
    thresholds: dict[str, float] = {}
    for objective in curriculum.get('objectives', []) if isinstance(curriculum, dict) else []:
        if not isinstance(objective, dict):
            continue
        mastery = objective.get('mastery', {}) if isinstance(objective.get('mastery'), dict) else {}
        rubric_id = _normalize_string(mastery.get('rubricId'))
        threshold = mastery.get('threshold')
        if rubric_id and isinstance(threshold, (int, float)):
            thresholds[rubric_id] = max(float(threshold), thresholds.get(rubric_id, float(threshold)))
    return thresholds


def _confidence_label(signal_count: int, error_count: int) -> str:
    total = max(0, signal_count) + max(0, error_count)
    if total >= 8:
        return 'high'
    if total >= 4:
        return 'medium'
    return 'low'


def _dimension_evidence_strings(
    dimension_id: str,
    *,
    signal_count: int,
    error_count: int,
    target_expression_total_hits: int,
    communicative_function_signals: dict[str, int],
    discourse_move_signals: dict[str, int],
    repeated_error_cards: list[dict[str, Any]],
    context_tag_counts: dict[str, int],
) -> tuple[list[str], list[str]]:
    evidence: list[str] = []
    concerns: list[str] = []

    if dimension_id in {'interaction_management'}:
        interaction_signals = communicative_function_signals.get('ask_follow_up', 0) + discourse_move_signals.get('turn_taking', 0)
        if interaction_signals > 0:
            evidence.append(f'Interactive follow-up and turn-taking signals: {interaction_signals}')
    if dimension_id in {'comprehensibility', 'clarity'} and discourse_move_signals.get('self_correction', 0) > 0:
        evidence.append(f'Self-correction signals: {discourse_move_signals["self_correction"]}')
    if dimension_id in {'lexical_grammatical_control', 'language_control'} and target_expression_total_hits > 0:
        evidence.append(f'Target expression hits: {target_expression_total_hits}')
    if dimension_id in {'sociopragmatics', 'cultural_specificity'} and sum(context_tag_counts.values()) > 0:
        evidence.append(f'Context-tag signals: {sum(context_tag_counts.values())}')
    if dimension_id in {'organization'} and (
        discourse_move_signals.get('signposting', 0) > 0
        or discourse_move_signals.get('introduction_body_conclusion', 0) > 0
    ):
        evidence.append(
            f"Structure signals: {discourse_move_signals.get('signposting', 0) + discourse_move_signals.get('introduction_body_conclusion', 0)}"
        )
    if dimension_id in {'argument_or_comparison'}:
        argument_signals = communicative_function_signals.get('support_with_evidence', 0) + discourse_move_signals.get('compare_contrast', 0)
        if argument_signals > 0:
            evidence.append(f'Argument / comparison signals: {argument_signals}')

    if signal_count > 0 and not evidence:
        evidence.append(f'Curriculum-aligned positive evidence signals: {signal_count}')

    if error_count > 0:
        concerns.append(f'Correction-linked error signals: {error_count}')

    relevant_repeated_errors = [
        item['label']
        for item in repeated_error_cards
        if dimension_id in _normalize_string_list(item.get('rubricDimensionIds'))
    ]
    if relevant_repeated_errors:
        concerns.append(f'Repeated pattern: {relevant_repeated_errors[0]}')

    if not evidence:
        evidence.append('Limited direct evidence in the current transcript/event stream.')

    return evidence[:2], concerns[:2]


def build_assignment_analytics_payload(
    bootstrap: dict[str, Any],
    sessions: list[dict[str, Any]],
    learning_events: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    assignment = bootstrap.get('assignment', {}) if isinstance(bootstrap, dict) else {}
    classroom = bootstrap.get('class', {}) if isinstance(bootstrap, dict) else {}
    mapping = bootstrap.get('mapping', {}) if isinstance(bootstrap, dict) else {}
    curriculum = bootstrap.get('curriculum', {}) if isinstance(bootstrap, dict) else {}
    pedagogy = curriculum.get('pedagogy', {}) if isinstance(curriculum, dict) else {}

    unique_student_ids = {
        session.get('student_uid')
        for session in sessions
        if isinstance(session.get('student_uid'), str) and session.get('student_uid')
    }

    total_student_turns = 0
    total_assistant_turns = 0
    total_student_words = 0
    estimated_speaking_time_seconds = 0
    total_self_corrections = 0
    total_task_completions = 0
    target_expression_hits: dict[str, int] = {}
    target_vocabulary_hits: dict[str, int] = {}
    objective_turn_counts: dict[str, int] = {}
    foundation_domain_turn_counts: dict[str, int] = {}
    rubric_turn_counts: dict[str, int] = {}
    error_counts: dict[str, int] = {}
    repeated_error_counts: dict[str, int] = {}
    communicative_function_signals: dict[str, int] = {}
    discourse_move_signals: dict[str, int] = {}
    rubric_dimension_signal_counts: dict[str, int] = {}
    rubric_dimension_error_counts: dict[str, int] = {}
    rubric_dimension_scores: dict[str, list[float]] = {}
    feedback_counts = {'recast': 0, 'elicitation': 0, 'reviewItem': 0}

    completed_session_count = 0
    active_session_count = 0

    for session in sessions:
        status = session.get('status', 'active')
        if status == 'completed':
            completed_session_count += 1
        elif status == 'active':
            active_session_count += 1

        summary = normalize_session_summary(session.get('session_summary'))
        total_student_turns += summary['student_turn_count']
        total_assistant_turns += summary['assistant_turn_count']
        total_student_words += summary['total_student_words']
        estimated_speaking_time_seconds += summary['estimated_speaking_time_seconds']
        total_self_corrections += summary['self_correction_count']
        total_task_completions += summary['task_completion_count']

        for expression, count in summary['target_expression_hits'].items():
            target_expression_hits[expression] = target_expression_hits.get(expression, 0) + count
        for word, count in summary['target_vocabulary_hits'].items():
            target_vocabulary_hits[word] = target_vocabulary_hits.get(word, 0) + count
        for objective_id, count in summary['objective_turn_counts'].items():
            objective_turn_counts[objective_id] = objective_turn_counts.get(objective_id, 0) + count
        for domain_id, count in summary['foundation_domain_turn_counts'].items():
            foundation_domain_turn_counts[domain_id] = foundation_domain_turn_counts.get(domain_id, 0) + count
        for rubric_id, count in summary['rubric_turn_counts'].items():
            rubric_turn_counts[rubric_id] = rubric_turn_counts.get(rubric_id, 0) + count
        for error_id, count in summary['error_counts'].items():
            error_counts[error_id] = error_counts.get(error_id, 0) + count
        for error_id, count in summary['repeated_error_counts'].items():
            repeated_error_counts[error_id] = max(repeated_error_counts.get(error_id, 0), count)
        for function_id, count in summary['communicative_function_signals'].items():
            communicative_function_signals[function_id] = communicative_function_signals.get(function_id, 0) + count
        for move_id, count in summary['discourse_move_signals'].items():
            discourse_move_signals[move_id] = discourse_move_signals.get(move_id, 0) + count
        for dimension_id, count in summary['rubric_dimension_signal_counts'].items():
            rubric_dimension_signal_counts[dimension_id] = rubric_dimension_signal_counts.get(dimension_id, 0) + count
        for dimension_id, count in summary['rubric_dimension_error_counts'].items():
            rubric_dimension_error_counts[dimension_id] = rubric_dimension_error_counts.get(dimension_id, 0) + count
        for dimension_id, score in summary['rubric_dimension_scores'].items():
            rubric_dimension_scores.setdefault(dimension_id, []).append(score)

        feedback_counts['recast'] += summary['feedback_counts']['recast']
        feedback_counts['elicitation'] += summary['feedback_counts']['elicitation']
        feedback_counts['reviewItem'] += summary['feedback_counts']['review_item']

    average_student_words_per_turn = round(
        total_student_words / total_student_turns,
        2,
    ) if total_student_turns > 0 else 0.0
    average_dimension_scores = {
        dimension_id: round(sum(scores) / len(scores), 2)
        for dimension_id, scores in rubric_dimension_scores.items()
        if scores
    }
    context_tag_counts = _aggregate_context_tag_counts(learning_events)
    error_event_metadata, student_ids_by_error = _aggregate_error_event_metadata(learning_events)
    rubric_thresholds = _rubric_thresholds(curriculum)

    objective_cards = []
    for objective in curriculum.get('objectives', []) if isinstance(curriculum, dict) else []:
        if not isinstance(objective, dict):
            continue
        mastery = objective.get('mastery', {}) if isinstance(objective.get('mastery'), dict) else {}
        rubric_id = _normalize_string(mastery.get('rubricId'))
        rubric_threshold = mastery.get('threshold')
        objective_cards.append({
            'id': objective.get('id'),
            'mode': objective.get('mode'),
            'canDo': objective.get('canDo', {}),
            'contextTags': _normalize_string_list(objective.get('contextTags')),
            'communicativeFunctions': _normalize_string_list(objective.get('communicativeFunctions')),
            'discourseMoves': _normalize_string_list(objective.get('discourseMoves')),
            'foundationDomains': _normalize_string_list(objective.get('foundationDomains')),
            'register': objective.get('register'),
            'rubricId': rubric_id,
            'rubricThreshold': rubric_threshold,
            'templateRefs': _normalize_string_list(objective.get('templateRefs')),
            'turnCount': objective_turn_counts.get(objective.get('id'), 0),
        })

    rubric_cards = []
    for rubric in curriculum.get('rubrics', []) if isinstance(curriculum, dict) else []:
        if not isinstance(rubric, dict):
            continue
        rubric_id = _normalize_string(rubric.get('id'))
        rubric_threshold = rubric_thresholds.get(rubric_id)
        rubric_dimension_cards = []
        for dimension in rubric.get('dimensions', []):
            if not isinstance(dimension, dict):
                continue
            dimension_id = _normalize_string(dimension.get('id'))
            signal_count = rubric_dimension_signal_counts.get(dimension_id, 0)
            error_count = rubric_dimension_error_counts.get(dimension_id, 0)
            average_score = average_dimension_scores.get(dimension_id)
            evidence, concerns = _dimension_evidence_strings(
                dimension_id,
                signal_count=signal_count,
                error_count=error_count,
                target_expression_total_hits=sum(target_expression_hits.values()),
                communicative_function_signals=communicative_function_signals,
                discourse_move_signals=discourse_move_signals,
                repeated_error_cards=[],
                context_tag_counts=context_tag_counts,
            )
            rubric_dimension_cards.append({
                'id': dimension_id,
                'title': dimension.get('title', {}),
                'description': dimension.get('description', {}),
                'averageScore': average_score,
                'threshold': rubric_threshold,
                'meetingThreshold': (
                    isinstance(average_score, (int, float))
                    and isinstance(rubric_threshold, (int, float))
                    and average_score >= rubric_threshold
                ),
                'confidence': _confidence_label(signal_count, error_count),
                'signalCount': signal_count,
                'errorCount': error_count,
                'evidence': evidence,
                'concerns': concerns,
            })
        rubric_average_score = round(
            sum(
                card['averageScore']
                for card in rubric_dimension_cards
                if isinstance(card.get('averageScore'), (int, float))
            ) / max(
                1,
                len([card for card in rubric_dimension_cards if isinstance(card.get('averageScore'), (int, float))]),
            ),
            2,
        ) if rubric_dimension_cards else None
        rubric_signal_count = sum(card['signalCount'] for card in rubric_dimension_cards)
        rubric_error_count = sum(card['errorCount'] for card in rubric_dimension_cards)
        rubric_cards.append({
            'id': rubric_id,
            'title': rubric.get('title', {}),
            'scale': rubric.get('scale', {}),
            'dimensions': rubric_dimension_cards,
            'notes': rubric.get('notes', ''),
            'turnCount': rubric_turn_counts.get(rubric_id, 0),
            'threshold': rubric_threshold,
            'meetingThreshold': (
                isinstance(rubric_average_score, (int, float))
                and isinstance(rubric_threshold, (int, float))
                and rubric_average_score >= rubric_threshold
            ),
            'confidence': _confidence_label(rubric_signal_count, rubric_error_count),
            'averageScore': rubric_average_score,
        })

    repeated_error_cards = []
    for error_id, count in sorted(repeated_error_counts.items(), key=lambda item: (-item[1], item[0])):
        metadata = {
            **_error_rule_metadata(error_id),
            **error_event_metadata.get(error_id, {}),
        }
        repeated_error_cards.append({
            'id': error_id,
            'label': metadata['label'],
            'category': metadata['category'],
            'count': count,
            'rubricDimensionIds': metadata['rubricDimensionIds'],
            'studentCount': len(student_ids_by_error.get(error_id, set())),
        })

    rubric_average_scores = [
        rubric.get('averageScore')
        for rubric in rubric_cards
        if isinstance(rubric.get('averageScore'), (int, float))
    ]
    rubric_average_score = round(sum(rubric_average_scores) / len(rubric_average_scores), 2) if rubric_average_scores else None

    if repeated_error_cards:
        rubric_cards = [
            {
                **rubric,
                'dimensions': [
                    {
                        **dimension,
                        'evidence': _dimension_evidence_strings(
                            dimension['id'],
                            signal_count=dimension['signalCount'],
                            error_count=dimension['errorCount'],
                            target_expression_total_hits=sum(target_expression_hits.values()),
                            communicative_function_signals=communicative_function_signals,
                            discourse_move_signals=discourse_move_signals,
                            repeated_error_cards=repeated_error_cards,
                            context_tag_counts=context_tag_counts,
                        )[0],
                        'concerns': _dimension_evidence_strings(
                            dimension['id'],
                            signal_count=dimension['signalCount'],
                            error_count=dimension['errorCount'],
                            target_expression_total_hits=sum(target_expression_hits.values()),
                            communicative_function_signals=communicative_function_signals,
                            discourse_move_signals=discourse_move_signals,
                            repeated_error_cards=repeated_error_cards,
                            context_tag_counts=context_tag_counts,
                        )[1],
                    }
                    for dimension in rubric['dimensions']
                ],
            }
            for rubric in rubric_cards
        ]

    rubric_average_by_id = {
        _normalize_string(rubric.get('id')): rubric.get('averageScore')
        for rubric in rubric_cards
        if _normalize_string(rubric.get('id'))
    }
    objective_cards = [
        {
            **objective,
            'estimatedRubricScore': rubric_average_by_id.get(_normalize_string(objective.get('rubricId'))),
            'meetingThreshold': (
                isinstance(rubric_average_by_id.get(_normalize_string(objective.get('rubricId'))), (int, float))
                and isinstance(objective.get('rubricThreshold'), (int, float))
                and rubric_average_by_id.get(_normalize_string(objective.get('rubricId'))) >= float(objective.get('rubricThreshold'))
            ),
        }
        for objective in objective_cards
    ]

    recent_sessions = sorted(
        sessions,
        key=lambda session: _timestamp_to_iso(session.get('started_at')) or '',
        reverse=True,
    )[:10]

    return {
        'assignment': assignment,
        'class': classroom,
        'mapping': mapping,
        'summary': {
            'sessionCount': _count_distinct_conversations(sessions),
            'completedSessionCount': completed_session_count,
            'activeSessionCount': active_session_count,
            'uniqueStudentCount': len(unique_student_ids),
            'totalStudentTurns': total_student_turns,
            'totalAssistantTurns': total_assistant_turns,
            'totalStudentWords': total_student_words,
            'averageStudentWordsPerTurn': average_student_words_per_turn,
            'estimatedSpeakingTimeSeconds': estimated_speaking_time_seconds,
            'targetExpressionHits': target_expression_hits,
            'targetExpressionTotalHits': sum(target_expression_hits.values()),
            'targetVocabularyHits': target_vocabulary_hits,
            'targetVocabularyTotalHits': sum(target_vocabulary_hits.values()),
            'selfCorrectionCount': total_self_corrections,
            'taskCompletionCount': total_task_completions,
            'repeatedErrorCount': sum(repeated_error_counts.values()),
            'rubricAverageScore': rubric_average_score,
            'feedbackCounts': feedback_counts,
            'eventCount': len(learning_events or []),
        },
        'pedagogy': {
            'taskModel': _normalize_string(pedagogy.get('taskModel')),
            'evidence': pedagogy.get('evidence', {}) if isinstance(pedagogy.get('evidence'), dict) else {},
            'targetExpressions': _sort_count_map(target_expression_hits),
            'targetVocabulary': _sort_count_map(target_vocabulary_hits),
            'contextTagCoverage': _sort_count_map(context_tag_counts),
            'communicativeFunctionSignals': _sort_count_map(communicative_function_signals),
            'discourseMoveSignals': _sort_count_map(discourse_move_signals),
            'foundationDomainCoverage': _sort_count_map(foundation_domain_turn_counts),
            'repeatedErrors': repeated_error_cards,
            'rubricDimensionScores': _sort_float_map(average_dimension_scores),
            'objectives': objective_cards,
            'rubrics': rubric_cards,
        },
        'recentSessions': [
            session_dto
            for session in recent_sessions
            if (session_dto := serialize_practice_session(session))
        ],
        'limitations': [
            'Speaking time is currently estimated from transcript length rather than raw audio timing.',
            'Communicative-function, discourse-move, repeated-error, and feedback signals are still heuristic detections, although they now use locale-aware pattern libraries.',
            'Rubric scores are evidence-backed heuristic rollups, not certified assessment scoring.',
        ],
    }


# ---------------------------------------------------------------------------
# Class-level analytics
# ---------------------------------------------------------------------------


def _count_distinct_conversations(sessions: list[dict[str, Any]]) -> int:
    """Count distinct conversations across practice sessions.

    A "conversation" is a unique chat_id. Sessions without a chat_id are
    not counted — only chat-anchored sessions represent real conversations.
    """
    chat_ids: set[str] = set()
    for session in sessions:
        ref = session.get('transcript_ref')
        chat_id = ref.get('chat_id') if isinstance(ref, dict) else None
        if isinstance(chat_id, str) and chat_id:
            chat_ids.add(chat_id)
    return len(chat_ids)


def _aggregate_session_stats(sessions: list[dict[str, Any]]) -> dict[str, Any]:
    """Aggregate basic stats from a list of session records."""
    unique_students: set[str] = set()
    total_student_turns = 0
    total_student_words = 0
    estimated_speaking_time_seconds = 0
    total_self_corrections = 0
    total_task_completions = 0
    feedback_recast = 0
    feedback_elicitation = 0
    feedback_review_item = 0
    repeated_error_counts: dict[str, int] = {}
    completed = 0
    active = 0

    for session in sessions:
        uid = session.get('student_uid')
        if isinstance(uid, str) and uid:
            unique_students.add(uid)

        status = session.get('status', 'active')
        if status == 'completed':
            completed += 1
        elif status == 'active':
            active += 1

        summary = normalize_session_summary(session.get('session_summary'))
        total_student_turns += summary['student_turn_count']
        total_student_words += summary['total_student_words']
        estimated_speaking_time_seconds += summary['estimated_speaking_time_seconds']
        total_self_corrections += summary['self_correction_count']
        total_task_completions += summary['task_completion_count']
        feedback_recast += summary['feedback_counts']['recast']
        feedback_elicitation += summary['feedback_counts']['elicitation']
        feedback_review_item += summary['feedback_counts']['review_item']
        for error_id, count in summary['repeated_error_counts'].items():
            repeated_error_counts[error_id] = max(repeated_error_counts.get(error_id, 0), count)

    return {
        'sessionCount': _count_distinct_conversations(sessions),
        'completedSessionCount': completed,
        'activeSessionCount': active,
        'uniqueStudentCount': len(unique_students),
        'totalStudentTurns': total_student_turns,
        'totalStudentWords': total_student_words,
        'averageStudentWordsPerTurn': round(total_student_words / total_student_turns, 2) if total_student_turns > 0 else 0.0,
        'estimatedSpeakingTimeSeconds': estimated_speaking_time_seconds,
        'selfCorrectionCount': total_self_corrections,
        'taskCompletionCount': total_task_completions,
        'repeatedErrorCount': sum(repeated_error_counts.values()),
        'feedbackCounts': {
            'recast': feedback_recast,
            'elicitation': feedback_elicitation,
            'reviewItem': feedback_review_item,
        },
    }


def build_class_analytics_payload(
    class_record: dict[str, Any],
    assignments: list[dict[str, Any]],
    enrollments: list[dict[str, Any]],
    all_sessions: list[dict[str, Any]],
    student_profiles: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    """Build a class-level analytics payload aggregated across all assignments."""

    # Group sessions by assignment
    sessions_by_assignment: dict[str, list[dict[str, Any]]] = {}
    for session in all_sessions:
        aid = session.get('assignment_id')
        if isinstance(aid, str) and aid:
            sessions_by_assignment.setdefault(aid, []).append(session)

    # Group sessions by student
    sessions_by_student: dict[str, list[dict[str, Any]]] = {}
    for session in all_sessions:
        uid = session.get('student_uid')
        if isinstance(uid, str) and uid:
            sessions_by_student.setdefault(uid, []).append(session)

    # Build per-assignment summaries
    assignment_cards = []
    for assignment in assignments:
        aid = assignment.get('id')
        if not aid:
            continue
        a_sessions = sessions_by_assignment.get(aid, [])
        stats = _aggregate_session_stats(a_sessions)
        assignment_cards.append({
            'id': aid,
            'title': assignment.get('title', ''),
            'status': assignment.get('status', 'draft'),
            'taskType': assignment.get('task_type', ''),
            'dueAt': _timestamp_to_iso(assignment.get('due_at')),
            **stats,
        })

    # Build per-student summaries from enrollment + session data
    enrolled_uids = {
        enrollment.get('student_uid')
        for enrollment in enrollments
        if isinstance(enrollment.get('student_uid'), str) and enrollment.get('student_uid')
    }

    student_cards = []
    for uid in sorted(enrolled_uids):
        s_sessions = sessions_by_student.get(uid, [])
        stats = _aggregate_session_stats(s_sessions)
        profile = student_profiles.get(uid, {})
        display_name = ''
        if isinstance(profile, dict):
            profile_data = profile.get('profile', profile)
            display_name = profile_data.get('display_name', profile_data.get('displayName', ''))
        student_cards.append({
            'uid': uid,
            'displayName': display_name or uid[:8],
            'email': profile.get('email', '') if isinstance(profile, dict) else '',
            **stats,
        })

    # Also include students from sessions who may not be in enrollment list
    for uid in sorted(sessions_by_student.keys()):
        if uid in enrolled_uids:
            continue
        s_sessions = sessions_by_student[uid]
        stats = _aggregate_session_stats(s_sessions)
        profile = student_profiles.get(uid, {})
        display_name = ''
        if isinstance(profile, dict):
            profile_data = profile.get('profile', profile)
            display_name = profile_data.get('display_name', profile_data.get('displayName', ''))
        student_cards.append({
            'uid': uid,
            'displayName': display_name or uid[:8],
            'email': profile.get('email', '') if isinstance(profile, dict) else '',
            **stats,
        })

    class_stats = _aggregate_session_stats(all_sessions)

    return {
        'class': {
            'id': class_record.get('id', ''),
            'orgId': class_record.get('org_id', ''),
            'name': class_record.get('name', ''),
            'term': class_record.get('term', ''),
            'subject': class_record.get('subject', ''),
            'learningLocale': class_record.get('learning_locale', ''),
            'gradeBand': class_record.get('grade_band', ''),
            'status': class_record.get('status', 'active'),
        },
        'summary': {
            **class_stats,
            'enrolledStudentCount': len(enrolled_uids),
            'assignmentCount': len(assignments),
        },
        'assignments': sorted(
            assignment_cards,
            key=lambda card: card.get('dueAt') or '',
            reverse=True,
        ),
        'students': sorted(
            student_cards,
            key=lambda card: (-card.get('sessionCount', 0), card.get('displayName', '')),
        ),
        'limitations': [
            'Class analytics aggregate per-session summaries; curriculum-level detail is available in assignment drill-down.',
            'Speaking time is estimated from transcript word counts, not raw audio duration.',
        ],
    }


# ---------------------------------------------------------------------------
# Student drill-down analytics
# ---------------------------------------------------------------------------


def build_student_drill_down_payload(
    student_uid: str,
    class_record: dict[str, Any],
    assignments: list[dict[str, Any]],
    student_sessions: list[dict[str, Any]],
    student_events: list[dict[str, Any]],
    student_profile: dict[str, Any],
) -> dict[str, Any]:
    """Build per-student analytics within a class, broken down by assignment."""

    # Group sessions by assignment
    sessions_by_assignment: dict[str, list[dict[str, Any]]] = {}
    for session in student_sessions:
        aid = session.get('assignment_id')
        if isinstance(aid, str) and aid:
            sessions_by_assignment.setdefault(aid, []).append(session)

    assignment_index = {a.get('id'): a for a in assignments if a.get('id')}

    # Per-assignment breakdown
    assignment_cards = []
    for aid, a_sessions in sorted(sessions_by_assignment.items(), key=lambda item: item[0]):
        assignment = assignment_index.get(aid, {})
        stats = _aggregate_session_stats(a_sessions)

        # Aggregate target-expression hits and rubric dimension scores for this student+assignment
        target_expression_hits: dict[str, int] = {}
        rubric_dimension_scores: dict[str, list[float]] = {}
        for session in a_sessions:
            summary = normalize_session_summary(session.get('session_summary'))
            for expr, count in summary['target_expression_hits'].items():
                target_expression_hits[expr] = target_expression_hits.get(expr, 0) + count
            for dim_id, score in summary['rubric_dimension_scores'].items():
                rubric_dimension_scores.setdefault(dim_id, []).append(score)

        average_dimension_scores = {
            dim_id: round(sum(scores) / len(scores), 2)
            for dim_id, scores in rubric_dimension_scores.items()
            if scores
        }
        rubric_avg_scores = list(average_dimension_scores.values())
        rubric_average = round(sum(rubric_avg_scores) / len(rubric_avg_scores), 2) if rubric_avg_scores else None

        assignment_cards.append({
            'id': aid,
            'title': assignment.get('title', ''),
            'status': assignment.get('status', 'draft'),
            'taskType': assignment.get('task_type', ''),
            'dueAt': _timestamp_to_iso(assignment.get('due_at')),
            **stats,
            'targetExpressionHits': target_expression_hits,
            'targetExpressionTotalHits': sum(target_expression_hits.values()),
            'rubricDimensionScores': _sort_float_map(average_dimension_scores),
            'rubricAverageScore': rubric_average,
        })

    # Aggregate repeated errors from events
    _event_error_metadata, student_ids_by_error = _aggregate_error_event_metadata(student_events)
    repeated_error_counts: dict[str, int] = {}
    for session in student_sessions:
        summary = normalize_session_summary(session.get('session_summary'))
        for error_id, count in summary['repeated_error_counts'].items():
            repeated_error_counts[error_id] = max(repeated_error_counts.get(error_id, 0), count)

    repeated_error_cards = []
    for error_id, count in sorted(repeated_error_counts.items(), key=lambda item: (-item[1], item[0])):
        metadata = {
            **_error_rule_metadata(error_id),
            **_event_error_metadata.get(error_id, {}),
        }
        repeated_error_cards.append({
            'id': error_id,
            'label': metadata['label'],
            'category': metadata['category'],
            'count': count,
            'rubricDimensionIds': metadata['rubricDimensionIds'],
        })

    overall_stats = _aggregate_session_stats(student_sessions)

    profile_data = student_profile.get('profile', student_profile) if isinstance(student_profile, dict) else {}
    display_name = ''
    if isinstance(profile_data, dict):
        display_name = profile_data.get('display_name', profile_data.get('displayName', ''))

    recent_sessions = sorted(
        student_sessions,
        key=lambda session: _timestamp_to_iso(session.get('started_at')) or '',
        reverse=True,
    )[:10]

    return {
        'student': {
            'uid': student_uid,
            'displayName': display_name or student_uid[:8],
            'email': student_profile.get('email', '') if isinstance(student_profile, dict) else '',
        },
        'class': {
            'id': class_record.get('id', ''),
            'orgId': class_record.get('org_id', ''),
            'name': class_record.get('name', ''),
            'term': class_record.get('term', ''),
            'subject': class_record.get('subject', ''),
            'learningLocale': class_record.get('learning_locale', ''),
            'gradeBand': class_record.get('grade_band', ''),
            'status': class_record.get('status', 'active'),
        },
        'summary': overall_stats,
        'assignments': sorted(
            assignment_cards,
            key=lambda card: card.get('dueAt') or '',
            reverse=True,
        ),
        'repeatedErrors': repeated_error_cards,
        'recentSessions': [
            session_dto
            for session in recent_sessions
            if (session_dto := serialize_practice_session(session))
        ],
        'limitations': [
            'Student analytics aggregate per-session summaries within this class.',
            'Speaking time and rubric scores are heuristic estimates.',
        ],
    }
