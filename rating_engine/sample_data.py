"""Made-up houses and stub sources for demos and tests. None of this is real data."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from .engine import Context
from .models import Evidence, House, Listing, LocationInputs, Review
from .research import Query

TODAY = date(2026, 10, 22)


@dataclass
class StubSource:
    """Answers queries from a fixed table: kind -> evidence. Real adapters
    (CanLII, Hamilton open data, Reddit API, HSR GTFS, maps) implement the same
    two members: kinds and search()."""
    name: str
    answers: dict[str, list[Evidence]] = field(default_factory=dict)

    @property
    def kinds(self) -> set[str]:
        return set(self.answers)

    def search(self, query: Query, house: House) -> list[Evidence]:
        return list(self.answers.get(query.kind, []))


def worked_example_house() -> House:
    review = Review(
        ratings={"heat": 3, "mould": 2, "pests": 3, "landlord_response": 2, "deposit_returned": 3,
                 "noise": 3, "water_pressure": 3, "outlets": 2, "appliances": 3},
        lived_until=date(2025, 10, 22), utilities_per_month=90)
    return House(
        address="88 Example St, Hamilton, ON", neighbourhood="Ainslie Wood", landlord="Sample Properties Inc",
        location=LocationInputs(walk_minutes=14, grocery_walk_minutes=9, food_places_800m=16,
                                social_places_1km=12, parking_spots=2),
        listing=Listing(rent_per_room=725, bedrooms=5, utilities_included=False, source="pasted link",
                        url="https://example.com/listing/88", last_checked=TODAY),
        reviews=[review])


def worked_example_sources() -> list[StubSource]:
    ltb = Evidence("inside", "ltb_decision", None, date(2024, 10, 22), "landlord",
                   "Tenant application decided against the landlord", "https://example.com/ltb/1",
                   signal="ltb_cases_5y", about_landlord="Sample Properties Inc.")
    other_landlord = Evidence("inside", "ltb_decision", None, date(2025, 3, 1), "landlord",
                              "Different landlord with a similar name", "https://example.com/ltb/2",
                              signal="ltb_cases_5y", about_landlord="Simple Properties Ltd")
    relisted = Evidence("inside", "past_listing", None, TODAY, "address",
                        "Listed 3 times in 2 years", "https://example.com/history/88",
                        signal="relisted_3_in_2y", about_address="88 Example Street")
    order = Evidence("inside", "city_records", None, date(2024, 10, 22), "address",
                     "Property standards order", "https://example.com/city/88",
                     signal="property_standards_orders_3y", about_address="88 Example St")
    reddit = Evidence("inside", "reddit", None, date(2025, 10, 22), "address",
                      "Post about mould in the basement at 88 Example", "https://example.com/r/88",
                      signal="public_posts_net_negative", about_address="88 Example St")
    return [
        StubSource("canlii", {"ltb_by_landlord": [ltb, other_landlord]}),
        StubSource("city", {"city_by_address": [order]}),
        StubSource("listings_history", {"past_listings_by_address": [relisted]}),
        StubSource("reddit", {"reddit_by_street": [reddit]}),
    ]


def worked_example_context() -> Context:
    return Context(today=TODAY, neighbourhood_inside_average={"Ainslie Wood": 6.5, "Westdale": 6.8},
                   comparable_totals=[780.0] * 120)


def sample_houses() -> list[House]:
    """A few more made-up houses so ranking has something to sort."""
    fresh = date(2026, 6, 1)

    def good_review(year_end: date) -> Review:
        return Review({k: 4 for k in ("heat", "mould", "pests", "landlord_response", "deposit_returned",
                                      "noise", "water_pressure", "outlets", "appliances")}, year_end,
                      utilities_per_month=110)

    return [
        worked_example_house(),
        House("15 Sample Ave, Hamilton, ON", "Westdale", "A. Landlord",
              LocationInputs(walk_minutes=9, grocery_walk_minutes=6, food_places_800m=25, social_places_1km=30),
              Listing(840, 4, True, "landlord post", "https://example.com/15", TODAY),
              [good_review(fresh) for _ in range(5)]),
        House("230 Placeholder Rd, Hamilton, ON", "Ainslie Wood", "B. Owner",
              LocationInputs(walk_minutes=25, bus_minutes=12, bus_gap_minutes=10, grocery_walk_minutes=15,
                             food_places_800m=6, social_places_1km=4, parking_spots=4),
              Listing(600, 6, False, "pasted link", "https://example.com/230", date(2026, 10, 18))),
        House("7 Demo Cres, Hamilton, ON", "Westdale", "C. Holdings",
              LocationInputs(walk_minutes=12, grocery_walk_minutes=10, food_places_800m=14, social_places_1km=18),
              Listing(700, 5, False, "partner feed", "https://example.com/7", TODAY),
              [Review({k: 5 for k in ("heat", "mould", "pests")}, fresh)]),
    ]
