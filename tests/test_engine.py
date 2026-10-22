import unittest
from datetime import date

from rating_engine import config, learning
from rating_engine.confidence import confidence, display_range, level
from rating_engine.engine import Context, rated, score_house
from rating_engine.inside import predicted, review_score
from rating_engine.location import commute, food, ramp, social
from rating_engine.models import Evidence, House, Listing, LocationInputs, Review
from rating_engine.prices import price_status, utilities_estimate, value
from rating_engine.ranking import Rated, max_monthly, needs_parking, rank
from rating_engine.research import is_about, normalise_address, research
from rating_engine.sample_data import (TODAY, worked_example_context, worked_example_house,
                                       worked_example_sources)
from rating_engine.models import Score


def review(score_each=4, lived=TODAY, **kw):
    return Review({k: score_each for k in config.CHECKLIST_WEIGHTS}, lived, **kw)


class LocationTests(unittest.TestCase):
    def test_ramp_ends_and_middle(self):
        self.assertEqual(ramp(5, 8, 40), 10)
        self.assertEqual(ramp(45, 8, 40), 0)
        self.assertAlmostEqual(ramp(24, 8, 40), 5)

    def test_commute_uses_faster_option_and_january_factor(self):
        loc = LocationInputs(walk_minutes=20, bus_minutes=10, bus_gap_minutes=10)
        self.assertIn("15 min", commute(loc).note)          # bus 10 + half of 10
        self.assertAlmostEqual(commute(LocationInputs(walk_minutes=20), "january").value, ramp(26, 8, 40))

    def test_worked_example_location(self):
        loc = worked_example_house().location
        self.assertAlmostEqual(commute(loc).value, 8.125)
        self.assertAlmostEqual(food(loc).value, 8.0)
        self.assertAlmostEqual(social(loc).value, 7.47, places=2)

    def test_missing_input_lowers_confidence(self):
        self.assertEqual(food(LocationInputs(grocery_walk_minutes=9)).confidence, config.MAP_CONFIDENCE_ESTIMATED)
        self.assertIsNone(social(LocationInputs()))


class InsideTests(unittest.TestCase):
    def test_review_score_is_weighted_and_rescaled(self):
        self.assertEqual(review_score(review(5)), 10)
        self.assertEqual(review_score(review(1)), 0)
        self.assertAlmostEqual(review_score(worked_example_house().reviews[0]), 28 * 2.5 / 17)

    def test_signal_caps(self):
        ltb = [Evidence("inside", "ltb_decision", None, TODAY, url=str(i), signal="ltb_cases_5y") for i in range(3)]
        self.assertEqual(predicted(6.5, ltb), 4.5)          # capped at -2.0, not -3.0

    def test_duplicate_evidence_counts_once(self):
        e = Evidence("inside", "ltb_decision", None, TODAY, url="same", signal="ltb_cases_5y")
        self.assertEqual(predicted(6.5, [e, e]), 5.5)


class ConfidenceTests(unittest.TestCase):
    def fresh(self, n, values=None):
        values = values or [5.0] * n
        return [Evidence("inside", "verified_review", v, TODAY, url=str(i)) for i, v in enumerate(values)]

    def test_spec_numbers(self):
        self.assertAlmostEqual(confidence(self.fresh(1), TODAY), 0.28, places=2)
        self.assertAlmostEqual(confidence(self.fresh(2), TODAY), 0.49, places=2)
        self.assertAlmostEqual(confidence(self.fresh(5), TODAY), 0.81, places=2)

    def test_disagreement_cuts_confidence(self):
        agree = confidence(self.fresh(5), TODAY)
        split = confidence(self.fresh(5, [1, 9, 1, 9, 5]), TODAY)
        self.assertLess(split, agree * 0.6)

    def test_low_scores_show_a_range(self):
        self.assertEqual(level(0.3), "Low")
        low, high = display_range(6, 0.3)
        self.assertAlmostEqual(low, 3.9)
        self.assertAlmostEqual(high, 8.1)
        self.assertEqual(display_range(6, 0.8), (6, 6))


class ResearchTests(unittest.TestCase):
    def test_worked_example(self):
        house = worked_example_house()
        result = research(house, worked_example_context(), worked_example_sources())
        inside = result.scores["inside"]
        self.assertAlmostEqual(inside.value, 4.0, places=1)
        self.assertAlmostEqual(inside.confidence, 0.51, places=2)
        self.assertEqual(result.rounds[-1].stopped_because, "nothing new turned up")
        self.assertAlmostEqual(result.scores["value"].value, 3.88, places=2)

    def test_similar_landlord_name_is_rejected(self):
        house = worked_example_house()
        research(house, worked_example_context(), worked_example_sources())
        ltb = [e for e in house.evidence if e.signal == "ltb_cases_5y"]
        self.assertEqual([e.about_landlord for e in ltb], ["Sample Properties Inc."])

    def test_address_matching(self):
        self.assertEqual(normalise_address("12 Emerson Street, Hamilton, ON L8S 1A1"), "12 emerson st")
        house = worked_example_house()
        wrong = Evidence("inside", "reddit", None, TODAY, about_address="90 Example St")
        self.assertFalse(is_about(wrong, house))

    def test_stops_when_everything_is_high(self):
        house = House("1 A St", "Westdale", location=LocationInputs(walk_minutes=5, grocery_walk_minutes=5,
                                                                      food_places_800m=20, social_places_1km=30),
                      reviews=[review(5) for _ in range(8)])
        result = research(house, worked_example_context(), [])
        self.assertEqual(result.rounds[0].stopped_because, "every score is High")

    def test_search_budget(self):
        house = worked_example_house()
        sources = worked_example_sources() * 20             # every query answered 20 times over
        result = research(house, worked_example_context(), sources)
        self.assertLessEqual(result.searches, config.MAX_SEARCHES)


