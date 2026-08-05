#!/usr/bin/env -S uv run python
# /// script
# dependencies = ["reverse-geocoder"]
# ///
"""Download geolocated Claude Monet paintings from Wikidata."""

import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

import reverse_geocoder as rg

ENDPOINT = "https://query.wikidata.org/sparql"
BATCH_SIZE = 100
OUTPUT = Path(__file__).with_name("paintings.json")


def query(offset: int) -> str:
    return f"""
SELECT DISTINCT ?painting ?paintingLabel ?image
                ?collection ?collectionLabel ?coord WHERE {{
  ?painting wdt:P170 wd:Q296;
            wdt:P31 wd:Q3305213;
            wdt:P195 ?collection.
  ?collection wdt:P625 ?coord.
  OPTIONAL {{ ?painting wdt:P18 ?image. }}
  SERVICE wikibase:label {{
    bd:serviceParam wikibase:language "en,fr".
  }}
}}
ORDER BY ?painting ?collection ?image
LIMIT {BATCH_SIZE}
OFFSET {offset}
"""


def fetch_batch(offset: int) -> list[dict]:
    params = urllib.parse.urlencode({"query": query(offset), "format": "json"})
    request = urllib.request.Request(
        f"{ENDPOINT}?{params}",
        headers={
            "Accept": "application/sparql-results+json",
            "User-Agent": "doehyunbaek.github.io Monet map/1.0",
        },
    )

    for attempt in range(5):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return json.load(response)["results"]["bindings"]
        except Exception:
            if attempt == 4:
                raise
            time.sleep(2 ** attempt)

    raise RuntimeError("Unreachable")


def value(row: dict, key: str, default: str = "") -> str:
    return row.get(key, {}).get("value", default)


def main() -> None:
    rows = []
    offset = 0

    while True:
        batch = fetch_batch(offset)
        rows.extend(batch)
        print(f"Downloaded {len(rows)} rows")
        if len(batch) < BATCH_SIZE:
            break
        offset += BATCH_SIZE
        time.sleep(0.2)

    records = [
        {
            "painting": value(row, "painting"),
            "title": value(row, "paintingLabel"),
            "image": value(row, "image"),
            "collection": value(row, "collection"),
            "collectionName": value(row, "collectionLabel"),
            "coord": value(row, "coord"),
        }
        for row in rows
    ]

    points = []
    for record in records:
        match = re.fullmatch(r"Point\((-?[\d.]+) (-?[\d.]+)\)", record["coord"])
        if not match:
            raise ValueError(f"Invalid coordinate: {record['coord']}")
        points.append((float(match.group(2)), float(match.group(1))))

    for record, city in zip(records, rg.search(points, mode=1), strict=True):
        record["city"] = city["name"]
        record["countryCode"] = city["cc"]

    payload = {
        "source": "Wikidata",
        "sourceUrl": "https://www.wikidata.org/wiki/Q296",
        "records": records,
    }
    OUTPUT.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {len(records)} records to {OUTPUT}")


if __name__ == "__main__":
    main()
