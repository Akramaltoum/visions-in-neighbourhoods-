"""Vercel Python function: recomputes rating scores with the rating engine.

POST {"houseId": "..."} rescores one house (the website calls this after a new
listing or an approved lease). GET is the nightly Vercel Cron run: it looks up map
data for houses that don't have it yet, then rescores every house.
Both need "Authorization: Bearer <CRON_SECRET>".
"""
import hmac
import json
import os
import sys
import time
from datetime import date
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import psycopg  # noqa: E402

from rating_engine import store  # noqa: E402
from rating_engine.adapters import osm  # noqa: E402

TIME_BUDGET_SECONDS = 50       # the function's limit is 60
MAX_LOOKUPS_PER_RUN = 15       # map lookups are slow and rate limited


def connect():
    # prepare_threshold=None: the Supabase pooler (transaction mode) can't keep prepared statements.
    return psycopg.connect(os.environ["DATABASE_URL"], prepare_threshold=None, sslmode="require")


def rescore_one(conn, house_id, lookup=True):
    with conn.cursor() as cur:
        house = store.load_house(cur, house_id)
        if house is None:
            return None
        cur.execute("SELECT lat, is_sample FROM houses WHERE id = %s", (house_id,))
        lat, is_sample = cur.fetchone()
        if lookup and lat is None and not is_sample:
            try:
                found = osm.locate(house.address)
            except Exception as err:  # map services down: score with what we have
                print(f"Map lookup failed for {house_id}: {err}")
                found = None
            if found:
                store.save_location(cur, house_id, *found)
                house = store.load_house(cur, house_id)
        ctx = store.load_context(cur, house, date.today())
        result = store.save(cur, house_id, house, ctx)
    conn.commit()
    return result


def rescore_all(conn):
    start = time.monotonic()
    with conn.cursor() as cur:
        # Houses never scored, or missing map data, go first.
        cur.execute("SELECT id, lat IS NULL AND NOT is_sample FROM houses ORDER BY rescored_at NULLS FIRST")
        rows = cur.fetchall()
    done = lookups = 0
    for house_id, needs_lookup in rows:
        if time.monotonic() - start > TIME_BUDGET_SECONDS:
            break
        lookup = needs_lookup and lookups < MAX_LOOKUPS_PER_RUN
        lookups += int(lookup)
        rescore_one(conn, str(house_id), lookup=lookup)
        done += 1
    return {"rescored": done, "total": len(rows), "mapLookups": lookups}


class handler(BaseHTTPRequestHandler):
    def _authorized(self):
        secret = os.environ.get("CRON_SECRET", "")
        given = self.headers.get("authorization", "")
        return bool(secret) and hmac.compare_digest(given, f"Bearer {secret}")

    def _send(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if not self._authorized():
            return self._send(401, {"error": "unauthorized"})
        with connect() as conn:
            self._send(200, rescore_all(conn))

    def do_POST(self):
        if not self._authorized():
            return self._send(401, {"error": "unauthorized"})
        length = int(self.headers.get("content-length") or 0)
        try:
            house_id = json.loads(self.rfile.read(length) or b"{}").get("houseId")
        except ValueError:
            house_id = None
        if not house_id:
            return self._send(400, {"error": "houseId is required"})
        with connect() as conn:
            result = rescore_one(conn, str(house_id))
        if result is None:
            return self._send(404, {"error": "house not found"})
        self._send(200, {"houseId": house_id, "scores": result})
