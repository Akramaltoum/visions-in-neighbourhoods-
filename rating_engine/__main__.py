"""Run the worked example and a sample ranking: python -m rating_engine"""
from __future__ import annotations

from . import prices
from .engine import rated
from .ranking import max_monthly, rank
from .research import research
from .sample_data import (TODAY, sample_houses, worked_example_context, worked_example_house,
                          worked_example_sources)


def show_scores(scores) -> None:
    for s in scores.values():
        low, high = s.display_range
        shown = f"{s.value:4.1f}" if low == high else f"{low:.1f} to {high:.1f}"
        print(f"  {s.name:<8} {shown:<12} confidence {s.confidence:.2f} {s.level:<6} {s.note}")


def main() -> None:
    ctx = worked_example_context()
    house = worked_example_house()
    print(f"Researching {house.address}")
    result = research(house, ctx, worked_example_sources())
    for r in result.rounds:
        print(f"  round {r.round}: targets {r.targets or '-'}, {r.searches} searches, "
              f"{r.new_facts} new facts, weight {r.new_weight:.2f} {('-> ' + r.stopped_because) if r.stopped_because else ''}")
    show_scores(result.scores)
    est = prices.utilities_estimate(TODAY, house.reviews)
    print(f"  price: ${house.listing.rent_per_room:.0f} rent, {prices.utilities_label(est)}, "
          f"{prices.price_status(house.listing, TODAY)}")

    print("\nRanking with default sliders, budget $900 a month:")
    others = [h for h in sample_houses() if h.address != house.address]
    houses = [rated(house, ctx, result.scores)] + [rated(h, ctx) for h in others]
    for i, h in enumerate(rank(houses, filters=[max_monthly(900)]), 1):
        print(f"  {i}. {h.address:<32} overall {h.overall:.2f}  confidence {h.avg_confidence:.2f}  "
              f"rank key {h.rank_key:.2f}  ${h.monthly_total:.0f}/month")


if __name__ == "__main__":
    main()
