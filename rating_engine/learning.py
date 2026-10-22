"""The feedback step: compare predictions with verified reviews and refit.

The only thing these functions try to reduce is prediction error. None of them
look at whether scores go up or down on average.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from statistics import mean
from typing import Optional

from . import config
from .inside import apply_adjustments


@dataclass
class Outcome:
    """A house that had a prediction before its first verified review arrived."""
    neighbourhood_average: float
    signals: dict[str, float]       # signal counts used for the prediction
    predicted: float
    actual: float                   # verified Inside score from the review


@dataclass
class ChangeLog:
    when: date
    what: str
    error_before: float
    error_after: float


def _solve(a: list[list[float]], b: list[float]) -> list[float]:
    """Gaussian elimination with partial pivoting, for the small ridge system."""
    n = len(b)
    m = [row[:] + [b[i]] for i, row in enumerate(a)]
    for col in range(n):
        pivot = max(range(col, n), key=lambda r: abs(m[r][col]))
        m[col], m[pivot] = m[pivot], m[col]
        for r in range(n):
            if r != col and m[col][col]:
                f = m[r][col] / m[col][col]
                m[r] = [x - f * y for x, y in zip(m[r], m[col])]
    return [m[i][n] / m[i][i] for i in range(n)]


def _predict(o: Outcome, adjustments: dict) -> float:
    return apply_adjustments(o.neighbourhood_average, o.signals, adjustments)


def mean_abs_error(outcomes: list[Outcome], adjustments: dict) -> float:
    return mean(abs(o.actual - _predict(o, adjustments)) for o in outcomes)


def refit_adjustments(outcomes: list[Outcome], current: Optional[dict] = None, strength: float = 10.0,
                      today: Optional[date] = None) -> tuple[dict, Optional[ChangeLog]]:
    """Ridge regression of (actual - neighbourhood average) on signal counts,
    pulled toward the current adjustments. Caps scale with each new step.
    Does nothing until there are at least 50 outcomes."""
    current = current or config.SIGNAL_ADJUSTMENTS
    if len(outcomes) < config.MIN_PAIRS_FOR_REFIT:
        return current, None
    names = list(current)
    prior = [current[n][0] for n in names]
    xs = [[o.signals.get(n, 0.0) for n in names] for o in outcomes]
    ys = [o.actual - o.neighbourhood_average for o in outcomes]
    k = len(names)
    xtx = [[sum(x[i] * x[j] for x in xs) + (strength if i == j else 0.0) for j in range(k)] for i in range(k)]
    xty = [sum(x[i] * y for x, y in zip(xs, ys)) + strength * prior[i] for i in range(k)]
    steps = _solve(xtx, xty)
    fitted = {}
    for n, step in zip(names, steps):
        old_step, old_cap = current[n]
        ratio = old_cap / old_step if old_step else 1.0
        fitted[n] = (round(step, 3), round(step * ratio, 3))
    log = ChangeLog(today or date.today(), "refit signal adjustments",
                    mean_abs_error(outcomes, current), mean_abs_error(outcomes, fitted))
    return fitted, log


def update_reliability(observations: dict[str, list[tuple[float, float]]],
                       current: Optional[dict] = None) -> dict:
    """observations[source] = [(what the source said, later verified score), ...].
    reliability = clamp(1 - average error / 5, 0.1, 1.0), blended 80% old, 20% new."""
    current = dict(current or config.SOURCE_RELIABILITY)
    for source, pairs in observations.items():
        if not pairs or source == "verified_review":
            continue
        measured = min(1.0, max(0.1, 1 - mean(abs(a - b) for a, b in pairs) / 5))
        old = current.get(source, measured)
        current[source] = config.RELIABILITY_BLEND_OLD * old + (1 - config.RELIABILITY_BLEND_OLD) * measured
    return current


def calibration(records: list[tuple[float, float, float]]) -> tuple[Optional[float], bool]:
    """records = [(confidence shown, score shown, later verified score)].
    High-confidence scores should be within 1.5 points at least 80% of the time.
    Returns (share within tolerance, ok). If not ok, raise config.CONFIDENCE_SCALE."""
    high = [(v, a) for c, v, a in records if c >= config.HIGH]
    if not high:
        return None, True
    share = sum(abs(v - a) <= config.CALIBRATION_TOLERANCE for v, a in high) / len(high)
    return share, share >= config.CALIBRATION_TARGET


def commute_factor(reported: list[tuple[float, float]], current_factor: float = 1.0) -> float:
    """reported = [(predicted minutes, tenant's real minutes)]. If the average error
    is over 5 minutes, rescale so predictions match the average real time."""
    if not reported:
        return current_factor
    if mean(abs(p - r) for p, r in reported) <= 5:
        return current_factor
    return current_factor * mean(r for _, r in reported) / mean(p for p, _ in reported)
