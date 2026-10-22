from __future__ import annotations

import math
from typing import Optional

from . import config
from .confidence import map_confidence
from .models import LocationInputs, Score


def ramp(x: float, great: float, bad: float) -> float:
    """10 x clamp((bad - x) / (bad - great), 0, 1)"""
    return 10.0 * min(1.0, max(0.0, (bad - x) / (bad - great)))


def door_to_class_minutes(loc: LocationInputs, season: str = "september") -> Optional[float]:
    """The faster of walking or the bus. The bus includes half the gap between buses."""
    options = []
    if loc.walk_minutes is not None:
        factor = config.JANUARY_WALK_FACTOR if season == "january" else 1.0
        options.append(loc.walk_minutes * factor)
    if loc.bus_minutes is not None:
        options.append(loc.bus_minutes + (loc.bus_gap_minutes or 0) / 2)
    return min(options) if options else None


def commute(loc: LocationInputs, season: str = "september") -> Optional[Score]:
    minutes = door_to_class_minutes(loc, season)
    if minutes is None:
        return None
    complete = loc.walk_minutes is not None and (loc.bus_minutes is None or loc.bus_gap_minutes is not None)
    return Score("commute", ramp(minutes, *config.COMMUTE_RAMP), map_confidence(complete),
                 ["map", "hsr_gtfs"], f"{minutes:.0f} min door to class ({season})")


def food(loc: LocationInputs) -> Optional[Score]:
    if loc.grocery_walk_minutes is None and loc.food_places_800m is None:
        return None
    complete = loc.grocery_walk_minutes is not None and loc.food_places_800m is not None
    grocery = ramp(loc.grocery_walk_minutes, *config.GROCERY_RAMP) if loc.grocery_walk_minutes is not None else 5.0
    places = 10.0 * min(1.0, (loc.food_places_800m or 0) / config.FOOD_PLACES_FULL)
    value = config.FOOD_GROCERY_SHARE * grocery + config.FOOD_PLACES_SHARE * places
    return Score("food", value, map_confidence(complete), ["map"])


def social(loc: LocationInputs) -> Optional[Score]:
    if loc.social_places_1km is None:
        return None
    value = 10.0 * min(1.0, math.log(1 + loc.social_places_1km) / math.log(1 + config.SOCIAL_PLACES_FULL))
    return Score("social", value, map_confidence(True), ["map"])
