"""Pure ranking policy. No DB writes; scorer B is never a production ranking key."""
from __future__ import annotations
from typing import Any
from .scoring import ALGORITHM_A


def rank_for_student(results: list[dict[str,Any]]) -> dict[str,Any]:
    """Return separated recommendation groups, not an unsafe merged list.

    Only V1.1 A results marked ELIGIBLE are normally ranked. Unverified,
    unscorable, confirmed ineligible, and unsupported jobs are distinct.
    """
    if not isinstance(results,list):raise ValueError("Expected match results list")
    categories={"normal":[],"needs_confirmation":[],"unrankable":[],"ineligible":[],"unsupported":[]}
    for r in results:
        if not isinstance(r,dict) or not isinstance(r.get("job_id"),str):
            raise ValueError("Result must include stable job_id for cross-JD ranking")
        if r.get("algorithm_version")!="1.1.0" or r.get("scorer_id")!=ALGORITHM_A:
            raise ValueError("Only V1.1 algorithm A may rank user jobs")
        group=r.get("recommendation_bucket")
        if group=="ELIGIBLE" and r.get("ranking_allowed") and r.get("display_score") is not None:
            categories["normal"].append(r)
        elif group=="NEEDS_CONFIRMATION":categories["needs_confirmation"].append(r)
        elif group=="INELIGIBLE":categories["ineligible"].append(r)
        elif group=="UNSUPPORTED":categories["unsupported"].append(r)
        else:categories["unrankable"].append(r)
    if len(set(x["job_id"] for x in results))!=len(results):
        raise ValueError("Duplicate job_id in results")
    key=lambda r:(-(r.get("display_score") if r.get("display_score") is not None else -1), r["job_id"])
    for g in categories:
        categories[g].sort(key=key)
    return {"algorithm_version":"1.1.0","scorer_id":ALGORITHM_A,
            "normal_recommendations":categories["normal"],
            "needs_confirmation":categories["needs_confirmation"],
            "unrankable":categories["unrankable"],
            "ineligible_separate":categories["ineligible"],
            "unsupported_separate":categories["unsupported"]}
