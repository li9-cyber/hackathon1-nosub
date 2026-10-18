"""FCDT V1.1 orchestration; no network/DB reads or writes beyond supplied JSON.

Pipeline: JD structured extraction -> normalized Requirement Units -> AI output
validation -> market lookup -> deterministic scoring -> eligibility -> ranking tags.
"""
from __future__ import annotations
import hashlib
import json
from typing import Any
from .taxonomy import SUPPORTED_ROLES, role_id
from .requirements import normalize_requirements
from .evidence import assessed_units
from .market import MarketIndex
from .scoring import ALGORITHM_A,ALGORITHM_B, SCORERS,calculate_coverage,match_band

VERSION="1.1.0"


def _digest(data: Any) -> str:
    return hashlib.sha256(json.dumps(data,ensure_ascii=False,sort_keys=True,
                         separators=(",", ":"),default=str).encode()).hexdigest()


def _gate_results(raw:list[dict[str,Any]], *, cv_text:str|None,
                  jd_text:str|None, review_complete:bool) -> tuple[str,list[dict]]:
    if type(review_complete) is not bool:
        raise ValueError("eligibility_review_complete must be bool")
    if not isinstance(raw,list):raise ValueError("hard_gates must be a list")
    accepted={"Confirmed Met","Confirmed Not Met","Unverified"}
    by_key={}
    for i,gate in enumerate(raw):
        if not isinstance(gate,dict):raise ValueError("Hard gate must be object")
        key=str(gate.get("id",f"gate_{i:03d}")).strip()
        st=gate.get("status")
        quote=gate.get("jd_quote")
        if st not in accepted or not isinstance(quote,str) or not quote.strip():
            raise ValueError("Hard gate requires status and literal JD quote")
        if jd_text is not None and quote not in jd_text:
            raise ValueError("Hard gate JD quote missing from supplied JD")
        evidence=gate.get("cv_quote")
        reason=gate.get("reason")
        if not isinstance(reason,str) or not reason.strip():
            raise ValueError("Hard gate decision needs concise reason")
        if st in {"Confirmed Met","Confirmed Not Met"}:
            if not isinstance(evidence,str) or not evidence.strip():
                raise ValueError("Cannot confirm a gate based only on missing CV evidence")
        if evidence and cv_text is not None and evidence not in cv_text:
            raise ValueError("Hard gate CV quote does not occur in source CV")
        item=dict(id=key,status=st,jd_quote=quote,cv_quote=evidence,reason=reason)
        if key in by_key:
            if by_key[key]!=item:raise ValueError("Contradictory duplicate hard gate")
            continue
        by_key[key]=item
    gates=[by_key[k] for k in sorted(by_key)]
    if any(x["status"]=="Confirmed Not Met" for x in gates):return "CONFIRMED_NOT_MET",gates
    if any(x["status"]=="Unverified" for x in gates):return "UNVERIFIED",gates
    if not review_complete:return "NOT_CHECKED",gates
    if not gates:return "NO_DECLARED_GATES",gates
    return "CONFIRMED_MET",gates


