"""Pakistan city centroids and stable store pin offsets for the live map."""

from __future__ import annotations

from decimal import Decimal

# Approximate city centers (lat, lng)
CITY_CENTROIDS: dict[str, tuple[float, float]] = {
    'lahore': (31.5204, 74.3587),
    'karachi': (24.8607, 67.0011),
    'islamabad': (33.6844, 73.0479),
    'rawalpindi': (33.5651, 73.0169),
    'multan': (30.1575, 71.5249),
    'faisalabad': (31.4504, 73.1350),
    'peshawar': (34.0151, 71.5249),
    'quetta': (30.1798, 66.9750),
    'hyderabad': (25.3960, 68.3578),
    'sialkot': (32.4945, 74.5229),
}

DEFAULT_CENTER = (30.3753, 69.3451)  # Pakistan centroid-ish


def coordinates_for_store(city: str, store_id: int, address: str = '') -> tuple[Decimal, Decimal]:
    key = (city or '').strip().lower()
    base_lat, base_lng = CITY_CENTROIDS.get(key, DEFAULT_CENTER)

    # Stable small offset so multiple stores in one city don't stack
    n = int(store_id or 0)
    # ~0.01–0.04 degrees (~1–4 km)
    lat_off = ((n * 37) % 17 - 8) * 0.004
    lng_off = ((n * 53) % 17 - 8) * 0.004

    # Light address hash nudge
    if address:
        h = sum(ord(c) for c in address) % 11
        lat_off += (h - 5) * 0.001
        lng_off += ((h * 3) % 11 - 5) * 0.001

    return (
        Decimal(f'{base_lat + lat_off:.6f}'),
        Decimal(f'{base_lng + lng_off:.6f}'),
    )