class PriceTests(unittest.TestCase):
    def listing(self, days_ago):
        return Listing(700, 5, False, "x", "u", date.fromordinal(TODAY.toordinal() - days_ago))

    def test_price_freshness(self):
        self.assertEqual(price_status(self.listing(3), TODAY), "current")
        self.assertEqual(price_status(self.listing(10), TODAY), "stale")
        self.assertEqual(price_status(self.listing(20), TODAY), "may_be_rented")
        self.assertEqual(price_status(self.listing(40), TODAY), "history_only")

    def test_utilities_fall_back_by_tier_and_ignore_old(self):
        old = review(lived=date(2022, 1, 1), utilities_per_month=50)
        street = [review(utilities_per_month=80), review(utilities_per_month=100)]
        self.assertEqual(utilities_estimate(TODAY, [old], street), (90, 2, 1))

    def test_utilities_extra_never_looks_cheaper(self):
        ctx = worked_example_context()
        extra = House("1 A St", "Westdale", listing=Listing(700, 4, False, "x", "u", TODAY))
        included = House("2 A St", "Westdale", listing=Listing(750, 4, True, "x", "u", TODAY))
        self.assertGreater(rated(extra, ctx).monthly_total, rated(included, ctx).monthly_total)

    def test_value(self):
        self.assertEqual(value(780 * 0.8, 780, 50).value, 10)
        self.assertEqual(value(780, 780, 50).value, 5)
        self.assertEqual(value(780 * 1.2, 780, 50).value, 0)


class RankingTests(unittest.TestCase):
    def house(self, name, overall, conf, total=800, parking=0):
        scores = {s: Score(s, overall, conf) for s in config.SCORES}
        return Rated(name, "Westdale", scores, total, parking)

    def test_one_glowing_guess_does_not_win(self):
        guess = self.house("guess", 9.5, 0.2)
        solid = self.house("solid", 8.0, 0.9)
        ranked = rank([guess, solid, self.house("avg", 6.5, 0.8)], neighbourhood_medians={"Westdale": 6.5})
        self.assertEqual(ranked[0].address, "solid")

    def test_filters_remove_before_ranking(self):
        ranked = rank([self.house("pricey", 9, 0.9, 1200), self.house("ok", 7, 0.9, 800, parking=1)],
                      filters=[max_monthly(900), needs_parking()])
        self.assertEqual([h.address for h in ranked], ["ok"])

    def test_sliders_change_the_order(self):
        a = Rated("a", "W", {"commute": Score("commute", 10, 0.9), "social": Score("social", 2, 0.9)})
        b = Rated("b", "W", {"commute": Score("commute", 2, 0.9), "social": Score("social", 10, 0.9)})
        self.assertEqual(rank([a, b], {"commute": 5, "social": 1})[0].address, "a")
        self.assertEqual(rank([a, b], {"commute": 1, "social": 5})[0].address, "b")


class LearningTests(unittest.TestCase):
    def outcomes(self, n, true_step):
        out = []
        for i in range(n):
            cases = i % 3
            actual = 6.5 + true_step * cases
            out.append(learning.Outcome(6.5, {"ltb_cases_5y": cases}, 0.0, actual))
        return out

    def test_no_refit_below_50(self):
        fitted, log = learning.refit_adjustments(self.outcomes(49, -1.5))
        self.assertIs(fitted, config.SIGNAL_ADJUSTMENTS)
        self.assertIsNone(log)

    def test_refit_moves_toward_truth_and_lowers_error(self):
        fitted, log = learning.refit_adjustments(self.outcomes(300, -1.5), today=TODAY)
        self.assertLess(fitted["ltb_cases_5y"][0], -1.3)
        self.assertLess(log.error_after, log.error_before)

    def test_reliability_update(self):
        rel = learning.update_reliability({"reddit": [(2, 2), (8, 8)], "google_reviews": [(0, 10)]})
        self.assertAlmostEqual(rel["reddit"], 0.8 * 0.3 + 0.2 * 1.0)
        self.assertAlmostEqual(rel["google_reviews"], 0.8 * 0.4 + 0.2 * 0.1)

    def test_calibration(self):
        share, ok = learning.calibration([(0.9, 7, 7.5), (0.9, 7, 9.5), (0.3, 7, 1)])
        self.assertEqual(share, 0.5)
        self.assertFalse(ok)


if __name__ == "__main__":
    unittest.main()
