"""FCDT Matching V1.1 — independent, side-effect-free Python implementation."""
from .engine import match_v1_1, VERSION, _gate_results
from .ranking import rank_for_student
from .requirements import normalize_requirements, JD_NORMALIZATION_SYSTEM_PROMPT
from .market import MarketIndex
from .evidence import EVIDENCE_MATCHING_SYSTEM_PROMPT, HARD_GATE_ASSESSMENT_SYSTEM_PROMPT
from .scoring import ALGORITHM_A, ALGORITHM_B
__all__ = ["match_v1_1","rank_for_student","normalize_requirements","MarketIndex",
           "EVIDENCE_MATCHING_SYSTEM_PROMPT","JD_NORMALIZATION_SYSTEM_PROMPT",
           "HARD_GATE_ASSESSMENT_SYSTEM_PROMPT","ALGORITHM_A","ALGORITHM_B","VERSION"]
