"""The search loop: gather, score, find the weakest scores, search again, stop.

Data sources are adapters. Each one answers the queries it knows how to answer
and returns Evidence. Turning a messy post into Evidence (the spec's ai_extract)
happens inside the adapter, so the loop and the scoring stay plain maths.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from typing import Optional, Protocol

from . import config
from .confidence import total_weight
from .engine import Context, score_house
from .models import Evidence, House, Score


@dataclass(frozen=True)
class Query:
    score: str        # the weak score this search is for
    kind: str         # e.g. "ltb_by_landlord", "reddit_by_street"
    text: str         # what to search for


class Source(Protocol):
    name: str
    kinds: set[str]

    def search(self, query: Query, house: House) -> list[Evidence]: ...


# What to search for when each score is weak. "gather" runs once at the start.
PLAYBOOK: dict[str, list[str]] = {
    "gather": ["map_places", "hsr_gtfs", "ltb_by_landlord", "city_by_address", "reddit_by_address",
               "past_listings_by_address", "own_reviews"],
    "inside": ["ltb_by_landlord", "city_by_address", "reddit_by_address", "reddit_by_street",
               "past_listings_by_address", "landlord_other_houses"],
    "inside_conflict": ["renovation_permits", "evidence_dates"],
    "commute": ["hsr_from_nearest_stop", "walking_route"],
    "food": ["map_places_fresh"],
    "social": ["map_places_fresh"],
    "value": ["comparables_1km_12m"],
}


def street_of(address: str) -> str:
    return re.sub(r"^\s*\d+[A-Za-z]?\s+", "", address).strip()


def query_text(kind: str, house: House) -> str:
    if "landlord" in kind:
        return house.landlord
    if "street" in kind:
        return f"{street_of(house.address)}, Hamilton"
    return f"{house.address}, Hamilton, ON"


def playbook(score: Score, house: House, evidence_conflicts: bool = False) -> list[Query]:
    key = "inside_conflict" if score.name == "inside" and evidence_conflicts else score.name
    kinds = PLAYBOOK.get(key, []) + (PLAYBOOK["inside"] if key == "inside_conflict" else [])
    return [Query(score.name, k, query_text(k, house)) for k in kinds if k != "landlord_other_houses" or house.landlord]


SUFFIXES = {"street": "st", "avenue": "ave", "road": "rd", "drive": "dr", "crescent": "cres",
            "boulevard": "blvd", "court": "ct", "place": "pl", "lane": "ln"}
PLACE_WORDS = {"hamilton", "on", "ontario", "canada"}


def normalise_address(a: str) -> str:
    a = re.sub(r"\b[a-z]\d[a-z]\s?\d[a-z]\d\b", " ", a.lower())    # postal code
    words = [SUFFIXES.get(w, w) for w in re.sub(r"[^a-z0-9 ]", " ", a).split()]
    while words and words[-1] in PLACE_WORDS:
        words.pop()
    return " ".join(words)


def same_address(a: str, b: str) -> bool:
    return normalise_address(a) == normalise_address(b)


def same_landlord(a: str, b: str) -> bool:
    if not a or not b:
        return False
    return SequenceMatcher(None, a.lower().strip(), b.lower().strip()).ratio() >= config.LANDLORD_NAME_MATCH


def is_about(e: Evidence, house: House) -> bool:
    """Address facts must match the address; landlord facts need a 0.9 name match."""
    if e.specificity == "address":
        return not e.about_address or same_address(e.about_address, house.address)
    if e.specificity == "landlord":
        return same_landlord(e.about_landlord, house.landlord)
    if e.specificity == "street":
        return not e.about_address or street_of(e.about_address).lower() == street_of(house.address).lower()
    return True


def drop_duplicates(found: list[Evidence], known: list[Evidence]) -> list[Evidence]:
    seen = {e.key() for e in known}
    out = []
    for e in found:
        if e.key() not in seen:
            seen.add(e.key())
            out.append(e)
    return out


def has_conflict(house: House, score_name: str) -> bool:
    values = [e.value for e in house.evidence if e.score == score_name and e.value is not None]
    return len(values) > 1 and max(values) - min(values) >= 4


@dataclass
class RoundLog:
    round: int
    targets: list[str]
    searches: int
    new_facts: int
    new_weight: float
    stopped_because: str = ""


@dataclass
class ResearchResult:
    scores: dict[str, Score]
    rounds: list[RoundLog] = field(default_factory=list)
    searches: int = 0


def run_queries(queries: list[Query], sources: list[Source], house: House, budget: int) -> tuple[list[Evidence], int]:
    found: list[Evidence] = []
    used = 0
    for q in queries:
        for s in sources:
            if q.kind in s.kinds:
                if used >= budget:
                    return found, used
                found.extend(s.search(q, house))
                used += 1
    return found, used


def research(house: House, ctx: Context, sources: list[Source],
             avg_sliders: Optional[dict[str, float]] = None) -> ResearchResult:
    avg_sliders = avg_sliders or {s: config.DEFAULT_SLIDER for s in config.SCORES}
    gather = [Query("gather", k, query_text(k, house)) for k in PLAYBOOK["gather"]]
    found, searches = run_queries(gather, sources, house, config.MAX_SEARCHES)
    house.evidence += [e for e in drop_duplicates(found, house.evidence) if is_about(e, house)]
    scores = score_house(house, ctx)
    result = ResearchResult(scores, [], searches)

    for rnd in range(1, config.MAX_ROUNDS + 1):
        # priority = how much students care x how unsure we are
        gaps = sorted(scores.values(), key=lambda s: avg_sliders.get(s.name, 0) / 5 * (1 - s.confidence),
                      reverse=True)
        targets = [s for s in gaps[:config.TARGETS_PER_ROUND] if s.confidence < config.HIGH]
        if not targets:
            result.rounds.append(RoundLog(rnd, [], 0, 0, 0.0, "every score is High"))
            break
        queries = [q for s in targets for q in playbook(s, house, has_conflict(house, s.name))]
        found, used = run_queries(queries, sources, house, config.MAX_SEARCHES - searches)
        searches += used
        new = [e for e in drop_duplicates(found, house.evidence) if is_about(e, house)]
        weight = total_weight(new, ctx.today, ctx.reliability)
        log = RoundLog(rnd, [s.name for s in targets], used, len(new), weight)
        result.rounds.append(log)
        house.evidence += new
        scores = score_house(house, ctx)
        if weight < config.MIN_NEW_EVIDENCE:
            log.stopped_because = "nothing new turned up"
            break
        if searches >= config.MAX_SEARCHES:
            log.stopped_because = "search budget spent"
            break
    else:
        result.rounds[-1].stopped_because = "3 rounds done"

    result.scores = scores
    result.searches = searches
    return result
