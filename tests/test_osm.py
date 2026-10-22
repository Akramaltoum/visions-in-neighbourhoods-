import unittest

from rating_engine.adapters import osm


class FakeMaps:
    """Answers Nominatim and Overpass with fixed data."""

    def __init__(self):
        self.calls = []

    def __call__(self, url, body):
        self.calls.append(url)
        if "nominatim" in url:
            return [{"lat": "43.2580", "lon": "-79.9300"}]
        home = (43.2580, -79.9300)
        north = lambda m: home[0] + m / 111_000
        return {"elements": [
            {"type": "node", "id": 1, "lat": north(400), "lon": home[1], "tags": {"shop": "supermarket"}},
            {"type": "way", "id": 2, "center": {"lat": north(1500), "lon": home[1]}, "tags": {"shop": "supermarket"}},
            {"type": "node", "id": 3, "lat": north(300), "lon": home[1], "tags": {"amenity": "restaurant"}},
            {"type": "node", "id": 4, "lat": north(700), "lon": home[1], "tags": {"amenity": "cafe"}},
            {"type": "node", "id": 4, "lat": north(700), "lon": home[1], "tags": {"amenity": "cafe"}},   # duplicate
            {"type": "node", "id": 5, "lat": north(900), "lon": home[1], "tags": {"amenity": "restaurant"}},  # too far for food
            {"type": "node", "id": 6, "lat": north(950), "lon": home[1], "tags": {"amenity": "bar"}},
            {"type": "node", "id": 7, "lat": north(200), "lon": home[1], "tags": {"leisure": "fitness_centre"}},
        ]}


class OsmTests(unittest.TestCase):
    def test_locate(self):
        fake = FakeMaps()
        point, loc = osm.locate("12 Emerson St", fetch=fake, pause=lambda s: None)
        self.assertEqual(point, (43.258, -79.93))
        self.assertAlmostEqual(loc.grocery_walk_minutes, 400 * 1.3 / 80, delta=0.2)
        self.assertEqual(loc.food_places_800m, 2)       # restaurant at 300 m, cafe at 700 m
        self.assertEqual(loc.social_places_1km, 3)      # cafe, bar, gym
        self.assertGreater(loc.walk_minutes, 10)
        self.assertIn("Hamilton", fake.calls[0])

    def test_unknown_address(self):
        self.assertIsNone(osm.locate("nowhere", fetch=lambda u, b: [], pause=lambda s: None))

    def test_no_grocery_store_counts_as_far(self):
        loc = osm.nearby(43.25, -79.93, fetch=lambda u, b: {"elements": []})
        self.assertGreater(loc.grocery_walk_minutes, 25)


if __name__ == "__main__":
    unittest.main()
