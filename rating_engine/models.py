from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Optional


@dataclass
class Evidence:
    """One fact found about a house, already turned into a 0 to 10 reading."""
    score: str                      # which score it informs: "inside", "commute", ...
    source: str                     # key into config.SOURCE_RELIABILITY
    value: Optional[float]          # 0 to 10 reading, or None if it only counts as support
    seen_on: date                   # when the thing it describes happened
    specificity: str = "address"    # address | landlord | street | neighbourhood
    claim: str = ""
    url: str = ""
    signal: Optional[str] = None    # prediction signal it feeds, e.g. "ltb_cases_5y"
    signal_amount: float = 1.0
    about_address: str = ""         # what the source said it was about, for matching
    about_landlord: str = ""

    def key(self) -> tuple:
        return (self.score, self.source, self.url or self.claim, self.seen_on)


@dataclass
class Review:
    """A checklist review from a verified tenant. Ratings are 1 to 5."""
    ratings: dict[str, int]
    lived_until: date
    verified: bool = True
    utilities_per_month: Optional[float] = None
    commute_minutes: Optional[float] = None


@dataclass
class LocationInputs:
    walk_minutes: Optional[float] = None
    bus_minutes: Optional[float] = None         # ride plus walking to and from stops
    bus_gap_minutes: Optional[float] = None     # time between buses at 8:30 am
    grocery_walk_minutes: Optional[float] = None
    food_places_800m: Optional[int] = None
    social_places_1km: Optional[int] = None
    parking_spots: Optional[int] = None          # shown as a fact, not scored


@dataclass
class Listing:
    rent_per_room: float
    bedrooms: int
    utilities_included: bool
    source: str
    url: str
    last_checked: date
    landlord_submitted_rent: Optional[float] = None


@dataclass
class House:
    address: str
    neighbourhood: str
    landlord: str = ""
    location: LocationInputs = field(default_factory=LocationInputs)
    listing: Optional[Listing] = None
    reviews: list[Review] = field(default_factory=list)
    evidence: list[Evidence] = field(default_factory=list)


@dataclass
class Score:
    name: str
    value: float
    confidence: float
    sources: list[str] = field(default_factory=list)
    note: str = ""

    @property
    def level(self) -> str:
        from .confidence import level
        return level(self.confidence)

    @property
    def display_range(self) -> tuple[float, float]:
        from .confidence import display_range
        return display_range(self.value, self.confidence)
