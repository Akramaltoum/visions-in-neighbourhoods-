from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Optional

from . import config
from . import inside as inside_mod
from . import location, prices
from .models import House, Review, Score
from .ranking import Rated


@dataclass
class Context:
    """Everything outside the house itself that scoring needs."""
    today: date
    neighbourhood_inside_average: dict[str, float]
    comparable_totals: list[float] = field(default_factory=list)   # monthly totals of similar rooms
    street_reviews: list[Review] = field(default_factory=list)     # same street and bedroom count
    neighbourhood_reviews: list[Review] = field(default_factory=list)
    season: str = "september"
    reliability: Optional[dict] = None    # fitted values from learning.py, else config defaults
    adjustments: Optional[dict] = None
    fair_price_override: Optional[float] = None


DEFAULT_INSIDE_AVERAGE = 6.5


def score_house(house: House, ctx: Context) -> dict[str, Score]:
    """All five scores for one house. A score with no data is left out, and the
    ranking re-weights over the scores that exist."""
    scores: dict[str, Optional[Score]] = {
        "commute": location.commute(house.location, ctx.season),
        "food": location.food(house.location),
        "social": location.social(house.location),
        "inside": inside_mod.inside(
            house, ctx.neighbourhood_inside_average.get(house.neighbourhood, DEFAULT_INSIDE_AVERAGE),
            ctx.today, ctx.adjustments, ctx.reliability),
        "value": None,
    }
    total = monthly_total(house, ctx)
    fair = ctx.fair_price_override or prices.fair_price(ctx.comparable_totals)
    if total is not None and fair:
        scores["value"] = prices.value(total, fair, len(ctx.comparable_totals))
    return {k: v for k, v in scores.items() if v is not None}


def monthly_total(house: House, ctx: Context) -> Optional[float]:
    if house.listing is None or prices.price_status(house.listing, ctx.today) in ("history_only", "may_be_rented"):
        return None
    estimate = prices.utilities_estimate(ctx.today, house.reviews, ctx.street_reviews, ctx.neighbourhood_reviews)
    utilities = estimate[0] if estimate else config.FALLBACK_UTILITIES_PER_ROOM
    total, _ = prices.monthly_total(house.listing, utilities)
    return total


def rated(house: House, ctx: Context, scores: Optional[dict[str, Score]] = None) -> Rated:
    return Rated(house.address, house.neighbourhood, scores or score_house(house, ctx),
                 monthly_total(house, ctx), house.location.parking_spots,
                 house.listing.bedrooms if house.listing else None)