def match_v1_1(*, role_code:str, jd_requirements:list[dict[str,Any]],
               evidence_assessments:list[dict[str,Any]], hard_gates:list[dict[str,Any]],
               baseline:dict[str,Any], jd_text:str|None=None, cv_text:str|None=None,
               eligibility_review_complete:bool=False,
               overlap_decisions:list[dict[str,Any]]|None=None,
               algorithm:str=ALGORITHM_A) -> dict[str,Any]:
    """Match an actual candidate to an actual JD; inputs already AI-extracted.

    All returned values are internally calculated. Caller is responsible for
    displaying the eligibility/status caveats alongside scores/bands.
    """
    # No silent fallback from an unsupported role to another finance category.
    normalized_role=role_id(role_code)
    if normalized_role is None:
        return dict(algorithm_version=VERSION, scorer_id=algorithm,
                    role_input=role_code, role_code=None, status="UNSUPPORTED_ROLE",
                    supported=False, recommendation_bucket="UNSUPPORTED",
                    display_score=None, diagnostic_score=None, match_band=None,
                    note="Unsupported role; no market weight lookup or substitute role mapping was performed")
    if algorithm not in SCORERS:
        raise ValueError("Unknown scorer; use A_80_20 or B_ITEM_4_TO_1")
    if not isinstance(baseline,dict):raise ValueError("baseline must be existing saved JSON object")
    market=MarketIndex(baseline)
    gates_state,gates=_gate_results(hard_gates,cv_text=cv_text,jd_text=jd_text,
                                   review_complete=eligibility_review_complete)
    prepared=normalize_requirements(jd_requirements,jd_text=jd_text,
                                    overlap_decisions=overlap_decisions)
    evidence,option_evidence,evidence_audit=assessed_units(prepared.units,evidence_assessments,
                                                          cv_text=cv_text)

    detailed=[]
    buckets={"Required":[],"Preferred":[],"Responsibility":[]}
    unassessed=[]
    unclear=[]
    direct=[]
    partial=[]
    unverified=[]
    required_gaps=[]
    important_gaps=[]
    improvement=[]
    warnings=[]
    for u in prepared.units:
        w=(market.lookup(normalized_role,u.skills[0]) if u.operator=="ONE" else
           market.any_of_weight(normalized_role,u.skills))
        e=evidence[u.id]
        item={**u.to_dict(),"W":w.value,"W_source_state":w.state,
              "W_source_candidates":list(w.candidates),"u":1.0+w.value,
              "evidence":e.to_dict(),"weighted_evidence":round((1.0+w.value)*e.e,9),
              "alternative_evidence":{k:v.to_dict() for k,v in sorted(option_evidence.get(u.id,{}).items())}}
        detailed.append(item)
        if w.state=="MISSING_DEFAULT": warnings.append(f"W_DEFAULT_MISSING:{u.id}")
        if w.state=="ALIAS_COLLISION_MAX": warnings.append(f"MARKET_ALIAS_COLLISION:{u.id}")
        if e.status=="NOT_ASSESSED":unassessed.append(u.id)
        if u.type=="Unclear":unclear.append(u.id)
        if u.type in buckets and e.status=="ASSESSED":
            buckets[u.type].append(dict(u=item["u"],e=e.e,unit_id=u.id))
        # The following user-facing evidence summaries only describe assessed facts.
        if e.status=="ASSESSED":
            listed={"unit_id":u.id,"skills":list(u.skills),"grade":e.grade,
                    "cv_quotes":list(e.cv_quotes),"jd_quotes":list(u.quotes),"reason":e.reason}
            if e.grade=="Direct":direct.append(listed)
            if e.grade=="Partial":partial.append(listed)
            if e.grade=="Unverified":unverified.append(listed)
            if u.type=="Required" and e.grade!="Direct":
                required_gaps.append(listed)
                if u.critical_candidate:
                    important_gaps.append({**listed,"critical_reason":u.critical_reason})
            if u.type in {"Required","Preferred"} and e.grade!="Direct":
                # Never invent experience; invite evidence confirmation and better wording.
                suggestion=("如有真實相關經歷，補充具體工作、個人貢獻及成果證據。" if e.grade=="Unverified"
                            else "補充可核實的工具、工作範圍、個人貢獻與成果，以證明完整能力或程度。")
                improvement.append({"unit_id":u.id,"suggestion":suggestion})

    required_complete=all(evidence[u.id].status=="ASSESSED" for u in prepared.units if u.type=="Required")
    preferred_complete=all(evidence[u.id].status=="ASSESSED" for u in prepared.units if u.type=="Preferred")
    class_r=calculate_coverage(buckets["Required"]) if required_complete else None
    class_p=calculate_coverage(buckets["Preferred"]) if preferred_complete else None
    if not any(u.type=="Required" for u in prepared.units):class_r=None
    if not any(u.type=="Preferred" for u in prepared.units):class_p=None

    # Strict diagnostic: calculate only when all scoreable classes assessed.
    scoreable=any(u.type in {"Required","Preferred"} for u in prepared.units)
    classified_unassessed=any(u.type in {"Required","Preferred"} and u.id in unassessed
                              for u in prepared.units)
    diagnostic=SCORERS[algorithm](buckets) if scoreable and not classified_unassessed else None
    reasons=[]
    if not scoreable:reasons.append("NO_SCORABLE_REQUIRED_OR_PREFERRED")
    if unclear:reasons.append("UNRESOLVED_REQUIREMENT_TYPES")
    if classified_unassessed:reasons.append("REQUIRED_EVIDENCE_ASSESSMENTS_NOT_COMPLETE")
    if not scoreable:
        state="INSUFFICIENT_SCORABLE_REQUIREMENTS"
    elif classified_unassessed:
        state="PROVISIONAL_EVIDENCE_NOT_ASSESSED"
    elif unclear:
        state="PROVISIONAL_UNCLEAR_REQUIREMENTS"
    elif not isinstance(jd_text,str) or not jd_text.strip():
        reasons.append("ORIGINAL_JD_TEXT_NOT_PROVIDED_TO_VERIFY_QUOTES")
        state="PROVISIONAL_JD_SOURCE_UNVERIFIED"
    elif not isinstance(cv_text,str) or not cv_text.strip():
        reasons.append("ORIGINAL_CV_TEXT_NOT_PROVIDED")
        state="PROVISIONAL_CV_SOURCE_UNVERIFIED"
    else:
        state="SCORED"
    score=(diagnostic if state=="SCORED" else None)
    # The score stays a CV-evidence metric. Gates do NOT zero or cap it.
    if algorithm==ALGORITHM_B:rec="UNRANKABLE"
    elif gates_state=="CONFIRMED_NOT_MET":rec="INELIGIBLE"
    elif state!="SCORED":rec="UNRANKABLE"
    elif gates_state in {"UNVERIFIED","NOT_CHECKED"}:rec="NEEDS_CONFIRMATION"
    else:rec="ELIGIBLE"
    if algorithm==ALGORITHM_B:display_label="內部 Challenger 比較（不可作正式推薦）"
    elif state!="SCORED":display_label="資料不足／需確認"
    elif rec=="INELIGIBLE":display_label="已確認不符合申請資格"
    elif rec=="NEEDS_CONFIRMATION":display_label="申請資格待核實"
    else:display_label=match_band(round(score,2))
    n_r=sum(u.type=="Required" for u in prepared.units)
    n_p=sum(u.type=="Preferred" for u in prepared.units)
    p_unverified=sum(u.type=="Preferred" and evidence[u.id].grade=="Unverified"
                     for u in prepared.units)
    r_non_direct=sum(u.type=="Required" and evidence[u.id].status=="ASSESSED"
                     and evidence[u.id].grade!="Direct" for u in prepared.units)
    coverage_alerts=[]
    if score is not None and score>=80 and p_unverified:
        coverage_alerts.append(f"Preferred 尚有 {p_unverified}/{n_p} 項缺少 CV 證據；總分不可單獨解讀。")
    if score is not None and score>=80 and r_non_direct:
        coverage_alerts.append(f"Required 尚有 {r_non_direct}/{n_r} 項未得到完整 CV 證據。")
    if state!="SCORED":
        coverage_alerts.append("資料未分類／未完成證據評級，不可作正式排序。")
    if gates_state in {"NOT_CHECKED","UNVERIFIED","CONFIRMED_NOT_MET"}:
        coverage_alerts.append("申請資格未確認或不符合，不能列為正常優先推薦。")
    output={
        "algorithm_version":VERSION,
        "scorer_id":algorithm,
        "active_product_scorer": ALGORITHM_A,
        "challenger_not_for_production":algorithm==ALGORITHM_B,
        "role_code":normalized_role,
        "role_input":role_code,
        "supported":True,
        "jd_source_quote_verified":isinstance(jd_text,str) and bool(jd_text.strip()),
        "cv_source_provided":isinstance(cv_text,str) and bool(cv_text.strip()),
        "baseline_source_date":baseline.get("analysis_date"),
        "baseline_metadata":market.meta(normalized_role),
        "status":state,
        "reason_codes":reasons,
        "eligibility_status":gates_state,
        "hard_gates":gates,
        "recommendation_bucket":rec,
        "ranking_allowed":rec=="ELIGIBLE" and algorithm==ALGORITHM_A,
        "display_score":round(score,2) if score is not None and algorithm==ALGORITHM_A else None,
        "diagnostic_score":round(diagnostic,2) if diagnostic is not None else None,
        "diagnostic_is_provisional":state!="SCORED",
        "match_band":match_band(round(score,2)) if score is not None and rec=="ELIGIBLE" and algorithm==ALGORITHM_A else None,
        "internal_evidence_band":match_band(round(diagnostic,2)) if diagnostic is not None else None,
        "display_label":display_label,
        "required_coverage":round(class_r,6) if class_r is not None else None,
        "preferred_coverage":round(class_p,6) if class_p is not None else None,
        "task_evidence_coverage":round(calculate_coverage(buckets["Responsibility"]),6)
                                 if buckets["Responsibility"] else None,
        "direct_evidence":direct,
        "partial_evidence":partial,
        "unverified_evidence":unverified,
        "required_evidence_gaps":required_gaps,
        "important_required_evidence_gaps":important_gaps,
        "requirement_counts":{"required":n_r,"preferred":n_p,"preferred_unverified":p_unverified,
                              "required_non_direct":r_non_direct},
        "coverage_alerts":coverage_alerts,
        "cv_improvements":improvement,
        "unresolved_unit_ids":unclear,
        "unassessed_unit_ids":unassessed,
        "units":detailed,
        "normalization_audit":prepared.audit,
        "evidence_audit":evidence_audit,
        "audit":{
            "algorithm_version":VERSION,
            "scorer_id":algorithm,
            "market_baseline_version":baseline.get("analysis_date"),
            "market_weights_source":"existing saved JSON; no recalibration",
            "scoring_rules":{"W":"R+0.5P+0.3M stored", "u":"1+W", "e":{"Direct":1,"Partial":.5,"Unverified":0},
                             "required_share_a":.8,"preferred_share_a":.2,"required_g_b":4,"preferred_g_b":1},
            "normalized_input_sha256":_digest([u.to_dict() for u in prepared.units]),
            "assessment_sha256":_digest([x.to_dict() for x in [evidence[u.id] for u in prepared.units]]),
            "traceable_jd_quotes":sum(len(u.quotes) for u in prepared.units),
            "notes":"Not hiring probability; missing CV evidence is not confirmed lack of ability.",
        },
        "warnings":sorted(set(warnings)),
    }
    return output
