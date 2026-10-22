from __future__ import annotations

from dataclasses import dataclass, field
from statistics import median
from typing import Callable, Optional

from . import config
from .models import Score


@dataclass
class Rated:
    address: str
    neighbourhood: str
    scores: dict[str, Score]
    monthly_total: Optional[float] = None
    parking_spots: Optional[int] = None
    bedrooms: Optional[int] = None
    overall: float = 0.0
    avg_confidence: float = 0.0
    rank_key: float = 0.0


def default_sliders() -> dict[str, int]:
    return {s: config.DEFAULT_SLIDER for s in config.SCORES}


def overall(scores: dict[str, Score], sliders: dict[str, int]) -> float:
    """Overall = sum(p_s x Score_s) / sum(p_s), over the scores this house has."""
    used = {s: p for s, p in sliders.items() if p > 0 and s in scores}
    if not used:
        return 0.0
    return sum(p * scores[s].value for s, p in used.items()) / sum(used.values())


def average_confidence(scores: dict[str, Score], sliders: dict[str, int]) -> float:
    used = {s: p for s, p in sliders.items() if p > 0 and s in scores}
    if not used:
        return 0.0
    return sum(p * scores[s].confidence for s, p in used.items()) / sum(used.values())


def rank_key(overall_score: float, c_bar: float, neighbourhood_median: float) -> float:
    """Rank = c x Overall + (1 - c) x neighbourhood median"""
    return c_bar * overall_score + (1 - c_bar) * neighbourhood_median


Filter = Callable[[Rated], bool]


def max_monthly(amount: float) -> Filter:
    return lambda r: r.monthly_total is not None and r.monthly_total <= amount


def needs_parking(spots: int = 1) -> Filter:
    return lambda r: (r.parking_spots or 0) >= spots


def min_bedrooms(n: int) -> Filter:
    return lambda r: (r.bedrooms or 0) >= n


def rank(houses: list[Rated], sliders: Optional[dict[str, int]] = None,
         filters: Optional[list[Filter]] = None,
         neighbourhood_medians: Optional[dict[str, float]] = None) -> list[Rated]:
    """Hard filters remove houses first; the rest sort by rank key, not raw Overall.
    Neighbourhood medians default to the medians of the houses passed in."""
    sliders = sliders or default_sliders()
    for h in houses:
        h.overall = overall(h.scores, sliders)
        h.avg_confidence = average_confidence(h.scores, sliders)
    medians = dict(neighbourhood_medians or {})
    for n in {h.neighbourhood for h in houses} - medians.keys():
        medians[n] = median(h.overall for h in houses if h.neighbourhood == n)
    for h in houses:
        h.rank_key = rank_key(h.overall, h.avg_confidence, medians[h.neighbourhood])
    kept = [h for h in houses if all(f(h) for f in (filters or []))]
    return sorted(kept, key=lambda h: (round(h.rank_key, 2), h.avg_confidence), reverse=True)
