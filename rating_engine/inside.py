from __future__ import annotations

from datetime import date
from typing import Iterable, Optional

from . import config
from .confidence import confidence, recency
from .models import Evidence, House, Review, Score


def review_score(review: Review, weights: Optional[dict] = None) -> float:
    """Weighted average of the checklist, rescaled from 1-5 to 0-10."""
    weights = weights or config.CHECKLIST_WEIGHTS
    rated = {k: v for k, v in review.ratings.items() if k in weights}
    if not rated:
        raise ValueError("review has no checklist ratings")
    total = sum(weights[k] for k in rated)
    return sum(weights[k] * (v - 1) / 4 * 10 for k, v in rated.items()) / total


def review_weight(review: Review, today: date) -> float:
    return recency(review.lived_until, today, config.REVIEW_HALF_LIFE_YEARS)


def signal_counts(evidence: Iterable[Evidence]) -> dict[str, float]:
    counts: dict[str, float] = {}
    seen = set()
    for e in evidence:
        if e.signal and e.key() not in seen:
            seen.add(e.key())
            counts[e.signal] = counts.get(e.signal, 0.0) + e.signal_amount
    return counts


def predicted(neighbourhood_average: float, evidence: Iterable[Evidence],
              adjustments: Optional[dict] = None) -> float:
    """Neighbourhood average plus the capped signal adjustments."""
    return apply_adjustments(neighbourhood_average, signal_counts(evidence), adjustments)


def apply_adjustments(base: float, counts: dict[str, float], adjustments: Optional[dict] = None) -> float:
    adjustments = adjustments or config.SIGNAL_ADJUSTMENTS
    value = base
    for signal, count in counts.items():
        if signal in adjustments:
            step, cap = adjustments[signal]
            change = step * count
            value += max(change, cap) if cap < 0 else min(change, cap)
    return min(10.0, max(0.0, value))


def review_evidence(house: House) -> list[Evidence]:
    return [Evidence("inside", "verified_review", review_score(r), r.lived_until, "address", "verified review")
            for r in house.reviews if r.verified]


def inside(house: House, neighbourhood_average: float, today: date,
           adjustments: Optional[dict] = None, reliability: Optional[dict] = None) -> Score:
    """Inside = (k x Predicted + sum w_i r_i) / (k + sum w_i)"""
    found = [e for e in house.evidence if e.score == "inside"]
    prediction = predicted(neighbourhood_average, found, adjustments)
    reviews = [r for r in house.reviews if r.verified]
    k = config.PRIOR_STRENGTH_K
    weighted = sum(review_weight(r, today) * review_score(r) for r in reviews)
    weights = sum(review_weight(r, today) for r in reviews)
    value = (k * prediction + weighted) / (k + weights)
    all_evidence = review_evidence(house) + found
    note = f"predicted {prediction:.1f} from signals; {len(reviews)} verified review(s)"
    return Score("inside", value, confidence(all_evidence, today, reliability),
                 sorted({e.source for e in all_evidence}), note)
