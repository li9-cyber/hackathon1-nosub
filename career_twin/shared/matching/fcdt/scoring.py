"""Pure deterministic score strategies: A baseline and B internal challenger."""
from __future__ import annotations
from typing import Any

ALGORITHM_A="A_80_20"
ALGORITHM_B="B_ITEM_4_TO_1"


def calculate_coverage(items: list[dict[str,Any]]) -> float | None:
    total=sum(item["u"] for item in items)
    return sum(item["u"]*item["e"] for item in items)/total if total>0 else None


def score_a(groups:dict[str,list[dict]]) -> float | None:
    r=calculate_coverage(groups["Required"])
    p=calculate_coverage(groups["Preferred"])
    if r is not None and p is not None:return 100.0*(.8*r+.2*p)
    if r is not None:return 100.0*r
    if p is not None:return 100.0*p
    return None


def score_b(groups:dict[str,list[dict]]) -> float | None:
    # NOT the active product scorer: offline challenger only.
    req=groups["Required"]
    pref=groups["Preferred"]
    denominator=sum(4*x["u"] for x in req)+sum(x["u"] for x in pref)
    if not denominator:return None
    numerator=sum(4*x["u"]*x["e"] for x in req)+sum(x["u"]*x["e"] for x in pref)
    return 100.0*numerator/denominator

SCORERS={ALGORITHM_A:score_a,ALGORITHM_B:score_b}


def match_band(value:float|None) -> str|None:
    if value is None:return None
    if value>=80:return "高度匹配"
    if value>=60:return "匹配良好"
    if value>=40:return "部分匹配"
    return "匹配度較低"
