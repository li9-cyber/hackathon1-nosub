"""One concept namespace; legacy names/score keys are compatibility projections.

No model-proposed alias is ever registered here. Unknown Unicode names have a
stable identity, independently of whether a source supports a particular fact.
"""
from dataclasses import dataclass
import hashlib
import re
import unicodedata

ALIASES = {
    'excel': ['microsoft excel', 'ms excel', '試算表 excel'],
    'sql': ['structured query language', '結構化查詢語言'],
    'python': ['python programming'], 'power bi': ['powerbi', 'microsoft power bi'],
    'english': ['英文', '英語'], 'cantonese': ['廣東話', '粵語'], 'mandarin': ['普通話', '國語'],
    'bachelor': ["bachelor's degree", 'bachelors', '學士', '本科'],
    'master': ["master's degree", 'masters', '碩士'], 'doctorate': ['phd', '博士'],
    'data analyst': ['數據分析師', '資料分析師'], 'financial analyst': ['財務分析師', '金融分析師'],
}
# Existing V1.1 score keys, not a second semantic taxonomy.
SCORE_KEYS = {
    'excel': 'microsoft_excel', 'ms excel': 'microsoft_excel', 'microsoft excel': 'microsoft_excel',
    'ms office': 'microsoft_office', 'microsoft office': 'microsoft_office',
    'ms word': 'microsoft_word', 'microsoft word': 'microsoft_word',
    'ms powerpoint': 'microsoft_powerpoint', 'microsoft powerpoint': 'microsoft_powerpoint',
    'power point': 'microsoft_powerpoint', 'financial modelling': 'financial_modeling',
    'financial modeling': 'financial_modeling', 'auditing': 'audit', 'audit': 'audit',
    'python programming': 'python', 'sql': 'sql', 'acccounting': 'accounting',
}

def normalized(value):
    return ' '.join(unicodedata.normalize('NFKC', value).casefold().split())

def score_key(value):
    """Preserve every existing ASCII key; Unicode no longer produces an error."""
    key = normalized(value)
    if not key: raise ValueError('Concept name must be nonempty')
    if key in SCORE_KEYS: return SCORE_KEYS[key]
    slug = re.sub(r'[^a-z0-9]+', '_', key).strip('_')
    # Mixed-script names must not collide with an unrelated ASCII substring.
    if any(c.isalnum() and not c.isascii() for c in key):
        return 'concept_' + hashlib.sha256(key.encode()).hexdigest()[:24]
    return slug or 'concept_' + hashlib.sha256(key.encode()).hexdigest()[:24]

@dataclass(frozen=True)
class Concept:
    concept_id: str
    canonical_name: str
    match_name: str
    legacy_skill_id: str | None
    scoring_id: str
    known: bool

def normalize_concept(value):
    from career_twin.shared.evidence.skill_taxonomy import lookup
    skill = lookup(value)
    if skill:
        return Concept(skill.id, skill.canonical_name, skill.match_name, skill.id,
                       score_key(skill.canonical_name), True)
    key = normalized(value)
    name = next((n for n, aliases in ALIASES.items() if key in (n, *aliases)), key)
    scoring = score_key(name)
    identity = 'concept_' + hashlib.sha256(scoring.encode()).hexdigest()[:24]
    return Concept(identity, name, name, None, scoring, name in ALIASES or key in SCORE_KEYS)

def canonical(value):
    return normalize_concept(value).match_name if value and value.strip() else ''
