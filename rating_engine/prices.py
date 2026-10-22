from __future__ import annotations

from datetime import date
from statistics import median
from typing import Optional, Sequence

from . import config
from .confidence import value_confidence, years_between
from .models import Listing, Review, Score


def price_status(listing: Listing, today: date) -> str:
    """current: seen in 7 days. stale: show with its date. may_be_rented: hidden by default.
    history_only: never shown as the current price."""
    age = (today - listing.last_checked).days
    if age <= config.PRICE_CURRENT_DAYS:
        return "current"
    if age > config.PRICE_NEVER_CURRENT_DAYS:
        return "history_only"
    if age > config.PRICE_MAY_BE_RENTED_DAYS:
        return "may_be_rented"
    return "stale"


def utilities_estimate(today: date, *tiers: Sequence[Review]) -> Optional[tuple[float, int, int]]:
    """Median utilities reported by verified reviewers in the last 2 years.

    Pass the tiers in order: this address, same street and bedroom count,
    neighbourhood. Returns (amount, number of tenants, tier used) or None.
    """
    for tier, reviews in enumerate(tiers):
        amounts = [r.utilities_per_month for r in reviews
                   if r.verified and r.utilities_per_month is not None
                   and years_between(r.lived_until, today) <= 2]
        if amounts:
            return median(amounts), len(amounts), tier
    return None


def monthly_total(listing: Listing, utilities: Optional[float]) -> tuple[float, bool]:
    """Rent plus utilities when they're not included. Returns (total, is_estimate)."""
    if listing.utilities_included:
        return listing.rent_per_room, False
    if utilities is None:
        return listing.rent_per_room, True
    return listing.rent_per_room + utilities, True


def utilities_label(estimate: Optional[tuple[float, int, int]]) -> str:
    if estimate is None:
        return "utilities extra, no estimate yet"
    amount, n, _ = estimate
    return f"about ${amount:.0f} a month, estimate from {n} tenant{'s' if n != 1 else ''}"


def fair_price(comparable_totals: Sequence[float]) -> Optional[float]:
    """First version: median monthly total of comparable rooms (same bedrooms,
    within 1 km, last 12 months). The spec's regression replaces this once
    there's enough data to fit it."""
    return median(comparable_totals) if comparable_totals else None


def value(total: float, fair: float, comparables: int) -> Score:
    """Value = 5 + 25 x gap, gap = (fair - total) / fair, clamped to 0..10."""
    gap = (fair - total) / fair
    score = min(10.0, max(0.0, 5 + config.VALUE_SLOPE * gap))
    diff = fair - total
    note = f"${abs(diff):.0f} {'below' if diff >= 0 else 'above'} what similar rooms near here usually cost"
    return Score("value", score, value_confidence(comparables), ["listings"], note)


def price_conflict(listing: Listing) -> bool:
    """A landlord-submitted rent that differs from the public listing is flagged;
    the public listing's price is the one shown."""
    return listing.landlord_submitted_rent is not None and listing.landlord_submitted_rent != listing.rent_per_room
