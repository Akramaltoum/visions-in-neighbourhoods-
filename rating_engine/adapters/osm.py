"""Location inputs from OpenStreetMap: Nominatim for the address, Overpass for what's nearby.

Both services ask for light use (Nominatim: at most 1 request a second, with a real
User-Agent). The rescore job only calls them for houses that are missing location
data, so each address is looked up once.
"""
from __future__ import annotations

import json
import math
import time
import urllib.parse
import urllib.request
from typing import Callable, Optional

from ..models import LocationInputs

# Centre of McMaster's main campus, near Mills Library. The spec lists the exact
# point as an open question; change it here.
CAMPUS = (43.2627, -79.9179)
WALK_METRES_PER_MIN = 80.0
DETOUR_FACTOR = 1.3            # streets are longer than a straight line
GROCERY_SEARCH_METRES = 2500
USER_AGENT = "VisionInNeighborhoods/0.1 (student housing ratings, Hamilton ON)"

Fetch = Callable[[str, Optional[bytes]], dict]


def http_json(url: str, body: Optional[bytes] = None) -> dict:
    req = urllib.request.Request(url, data=body, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=20) as res:
        return json.loads(res.read().decode("utf-8"))


def metres_between(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lng1, lat2, lng2 = map(math.radians, (*a, *b))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(h))


def walk_minutes(a: tuple[float, float], b: tuple[float, float]) -> float:
    return metres_between(a, b) * DETOUR_FACTOR / WALK_METRES_PER_MIN


def geocode(address: str, fetch: Fetch = http_json) -> Optional[tuple[float, float]]:
    q = urllib.parse.urlencode({"q": f"{address}, Hamilton, Ontario, Canada", "format": "jsonv2",
                                "limit": 1, "countrycodes": "ca"})
    results = fetch(f"https://nominatim.openstreetmap.org/search?{q}", None)
    if not results:
        return None
    return float(results[0]["lat"]), float(results[0]["lon"])


def overpass_query(lat: float, lng: float) -> str:
    return f"""[out:json][timeout:20];
(
  nwr(around:{GROCERY_SEARCH_METRES},{lat},{lng})[shop~"^(supermarket|greengrocer)$"];
  nwr(around:800,{lat},{lng})[amenity~"^(restaurant|cafe|fast_food)$"];
  nwr(around:1000,{lat},{lng})[amenity~"^(bar|pub|nightclub|cafe)$"];
  nwr(around:1000,{lat},{lng})[leisure=fitness_centre];
);
out center tags;"""


def _point(el: dict) -> Optional[tuple[float, float]]:
    if "lat" in el:
        return el["lat"], el["lon"]
    if "center" in el:
        return el["center"]["lat"], el["center"]["lon"]
    return None


def nearby(lat: float, lng: float, fetch: Fetch = http_json) -> LocationInputs:
    body = urllib.parse.urlencode({"data": overpass_query(lat, lng)}).encode()
    data = fetch("https://overpass-api.de/api/interpreter", body)
    home = (lat, lng)
    grocery = []
    food = social = 0
    seen = set()
    for el in data.get("elements", []):
        key = (el.get("type"), el.get("id"))
        if key in seen:
            continue
        seen.add(key)
        p = _point(el)
        if p is None:
            continue
        tags = el.get("tags", {})
        d = metres_between(home, p)
        if tags.get("shop") in ("supermarket", "greengrocer"):
            grocery.append(walk_minutes(home, p))
        if tags.get("amenity") in ("restaurant", "cafe", "fast_food") and d <= 800:
            food += 1
        if (tags.get("amenity") in ("bar", "pub", "nightclub", "cafe") or tags.get("leisure") == "fitness_centre") and d <= 1000:
            social += 1
    # No grocery store within 2.5 km: record it as just past the "bad" end of the ramp.
    grocery_minutes = min(grocery) if grocery else GROCERY_SEARCH_METRES * DETOUR_FACTOR / WALK_METRES_PER_MIN
    return LocationInputs(walk_minutes=walk_minutes(home, CAMPUS), grocery_walk_minutes=grocery_minutes,
                          food_places_800m=food, social_places_1km=social)


def locate(address: str, fetch: Fetch = http_json, pause: Callable[[float], None] = time.sleep):
    """Returns ((lat, lng), LocationInputs) or None when the address can't be found."""
    point = geocode(address, fetch)
    if point is None:
        return None
    pause(1.0)    # Nominatim's one-request-a-second rule
    return point, nearby(*point, fetch=fetch)
