"""Read-only lookups into the existing 304-JD baseline, without re-estimating W."""
from __future__ import annotations
from dataclasses import dataclass
import math
from typing import Any
from .taxonomy import SUPPORTED_ROLES, skill_id

@dataclass(frozen=True)
class MarketWeight:
    value: float
    state: str             # PRESENT / KNOWN_ZERO / MISSING_DEFAULT / ALIAS_COLLISION_MAX
    candidates: tuple[str, ...] = ()

class MarketIndex:
    def __init__(self, original_baseline: dict[str, Any]):
        self._data = original_baseline
        self._roles: dict[str, dict[str, MarketWeight]] = {}
        self._meta: dict[str, dict[str, Any]] = {}
        for role in original_baseline.get("role_baselines", []):
            code = role.get("role_code")
            if code not in SUPPORTED_ROLES:
                continue  # Historical insurance data remains intact but is NEVER loaded for matching.
            groups: dict[str, list[tuple[str, float]]] = {}
            for s in role.get("skills", []):
                key = skill_id(s["skill"])
                value = s.get("market_weight")
                if type(value) not in (float, int) or not math.isfinite(value) or value < 0:
                    raise ValueError(f"Invalid stored W in baseline: {code}/{key}")
                groups.setdefault(key, []).append((s["skill"], float(value)))
            index = {}
            for key, samples in groups.items():
                # Existing baseline can contain duplicate alias/case variants with different W.
                # Select the maximum STORED value; never sum/re-estimate them.
                v = max(w for _,w in samples)
                state = ("ALIAS_COLLISION_MAX" if len(samples)>1 else
                         "KNOWN_ZERO" if v==0 else "PRESENT")
                index[key] = MarketWeight(v, state, tuple(sorted(n for n,_ in samples)))
            self._roles[code] = index
            self._meta[code] = {
                "source_jds": role.get("n_source_jds"),
                "retained_full_text_jds": role.get("n_full_text_retained_jds"),
                "quality": role.get("sample_quality"),
            }
        if not SUPPORTED_ROLES.issubset(self._roles):
            raise ValueError("Baseline must contain all six supported role codes")

    def lookup(self, role: str, concept_id: str) -> MarketWeight:
        if role not in self._roles:
            raise ValueError("Unsupported role lookup forbidden")
        return self._roles[role].get(concept_id, MarketWeight(0.0,"MISSING_DEFAULT"))

    def meta(self, role: str) -> dict[str, Any]:
        return dict(self._meta[role])

    def any_of_weight(self, role: str, alternatives: tuple[str, ...]) -> MarketWeight:
        """One OR-group weight = MAX(stored market W among accepted alternatives).

        Never add the weights: more options must not create extra score items.
        The option with max W need not be the same option with max e.
        This is a heuristic group-weight policy, not employer-revealed importance.
        """
        found = [self.lookup(role, s) for s in alternatives]
        biggest = max(found, key=lambda x:x.value)
        if all(x.state == "MISSING_DEFAULT" for x in found):
            state = "MISSING_DEFAULT"
        elif all(x.value == 0 for x in found):
            state = "KNOWN_ZERO" if any(x.state != "MISSING_DEFAULT" for x in found) else "MISSING_DEFAULT"
        elif any(x.state == "ALIAS_COLLISION_MAX" for x in found):
            state = "OR_MAX_OF_OPTIONS_WITH_ALIAS_COLLISION"
        else:
            state = "OR_MAX_OF_OPTIONS"
        return MarketWeight(biggest.value, state, tuple(alternatives))
