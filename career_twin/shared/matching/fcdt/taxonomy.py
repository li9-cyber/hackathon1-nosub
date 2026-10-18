"""Conservative skill identity and *explicit* role support policy.

This taxonomy is for JD/CV concept alignment, not new market-weight research.
Unknown roles are never mapped to the closest known role.
"""
from __future__ import annotations
import re
import unicodedata

SUPPORTED_ROLES = frozenset({
    "accounting_audit", "risk_compliance_aml", "banking_operations_credit",
    "investment_asset_mgmt", "fintech_financial_data", "financial_analysis_fpa",
})
UNSUPPORTED_ROLES = frozenset({"insurance_actuarial", "insurance", "actuarial", "underwriting"})

_ROLE_ALIASES = {
    "accounting & audit": "accounting_audit",
    "risk / compliance / aml": "risk_compliance_aml",
    "banking operations / credit": "banking_operations_credit",
    "investment / asset management": "investment_asset_mgmt",
    "fintech / financial data": "fintech_financial_data",
    "financial analysis / fp&a": "financial_analysis_fpa",
    "insurance / actuarial / underwriting": "insurance_actuarial",
    "保險／精算／承保": "insurance_actuarial",
    "會計與審計": "accounting_audit",
    "風險／合規／aml": "risk_compliance_aml",
    "銀行營運／信貸": "banking_operations_credit",
    "投資／資產管理": "investment_asset_mgmt",
    "金融科技／金融數據": "fintech_financial_data",
    "財務分析／fp&a": "financial_analysis_fpa",
}

from career_twin.shared.evidence.concepts import SCORE_KEYS as _SKILL_ALIASES, score_key

# Only known, audited concept-hierarchy relationships are detected automatically.
# Detection is NOT a license to merge. A source-grounded decision must be supplied.
PARENT_SKILL_CHILDREN = {
    "microsoft_office": frozenset({"microsoft_excel", "microsoft_word", "microsoft_powerpoint"}),
}
LEVELS = frozenset({"unspecified", "basic", "intermediate", "advanced"})
TYPES = frozenset({"Required", "Preferred", "Responsibility", "Unclear"})
GRADES = {"Direct": 1.0, "Partial": 0.5, "Unverified": 0.0}


def role_id(value: str) -> str | None:
    """Return supported code or None; never infer the nearest finance role."""
    if not isinstance(value, str) or not value.strip():
        return None
    key = " ".join(value.strip().casefold().split())
    code = _ROLE_ALIASES.get(key, key)
    return code if code in SUPPORTED_ROLES else None


def skill_id(value: str) -> str:
    """Compatibility projection; shared registry owns aliases and Unicode IDs."""
    return score_key(value)
