from __future__ import annotations

import math
from datetime import date
from statistics import pstdev
from typing import Iterable, Optional

from . import config
from .models import Evidence


def years_between(earlier: date, later: date) -> float:
    return max(0.0, (later - earlier).days / 365.25)


def recency(seen_on: date, today: date, half_life: float = config.EVIDENCE_HALF_LIFE_YEARS) -> float:
    return 0.5 ** (years_between(seen_on, today) / half_life)


def evidence_weight(e: Evidence, today: date, reliability: Optional[dict] = None) -> float:
    """e = reliability x 0.5^(years ago / 2) x specificity"""
    rel = (reliability or config.SOURCE_RELIABILITY).get(e.source, 0.0)
    return rel * recency(e.seen_on, today) * config.SPECIFICITY.get(e.specificity, 0.0)


def confidence_from_weights(weights_and_values: Iterable[tuple[float, Optional[float]]]) -> float:
    """c = (1 - e^(-E/3)) x (1 - min(0.5, sigma/4))"""
    pairs = list(weights_and_values)
    total = sum(w for w, _ in pairs)
    values = [v for _, v in pairs if v is not None]
    sigma = pstdev(values) if len(values) > 1 else 0.0
    return (1 - math.exp(-total / config.CONFIDENCE_SCALE)) * (1 - min(config.MAX_DISAGREEMENT_CUT, sigma / 4))


def confidence(evidence: Iterable[Evidence], today: date, reliability: Optional[dict] = None) -> float:
    return confidence_from_weights((evidence_weight(e, today, reliability), e.value) for e in evidence)


def total_weight(evidence: Iterable[Evidence], today: date, reliability: Optional[dict] = None) -> float:
    return sum(evidence_weight(e, today, reliability) for e in evidence)


def map_confidence(all_inputs_found: bool) -> float:
    return config.MAP_CONFIDENCE_COMPLETE if all_inputs_found else config.MAP_CONFIDENCE_ESTIMATED


def value_confidence(comparables: int) -> float:
    return min(0.9, comparables / config.VALUE_FULL_CONFIDENCE_COMPARABLES)


def level(c: float) -> str:
    if c >= config.HIGH:
        return "High"
    if c >= config.MEDIUM:
        return "Medium"
    return "Low"


def display_range(value: float, c: float) -> tuple[float, float]:
    """Low scores are shown as value +/- 3 x (1 - c); others as a single number."""
    if level(c) != "Low":
        return (value, value)
    half = config.LOW_RANGE_FACTOR * (1 - c)
    return (max(0.0, value - half), min(10.0, value + half))
