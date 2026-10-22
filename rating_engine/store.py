"""Reads houses from the website's Postgres database and writes their scores back."""
from __future__ import annotations

import json
from datetime import date, timedelta
from statistics import median
from typing import Optional

from . import config, prices
from .engine import Context, monthly_total, score_house
from .models import Evidence, House, Listing, LocationInputs, Review

HOUSE_COLS = ("id, address, neighbourhood, landlord_name, walk_minutes, bus_minutes, bus_gap_minutes, "
              "grocery_walk_minutes, food_places_800m, social_places_1km, parking_spots, lat, is_sample")


def _review(row) -> Review:
    ratings, lived_until, utilities, commute = row
    if isinstance(ratings, str):
        ratings = json.loads(ratings)
    return Review({k: int(v) for k, v in ratings.items()}, lived_until, True, utilities, commute)


def load_house(cur, house_id: str) -> Optional[House]:
    cur.execute(f"SELECT {HOUSE_COLS} FROM houses WHERE id = %s", (house_id,))
    row = cur.fetchone()
    if row is None:
        return None
    (hid, address, hood, landlord, walk, bus, gap, grocery, food, social, parking, _lat, _sample) = row
    house = House(address, hood, landlord or "",
                  LocationInputs(walk, bus, gap, grocery, food, social, parking))
    house.id = str(hid)
    cur.execute("""SELECT rent_per_room, bedrooms, utilities_included, source, url, last_checked
                   FROM listings WHERE house_id = %s AND active ORDER BY created_at DESC LIMIT 1""", (house_id,))
    l = cur.fetchone()
    if l:
        house.listing = Listing(l[0], l[1], l[2], l[3], l[4] or "", l[5])
    cur.execute("""SELECT ratings, lived_until, utilities_per_month, commute_minutes
                   FROM reviews WHERE house_id = %s AND status = 'verified'""", (house_id,))
    house.reviews = [_review(r) for r in cur.fetchall()]
    cur.execute("""SELECT score, source, value, seen_on, specificity, claim, url, signal, signal_amount,
                          about_address, about_landlord FROM evidence WHERE house_id = %s""", (house_id,))
    house.evidence = [Evidence(r[0], r[1], r[2], r[3], r[4], r[5] or "", r[6] or "", r[7], r[8], r[9] or "", r[10] or "")
                      for r in cur.fetchall()]
    return house


def load_context(cur, house: House, today: date) -> Context:
    cur.execute("SELECT name, inside_average FROM neighbourhoods")
    averages = {name: avg for name, avg in cur.fetchall()}
    cur.execute("""SELECT r.ratings, r.lived_until, r.utilities_per_month, r.commute_minutes FROM reviews r
                   JOIN houses h ON h.id = r.house_id
                   WHERE r.status = 'verified' AND h.neighbourhood = %s AND r.utilities_per_month IS NOT NULL""",
                (house.neighbourhood,))
    hood_reviews = [_review(r) for r in cur.fetchall()]
    utilities = prices.utilities_estimate(today, hood_reviews)
    fallback = utilities[0] if utilities else config.FALLBACK_UTILITIES_PER_ROOM
    comparables = []
    if house.listing:
        cur.execute("""SELECT l.rent_per_room, l.utilities_included FROM listings l JOIN houses h ON h.id = l.house_id
                       WHERE h.neighbourhood = %s AND l.bedrooms = %s AND l.created_at > %s""",
                    (house.neighbourhood, house.listing.bedrooms, today - timedelta(days=365)))
        comparables = [rent + (0 if included else fallback) for rent, included in cur.fetchall()]
    return Context(today=today, neighbourhood_inside_average=averages, comparable_totals=comparables,
                   neighbourhood_reviews=hood_reviews)


def price_info(house: House, ctx: Context) -> Optional[dict]:
    if house.listing is None:
        return None
    estimate = prices.utilities_estimate(ctx.today, house.reviews, ctx.street_reviews, ctx.neighbourhood_reviews)
    total = monthly_total(house, ctx)
    label = prices.utilities_label(estimate) if estimate else (
        f"about ${config.FALLBACK_UTILITIES_PER_ROOM:.0f} a month, placeholder until tenants report real costs")
    return {"monthlyTotal": round(total) if total is not None else None, "utilitiesLabel": label,
            "fairPrice": round(median(ctx.comparable_totals)) if ctx.comparable_totals else None}


def save(cur, house_id: str, house: House, ctx: Context) -> dict:
    scores = score_house(house, ctx)
    cur.execute("DELETE FROM scores WHERE house_id = %s", (house_id,))
    for s in scores.values():
        cur.execute("""INSERT INTO scores (house_id, name, value, confidence, note, sources)
                       VALUES (%s, %s, %s, %s, %s, %s)""",
                    (house_id, s.name, round(s.value, 2), round(s.confidence, 3), s.note, json.dumps(s.sources)))
    cur.execute("UPDATE houses SET price_info = %s, rescored_at = now() WHERE id = %s",
                (json.dumps(price_info(house, ctx)), house_id))
    return {k: round(v.value, 2) for k, v in scores.items()}


def save_location(cur, house_id: str, point: tuple[float, float], loc: LocationInputs) -> None:
    cur.execute("""UPDATE houses SET lat = %s, lng = %s, walk_minutes = %s, grocery_walk_minutes = %s,
                   food_places_800m = %s, social_places_1km = %s WHERE id = %s""",
                (point[0], point[1], loc.walk_minutes, loc.grocery_walk_minutes, loc.food_places_800m,
                 loc.social_places_1km, house_id))
